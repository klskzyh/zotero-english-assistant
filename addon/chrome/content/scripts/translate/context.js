/* 上下文提取。
 *
 * 插件要在翻译时提供两样东西：
 *   1. 选中片段在 PDF 原文中的上下文；
 *   2. 这本文献的基本信息。
 *
 * 上下文取自 Zotero 自己的全文索引（附件目录下的 .zotero-ft-cache）。
 * 这个文件由 Zotero 在导入 PDF 时生成，比截阅读器视口里的文字可靠：
 * 缩放、翻页、双页布局都不影响结果，扫描版 PDF 也能反映真实的索引状态。 */

DeepSeekTranslate.context = {
	/** 从面板或阅读器拿到的 item，推出它对应的 PDF 附件 */
	async resolveAttachment(item) {
		if (!item) {
			return null;
		}
		try {
			if (item.isAttachment()) {
				if (item.isPDFAttachment()) {
					return item;
				}
				var parent = item.parentItem;
				if (parent && parent.isRegularItem()) {
					return await parent.getBestAttachment();
				}
				return null;
			}
			if (item.isRegularItem()) {
				return await item.getBestAttachment();
			}
		}
		catch (e) {
			DeepSeekTranslate.logError('解析附件失败', e);
		}
		return null;
	},

	/** 文献基本信息，附件会向上找父条目 */
	buildMetadata(item) {
		if (!item) {
			return null;
		}
		var target = item.isAttachment() ? (item.parentItem || item) : item;
		var read = function (field) {
			try {
				return target.getField(field) || '';
			}
			catch (e) {
				return '';
			}
		};

		var creators = '';
		try {
			creators = (target.getCreators() || [])
				.map(function (c) {
					if (c.name) {
						return c.name;
					}
					return [c.firstName, c.lastName].filter(Boolean).join(' ');
				})
				.filter(Boolean)
				.join('; ');
		}
		catch (e) {
			creators = '';
		}

		var itemType = '';
		try {
			itemType = Zotero.ItemTypes.getLocalizedName(target.itemTypeID) || '';
		}
		catch (e) {
			itemType = '';
		}

		var tags = '';
		try {
			tags = (target.getTags() || []).map(function (t) { return t.tag; }).join('; ');
		}
		catch (e) {
			tags = '';
		}

		var date = read('date');
		var year = (date.match(/\d{4}/) || [''])[0];

		return {
			title: read('title'),
			creators: creators,
			year: year,
			date: date,
			publication: read('publicationTitle') || read('proceedingsTitle') || read('bookTitle') || read('publisher'),
			itemType: itemType,
			abstract: this._truncate(read('abstractNote'), 900),
			tags: tags,
			doi: read('DOI'),
			language: read('language'),
			url: read('url'),
		};
	},

	/** 取 PDF 全文，优先读 Zotero 的全文缓存文件 */
	async getFullText(attachment) {
		if (!attachment) {
			return '';
		}
		var cache = DeepSeekTranslate.state.textCache;
		if (cache.has(attachment.id)) {
			return cache.get(attachment.id);
		}
		var promise = this._loadFullText(attachment);
		cache.set(attachment.id, promise);
		return promise;
	},

	async _loadFullText(attachment) {
		var text = await this._readCacheFile(attachment);
		if (!text) {
			text = await this._extractWithPDFWorker(attachment);
		}
		return text || '';
	},

	async _readCacheFile(attachment) {
		try {
			if (!Zotero.Fulltext || !Zotero.Fulltext.getItemCacheFile) {
				return '';
			}
			var file = Zotero.Fulltext.getItemCacheFile(attachment);
			var path = file && file.path ? file.path : '';
			if (!path) {
				return '';
			}
			var exists = true;
			try {
				exists = await IOUtils.exists(path);
			}
			catch (e) {
				exists = true;
			}
			if (!exists) {
				return '';
			}
			var contents = await Zotero.File.getContentsAsync(path);
			if (contents && contents.trim().length > 20) {
				return contents;
			}
		}
		catch (e) {
			DeepSeekTranslate.log('读取全文缓存失败：' + e);
		}
		return '';
	},

	async _extractWithPDFWorker(attachment) {
		try {
			if (!Zotero.PDFWorker || !Zotero.PDFWorker.getFullText) {
				return '';
			}
			DeepSeekTranslate.log('全文缓存不可用，改用 PDFWorker 现场提取');
			var result = await Zotero.PDFWorker.getFullText(attachment.id, null);
			return (result && result.text) || '';
		}
		catch (e) {
			DeepSeekTranslate.log('PDFWorker 提取失败：' + e);
			return '';
		}
	},

	/**
	 * 组装送给模型的上下文。
	 *
	 * localContext 是阅读器从选区 DOM 直接取到的前后原文，优先使用。它锚定的是
	 * 用户实际选中的那一处；没有它时才退回按文字在全文里查找，那种做法在同一个词
	 * 出现多次时只能命中第一次出现的位置，会取到别处的上下文。
	 *
	 * @returns {{available: boolean, source?: string, reason?: string, text?: string,
	 *   pageLabel?: string, matched?: boolean, before?: string, selected?: string, after?: string}}
	 */
	async buildContext(attachment, selectionText, pageLabel, localContext) {
		var D = DeepSeekTranslate;
		var budget = this.budgetFor(attachment);

		// EPUB 的阅读器只给得出所在那一句的前后文（没有「相邻页」可拼），
		// 所以直接走全文定位，拿真正的前后若干句
		if (!this.isEpub(attachment)
			&& localContext && (localContext.before || localContext.after || localContext.selected)) {
			return {
				available: true,
				matched: true,
				source: 'selection',
				pageLabel: pageLabel || '',
				before: this.tidy(this.trimToBudget(localContext.before, 'tail', budget)),
				selected: this.tidy(localContext.selected || selectionText),
				after: this.tidy(this.trimToBudget(localContext.after, 'head', budget)),
			};
		}

		var fullText = await this.getFullText(attachment);
		if (!fullText) {
			return {
				available: false,
				reason: '这篇文献没有可用的全文索引（PDF 可能是扫描件且未 OCR；EPUB 可能是还没建索引），无法提供原文上下文。',
			};
		}

		// 同一个词在全文里往往出现多次：只按选中文字搜会命中第一次出现的地方，
		// 上下文就跑到别的句子去了。阅读器给的前文正好可以当锚点。
		var located = this.locateAnchored(fullText, localContext, selectionText)
			|| this.locate(fullText, selectionText);

		if (!located) {
			// 定位失败：EPUB 还有阅读器给的前后文可用，先用它；
			// 都没有才退回全文开头，够模型判断文献主题，但别当成本句上下文
			if (this.isEpub(attachment) && localContext && (localContext.before || localContext.after)) {
				return {
					available: true,
					matched: false,
					source: 'selection',
					pageLabel: pageLabel || '',
					reason: '选中文字未能在全文索引中精确定位，下面用的是阅读器给出的前后文。',
					before: this.tidy(this.trimToBudget(localContext.before, 'tail', budget)),
					selected: this.tidy(localContext.selected || selectionText),
					after: this.tidy(this.trimToBudget(localContext.after, 'head', budget)),
				};
			}
			return {
				available: true,
				matched: false,
				source: 'document',
				reason: '选中文字未能在全文索引中精确定位（PDF 文字层的空格或连字符与选区不一致），下面给出的是文献开头部分，仅供参考。',
				text: this.tidy(fullText.slice(0, Math.min(fullText.length, budget * 2))),
				pageLabel: pageLabel || '',
			};
		}

		var window = this.extractWindow(fullText, located.start, located.end, budget);
		return {
			available: true,
			matched: true,
			source: 'document',
			pageLabel: pageLabel || '',
			before: this.tidy(window.before),
			selected: this.tidy(window.selected),
			after: this.tidy(window.after),
		};
	},

	/**
	 * 上下文窗口大小。EPUB 是重排文本，没有分页失真的问题，
	 * 给两倍长（2000 字符）通常能把一整段甚至几段带进来；PDF 保持原预算。
	 */
	budgetFor(attachment) {
		// EPUB 与 PDF 用同一个预算：用户不希望靠放大窗口来换上下文，
		// 问题在于 EPUB 原来只拿到所在那一句
		return Math.max(200, DeepSeekTranslate.prefInt('contextChars', 1200));
	},

	/** EPUB 附件判定；这类文献没有页码，阅读器给的选区前后文往往只有一句 */
	isEpub(attachment) {
		return ((attachment && attachment.attachmentContentType) || '') === 'application/epub+zip';
	},

	/** 段落边界：两个换行之间，允许中间只有空白 */
	_lastParagraphBreak(chunk) {
		var re = /\n[ \t]*\n/g;
		var last = -1;
		var m;
		while ((m = re.exec(chunk)) !== null) {
			last = m.index;
		}
		return last;
	},

	_firstParagraphBreak(chunk) {
		var re = /\n[ \t]*\n/g;
		var m = re.exec(chunk);
		return m ? m.index : -1;
	},

	/**`n	 * 把一段前后文裁到预算内，并停在句子边界。
	 * side 为 'tail' 表示这段文字在选区之前，要让它从一句话的开头起；
	 * 'head' 表示在选区之后，要让它到一句话的结尾止。
	 */
	trimToBudget(text, side, budget) {
		var t = String(text || '');
		if (!t) {
			return '';
		}
		if (side === 'tail') {
			if (t.length > budget) {
				t = t.slice(t.length - budget);
			}
			// 先看段落边界（能带来完整一段），没有才退到句子边界
			var paraOut = this._firstParagraphBreak(t);
			if (paraOut >= 0 && paraOut < t.length / 2) {
				return t.slice(paraOut + 1);
			}
			var firstBreak = this._firstSentenceBreak(t);
			// 只在断点位于前半段时才裁，否则会丢掉大半段上下文
			if (firstBreak >= 0 && firstBreak < t.length / 2) {
				t = t.slice(firstBreak + 1);
			}
			return t;
		}
		if (t.length > budget) {
			t = t.slice(0, budget);
		}
		var paraIn = this._lastParagraphBreak(t);
		if (paraIn >= t.length / 2) {
			return t.slice(0, paraIn + 1);
		}
		var lastBreak = this._lastSentenceBreak(t);
		if (lastBreak >= t.length / 2) {
			t = t.slice(0, lastBreak + 1);
		}
		return t;
	},

	/**
	 * 在全文里找选中文字。
	 * PDF 文字层会在汉字间插空格，也可能用弯引号、连字符变体，
	 * 所以两边都先去掉空白并把标点归一化，再比对；indexOf 命中后映射回原文坐标。
	 */
	locate(text, needle) {
		if (!text || !needle) {
			return null;
		}
		var hay = this._normalize(text);
		var pin = this._normalize(needle);
		if (!hay.cmp || pin.cmp.length < 2) {
			return null;
		}

		var variants = [pin.cmp];
		// 选区常常带着首尾标点，去掉再试一次
		var stripped = pin.cmp.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
		if (stripped.length >= 2 && stripped !== pin.cmp) {
			variants.push(stripped);
		}

		for (var i = 0; i < variants.length; i++) {
			var idx = hay.cmp.indexOf(variants[i]);
			if (idx >= 0) {
				var start = hay.map[idx];
				var endIdx = Math.min(idx + variants[i].length - 1, hay.map.length - 1);
				return {
					start: start,
					end: hay.map[endIdx] + 1,
					exact: i === 0,
				};
			}
		}
		return null;
	},

	/**
	 * 带锚点的定位：把阅读器给的「选中处之前的一小段文字」和选中文字拼起来去全文里找。
	 * 同一个词出现在多处时，只有拼上前文才能命中用户真正选的那一处。
	 * 前缀从长到短试：太长可能因为换行/连字符差异匹配不上，太短又区分不开。
	 *
	 * @returns {{start: number, end: number, anchored: boolean}|null}
	 */
	locateAnchored(text, localContext, selectionText) {
		if (!localContext) {
			return null;
		}
		var selected = String(localContext.selected || selectionText || '').trim();
		if (selected.length < 2) {
			return null;
		}
		var before = String(localContext.before || '');
		if (!before) {
			return null;
		}
		var after = String(localContext.after || '');
		if (!before.trim() && !after.trim()) {
			return null;
		}
		var sizes = [80, 60, 40, 24, 12, 6];
		// 先定位前文锚点，再看选中词是不是紧跟在它后面：把三段拼成一整根 needle
		// 去搜会让起止位置算不准（拼的时候丢空格，匹配又是宽松的）
		for (var i = 0; i < sizes.length; i++) {
			var tail = this._tailWords(before, sizes[i]);
			var at = -1;
			if (tail.length >= 3) {
				var anchor = this.locate(text, tail);
				if (anchor) {
					at = this._findAfter(text, selected, anchor.end, 8);
				}
			}
			if (at < 0 && i === sizes.length - 1) {
				break;
			}
			if (at < 0) {
				continue;
			}
			// 后文能对上就先验一下，对不上说明这处只是前文撞车
			var head = this._headWords(after, Math.min(sizes[i], 40));
			if (head.length >= 3 && !this._startsNear(text, at + selected.length, head, 4)) {
				continue;
			}
			return { start: at, end: at + selected.length, anchored: true };
		}
		// 锚点都撞不上时，退回「按前后文相似度挑一处」
		return this.locateByContext(text, selected, before, after);
	},

	/** 从 from 附近往后找 selected，允许少量空白差异；找不到返回 -1 */
	_findAfter(text, selected, from, slack) {
		var begin = Math.max(0, from - 2);
		var i = text.indexOf(selected, begin);
		if (i < 0 || i > from + (slack || 0)) {
			return -1;
		}
		return i;
	},

	/** pos 之后的文字开头是否像 head（忽略空白，允许前几个字符的偏差） */
	_startsNear(text, pos, head, slack) {
		var b = String(head || '').replace(/\s+/g, '');
		if (!b) {
			return true;
		}
		var a = String(text.slice(pos, pos + b.length * 3 + 8)).replace(/\s+/g, '');
		var probe = b.slice(0, Math.min(b.length, 6));
		var i = a.indexOf(probe);
		return i >= 0 && i <= (slack || 0);
	},

	/** 取字符串开头若干字符，止于词边界 */
	_headWords(s, size) {
		var t = String(s || '').replace(/^\s+/, '');
		if (t.length <= size) {
			return t;
		}
		var cut = t.slice(0, size);
		var space = cut.search(/\s\S*$/);
		return space > 0 ? cut.slice(0, space) : cut;
	},

	/**
	 * 高频词兜底：把选中文字在全文里的每一处都找出来，按「前后文与阅读器给的前后文
	 * 有多像」打分，取最高分的那一处。用公共前缀/后缀的长度当相似度，够用且可离线测。
	 */
	locateByContext(text, selected, before, after) {
		if (!selected || !text) {
			return null;
		}
		var hits = [];
		var from = 0;
		while (hits.length < 200) {
			var i = text.indexOf(selected, from);
			if (i < 0) {
				break;
			}
			hits.push(i);
			from = i + 1;
		}
		if (!hits.length) {
			return null;
		}
		var beforeTail = this._tailWords(before, 80);
		var afterHead = this._headWords(after, 80);
		var best = -1;
		var bestScore = -1;
		for (var k = 0; k < hits.length; k++) {
			var pos = hits[k];
			var leftChunk = text.slice(Math.max(0, pos - 80), pos);
			var rightChunk = text.slice(pos + selected.length, pos + selected.length + 80);
			var score = this._commonSuffix(leftChunk, beforeTail)
				+ this._commonPrefix(rightChunk, afterHead);
			if (score > bestScore) {
				bestScore = score;
				best = pos;
			}
		}
		if (best < 0) {
			return null;
		}
		return { start: best, end: best + selected.length, anchored: true, scored: true };
	},

	_commonSuffix(a, b) {
		var x = String(a || '').replace(/\s+$/, '');
		var y = String(b || '');
		var n = 0;
		while (n < x.length && n < y.length && x[x.length - 1 - n] === y[y.length - 1 - n]) {
			n++;
		}
		return n;
	},

	_commonPrefix(a, b) {
		var x = String(a || '');
		var y = String(b || '').replace(/^\s+/, '');
		var n = 0;
		while (n < x.length && n < y.length && x[n] === y[n]) {
			n++;
		}
		return n;
	},

	/** 取字符串末尾若干字符，并从词边界开始，避免半截单词 */
	_tailWords(s, size) {
		var t = String(s || '').replace(/\s+$/, '');
		if (t.length <= size) {
			return t;
		}
		var cut = t.slice(t.length - size);
		var space = cut.search(/\s/);
		return space >= 0 ? cut.slice(space + 1) : cut;
	},

	/** 以选中处为中心取一段，优先扩到段落边界，其次句子边界 */
	extractWindow(text, start, end, chars) {
		var from = Math.max(0, start - chars);
		var to = Math.min(text.length, end + chars);

		var leftChunk = text.slice(from, start);
		var lastPara = this._lastParagraphBreak(leftChunk);
		var lastBreak = this._lastSentenceBreak(leftChunk);
		// 段落边界落在后半段才采用，免得把上下文砍得太短
		if (lastPara >= 0 && lastPara >= leftChunk.length / 2) {
			from = from + lastPara + 1;
		}
		else if (lastBreak >= 0) {
			from = from + lastBreak + 1;
		}

		var rightChunk = text.slice(end, to);
		var firstPara = this._firstParagraphBreak(rightChunk);
		var firstBreak = this._firstSentenceBreak(rightChunk);
		if (firstPara >= 0 && firstPara < rightChunk.length / 2) {
			to = end + firstPara + 1;
		}
		else if (firstBreak >= 0) {
			to = end + firstBreak + 1;
		}

		return {
			from: from,
			to: to,
			before: text.slice(from, start),
			selected: text.slice(start, end),
			after: text.slice(end, to),
		};
	},

	// 句子边界。英文的 . ! ? ; 和中文的 。！？；都要算上，
	// 少一个就会在另一种语言里完全找不到边界。
	_lastSentenceBreak(chunk) {
		var re = /[.!?。！？；;…\n]/g;
		var last = -1;
		var m;
		while ((m = re.exec(chunk)) !== null) {
			last = m.index;
		}
		return last;
	},

	_firstSentenceBreak(chunk) {
		var re = /[.!?。！？；;…\n]/g;
		var m = re.exec(chunk);
		return m ? m.index : -1;
	},

	/** 去空白 + 标点归一化，返回比对串和每个字符在原文中的位置 */
	_normalize(text) {
		var norm = '';
		var map = [];
		for (var i = 0; i < text.length; i++) {
			var ch = text[i];
			if (/\s/.test(ch) || ch === '\u00ad') {
				continue;
			}
			norm += ch;
			map.push(i);
		}
		var cmp = '';
		for (var j = 0; j < norm.length; j++) {
			cmp += this._canon(norm[j]);
		}
		return { norm: norm, cmp: cmp.toLowerCase(), map: map };
	},

	/** 一个字符换一个字符的归一化，长度不变，坐标才能对得上 */
	_canon(ch) {
		switch (ch) {
			case '\u201c': case '\u201d': case '\u201e': case '\u300c': case '\u300d':
			case '\u300e': case '\u300f': case '\u00ab': case '\u00bb':
				return '"';
			case '\u2018': case '\u2019': case '\u201a': case '\u2032':
				return "'";
			case '\u2013': case '\u2014': case '\u2015': case '\u2212':
			case '\u2010': case '\u2011': case '\ufe63': case '\uff0d':
				return '-';
			case '\u00a0': case '\u2007': case '\u202f':
				return ' ';
			default:
				return ch;
		}
	},

	/** 让 PDF 抽出来的文本好读一些：多余空格合并，汉字之间不留空格 */
	tidy(text) {
		if (!text) {
			return '';
		}
		var t = text.replace(/\s+/g, ' ');
		// 汉字、假名、全角标点彼此之间的空格是 PDF 抽取产生的，去掉；
		// 拉丁字母与汉字之间的空格保留，否则英文单词会和汉字粘在一起
		var cjk = '\\u2e80-\\u9fff\\u3000-\\u303f\\uff00-\\uffef';
		t = t.replace(new RegExp('([' + cjk + ']) (?=[' + cjk + '])', 'g'), '$1');
		t = t.replace(/\s+([，。、；：？！）】》」』])/g, '$1');
		t = t.replace(/([（【《「『])\s+/g, '$1');
		return t.trim();
	},

	_truncate(text, max) {
		if (!text) {
			return '';
		}
		return text.length > max ? text.slice(0, max) + '……' : text;
	},
};
