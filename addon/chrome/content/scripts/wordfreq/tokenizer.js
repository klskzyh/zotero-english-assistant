/* 文本清洗与切词。
 *
 * 这一层是纯函数，不碰 Zotero 的任何接口，所以可以脱离 Zotero 单独测。
 * PDF 文字层里有一堆会污染词频的东西，全在这个文件里处理掉。
 */

var WordFreq = WordFreq || {};

WordFreq.tokenizer = (function () {
	// 带变音符的拉丁字母范围：Latin-1 补充、Latin Extended-A/B、Latin Extended Additional
	var LATIN_DIACRITICS = /[\u00c0-\u024f\u1e00-\u1eff]/;
	// 组合用变音符
	var COMBINING_MARKS = /[\u0300-\u036f]/g;
	// 软连字符、零宽字符、BOM。PDF 提取经常混进这些，肉眼看不见但会把单词切断
	var INVISIBLES = /[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g;
	// 各种撇号写法
	var APOSTROPHES = /[\u2018\u2019\u02bc\u00b4\u0060]/g;
	// 真正的连字符
	var HYPHENS = /[\u2010\u2011]/g;
	// 破折号与减号：当分隔符用，换成空格，免得把两侧的单词粘成一个
	var DASHES = /[\u2012\u2013\u2014\u2212]/g;
	// 行末断词：informa- 换行接 tion
	var LINE_BREAK_HYPHEN = /([A-Za-z])-\s*\r?\n\s*([A-Za-z])/g;

	/**
	 * 把文本整理成可以直接切词的形态。
	 *
	 * @param {string} text 原始文本
	 * @param {object} [opts] mergeCase / joinLineBreakHyphen，默认都为 true
	 * @returns {string}
	 */
	function normalize(text, opts) {
		opts = opts || {};
		var s = text == null ? '' : String(text);
		if (!s) {
			return '';
		}

		// NFKC 拆连字：ﬁ ﬂ ﬀ ﬃ ﬄ 变回 fi fl ff ffi ffl
		s = s.normalize('NFKC');

		s = s.replace(INVISIBLES, '');

		// 折掉变音符。不做这一步的话，naïve 会被 [a-z]+ 切成 na 和 ve 两个假词。
		// 只在真的出现带符号字母时才做，省掉一次全量遍历。
		if (LATIN_DIACRITICS.test(s)) {
			s = s.normalize('NFD').replace(COMBINING_MARKS, '').replace(/\u00df/g, 'ss');
		}

		s = s.replace(APOSTROPHES, "'");
		s = s.replace(HYPHENS, '-');
		s = s.replace(DASHES, ' ');

		if (opts.joinLineBreakHyphen !== false) {
			s = s.replace(LINE_BREAK_HYPHEN, '$1$2');
		}

		if (opts.mergeCase !== false) {
			s = s.toLowerCase();
		}

		return s;
	}

	function patternFor(splitHyphen, mergeCase) {
		var letters = mergeCase === false ? '[A-Za-z]' : '[a-z]';
		// 连字符处拆词（默认）：well-known 切成 well 与 known
		// 不拆时：把连字符留在词里，well-known 是一个 token
		var joiner = splitHyphen === false ? "['\\-]" : "'";
		return new RegExp(letters + '+(?:' + joiner + letters + '+)*', 'g');
	}

	/**
	 * 清洗后切词。
	 *
	 * @param {string} text
	 * @param {object} [opts] mergeCase / splitHyphen / joinLineBreakHyphen
	 * @returns {string[]}
	 */
	function tokens(text, opts) {
		opts = opts || {};
		var s = normalize(text, opts);
		if (!s) {
			return [];
		}
		var re = patternFor(opts.splitHyphen, opts.mergeCase);
		var out = s.match(re);
		return out || [];
	}

	/**
	 * 切词并计数。
	 *
	 * @param {string} text
	 * @param {object} [opts] 另外支持 minLength、lemmaFn、trackForms
	 *   lemmaFn(rawWord, vocab) 给出词形归并结果，不传就按原样统计
	 * @returns {{counts: Map<string, number>, total: number, unique: number,
	 *   forms: Map<string, Map<string, number>>|null}}
	 */
	function count(text, opts) {
		opts = opts || {};
		var minLength = opts.minLength > 1 ? opts.minLength : 1;
		var list = tokens(text, opts);
		var counts = new Map();
		var forms = opts.lemmaFn ? new Map() : null;
		var total = 0;

		// 归并前先摸清这份文本里出现过的词形。
		// vocab 用来裁决歧义：used 到底归 us 还是 use，看文本里出现过哪个。
		// capitalized 记「基本只以大写出现」的词，专有名词靠它躲开规则剥后缀——
		// Sachs 不该被剥成 sach。判据是小写占比低于四分之一：正文里
		// Rehding 大写 10 次、小写 2 次（可能出现在文件名或网址里），
		// 按「一次小写都没出现过」判会漏掉它。
		// 分词规则在大小写两种模式下边界一致，所以两份 token 数组下标对齐。
		var vocab = null;
		var capitalized = null;
		if (opts.lemmaFn) {
			vocab = new Set();
			var caseList = tokens(text, Object.assign({}, opts, { mergeCase: false }));
			var lowerCount = new Map();
			var totalCount = new Map();
			var i2;
			for (i2 = 0; i2 < list.length; i2++) {
				var t2 = list[i2];
				if (t2.length < minLength) {
					continue;
				}
				vocab.add(t2);
				totalCount.set(t2, (totalCount.get(t2) || 0) + 1);
				if (caseList[i2] === t2) {
					lowerCount.set(t2, (lowerCount.get(t2) || 0) + 1);
				}
			}
			capitalized = new Set();
			totalCount.forEach(function (total2, w2) {
				if ((lowerCount.get(w2) || 0) * 4 < total2) {
					capitalized.add(w2);
				}
			});
		}

		for (var i = 0; i < list.length; i++) {
			var raw = list[i];
			if (raw.length < minLength) {
				continue;
			}
			var w = opts.lemmaFn ? opts.lemmaFn(raw, vocab, capitalized) : raw;
			if (!w) {
				w = raw;
			}
			counts.set(w, (counts.get(w) || 0) + 1);
			if (forms) {
				var perLemma = forms.get(w);
				if (!perLemma) {
					perLemma = new Map();
					forms.set(w, perLemma);
				}
				perLemma.set(raw, (perLemma.get(raw) || 0) + 1);
			}
			total++;
		}
		return { counts: counts, total: total, unique: counts.size, forms: forms };
	}

	/**
	 * 判定语言用的切词。按 [a-z]+ 切，撇号与连字符都断开，
	 * 并把变音符折掉——表里写的都是 ASCII 形态。
	 */
	function detectTokens(sample) {
		var s = String(sample == null ? '' : sample);
		if (!s) {
			return [];
		}
		s = s.normalize('NFKC').replace(INVISIBLES, '');
		if (LATIN_DIACRITICS.test(s)) {
			s = s.normalize('NFD').replace(COMBINING_MARKS, '').replace(/\u00df/g, 'ss');
		}
		s = s.toLowerCase();
		return s.match(/[a-z]+/g) || [];
	}

	return {
		normalize: normalize,
		tokens: tokens,
		count: count,
		detectTokens: detectTokens,
	};
})();
