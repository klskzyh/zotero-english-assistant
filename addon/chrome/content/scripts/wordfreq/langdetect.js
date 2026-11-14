/* 语言判定。
 *
 * 目的是回答一个是非题：这份文献是不是英文？不是就拒绝统计。
 * 分三层证据，任何一层判定为非英文就直接返回，并把依据带回去给用户看。
 *
 *   第一层 书写系统：非拉丁字母占全部字母的比例。中日韩、西里尔、希腊、
 *           阿拉伯等文字在这一层被拦下。
 *   第二层 变音符密度：区分法语、德语、西班牙语这类同样用拉丁字母的语言。
 *           只作旁证，因为 PDF 提取会丢符号、参考文献里的人名会抬高它。
 *   第三层 功能词命中率：决定性判据。英语要同时过绝对门槛和相对门槛。
 *
 * 这个文件不读设置，阈值全部由调用方通过 opts 传进来，方便离线测。
 */

var WordFreq = WordFreq || {};

WordFreq.langdetect = (function () {
	var RE_LETTER = /\p{L}/gu;
	var RE_LATIN = /\p{Script=Latin}/gu;
	var NON_LATIN_SCRIPTS = [
		['CJK', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu],
		['Cyrillic', /\p{Script=Cyrillic}/gu],
		['Greek', /\p{Script=Greek}/gu],
		['Arabic', /\p{Script=Arabic}/gu],
		['Hebrew', /\p{Script=Hebrew}/gu],
		['Devanagari', /\p{Script=Devanagari}/gu],
		['Thai', /\p{Script=Thai}/gu],
	];

	// 对照语言。英语是待检验的假设，其余是竞争项。
	var CANDIDATES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl'];

	var DEFAULTS = {
		// 取样的总字符数
		sampleChars: 60000,
		// 开头这么多字符跳过：首页是标题、作者、单位，功能词少而人名符号多
		skipChars: 2000,
		// 样本词数低于此值不判定
		minTokens: 300,
		// 英语功能词命中率下限（百分数）
		minEnglishPercent: 20,
		// 英语相对次高语言要领先的倍数（百分数，130 表示 1.3 倍）
		marginPercent: 130,
		// 非拉丁字母占比上限（百分数）
		maxNonLatinPercent: 2,
	};

	function countMatches(text, re) {
		var m = text.match(re);
		return m ? m.length : 0;
	}

	/** 取样：正文开头一段 + 文档正中一段 */
	function takeSample(text, opts) {
		var max = opts.sampleChars;
		var skip = Math.min(opts.skipChars, Math.floor(text.length / 4));
		if (text.length <= max + skip) {
			return text;
		}
		var headLen = Math.round(max * 0.66);
		var head = text.slice(skip, skip + headLen);
		var mid = Math.floor(text.length / 2);
		var middle = text.slice(mid, mid + (max - headLen));
		return head + '\n' + middle;
	}

	/**
	 * 收集各项证据，不做最终判断。
	 *
	 * @param {string} text 全文或全文缓存
	 * @param {object} [opts] 见 DEFAULTS
	 * @returns {object} 报告
	 */
	function analyze(text, opts) {
		opts = Object.assign({}, DEFAULTS, opts || {});
		var full = String(text == null ? '' : text);
		var sample = takeSample(full, opts);

		var letters = countMatches(sample, RE_LETTER);
		var latinLetters = countMatches(sample, RE_LATIN);
		var nonLatinLetters = Math.max(0, letters - latinLetters);

		var scriptCounts = {};
		var dominantScript = null;
		var dominantCount = 0;
		for (var i = 0; i < NON_LATIN_SCRIPTS.length; i++) {
			var name = NON_LATIN_SCRIPTS[i][0];
			var n = countMatches(sample, NON_LATIN_SCRIPTS[i][1]);
			scriptCounts[name] = n;
			if (n > dominantCount) {
				dominantCount = n;
				dominantScript = name;
			}
		}
		if (nonLatinLetters > dominantCount) {
			dominantScript = 'Other';
		}

		// 变音符密度：拉丁字母里不是 ASCII a-zA-Z 的那部分
		var asciiLetters = countMatches(sample, /[A-Za-z]/g);
		var diacriticLetters = Math.max(0, latinLetters - asciiLetters);

		var tokens = WordFreq.tokenizer.detectTokens(sample);
		var scores = {};
		var englishHits = 0;
		for (var k = 0; k < CANDIDATES.length; k++) {
			scores[CANDIDATES[k]] = 0;
		}
		for (var t = 0; t < tokens.length; t++) {
			var w = tokens[t];
			for (var c = 0; c < CANDIDATES.length; c++) {
				var code = CANDIDATES[c];
				if (WordFreq.langdata.sets[code].has(w)) {
					scores[code]++;
					if (code === 'en') {
						englishHits++;
					}
				}
			}
		}

		var total = tokens.length || 1;
		var shares = {};
		for (var s = 0; s < CANDIDATES.length; s++) {
			shares[CANDIDATES[s]] = scores[CANDIDATES[s]] / total;
		}

		var runnerUpCode = null;
		var runnerUpShare = 0;
		for (var r = 0; r < CANDIDATES.length; r++) {
			var rc = CANDIDATES[r];
			if (rc === 'en') {
				continue;
			}
			if (shares[rc] > runnerUpShare) {
				runnerUpShare = shares[rc];
				runnerUpCode = rc;
			}
		}

		return {
			sampleChars: sample.length,
			textChars: full.length,
			tokens: tokens.length,
			letters: letters,
			latinLetters: latinLetters,
			nonLatinLetters: nonLatinLetters,
			nonLatinShare: letters ? nonLatinLetters / letters : 0,
			scriptCounts: scriptCounts,
			dominantScript: dominantScript,
			diacriticLetters: diacriticLetters,
			diacriticShare: latinLetters ? diacriticLetters / latinLetters : 0,
			englishHits: englishHits,
			scores: scores,
			shares: shares,
			englishShare: shares.en,
			runnerUpCode: runnerUpCode,
			runnerUpShare: runnerUpShare,
			margin: runnerUpShare > 0 ? shares.en / runnerUpShare : Infinity,
			thresholds: opts,
		};
	}

	function pct(v) {
		return (v * 100).toFixed(1) + '%';
	}

	/**
	 * 判定并给出可直接展示给用户的理由。
	 *
	 * @returns {{isEnglish: boolean, code: string, reason: string, report: object}}
	 *   code 取值：english / script / stopwords / too-short / empty
	 */
	function detect(text, opts) {
		opts = Object.assign({}, DEFAULTS, opts || {});
		var report = analyze(text, opts);

		if (!report.textChars) {
			return {
				isEnglish: false,
				code: 'empty',
				reason: '这份文献没有可用的文本内容。',
				report: report,
			};
		}

		// 书写系统这一层必须排在词数判断前面。
		// 中文正文里一个拉丁词都没有，判定用的切词会切出 0 个 token，
		// 先看词数就会把中文文献误报成「文本太短，无法判定」。
		var maxNonLatin = opts.maxNonLatinPercent / 100;
		if (report.letters > 0 && report.nonLatinShare > maxNonLatin) {
			var scriptName = WordFreq.langdata.scriptNames[report.dominantScript] || '非拉丁文字';
			return {
				isEnglish: false,
				code: 'script',
				reason: '检出' + scriptName + '占全部字母的 ' + pct(report.nonLatinShare)
					+ '（上限 ' + opts.maxNonLatinPercent + '%），判定为非英文文献。',
				report: report,
			};
		}

		if (report.tokens < opts.minTokens) {
			return {
				isEnglish: false,
				code: 'too-short',
				reason: '正文里可用的词只有 ' + report.tokens + ' 个，少于判定的下限 '
					+ opts.minTokens + ' 个，无法可靠判断语言。若这是扫描件，请先做 OCR。',
				report: report,
			};
		}

		var englishOk = report.englishShare * 100 >= opts.minEnglishPercent;
		var marginOk = report.englishShare >= (opts.marginPercent / 100) * report.runnerUpShare;

		if (englishOk && marginOk) {
			return {
				isEnglish: true,
				code: 'english',
				reason: '英语功能词命中率 ' + pct(report.englishShare)
					+ '，是次高语言（'
					+ (WordFreq.langdata.names[report.runnerUpCode] || report.runnerUpCode)
					+ ' ' + pct(report.runnerUpShare) + '）的 '
					+ (report.runnerUpShare > 0 ? report.margin.toFixed(2) : '∞') + ' 倍。',
				report: report,
			};
		}

		var best = report.runnerUpCode;
		var detail = best
			? '最匹配的是' + (WordFreq.langdata.names[best] || best) + '，功能词命中率 ' + pct(report.runnerUpShare) + '。'
			: '没有任何语言的功能词命中率达标。';
		var why = !englishOk
			? '英语功能词命中率只有 ' + pct(report.englishShare) + '，低于门槛 ' + opts.minEnglishPercent + '%。'
			: '英语功能词命中率 ' + pct(report.englishShare) + '，但没有比其它语言高出要求的 '
				+ (opts.marginPercent / 100).toFixed(2) + ' 倍。';

		return {
			isEnglish: false,
			code: 'stopwords',
			reason: why + detail + '判定为非英文文献。',
			report: report,
		};
	}

	/** 把判定报告压成一行，写进 Zotero 调试输出 */
	function summarize(result) {
		var r = result.report;
		return '[英文助手·词频] lang=' + result.code
			+ ' tokens=' + r.tokens
			+ ' nonLatin=' + pct(r.nonLatinShare)
			+ ' diacritic=' + pct(r.diacriticShare)
			+ ' en=' + pct(r.englishShare)
			+ ' runnerUp=' + r.runnerUpCode + ':' + pct(r.runnerUpShare)
			+ ' margin=' + (r.runnerUpShare > 0 ? r.margin.toFixed(2) : 'inf');
	}

	return {
		DEFAULTS: DEFAULTS,
		analyze: analyze,
		detect: detect,
		summarize: summarize,
		takeSample: takeSample,
	};
})();
