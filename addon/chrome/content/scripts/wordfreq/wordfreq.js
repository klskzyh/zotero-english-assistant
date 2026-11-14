/* 词频统计与 CSV 生成。
 *
 * 同样是纯函数，不依赖 Zotero。切词交给 tokenizer，这里负责排序、筛选和排版。
 */

var WordFreq = WordFreq || {};

WordFreq.wordfreq = (function () {
	/**
	 * 把计数字典排成表。
	 * 先按出现次数降序，次数相同时按字母升序，保证每次跑出来的顺序一致。
	 *
	 * @param {Map<string, number>} counts
	 * @param {number} totalTokens 全文 token 总数，用来算占比
	 * @returns {Array<{word: string, count: number, share: number}>}
	 */
	function rank(counts, totalTokens) {
		var rows = [];
		counts.forEach(function (count, word) {
			rows.push({ word: word, count: count, share: totalTokens ? count / totalTokens : 0 });
		});
		rows.sort(function (a, b) {
			if (b.count !== a.count) {
				return b.count - a.count;
			}
			return a.word < b.word ? -1 : (a.word > b.word ? 1 : 0);
		});
		return rows;
	}

	/** 把一个原形合并过的词形拼成 forms 列的内容：dogs:5; dog:3 */
	function formatForms(formMap) {
		if (!formMap || formMap.size < 2) {
			return '';
		}
		var list = [];
		formMap.forEach(function (count, form) {
			list.push({ form: form, count: count });
		});
		list.sort(function (a, b) {
			if (b.count !== a.count) {
				return b.count - a.count;
			}
			return a.form < b.form ? -1 : (a.form > b.form ? 1 : 0);
		});
		return list.map(function (x) {
			return x.form + ':' + x.count;
		}).join('; ');
	}

	/**
	 * 完整流程：清洗 → 切词 → 词形归并 → 计数 → 排序 → 筛选。
	 *
	 * @param {string} text 全文
	 * @param {object} [opts]
	 *   mergeCase / splitHyphen / joinLineBreakHyphen / minLength  交给 tokenizer
	 *   lemmatize 是否做词形归并，默认 true
	 *   mergePossessive 是否把 dog's 并进 dog，默认 true
	 *   includeStopwords 是否保留停用词，默认 true
	 *   topN 只保留前 N 个，0 表示全部
	 * @returns {{rows: Array, totalTokens: number, uniqueWords: number,
	 *   listedTokens: number, lemmatized: boolean, mergedForms: number}}
	 */
	function run(text, opts) {
		opts = opts || {};

		// 大小写都保留着的时候不适合归并：词形表是按小写查的，
		// 强行归并会拿小写原形去盖掉原样的大写词。
		var lemmatized = opts.lemmatize !== false
			&& opts.mergeCase !== false
			&& !!WordFreq.lemma;
		var countOpts = {};
		for (var key in opts) {
			countOpts[key] = opts[key];
		}
		if (lemmatized) {
			var possess = opts.mergePossessive !== false;
			countOpts.lemmaFn = function (word, vocab, capitalized) {
				return WordFreq.lemma.of(word, vocab, {
					possessive: possess,
					capitalized: capitalized,
				});
			};
		}

		var counted = WordFreq.tokenizer.count(text, countOpts);
		var totalTokens = counted.total;
		var rows = rank(counted.counts, totalTokens);

		// 每个原形挂上它由哪些词形合并而来。只有一个词形时留空，
		// 免得 forms 列把 word 列重复一遍。
		var mergedForms = 0;
		if (counted.forms) {
			for (var r = 0; r < rows.length; r++) {
				var text2 = formatForms(counted.forms.get(rows[r].word));
				rows[r].forms = text2;
				if (text2) {
					mergedForms++;
				}
			}
		}

		if (opts.includeStopwords === false) {
			var stop = WordFreq.langdata.sets.en;
			rows = rows.filter(function (row) {
				return !stop.has(row.word);
			});
		}

		/* 只出现一次的词。这里不给默认值：传 skipSingles: true 才过滤，
		 * 纯函数不替调用方做决定（设置项那边的默认是开启）。
		 * 归并已经做完，所以是按词元的总次数判断：dog 与 dogs 各出现一次时算两次，会留下。 */
		if (opts.skipSingles === true) {
			rows = rows.filter(function (row) {
				return row.count > 1;
			});
		}

		// 去重词元数按筛选后算，但不受 topN 截断影响
		var uniqueWords = rows.length;

		if (opts.topN > 0 && rows.length > opts.topN) {
			rows = rows.slice(0, opts.topN);
		}

		// 表中词次：只算真正写进 CSV 的那些行
		var listedTokens = rows.reduce(function (sum, row) {
			return sum + row.count;
		}, 0);

		return {
			rows: rows,
			totalTokens: totalTokens,
			uniqueWords: uniqueWords,
			listedTokens: listedTokens,
			lemmatized: lemmatized,
			mergedForms: mergedForms,
		};
	}

	/** CSV 字段转义：含逗号、引号、换行时用双引号包起来 */
	function csvField(value) {
		var s = value == null ? '' : String(value);
		if (/[",\r\n]/.test(s)) {
			return '"' + s.replace(/"/g, '""') + '"';
		}
		return s;
	}

	function csvLine(fields) {
		return fields.map(csvField).join(',');
	}

	/**
	 * 生成 CSV 文本。
	 *
	 * 头几行是 # 开头的元信息，方便日后回头核对这份表是哪来的。
	 * pandas 读取时用 pd.read_csv(path, comment='#')，Excel 直接双击即可。
	 *
	 * @param {Array} rows rank() 的输出
	 * @param {object} meta 元信息，键值都会写进注释行
	 * @param {object} [opts] bom 是否加 UTF-8 BOM，默认 true
	 * @returns {string}
	 */
	function buildCsv(rows, meta, opts) {
		opts = opts || {};
		meta = meta || {};
		var lines = [];

		var order = [
			['source', '来源文件'],
			['generated', '生成时间'],
			['total_words', '全文词次'],
			['listed_words', '表中词次'],
			['unique_words', '去重词数'],
			['lemma', '词形归并'],
			['language', '语言判定'],
			['text_source', '取文本方式'],
			// 分部词频写「页码范围」；整本词频不传这个键，行就不会出现
			['page_range', '页码范围'],
			// EPUB 分部按字符百分比，写「范围」；PDF 分部与整本都不传
			['range', '范围'],
			['pages', '页数'],
			['note', '备注'],
		];
		for (var i = 0; i < order.length; i++) {
			var key = order[i][0];
			if (meta[key] === undefined || meta[key] === null || meta[key] === '') {
				continue;
			}
			lines.push('# ' + csvLine([order[i][1], String(meta[key])]));
		}

		// forms 只在合并过词形时才有内容。单一词形的行留空，
		// 免得把 word 列重复一遍。
		lines.push(csvLine(['rank', 'word', 'count', 'share_percent', 'forms']));
		for (var r = 0; r < rows.length; r++) {
			lines.push(csvLine([
				r + 1,
				rows[r].word,
				rows[r].count,
				(rows[r].share * 100).toFixed(4),
				rows[r].forms || '',
			]));
		}

		var text = lines.join('\r\n') + '\r\n';
		return opts.bom === false ? text : '\ufeff' + text;
	}

	/** 拆一行 CSV，处理双引号包裹与 "" 转义 */
	function parseCsvLine(line) {
		var out = [];
		var cur = '';
		var quoted = false;
		for (var i = 0; i < line.length; i++) {
			var ch = line.charAt(i);
			if (quoted) {
				if (ch === '"') {
					if (line.charAt(i + 1) === '"') {
						cur += '"';
						i++;
					}
					else {
						quoted = false;
					}
				}
				else {
					cur += ch;
				}
			}
			else if (ch === '"') {
				quoted = true;
			}
			else if (ch === ',') {
				out.push(cur);
				cur = '';
			}
			else {
				cur += ch;
			}
		}
		out.push(cur);
		return out;
	}

	/**
	 * 解析自己写出的那份 CSV。
	 *
	 * 用途：文献已经统计过时，直接把表读回来渲染，不必重新提取一遍 PDF 全文。
	 * 表里该有的都有：全文词次、去重词数、取文本方式、以及全部词元。
	 *
	 * @param {string} text
	 * @returns {{meta: object, rows: Array, lineCount: number}}
	 */
	function parseCsv(text) {
		var out = { meta: {}, rows: [], lineCount: 0 };
		if (!text) {
			return out;
		}
		// 我们写出的表带 UTF-8 BOM
		if (text.charCodeAt(0) === 0xfeff) {
			text = text.slice(1);
		}
		var lines = text.split(/\r\n|\n|\r/);
		var inTable = false;
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			if (!line) {
				continue;
			}
			if (!inTable) {
				if (line.charAt(0) === '#') {
					var pair = parseCsvLine(line.slice(1));
					if (pair.length >= 2) {
						out.meta[pair[0].trim()] = pair.slice(1).join(',').trim();
					}
					continue;
				}
				var head = parseCsvLine(line);
				if (head.length && head[0].trim() === 'rank') {
					inTable = true;
				}
				// 认不出来的行直接跳过，不报错
				continue;
			}
			var f = parseCsvLine(line);
			if (f.length < 3) {
				continue;
			}
			var count = Number(f[2]);
			if (!isFinite(count)) {
				continue;
			}
			var share = f.length > 3 ? Number(f[3]) : 0;
			out.rows.push({
				word: f[1],
				count: count,
				share: isFinite(share) ? share / 100 : 0,
				forms: f.length > 4 ? f[4] : '',
			});
			out.lineCount++;
		}
		return out;
	}

	/** 摘要里展示的高频词，用「词(次数)」拼成一行 */
	function topWords(rows, n) {
		return rows.slice(0, n).map(function (row) {
			return row.word + '(' + row.count + ')';
		}).join('  ');
	}

	/**
	 * 界面展示用的筛选：滤掉用户加进自定义名单的词。
	 * 只影响条目窗格里显示的那份列表，CSV 不受影响——
	 * CSV 是数据记录，要完整。
	 *
	 * @param {Array} rows run() 出来的行
	 * @param {object} opts hideCustom / customWords（一个 Set）
	 * @returns {{rows: Array, hiddenCustom: number}}
	 */
	function filterForDisplay(rows, opts) {
		opts = opts || {};
		var custom = opts.hideCustom ? (opts.customWords || null) : null;
		if (!custom || !custom.size) {
			return { rows: rows.slice(), hiddenCustom: 0 };
		}
		var out = [];
		var hiddenCustom = 0;
		for (var i = 0; i < rows.length; i++) {
			if (custom.has(rows[i].word)) {
				hiddenCustom++;
				continue;
			}
			out.push(rows[i]);
		}
		return { rows: out, hiddenCustom: hiddenCustom };
	}

	/**
	 * 分页。页码会被夹到合法范围内，越界不报错。
	 *
	 * @param {Array} rows
	 * @param {number} pageSize
	 * @param {number} pageIndex 从 0 起
	 */
	function page(rows, pageSize, pageIndex) {
		rows = rows || [];
		pageSize = pageSize > 0 ? Math.floor(pageSize) : 10;
		var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
		var index = Math.floor(pageIndex || 0);
		if (!(index >= 0)) {
			index = 0;
		}
		if (index > totalPages - 1) {
			index = totalPages - 1;
		}
		var start = index * pageSize;
		return {
			rows: rows.slice(start, start + pageSize),
			pageIndex: index,
			totalPages: totalPages,
			total: rows.length,
			start: start,
		};
	}

	return {
		rank: rank,
		run: run,
		buildCsv: buildCsv,
		parseCsv: parseCsv,
		csvField: csvField,
		topWords: topWords,
		filterForDisplay: filterForDisplay,
		page: page,
	};
})();
