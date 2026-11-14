/* 「分部词频」区块。
 *
 * 统计方式与「整本词频」一致，正文只取用户填的范围。
 * PDF 按页码：分页文本从阅读器的 PDF.js 视图逐页取（Zotero 的全文缓存里没有
 * 分页标记，PDFWorker.getFullText 也只能取前 N 页，都不适合按页统计）。
 * EPUB 没有页码，按字符百分比：取 Zotero 全文缓存的正文，按长度折算起止位置再切。
 *
 * 每次统计写一份新的 CSV，文件名形如
 *   <PDF 名>_wordfreq_pages_12-34_20261017-173005.csv
 *   <书名>_wordfreq_pct_10-20_20261017-173005.csv
 * 不覆盖旧结果。「查询分部」弹出一个面板，按这两个前缀列出同一篇文献的历史结果，
 * 两类混在一起按时间倒序排，每条可以打开（读回 CSV）或删除。
 */

var WordFreq = WordFreq || {};

WordFreq.partsPane = (function () {
	var PANE_ID = 'ea-wordfreq-parts-pane';
	var STYLE_ID = 'ea-wordfreq-parts-style';
	var POPUP_ID = 'ea-parts-popup';
	// 「查询分部」弹窗。与自定义名单那个弹窗各自独立，只借用 wordfreq-panel* 的样式
	var PANEL_ID = 'ea-wordfreq-parts-panel';
	var POPUPSET_ID = 'ea-wordfreq-parts-popupset';
	// 分部结果的文件名主干。范围和时间戳接在它后面：
	//   _wordfreq_pages_12-34_20261017-173005.csv
	var PAGES_SUFFIX = '_wordfreq_pages_';
	// EPUB 分部：按字符百分比。前缀与 PAGES_SUFFIX 互不包含（…_pages_ 与 …_pct_），
	// 解析时不会把两类文件认错。
	var PCT_SUFFIX = '_wordfreq_pct_';
	var DEFAULT_PAGE_SIZE = 20;
	// 弹窗里每页显示几条分部记录。一行 22px，8 条正好放进 320px 的列表
	var PANEL_PAGE_SIZE = 8;
	// 每行左边那个小按钮上的符号，与整本词频一致
	var MARK_CHAR = '\u2212';

	// 文件名里时间戳之后的解析规则。同一天同一秒重名时 resolveCollision 会加 _2。
	var NAME_RE = /^(\d+)-(\d+)_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:_\d+)?\.csv$/;
	// 百分比范围允许小数，例如 10.5-20.25。页范围仍然只认整数。
	var NAME_RE_PCT = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:_\d+)?\.csv$/;

	// 当前区块对应的条目与附件，按 body 记
	var currentItem = new WeakMap();
	var currentAttachment = new WeakMap();
	// 当前页码（0 起）、上次成功的结果、上次失败的原因
	var pageIndex = new WeakMap();
	var lastError = new WeakMap();
	// 附件 itemID → 上次统计结果。切走再切回来还能看到上次那份
	var lastResults = new Map();
	// 附件 ID → 整本词频的索引（null 表示还没读或读不到），用来显示「分部/整本」
	var wholeByAttachment = new Map();
	// 正在统计的区块
	var running = new WeakSet();
	// 分部记录弹窗：当前页、当前列表、是哪个区块打开的
	var panelPage = new WeakMap();
	var panelItems = new WeakMap();
	var panelBody = new WeakMap();
	// Zotero 给的 refresh()，统计完要把折叠时的摘要改掉
	var refreshFns = new WeakMap();

	var BODY_XHTML = [
		'<vbox class="wordfreq-parts" flex="1">',
		'  <hbox class="wordfreq-parts-range wordfreq-parts-range-pages" align="center">',
		'    <description class="wordfreq-parts-text" value="从第" />',
		'    <html:input class="wordfreq-parts-from" type="text" size="4" />',
		'    <description class="wordfreq-parts-text" value="页到第" />',
		'    <html:input class="wordfreq-parts-to" type="text" size="4" />',
		'    <description class="wordfreq-parts-text" value="页统计词频" />',
		'  </hbox>',
		// EPUB 没有页码，换成百分比区间。两行只显示一行，由 render() 按附件类型切换
		'  <hbox class="wordfreq-parts-range wordfreq-parts-range-pct" align="center" hidden="true">',
		'    <description class="wordfreq-parts-text" value="从" />',
		'    <html:input class="wordfreq-parts-pct-from" type="text" size="5" />',
		'    <description class="wordfreq-parts-text" value="%到" />',
		'    <html:input class="wordfreq-parts-pct-to" type="text" size="5" />',
		'    <description class="wordfreq-parts-text" value="%统计词频" />',
		'  </hbox>',
		'  <hbox class="wordfreq-parts-actions" align="center">',
		'    <button class="wordfreq-parts-run" label="开始统计" />',
		'    <button class="wordfreq-parts-query" label="查询分部" />',
		'  </hbox>',
		'  <description class="wordfreq-parts-status" />',
		'  <vbox class="wordfreq-parts-result" flex="1" />',
		'  <hbox class="wordfreq-pager" align="center" hidden="true">',
		'    <button class="wordfreq-prev" label="上一页" />',
		'    <description class="wordfreq-pageinfo" flex="1" />',
		'    <button class="wordfreq-next" label="下一页" />',
		'  </hbox>',
		'  <checkbox class="wordfreq-hide-custom" label="隐藏自定义单词" native="true" />',
		'  <hbox class="wordfreq-parts-footer">',
		'    <button class="wordfreq-custom-open" label="自定义名单" />',
		'  </hbox>',
		'</vbox>',
	].join('\n');

	// 词表行的类名和整本词频一样（wordfreq-word / -count / -mark / -star / -pager），
	// 视觉才能一致。整本那边的样式都缩在 .wordfreq-pane 下，这里要自己来一份。
	var PANE_STYLE = [
		'.wordfreq-parts-range { margin-bottom: 6px; }',
		'.wordfreq-parts-text { margin: 0 4px; }',
		'.wordfreq-parts-from, .wordfreq-parts-to { width: 42px; margin: 0 2px; }',
		'.wordfreq-parts-pct-from, .wordfreq-parts-pct-to { width: 46px; margin: 0 2px; }',
		'.wordfreq-parts-actions { margin-bottom: 4px; }',
		'.wordfreq-parts-actions button { margin-right: 8px; }',
		'.wordfreq-parts-status { opacity: .8; margin-top: 2px; white-space: normal; line-height: 1.5; }',
		'.wordfreq-parts .wordfreq-word { min-height: 18px; }',
		'.wordfreq-parts .wordfreq-count { font-variant-numeric: tabular-nums; margin-left: 8px; }',
		'.wordfreq-parts button.wordfreq-mark {',
		'  appearance: none; -moz-appearance: none;',
		'  min-width: 0; width: 18px; min-height: 0; height: 18px;',
		'  padding: 0; margin: 0 5px 0 0;',
		'  font-size: 11px; line-height: 16px; text-align: center;',
		'  border: 1px solid rgba(128,128,128,.45); border-radius: 3px;',
		'  background: transparent; color: inherit;',
		'}',
		'.wordfreq-parts button.wordfreq-mark:hover { background: rgba(128,128,128,.22); }',
		'.wordfreq-parts button.wordfreq-mark[data-inlist="true"] { opacity: .45; }',
		'.wordfreq-parts button.wordfreq-star {',
		'  appearance: none; -moz-appearance: none;',
		'  min-width: 0; width: 20px; min-height: 0; height: 20px;',
		'  padding: 0; margin: 0 0 0 6px;',
		'  font-size: 15px; line-height: 18px; text-align: center;',
		'  border: none; background: transparent; color: inherit;',
		'}',
		'.wordfreq-parts button.wordfreq-star:hover { background: rgba(128,128,128,.22); border-radius: 3px; }',
		'.wordfreq-parts button.wordfreq-star[data-inbook="true"] { color: #faa700; }',
		'.wordfreq-parts .wordfreq-pager { margin-top: 4px; }',
		// 「查询分部」弹窗。外观与「自定义名单」弹窗同一套类名；区块不保证
		// pane.js 一定已经把样式注进这个文档（比如它还没渲染过），所以自己来一份。
		'.wordfreq-panel { width: 300px; padding: 8px 10px 6px; }',
		'.wordfreq-panel-head { margin-bottom: 6px; }',
		'.wordfreq-panel-title { font-weight: 600; font-size: 12px; opacity: .9; }',
		'.wordfreq-panel-list { overflow-y: auto; max-height: 320px; min-height: 40px; margin-top: 2px; }',
		'.wordfreq-panel-row { min-height: 22px; }',
		'.wordfreq-panel-label { font-size: 11px; opacity: .9; }',
		'.wordfreq-panel-pager { margin-top: 4px; }',
		'.wordfreq-panel-pageinfo { font-size: 11px; opacity: .8; text-align: center; margin: 0 4px; }',
		'.wordfreq-panel button.wordfreq-panel-x {',
		'  appearance: none; -moz-appearance: none;',
		'  min-width: 0; width: 20px; min-height: 0; height: 20px;',
		'  padding: 0; margin: 0 6px 0 0; font-size: 10px; line-height: 18px;',
		'  border: 1px solid rgba(128,128,128,.35); border-radius: 50%;',
		'  background: transparent; color: inherit; opacity: .75;',
		'}',
		'.wordfreq-panel button.wordfreq-panel-x:hover {',
		'  opacity: 1; background: rgba(209,59,59,.18); color: #d13b3b;',
		'  border-color: rgba(209,59,59,.5);',
		'}',
		'.wordfreq-panel button.wordfreq-panel-btn {',
		'  appearance: none; -moz-appearance: none;',
		'  min-width: 0; min-height: 20px; height: 20px;',
		'  padding: 0 10px; margin: 0 6px 0 0;',
		'  font-size: 11px; line-height: 18px;',
		'  border: 1px solid rgba(128,128,128,.45); border-radius: 4px;',
		'  background: rgba(128,128,128,.08); color: inherit;',
		'}',
		'.wordfreq-panel button.wordfreq-panel-btn:hover { background: rgba(128,128,128,.22); }',
		'.wordfreq-panel button.wordfreq-panel-btn:active { background: rgba(128,128,128,.32); }',
		// 行尾的「打开」「删除」比翻页按钮再小一号，一行才放得下
		'.wordfreq-panel button.wordfreq-panel-mini {',
		'  appearance: none; -moz-appearance: none;',
		'  min-width: 0; min-height: 18px; height: 18px;',
		'  padding: 0 8px; margin: 0 0 0 4px;',
		'  font-size: 11px; line-height: 16px;',
		'  border: 1px solid rgba(128,128,128,.45); border-radius: 4px;',
		'  background: rgba(128,128,128,.08); color: inherit;',
		'}',
		'.wordfreq-panel button.wordfreq-panel-mini:hover { background: rgba(128,128,128,.22); }',
		'.wordfreq-panel button.wordfreq-panel-mini[data-danger="true"]:hover {',
		'  background: rgba(209,59,59,.18); color: #d13b3b; border-color: rgba(209,59,59,.5);',
		'}',
	].join('\n');

	/* ── 小工具 ───────────────────────────────────────── */

	/** 界面相关的设置。代码里的默认值要和 prefs.js 保持一致。 */
	function uiOpts() {
		return {
			hideCustom: WordFreq.prefGet('paneHideCustom', true) !== false,
			pageSize: Math.max(1, Number(WordFreq.prefGet('panePageSize', DEFAULT_PAGE_SIZE))
				|| DEFAULT_PAGE_SIZE),
		};
	}

	function getPage(body) {
		var p = pageIndex.get(body);
		return p > 0 ? p : 0;
	}

	function resetPage(body) {
		pageIndex.set(body, 0);
	}

	function clear(node) {
		while (node && node.firstChild) {
			node.removeChild(node.firstChild);
		}
	}

	function show(node, visible) {
		if (node) {
			node.hidden = !visible;
		}
	}

	/** 名单按钮上带数量，和整本区块一致 */
	function syncCustomCount(body) {
		try {
			var btn = body.querySelector('.wordfreq-custom-open');
			if (btn) {
				btn.setAttribute('label', '自定义名单（' + WordFreq.userlist.count() + ' 个）');
			}
		}
		catch (e) {
			WordFreq.logError('更新名单按钮文案失败', e);
		}
	}

	function statusOf(body, text) {
		var el = body.querySelector('.wordfreq-parts-status');
		if (el) {
			el.textContent = text;
		}
	}

	function addLine(doc, box, text) {
		var line = doc.createXULElement('description');
		line.classList.add('wordfreq-line');
		line.setAttribute('style', 'white-space:normal;line-height:1.6');
		line.textContent = text;
		box.appendChild(line);
		return line;
	}

	function pad2(n) {
		return (n < 10 ? '0' : '') + n;
	}

	/** 与 WordFreq.timestamp() 同样的格式，用同一个时间点算，文件名和元信息不会差一秒 */
	function formatTime(date) {
		return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
			+ ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
	}

	/** 文件名里的时间戳：20261017-173005 */
	function stampOf(date) {
		return date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate())
			+ '-' + pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds());
	}

	/**
	 * 从文件名解出范围（页码或百分比）与统计时间。纯函数，自测直接调。
	 * 返回 null 表示这不是这篇文献的分部结果。
	 * 页范围文件名带 `_wordfreq_pages_`，百分比范围带 `_wordfreq_pct_`；
	 * 两个前缀互不包含，所以不会把页码文件认成百分比文件，反过来也不会。
	 */
	function parsePartName(name, stem) {
		if (!name || !stem) {
			return null;
		}
		var pagePrefix = stem + PAGES_SUFFIX;
		var pctPrefix = stem + PCT_SUFFIX;
		var m = null;
		var kind = '';
		if (name.indexOf(pagePrefix) === 0) {
			kind = 'pages';
			m = name.slice(pagePrefix.length).match(NAME_RE);
		}
		else if (name.indexOf(pctPrefix) === 0) {
			kind = 'pct';
			m = name.slice(pctPrefix.length).match(NAME_RE_PCT);
		}
		if (!m) {
			return null;
		}
		return {
			kind: kind,
			from: Number(m[1]),
			to: Number(m[2]),
			stamp: m[3] + '-' + m[4] + '-' + m[5] + ' ' + m[6] + ':' + m[7] + ':' + m[8],
			sortKey: m[3] + m[4] + m[5] + m[6] + m[7] + m[8],
		};
	}

	/* ── 纯函数：百分比范围 ───────────────────────────── */

	/** 百分比显示用：10 → "10"，10.50 → "10.5"，0.25 → "0.25" */
	function formatPercent(value) {
		var n = Number(value);
		if (!isFinite(n)) {
			return String(value);
		}
		return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
	}

	/**
	 * 阅读位置换算成百分比：index 是当前页（0 起），total 是总页数。
	 * 总页数拿不到或不是正数时返回 null，让界面提示「没拿到」，不要瞎猜。
	 */
	function percentOfIndex(index, total) {
		if (typeof index !== 'number' || !isFinite(index) || index < 0) {
			return null;
		}
		if (typeof total !== 'number' || !isFinite(total) || total <= 0) {
			return null;
		}
		var pct = Math.round((index / total) * 1000) / 10;
		return Math.max(0, Math.min(100, pct));
	}

	/**
	 * 输入框里的百分比：0–100，可以带小数，最多保留两位。
	 * 空串、负数、带别的字符都算无效，返回 NaN。
	 */
	function parsePercent(value) {
		if (typeof value === 'number') {
			return isFinite(value) ? Math.round(value * 100) / 100 : NaN;
		}
		var s = String(value == null ? '' : value).trim();
		if (!s || !/^\d+(?:\.\d+)?$/.test(s)) {
			return NaN;
		}
		var n = Number(s);
		return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
	}

	/**
	 * 校验百分比范围：起始 ≥ 0、起始 < 结束、结束 ≤ 100。纯函数。
	 * @returns {{ok: boolean, from: number, to: number, message: string}}
	 */
	function checkPercentRange(fromRaw, toRaw) {
		var from = parsePercent(fromRaw);
		var to = parsePercent(toRaw);
		if (!isFinite(from) || !isFinite(to)) {
			return { ok: false, from: NaN, to: NaN, message: '百分比要填数字（0 到 100，可以带小数）。' };
		}
		if (from < 0 || to > 100) {
			return { ok: false, from: from, to: to, message: '百分比要落在 0 到 100 之间。' };
		}
		if (from >= to) {
			return { ok: false, from: from, to: to, message: '起始百分比要小于结束百分比。' };
		}
		return { ok: true, from: from, to: to, message: '' };
	}

	/**
	 * 按字符百分比切一段文本。起点向下取整、终点向上取整，
	 * 保证 0% 从第一个字符开始、100% 到最后一个字符结束。
	 * 纯函数，自测直接调。
	 * @returns {{start: number, end: number, length: number, text: string}}
	 */
	function sliceByPercent(text, from, to) {
		var s = text == null ? '' : String(text);
		var len = s.length;
		var a = Number(from);
		var b = Number(to);
		if (!isFinite(a)) {
			a = 0;
		}
		if (!isFinite(b)) {
			b = 100;
		}
		if (a < 0) {
			a = 0;
		}
		if (b > 100) {
			b = 100;
		}
		var start = Math.floor(len * a / 100);
		if (start < 0) {
			start = 0;
		}
		if (start > len) {
			start = len;
		}
		var end = Math.ceil(len * b / 100);
		if (end < start) {
			end = start;
		}
		if (end > len) {
			end = len;
		}
		return { start: start, end: end, length: len, text: s.slice(start, end) };
	}

	/** 分部文件名里的范围部分（不含书名与时间戳） */
	function rangeSuffix(kind, from, to) {
		if (kind === 'pct') {
			return PCT_SUFFIX + formatPercent(from) + '-' + formatPercent(to);
		}
		return PAGES_SUFFIX + from + '-' + to;
	}

	/** 完整的分部文件名，供自测与其它模块核对 */
	function partFileName(stem, kind, from, to, stamp) {
		return stem + rangeSuffix(kind, from, to) + '_' + stamp + '.csv';
	}

	/** 界面上显示的范围文案：第 12-34 页 / 第 10%-20% */
	function labelOf(kind, from, to) {
		if (kind === 'pct') {
			return '第 ' + formatPercent(from) + '%-' + formatPercent(to) + '%';
		}
		return '第 ' + from + '-' + to + ' 页';
	}

	/** 附件类型：EPUB 按字符百分比，其余仍按页码（PDF 的老路径原样保留） */
	function attachmentKind(attachment) {
		try {
			return (attachment && WordFreq.source.isEpubAttachment(attachment))
				? 'pct'
				: 'pages';
		}
		catch (e) {
			return 'pages';
		}
	}

	/* ── 从阅读器逐页取正文 ───────────────────────────── */

	function findReader(attachmentID) {
		try {
			var readers = (Zotero.Reader && Zotero.Reader._readers) || [];
			for (var i = 0; i < readers.length; i++) {
				if (readers[i] && readers[i].itemID === attachmentID) {
					return readers[i];
				}
			}
		}
		catch (e) {
			WordFreq.logError('查找阅读器失败', e);
		}
		return null;
	}

	/**
	 * 阅读器把 PDF.js 装在 iframe 里。不同 Zotero 版本挂的位置不一样，
	 * 按已知的几处逐个试，拿到带 PDFViewerApplication 的那个 window。
	 */
	function viewerAppOf(reader) {
		var wins = [];
		function push(win) {
			if (win) {
				wins.push(win);
			}
		}
		try {
			push(reader._iframeWindow);
		}
		catch (e) {
			// 跨域或还没建好，继续试下一个
		}
		try {
			push(reader._internalReader && reader._internalReader._iframeWindow);
		}
		catch (e) {
			// 同上
		}
		try {
			var view = reader._internalReader && reader._internalReader._primaryView;
			push(view && view._iframeWindow);
		}
		catch (e) {
			// 同上
		}

		for (var i = 0; i < wins.length; i++) {
			try {
				var win = wins[i];
				var app = win.PDFViewerApplication;
				if (!app && win.wrappedJSObject) {
					app = win.wrappedJSObject.PDFViewerApplication;
				}
				if (app) {
					return app;
				}
			}
			catch (e) {
				// 这个 window 拿不到，换下一个
			}
		}
		return null;
	}

	/**
	 * 把一页的 textContent 拼成文本。要点是保留 pdf.js 的换行标记：
	 * 行末断词（informa-\ntion）要靠它才能还原，全用空格拼就散了。
	 */
	function pageTextOf(content) {
		var items = (content && content.items) || [];
		var out = '';
		for (var i = 0; i < items.length; i++) {
			var item = items[i];
			var str = item && typeof item.str === 'string' ? item.str : '';
			if (!str) {
				continue;
			}
			out += str;
			out += item.hasEOL ? '\n' : ' ';
		}
		return out;
	}

	/**
	 * 取 [from, to] 页的正文。失败不抛异常，把原因放在 error 里，
	 * 由调用方写进状态行。
	 */
	async function readPages(attachment, from, to) {
		var reader = findReader(attachment.id);
		if (!reader) {
			return { error: '请先在阅读器里打开这篇 PDF，再统计分部词频。' };
		}

		var app = viewerAppOf(reader);
		var pdf = app && app.pdfDocument;
		if (!pdf) {
			return { error: '阅读器里的 PDF 还没加载完，等页面显示出来再点一次。' };
		}

		var total = 0;
		try {
			total = pdf.numPages || 0;
		}
		catch (e) {
			total = 0;
		}
		if (!total) {
			try {
				var pages = await WordFreq.source.pagesOf(attachment);
				total = (pages && pages.totalPages) || 0;
			}
			catch (e) {
				total = 0;
			}
		}
		if (!total) {
			return { error: '拿不到这篇 PDF 的总页数，没法确认页码范围。' };
		}
		if (from > total) {
			return { error: '起始页超过这篇 PDF 的总页数（共 ' + total + ' 页）。' };
		}
		if (to > total) {
			return { error: '结束页超过这篇 PDF 的总页数（共 ' + total + ' 页），请改小一些。' };
		}

		// 首选：在 iframe 自己的 compartment 里逐页取（跨 compartment 调用会失败）
		var found = viewerWindowOf(reader);
		if (found) {
			var raw = null;
			try {
				raw = await extractPagesInViewer(found.win, from, to);
			}
			catch (e) {
				WordFreq.logError('在阅读器里取页文本失败', e);
			}
			if (typeof raw === 'string') {
				var parsed = null;
				try {
					parsed = JSON.parse(raw);
				}
				catch (e) {
					parsed = null;
				}
				if (parsed && typeof parsed.text === 'string') {
					return { text: parsed.text, totalPages: total, pages: to - from + 1 };
				}
				if (parsed && parsed.error) {
					return { error: '阅读器取文本失败：' + parsed.error };
				}
			}
		}

		// 退路：直接在 chrome 里调（老版本 Zotero 上可能仍然可用）
		var parts = [];
		for (var p = from; p <= to; p++) {
			var page = await pdf.getPage(p);
			if (!page || typeof page.getTextContent !== 'function') {
				return { error: '阅读器里的 PDF.js 取不到页面文字，请确认 PDF 已经完整加载。' };
			}
			var content = await page.getTextContent();
			parts.push(pageTextOf(content));
		}
		return {
			text: parts.join('\n\n'),
			totalPages: total,
			pages: to - from + 1,
		};
	}

	/** 与 viewerAppOf 同样的探测，但把命中的 window 一起返回 */
	function viewerWindowOf(reader) {
		var wins = [];
		function push(win) {
			if (win) {
				wins.push(win);
			}
		}
		try {
			push(reader._iframeWindow);
		}
		catch (e) {
			// 忽略
		}
		try {
			push(reader._internalReader && reader._internalReader._iframeWindow);
		}
		catch (e) {
			// 忽略
		}
		try {
			var view = reader._internalReader && reader._internalReader._primaryView;
			push(view && view._iframeWindow);
		}
		catch (e) {
			// 忽略
		}
		for (var i = 0; i < wins.length; i++) {
			try {
				var win = wins[i];
				var app = win.PDFViewerApplication
					|| (win.wrappedJSObject && win.wrappedJSObject.PDFViewerApplication);
				if (app && app.pdfDocument) {
					return { win: win, app: app };
				}
			}
			catch (e) {
				// 换下一个
			}
		}
		return null;
	}

	/**
	 * 在 iframe 自己的 compartment 里取文本。
	 * PDF.js 的对象跨 compartment 取回来时，方法不一定能调（真机上就撞到
	 * `page.getTextContent is not a function`），所以整段循环交给 `win.eval`
	 * 在那边跑，只把 JSON 字符串带回来。
	 */
	function extractPagesInViewer(win, from, to) {
		var code = '(async function () {try {'
			+ 'var app = window.PDFViewerApplication;'
			+ 'if (!app || !app.pdfDocument) { return JSON.stringify({ error: "nopdf" }); }'
			+ 'var pdf = app.pdfDocument;'
			+ 'var out = [];'
			+ 'for (var p = ' + from + '; p <= ' + to + '; p++) {'
			+ 'var page = await pdf.getPage(p);'
			+ 'var content = await page.getTextContent();'
			+ 'var s = "";'
			+ '(content.items || []).forEach(function (it) {'
			+ 'if (!it || typeof it.str !== "string" || !it.str) { return; }'
			+ 's += it.str;'
			+ 's += it.hasEOL ? "\\n" : " ";'
			+ '});'
			+ 'out.push(s);'
			+ '}'
			+ 'return JSON.stringify({ text: out.join("\\n\\n"), total: pdf.numPages || 0 });'
			+ '} catch (e) { return JSON.stringify({ error: String((e && e.message) || e) }); }'
			+ '})()';
		return win.eval(code);
	}
	/* ── 结果与 CSV ───────────────────────────────────── */

	/** 把读回来的 CSV 拼成和刚统计完同样形状的结果 */
	function outcomeFromCsv(parsed, outPath, from, to, kind) {
		var meta = parsed.meta || {};
		kind = kind === 'pct' ? 'pct' : 'pages';
		var total = Number(meta['全文词次']);
		if (!isFinite(total)) {
			total = parsed.rows.reduce(function (sum, r) {
				return sum + r.count;
			}, 0);
		}
		var unique = Number(meta['去重词数']);
		if (!isFinite(unique)) {
			unique = parsed.rows.length;
		}
		var readFrom = from;
		var readTo = to;
		if (kind === 'pct') {
			// 百分比范围写在「范围」里，形如 10%-20%（按字符比例）。
			// 读不出来就沿用文件名解析出来的数，老文件也能打开。
			var pct = String(meta['范围'] || '')
				.match(/^(\d+(?:\.\d+)?)%\s*-\s*(\d+(?:\.\d+)?)%/);
			if (pct) {
				readFrom = Number(pct[1]);
				readTo = Number(pct[2]);
			}
		}
		else {
			var range = String(meta['页码范围'] || '');
			var m = range.match(/^(\d+)\s*-\s*(\d+)$/);
			if (m) {
				readFrom = Number(m[1]);
				readTo = Number(m[2]);
			}
		}
		return {
			status: 'written',
			loadedFromCsv: true,
			kind: kind,
			outPath: outPath,
			from: readFrom,
			to: readTo,
			totalTokens: total,
			uniqueWords: unique,
			note: meta['取文本方式'] || '',
			generated: meta['生成时间'] || '',
			rows: parsed.rows,
		};
	}

	function filterNotes() {
		var notes = [];
		if (WordFreq.prefGet('includeStopwords', true) === false) {
			notes.push('已过滤英语停用词');
		}
		if (WordFreq.prefGet('skipSingles', true) !== false) {
			notes.push('已忽略只出现一次的词');
		}
		return notes;
	}

	async function runForBody(doc, body) {
		var item = currentItem.get(body);
		var attachment = currentAttachment.get(body);
		if (!attachment) {
			try {
				attachment = item ? WordFreq.source.findTextSource(item).attachment : null;
			}
			catch (e) {
				attachment = null;
			}
		}

		// 没有附件时按 PDF 那套校验，报错顺序和以前一样
		var kind = attachmentKind(attachment);
		var from;
		var to;
		if (kind === 'pct') {
			var pctFromEl = body.querySelector('.wordfreq-parts-pct-from');
			var pctToEl = body.querySelector('.wordfreq-parts-pct-to');
			var range = checkPercentRange(pctFromEl ? pctFromEl.value : '',
				pctToEl ? pctToEl.value : '');
			if (!range.ok) {
				statusOf(body, range.message);
				return;
			}
			from = range.from;
			to = range.to;
		}
		else {
			var fromEl = body.querySelector('.wordfreq-parts-from');
			var toEl = body.querySelector('.wordfreq-parts-to');
			from = fromEl ? parseInt(fromEl.value, 10) : NaN;
			to = toEl ? parseInt(toEl.value, 10) : NaN;
			if (!from || !to || from < 1 || to < from) {
				statusOf(body, '先填好页码范围：起始页至少 1，结束页不能小于起始页。');
				return;
			}
		}

		if (!attachment) {
			statusOf(body, '这个条目没有可用于统计的 PDF 或 EPUB。');
			return;
		}

		running.add(body);
		lastError.delete(body);
		render(doc, body);

		try {
			var text = '';
			var got = null;
			var sliceInfo = null;
			if (kind === 'pct') {
				got = await WordFreq.source.getText(attachment, { textSource: 'cache' });
				if (!got || !got.text) {
					lastError.set(body, '这篇 EPUB 的全文缓存是空的，先在 Zotero 里重建一次全文索引。');
					return;
				}
				var slice = sliceByPercent(got.text, from, to);
				text = slice.text;
				sliceInfo = {
					fullChars: got.text.length,
					sliceChars: text.length,
					preview: text.slice(0, 80).replace(/\s+/g, ' ').trim(),
				};
				WordFreq.log('分部切片：全文 ' + sliceInfo.fullChars + ' 字，本次取 '
					+ sliceInfo.sliceChars + ' 字，开头：' + sliceInfo.preview);
				if (!text) {
					lastError.set(body, '这个百分比区间里没有文字（全文缓存太短时会这样）。');
					return;
				}
			}
			else {
				got = await readPages(attachment, from, to);
				if (got.error) {
					lastError.set(body, got.error);
					return;
				}
				text = got.text;
			}

			var langResult = null;
			var langNote = '未做语言判定';
			if (WordFreq.prefGet('langCheck', true) !== false) {
				langResult = WordFreq.langdetect.detect(text, WordFreq.langOpts());
				WordFreq.log(WordFreq.langdetect.summarize(langResult)
					+ ' ← ' + labelOf(kind, from, to));
				// 分部常常只有一两页或一小段，词数不够判定语言。「文本太短」不拦，
				// 照常统计并把这个情况写进 CSV；检出了别的文字或别的语言才拒绝。
				if (!langResult.isEnglish && langResult.code !== 'too-short') {
					lastError.set(body, (kind === 'pct' ? '这一段' : '这几页')
						+ '判定为非英文，已跳过。' + langResult.reason);
					return;
				}
				langNote = langResult.isEnglish
					? langResult.reason
					: '文本太短，未做语言判定';
			}

			var stats = WordFreq.wordfreq.run(text, WordFreq.tokenOpts());
			if (!stats.totalTokens) {
				lastError.set(body, kind === 'pct'
					? '这个百分比区间里没有可统计的文字。'
					: '这几页没有可统计的文字（扫描版 PDF 需要先 OCR）。');
				return;
			}

			var filePath = await WordFreq.source.pathOf(attachment);
			if (!filePath) {
				lastError.set(body, kind === 'pct'
					? '拿不到这篇 EPUB 的文件路径。'
					: '拿不到这篇 PDF 的文件路径。');
				return;
			}

			var now = new Date();
			// 时间戳保证每次统计都是一份新结果，同一天重复统计不会互相覆盖
			var suffix = rangeSuffix(kind, from, to) + '_' + stampOf(now);
			var outPath = WordFreq.output.csvPathFor(filePath, { suffix: suffix });
			// 同一秒内点两次仍可能重名，这时加 _2，不覆盖前一份
			outPath = await WordFreq.output.resolveCollision(outPath, false);

			var notes = filterNotes();
			var meta = {
				source: WordFreq.output.baseNameOf(filePath),
				generated: formatTime(now),
				total_words: stats.totalTokens,
				listed_words: stats.listedTokens,
				unique_words: stats.uniqueWords,
				lemma: stats.lemmatized
					? '已开启，' + stats.mergedForms + ' 个词条由多个词形合并而来'
					: '已关闭，按原样统计',
				language: langNote,
			};
			if (kind === 'pct') {
				var pctText = formatPercent(from) + '%-' + formatPercent(to) + '%';
				notes.push('分部统计，只统计第 ' + pctText + '（按字符比例）');
				meta.text_source = (got && got.note) || '取自 Zotero 全文缓存（EPUB）';
				meta.range = pctText + '（按字符比例）';
				if (sliceInfo) {
					meta.slice_chars = String(sliceInfo.sliceChars);
					meta.full_chars = String(sliceInfo.fullChars);
					meta.slice_preview = sliceInfo.preview;
				}
			}
			else {
				notes.push('分部统计，只统计第 ' + from + '-' + to + ' 页');
				meta.text_source = '阅读器 PDF.js 逐页提取';
				meta.page_range = from + '-' + to;
				if (got.totalPages) {
					meta.pages = got.pages + ' / ' + got.totalPages;
				}
			}
			meta.note = notes.join('；');

			var csv = WordFreq.wordfreq.buildCsv(stats.rows, meta, {
				bom: WordFreq.prefGet('bom', true) !== false,
			});

			await WordFreq.output.writeTextAsync(outPath, csv);

			lastResults.set(attachment.id, {
				status: 'written',
				kind: kind,
				pdfPath: filePath,
				outPath: outPath,
				from: from,
				to: to,
				totalTokens: stats.totalTokens,
				uniqueWords: stats.uniqueWords,
				generated: formatTime(now),
				note: kind === 'pct' ? '全文缓存（EPUB）' : '阅读器逐页提取',
				pages: kind === 'pct' ? 0 : got.pages,
				totalPages: kind === 'pct' ? 0 : got.totalPages,
				rows: stats.rows,
				sliceChars: sliceInfo ? sliceInfo.sliceChars : 0,
				fullChars: sliceInfo ? sliceInfo.fullChars : 0,
				slicePreview: sliceInfo ? sliceInfo.preview : '',
			});
			resetPage(body);
		}
		catch (e) {
			WordFreq.logError('分部词频统计失败', e);
			lastError.set(body, '统计失败：' + ((e && e.message) || e));
		}
		finally {
			running.delete(body);
			render(doc, body);
			var refresh = refreshFns.get(body);
			if (refresh) {
				try {
					refresh();
				}
				catch (e) {
					// 只影响折叠时的摘要，失败不影响结果
				}
			}
			// 弹窗开着的话，把刚写出来的这一份也列进去
			var panel = doc.getElementById(PANEL_ID);
			if (panel && panelBody.get(panel) === body) {
				reloadPanel(doc, panel).catch(function () {});
			}
		}
	}

	/* ── 分部记录的读取与删除 ─────────────────────────── */

	/** 列出同一篇文献之前统计过的分部结果，新的在前。页码与百分比两类混排 */
	async function listHistory(attachment) {
		var filePath = await WordFreq.source.pathOf(attachment);
		if (!filePath) {
			throw new Error('拿不到这篇文献的文件路径。');
		}
		var dir = WordFreq.output.parentOf(filePath);
		var stem = WordFreq.output.stemOf(filePath);
		var children = await WordFreq.output.listDirAsync(dir);
		var items = [];
		for (var i = 0; i < children.length; i++) {
			// IOUtils.getChildren 给完整路径，nsIFile 那条回退给文件名，都能处理
			var name = WordFreq.output.baseNameOf(String(children[i]));
			var parsed = parsePartName(name, stem);
			if (!parsed) {
				continue;
			}
			items.push({
				name: name,
				path: WordFreq.output.joinPath(dir, name),
				kind: parsed.kind,
				from: parsed.from,
				to: parsed.to,
				stamp: parsed.stamp,
				sortKey: parsed.sortKey,
			});
		}
		items.sort(function (a, b) {
			if (a.sortKey === b.sortKey) {
				return 0;
			}
			return a.sortKey > b.sortKey ? -1 : 1;
		});
		return items;
	}

	/* ── 分部记录弹窗 ─────────────────────────────────── */

	/** 建一次弹窗，之后复用。骨架与「自定义名单」弹窗相同，内容换成分部记录 */
	function ensurePanel(doc) {
		var panel = doc.getElementById(PANEL_ID);
		if (panel) {
			return panel;
		}

		var host = doc.getElementById(POPUPSET_ID);
		if (!host) {
			host = doc.createXULElement('popupset');
			host.id = POPUPSET_ID;
			doc.documentElement.appendChild(host);
		}

		panel = doc.createXULElement('panel');
		panel.id = PANEL_ID;
		panel.setAttribute('type', 'arrow');

		var box = doc.createXULElement('vbox');
		box.classList.add('wordfreq-panel');
		box.setAttribute('flex', '1');

		var head = doc.createXULElement('hbox');
		head.classList.add('wordfreq-panel-head');
		head.setAttribute('align', 'center');

		var title = doc.createXULElement('description');
		title.classList.add('wordfreq-panel-title');
		title.setAttribute('flex', '1');
		title.setAttribute('crop', 'end');

		var closeBtn = doc.createXULElement('button');
		closeBtn.classList.add('wordfreq-panel-x');
		closeBtn.setAttribute('label', '✕');
		closeBtn.setAttribute('tooltiptext', '关闭');
		closeBtn.addEventListener('command', function () {
			try {
				panel.hidePopup();
			}
			catch (e) {
				// 本来就关着
			}
		});

		head.appendChild(title);
		head.appendChild(closeBtn);

		var list = doc.createXULElement('vbox');
		list.classList.add('wordfreq-panel-list');
		list.setAttribute('flex', '1');

		var pager = doc.createXULElement('hbox');
		pager.classList.add('wordfreq-panel-pager');
		pager.setAttribute('align', 'center');

		var prev = doc.createXULElement('button');
		prev.classList.add('wordfreq-panel-btn');
		prev.classList.add('wordfreq-panel-prev');
		prev.setAttribute('label', '上一页');
		prev.addEventListener('command', function () {
			panelPage.set(panel, Math.max(0, (panelPage.get(panel) || 0) - 1));
			fillPanel(doc, panel);
		});

		var info = doc.createXULElement('description');
		info.classList.add('wordfreq-panel-pageinfo');
		info.setAttribute('flex', '1');
		info.setAttribute('crop', 'end');

		var next = doc.createXULElement('button');
		next.classList.add('wordfreq-panel-btn');
		next.classList.add('wordfreq-panel-next');
		next.setAttribute('label', '下一页');
		next.addEventListener('command', function () {
			panelPage.set(panel, (panelPage.get(panel) || 0) + 1);
			fillPanel(doc, panel);
		});

		pager.appendChild(prev);
		pager.appendChild(info);
		pager.appendChild(next);

		box.appendChild(head);
		box.appendChild(list);
		box.appendChild(pager);
		panel.appendChild(box);
		host.appendChild(panel);
		panelPage.set(panel, 0);
		return panel;
	}

	function makePanelRow(doc, panel, item) {
		var row = doc.createXULElement('hbox');
		row.classList.add('wordfreq-panel-row');
		row.setAttribute('align', 'center');

		var label = doc.createXULElement('description');
		label.classList.add('wordfreq-panel-label');
		label.setAttribute('flex', '1');
		label.setAttribute('crop', 'end');
		label.setAttribute('tooltiptext', item.name);
		label.textContent = labelOf(item.kind, item.from, item.to) + ' · ' + item.stamp;

		var openBtn = doc.createXULElement('button');
		openBtn.classList.add('wordfreq-panel-mini');
		openBtn.setAttribute('label', '打开');
		openBtn.setAttribute('tooltiptext', '把这个结果读回来显示在区块里');
		openBtn.addEventListener('command', function () {
			var body = panelBody.get(panel);
			if (!body) {
				return;
			}
			openHistoryItem(doc, body, item).then(function (opened) {
				if (opened) {
					try {
						panel.hidePopup();
					}
					catch (e) {
						// 弹窗已经关掉了
					}
					return;
				}
				fillPanel(doc, panel);
			}).catch(function (e) {
				WordFreq.logError('读取分部结果失败', e);
				statusOf(body, '读取失败：' + ((e && e.message) || e));
				fillPanel(doc, panel);
			});
		});

		var delBtn = doc.createXULElement('button');
		delBtn.classList.add('wordfreq-panel-mini');
		delBtn.setAttribute('data-danger', 'true');
		delBtn.setAttribute('label', '删除');
		delBtn.setAttribute('tooltiptext', '删掉这份 CSV');
		delBtn.addEventListener('command', function () {
			var body = panelBody.get(panel);
			if (!body) {
				return;
			}
			deleteHistoryItem(doc, body, item).then(function (deleted) {
				if (!deleted) {
					return;
				}
				// 先从内存里的列表摘掉，界面立刻更新。页码越界由 page() 夹回
				// 最后一页，删掉当前页最后一条时正好退一页。
				panelItems.set(panel, (panelItems.get(panel) || []).filter(function (x) {
					return x.path !== item.path;
				}));
				fillPanel(doc, panel);
				// 磁盘上可能还有别的进程写进来的文件，再对一遍
				reloadPanel(doc, panel);
			}).catch(function (e) {
				WordFreq.logError('删除分部结果失败', e);
				statusOf(body, '删除失败：' + ((e && e.message) || e));
			});
		});

		row.appendChild(label);
		row.appendChild(openBtn);
		row.appendChild(delBtn);
		return row;
	}

	function fillPanel(doc, panel) {
		var items = panelItems.get(panel) || [];

		var title = panel.querySelector('.wordfreq-panel-title');
		if (title) {
			title.textContent = '分部记录（' + items.length + ' 个）';
		}

		var list = panel.querySelector('.wordfreq-panel-list');
		var paged = WordFreq.wordfreq.page(items, PANEL_PAGE_SIZE, panelPage.get(panel) || 0);
		panelPage.set(panel, paged.pageIndex);

		if (list) {
			clear(list);
			if (!items.length) {
				addLine(doc, list, '这篇文献还没有分部统计结果。点「开始统计」生成一份。');
			}
			else {
				for (var i = 0; i < paged.rows.length; i++) {
					list.appendChild(makePanelRow(doc, panel, paged.rows[i]));
				}
			}
		}

		var pager = panel.querySelector('.wordfreq-panel-pager');
		show(pager, items.length > 0);

		var info = panel.querySelector('.wordfreq-panel-pageinfo');
		if (info) {
			info.textContent = '第 ' + (paged.pageIndex + 1) + ' / ' + paged.totalPages + ' 页';
		}
		var prev = panel.querySelector('.wordfreq-panel-prev');
		if (prev) {
			prev.disabled = paged.pageIndex <= 0;
		}
		var next = panel.querySelector('.wordfreq-panel-next');
		if (next) {
			next.disabled = paged.pageIndex >= paged.totalPages - 1;
		}
	}

	/** 重新扫一遍目录，把弹窗里的列表换成最新的 */
	async function reloadPanel(doc, panel) {
		var body = panelBody.get(panel);
		if (!body) {
			return;
		}
		var attachment = currentAttachment.get(body);
		if (!attachment) {
			panelItems.set(panel, []);
			fillPanel(doc, panel);
			return;
		}
		try {
			var items = await listHistory(attachment);
			// 读目录是异步的，期间可能切了条目或换了区块，别把别人的列表画上来
			if (panelBody.get(panel) !== body) {
				return;
			}
			var now = currentAttachment.get(body);
			if (!now || now.id !== attachment.id) {
				return;
			}
			panelItems.set(panel, items);
			fillPanel(doc, panel);
		}
		catch (e) {
			WordFreq.logError('列出分部结果失败', e);
			statusOf(body, '读取历史结果失败：' + ((e && e.message) || e));
			panelItems.set(panel, []);
			fillPanel(doc, panel);
		}
	}

	/** 点「查询分部」：每次重新读目录，锚在按钮右下角 */
	function openPartsPanel(doc, body, anchor) {
		if (!currentAttachment.get(body)) {
			statusOf(body, '这个条目没有 PDF 或 EPUB，查不了分部结果。');
			return;
		}
		var panel;
		try {
			panel = ensurePanel(doc);
		}
		catch (e) {
			WordFreq.logError('创建分部记录弹窗失败', e);
			return;
		}

		panelBody.set(panel, body);
		panelPage.set(panel, 0);
		panelItems.set(panel, []);
		fillPanel(doc, panel);
		var list = panel.querySelector('.wordfreq-panel-list');
		if (list) {
			clear(list);
			addLine(doc, list, '正在读取…');
		}
		try {
			panel.openPopup(anchor, 'after_end', 0, 6, false, false);
		}
		catch (e) {
			WordFreq.logError('打开分部记录弹窗失败', e);
			return;
		}
		reloadPanel(doc, panel);
	}

	/** 换条目、销毁区块时把弹窗收掉，别让它挂在一个已经不存在的按钮上 */
	function hidePanelFor(body) {
		try {
			var doc = body && body.ownerDocument;
			var panel = doc ? doc.getElementById(PANEL_ID) : null;
			if (!panel || panelBody.get(panel) !== body) {
				return;
			}
			try {
				panel.hidePopup();
			}
			catch (e) {
				// 本来就关着
			}
			panelBody.delete(panel);
			panelItems.delete(panel);
			panelPage.delete(panel);
		}
		catch (e) {
			WordFreq.logError('收起分部记录弹窗失败', e);
		}
	}

	async function openHistoryItem(doc, body, item) {
		var text = await WordFreq.output.readTextAsync(item.path);
		var parsed = WordFreq.wordfreq.parseCsv(text);
		if (!parsed.rows.length) {
			statusOf(body, '这个 CSV 里没有词表：' + item.name);
			return false;
		}
		var outcome = outcomeFromCsv(parsed, item.path, item.from, item.to, item.kind);
		var attachment = currentAttachment.get(body);
		if (attachment) {
			lastResults.set(attachment.id, outcome);
		}
		lastError.delete(body);
		fillRangeInputs(body, outcome.kind || item.kind, outcome.from, outcome.to);
		resetPage(body);
		render(doc, body);
		return true;
	}

	/** 先问一句再删。只删 CSV，附件和整本词频表都不动 */
	async function deleteHistoryItem(doc, body, item) {
		var kind = item.kind === 'pct' ? 'pct' : 'pages';
		var ok = await confirmIn(doc,
			'删除分部结果',
			'删掉这份分部词频结果？\n' + item.path
			+ '\n\n只删这个 CSV 文件，' + (kind === 'pct' ? 'EPUB' : 'PDF')
			+ ' 和整本词频表都不动。');
		if (!ok) {
			return false;
		}
		await removeFile(item.path);

		// 正显示着这一份的话，连区块里的词表一起收掉
		var attachment = currentAttachment.get(body);
		if (attachment) {
			var outcome = lastResults.get(attachment.id);
			if (outcome && outcome.outPath === item.path) {
				lastResults.delete(attachment.id);
				resetPage(body);
				render(doc, body);
			}
		}

		statusOf(body, '已删除' + labelOf(kind, item.from, item.to) + '的结果。');
		return true;
	}

	async function removeFile(path) {
		var io = null;
		try {
			if (typeof IOUtils !== 'undefined' && IOUtils) {
				io = IOUtils;
			}
		}
		catch (e) {
			io = null;
		}
		if (io && typeof io.remove === 'function') {
			try {
				await io.remove(path, { ignoreAbsent: true });
				return;
			}
			catch (e) {
				WordFreq.logError('IOUtils.remove 删除失败，改用 nsIFile', e);
			}
		}
		try {
			var f = Components.classes['@mozilla.org/file/local;1']
				.createInstance(Components.interfaces.nsIFile);
			f.initWithPath(path);
			if (f.exists()) {
				f.remove(false);
			}
		}
		catch (e) {
			throw new Error('删除失败：' + ((e && e.message) || e));
		}
	}

	async function confirmIn(doc, title, text) {
		try {
			if (typeof DeepSeekTranslate !== 'undefined' && DeepSeekTranslate.confirm) {
				return await DeepSeekTranslate.confirm(doc && doc.defaultView, title, text);
			}
		}
		catch (e) {
			WordFreq.logError('确认框调用失败，改用窗口确认', e);
		}
		try {
			var win = (doc && doc.defaultView) || Zotero.getMainWindow();
			return !!win.confirm(text);
		}
		catch (e) {
			return false;
		}
	}

	/* ── 词表里每行的小按钮（与整本词频同一套行为） ───── */

	function makeMarkButton(doc, body, word) {
		var inList = WordFreq.userlist.has(word);
		var btn = doc.createXULElement('button');
		btn.classList.add('wordfreq-mark');
		btn.setAttribute('label', MARK_CHAR);
		btn.setAttribute('data-inlist', inList ? 'true' : 'false');
		btn.setAttribute('tooltiptext', inList
			? '已在自定义名单里，点击移出'
			: '加入自定义名单，以后所有文献都不显示它');
		btn.addEventListener('command', function () {
			WordFreq.userlist.toggle(word);
			render(doc, body);
		});
		return btn;
	}

	function renderWords(doc, body, box, paged, wholeIndex) {
		for (var i = 0; i < paged.rows.length; i++) {
			var row = paged.rows[i];

			var line = doc.createXULElement('hbox');
			line.classList.add('wordfreq-word');
			line.setAttribute('align', 'center');

			line.appendChild(makeMarkButton(doc, body, row.word));

			var wordEl = doc.createXULElement('description');
			wordEl.classList.add('wordfreq-word-text');
			wordEl.setAttribute('flex', '1');
			wordEl.setAttribute('crop', 'end');
			wordEl.textContent = row.word;

			var countEl = doc.createXULElement('description');
			countEl.classList.add('wordfreq-count');
			// 整本词频表里有这个词就写成「分部/整本」，没有就只显示分部次数
			var whole = (wholeIndex && wholeIndex.counts)
				? wholeIndex.counts.get(String(row.word).toLowerCase())
				: undefined;
			if (typeof whole === 'number' && isFinite(whole) && whole > 0) {
				countEl.textContent = row.count + '/' + whole;
				countEl.setAttribute('tooltiptext', '分部词频数/整本词频数');
			}
			else {
				countEl.textContent = String(row.count);
			}

			line.appendChild(wordEl);
			line.appendChild(countEl);
			line.appendChild(makeCollectButton(doc, body, row.word));
			box.appendChild(line);
		}
	}

	function makeCollectButton(doc, body, word) {
		var book = wordbookOf();
		var inBook = book ? book.isWordCollected(word) : false;
		var btn = doc.createXULElement('button');
		btn.classList.add('wordfreq-star');
		btn.setAttribute('label', inBook ? '★' : '☆');
		btn.setAttribute('data-inbook', inBook ? 'true' : 'false');
		btn.setAttribute('tooltiptext', inBook ? '已在单词本里，点击移出' : '加入单词本');
		btn.addEventListener('command', function () {
			toggleWordBook(word).then(function () {
				render(doc, body);
			}).catch(function (e) {
				WordFreq.logError('单词本操作失败', e);
			});
		});
		return btn;
	}

	function wordbookOf() {
		return (typeof DeepSeekTranslate !== 'undefined' && DeepSeekTranslate.wordbook)
			? DeepSeekTranslate.wordbook
			: null;
	}

	async function toggleWordBook(word) {
		var book = wordbookOf();
		if (!book) {
			return;
		}
		await book.load();
		if (book.isWordCollected(word)) {
			var ok = await DeepSeekTranslate.confirm(null, '移出单词本',
				'把「' + word + '」移出单词本？');
			if (!ok) {
				return;
			}
			await book.removeByWord(word);
		}
		else {
			await book.addWord(word);
		}
	}

	/* ── 主渲染 ───────────────────────────────────────── */

	function setInput(body, selector, value) {
		var el = body.querySelector(selector);
		if (el) {
			el.value = value;
		}
	}

	/** 把范围填回对应的输入框；另一类输入框清空，免得切换附件后留着旧值 */
	function fillRangeInputs(body, kind, from, to) {
		if (kind === 'pct') {
			setInput(body, '.wordfreq-parts-pct-from', formatPercent(from));
			setInput(body, '.wordfreq-parts-pct-to', formatPercent(to));
			setInput(body, '.wordfreq-parts-from', '');
			setInput(body, '.wordfreq-parts-to', '');
			return;
		}
		setInput(body, '.wordfreq-parts-from', String(from));
		setInput(body, '.wordfreq-parts-to', String(to));
		setInput(body, '.wordfreq-parts-pct-from', '');
		setInput(body, '.wordfreq-parts-pct-to', '');
	}

	function clearRangeInputs(body) {
		['.wordfreq-parts-from', '.wordfreq-parts-to',
			'.wordfreq-parts-pct-from', '.wordfreq-parts-pct-to'].forEach(function (selector) {
			setInput(body, selector, '');
		});
	}

	function render(doc, body) {
		var item = currentItem.get(body);
		var target = { attachment: null, reason: '没有选中条目。' };
		try {
			if (item) {
				target = WordFreq.source.findTextSource(item);
			}
		}
		catch (e) {
			target = { attachment: null, reason: '读取条目失败：' + ((e && e.message) || e) };
		}
		if (target.attachment) {
			currentAttachment.set(body, target.attachment);
		}
		else {
			currentAttachment.delete(body);
		}

		// 按附件类型切换输入行：PDF 填页码；EPUB 暂不支持分部统计
		var kind = attachmentKind(target.attachment);
		show(body.querySelector('.wordfreq-parts-range-pages'), kind === 'pages');
		show(body.querySelector('.wordfreq-parts-range-pct'), false);

		var runBtn = body.querySelector('.wordfreq-parts-run');
		var queryBtn = body.querySelector('.wordfreq-parts-query');
		var resultBox = body.querySelector('.wordfreq-parts-result');
		var pager = body.querySelector('.wordfreq-pager');
		var prevBtn = body.querySelector('.wordfreq-prev');
		var nextBtn = body.querySelector('.wordfreq-next');
		var hideCustom = body.querySelector('.wordfreq-hide-custom');
		if (resultBox) {
			clear(resultBox);
		}

		var opts = uiOpts();
		var customCount = WordFreq.userlist.count();
		if (hideCustom) {
			hideCustom.checked = opts.hideCustom;
			hideCustom.disabled = customCount === 0;
		}

		var isRunning = running.has(body);

		// EPUB 的分部统计暂时不做：分页是按排版分的，全文缓存按字符，
		// 两者对不齐，定位当前读到哪儿一直不准。先明确告知，不猜。
		if (target.attachment && kind === 'pct') {
			if (runBtn) {
				runBtn.disabled = true;
			}
			if (queryBtn) {
				queryBtn.disabled = true;
			}
			show(pager, false);
			statusOf(body, '当前版本的分部统计只支持 PDF，EPUB 还做不了。'
				+ 'EPUB 的整本词频可以正常用。');
			return;
		}

		if (!target.attachment) {
			if (runBtn) {
				runBtn.disabled = true;
			}
			if (queryBtn) {
				queryBtn.disabled = true;
			}
			show(pager, false);
			statusOf(body, target.reason || '这个条目没有可用于统计的 PDF 或 EPUB。');
			return;
		}

		if (runBtn) {
			runBtn.disabled = isRunning;
		}
		if (queryBtn) {
			queryBtn.disabled = isRunning;
		}

		if (isRunning) {
			show(pager, false);
			statusOf(body, kind === 'pct'
				? '正在从 Zotero 全文缓存取文本并统计，请稍等…'
				: '正在从阅读器逐页取文本并统计，页数越多越慢，请稍等…');
			return;
		}

		var outcome = lastResults.get(target.attachment.id);
		var error = lastError.get(body);
		if (error) {
			statusOf(body, error);
		}
		else if (outcome && outcome.status === 'written') {
			var line = labelOf(outcome.kind || kind, outcome.from, outcome.to)
				+ (outcome.generated ? ' · 生成于 ' + outcome.generated : '');
			if (outcome.sliceChars) {
				line += ' · 取 ' + outcome.sliceChars + ' / ' + outcome.fullChars + ' 字';
			}
			statusOf(body, line);
			if (outcome.slicePreview && resultBox) {
				addLine(doc, resultBox, '本次统计的文字从「'
					+ outcome.slicePreview.slice(0, 40) + '…」开始。');
			}
		}
		else if (kind === 'pct') {
			statusOf(body, '填好百分比后点「开始统计」。CSV 会写在 EPUB 同目录，每次统计都留一份。');
		}
		else {
			statusOf(body, '填好页码范围后点「开始统计」。CSV 会写在 PDF 同目录，每次统计都留一份。');
		}

		if (!outcome || outcome.status !== 'written') {
			show(pager, false);
			return;
		}

		var filtered = WordFreq.wordfreq.filterForDisplay(outcome.rows || [], {
			hideCustom: opts.hideCustom,
			customWords: WordFreq.userlist.set(),
		});
		// 整本词次：有整本词频表就拿来做对照，显示成「分部/整本」
		var wholeIndex = wholeByAttachment.get(target.attachment.id);
		if (wholeIndex === undefined && typeof DeepSeekTranslate !== 'undefined'
			&& DeepSeekTranslate.counts) {
			// 先占位，避免每次重画都重新读一遍文件
			wholeByAttachment.set(target.attachment.id, null);
			DeepSeekTranslate.counts.forAttachment(target.attachment).then(function (built) {
				wholeByAttachment.set(target.attachment.id, built || null);
				if (built) {
					try {
						render(doc, body);
					}
					catch (e) {
						WordFreq.logError('重画分部词表失败', e);
					}
				}
			}).catch(function (e) {
				WordFreq.logError('读取整本词次失败', e);
			});
		}
		var paged = WordFreq.wordfreq.page(filtered.rows, opts.pageSize, getPage(body));
		pageIndex.set(body, paged.pageIndex);

		if (!resultBox) {
			return;
		}
		if (!filtered.rows.length) {
			addLine(doc, resultBox,
				'当前筛选把 ' + (outcome.rows || []).length + ' 个词元全滤掉了。'
				+ '把下面的「隐藏自定义单词」关掉，或者去整本词频的名单弹窗里清一清。');
		}
		else {
			renderWords(doc, body, resultBox, paged, wholeIndex);
			// 说明白屏幕上这些条目是筛过的，不然容易以为没统计到
			var hidden = (outcome.rows || []).length - filtered.rows.length;
			if (hidden > 0) {
				addLine(doc, resultBox, '另有 ' + hidden + ' 个词元按当前筛选条件没显示'
					+ '（自定义名单、只出现一次的词）。');
			}
		}

		show(pager, filtered.rows.length > 0);
		var pageInfo = body.querySelector('.wordfreq-pageinfo');
		if (pageInfo) {
			pageInfo.textContent = '第 ' + (paged.pageIndex + 1) + ' / ' + paged.totalPages + ' 页';
		}
		if (prevBtn) {
			prevBtn.disabled = paged.pageIndex <= 0;
		}
		if (nextBtn) {
			nextBtn.disabled = paged.pageIndex >= paged.totalPages - 1;
		}
	}

	/* ── 样式与右键菜单 ───────────────────────────────── */

	function ensureStyle(doc) {
		if (!doc || !doc.documentElement || doc.getElementById(STYLE_ID)) {
			return;
		}
		try {
			var style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
			style.id = STYLE_ID;
			style.textContent = PANE_STYLE;
			doc.documentElement.appendChild(style);
		}
		catch (e) {
			WordFreq.logError('注入分部词频样式失败', e);
		}
	}

	/** 区块专用的右键菜单，一个文档只建一个 */
	function ensureContextPopup(doc) {
		var existing = doc.getElementById(POPUP_ID);
		if (existing) {
			return existing;
		}
		var popup = doc.createXULElement('menupopup');
		popup.id = POPUP_ID;
		var item = doc.createXULElement('menuitem');
		item.setAttribute('label', '填写当前页码');
		item.setAttribute('class', 'ea-parts-fill-page');
		popup.appendChild(item);
		doc.documentElement.appendChild(popup);
		return popup;
	}

	/** 输入框属于哪一类：百分比的框填当前位置，页码的框填当前页码 */
	function kindOfInput(input) {
		if (!input || !input.classList) {
			return 'pages';
		}
		return input.classList.contains('wordfreq-parts-pct-from')
			|| input.classList.contains('wordfreq-parts-pct-to') ? 'pct' : 'pages';
	}

	/**
	 * 当前阅读器打开的页码（1 起）。拿不到就返回 null。
	 * Zotero 没有公开的接口，这里按几种已知的内部字段逐个试，
	 * 全部失败就当作拿不到，让界面给提示，不要瞎猜一个数字。
	 */
	function currentPageOf(attachment) {
		if (!attachment) {
			return null;
		}

		// 首选 Zotero 自己的附件 API：记录的就是用户最后看到的那一页（0 起）
		try {
			if (typeof attachment.getAttachmentLastPageIndex === 'function') {
				var last = attachment.getAttachmentLastPageIndex();
				if (typeof last === 'number' && isFinite(last) && last >= 0) {
					return Math.floor(last) + 1;
				}
			}
		}
		catch (e) {
			WordFreq.logError('读取附件最后页码失败', e);
		}

		var readers = (Zotero.Reader && Zotero.Reader._readers) || [];
		for (var i = 0; i < readers.length; i++) {
			var reader = readers[i];
			if (!reader || reader.itemID !== attachment.id) {
				continue;
			}
			var index = firstPageIndex([
				reader.state && reader.state.pageIndex,
				reader._state && reader._state.pageIndex,
				reader._internalReader && reader._internalReader._state
					&& reader._internalReader._state.pageIndex,
				reader._internalReader && reader._internalReader._primaryView
					&& reader._internalReader._primaryView._state
					&& reader._internalReader._primaryView._state.pageIndex,
			]);
			if (index !== null) {
				return index + 1;
			}
		}
		return null;
	}

	function firstPageIndex(candidates) {
		for (var i = 0; i < candidates.length; i++) {
			var value = candidates[i];
			if (typeof value === 'number' && isFinite(value) && value >= 0) {
				return value;
			}
		}
		return null;
	}

	/** 失败时按原因给出能照着做的提示 */
	function positionFailureText(reason) {
		if (reason === 'no-reader') {
			return '没找到这本书的阅读器窗口：请先在 Zotero 里打开这本书（EPUB 或 PDF），'
				+ '再回到这里点右键。';
		}
		if (reason === 'no-text') {
			return '阅读器开着，但没读到屏幕上的正文：把书翻一页让它重新渲染，再点一次右键。';
		}
		return '全文缓存里没找到屏幕上那段文字：先在 Zotero 里右键这本书，'
			+ '选「重建全文索引」，索引建好后再试。';
	}
	/** 找到这篇附件对应的阅读器实例 */
	function readerFor(attachment) {
		var readers = (Zotero.Reader && Zotero.Reader._readers) || [];
		if (attachment) {
			for (var i = 0; i < readers.length; i++) {
				var reader = readers[i];
				if (!reader) {
					continue;
				}
				if (reader.itemID === attachment.id) {
					return reader;
				}
				try {
					if (reader._item && reader._item.id === attachment.id) {
						return reader;
					}
				}
				catch (e) {
					// 没有 _item 就算了
				}
			}
		}
		// 认不出 id 时，如果只开着一个阅读器，就是它
		if (readers.length === 1 && readers[0]) {
			return readers[0];
		}
		return null;
	}

	/** 阅读器里承载正文的窗口；EPUB 的正文在嵌套 iframe 里，往下多找几层 */
	function contentWindows(reader) {
		var wins = [];
		function add(win, depth) {
			if (!win || depth > 3 || wins.indexOf(win) >= 0) {
				return;
			}
			var doc = null;
			try {
				doc = win.document;
			}
			catch (e) {
				return;   // 跨域 iframe 读不到
			}
			if (!doc) {
				return;
			}
			wins.push(win);
			var frames = [];
			try {
				frames = win.frames || [];
			}
			catch (e) {
				frames = [];
			}
			for (var i = 0; i < frames.length; i++) {
				add(frames[i], depth + 1);
			}
		}
		try {
			add(reader._iframeWindow, 0);
			var internal = reader._internalReader;
			if (internal) {
				add(internal._primaryView && internal._primaryView._iframeWindow, 0);
				add(internal._secondaryView && internal._secondaryView._iframeWindow, 0);
			}
		}
		catch (e) {
			// 内部结构变了就算了，靠 frames 兜
		}
		return wins;
	}

	/** 这个窗口里的段落文字总长，用来区分阅读器外壳与正文 iframe */
	function windowTextWeight(win) {
		var doc = null;
		try {
			doc = win.document;
		}
		catch (e) {
			return 0;
		}
		if (!doc || !doc.querySelectorAll) {
			return 0;
		}
		var nodes = doc.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6');
		var total = 0;
		for (var i = 0; i < nodes.length && i < 4000; i++) {
			total += String(nodes[i].textContent || '').length;
		}
		return total;
	}
	/**
	 * 视口里前几段有字可读的正文，用来在全文里定位当前位置。
	 * mode = 'inner'：按 iframe 自己的滚动容器算（章节内部滚动）。
	 * mode = 'outer'：整本书铺在一个很高的 iframe 里、由外层窗口滚动，
	 *   这时 iframe 的 getBoundingClientRect().top 是大幅负值，用它加上
	 *   段落自身的 top 才是真正在屏幕上的位置。
	 */
	function visibleChunks(win, mode) {
		var found = [];
		var doc = win.document && win.document;
		if (!doc || !doc.querySelectorAll) {
			return found;
		}
		var outer = mode === 'outer';
		var scroller = doc.scrollingElement || doc.documentElement || doc.body;
		var scrollTop = 0;
		var viewHeight = 0;
		try {
			viewHeight = win.innerHeight || (scroller && scroller.clientHeight) || 0;
		}
		catch (e) {
			viewHeight = 0;
		}
		var frameTop = 0;
		if (outer) {
			try {
				var frame = win.frameElement;
				if (!frame) {
					return found;
				}
				frameTop = frame.getBoundingClientRect().top;
				var parentWin = frame.ownerDocument.defaultView;
				viewHeight = parentWin.innerHeight || viewHeight;
			}
			catch (e) {
				return found;
			}
			// 外层模式下段落坐标已经包含外层滚动量，不再叠加内部 scrollTop
			scrollTop = 0;
		}
		else {
			try {
				scrollTop = scroller ? (scroller.scrollTop || 0) : 0;
				if (!scrollTop && win.scrollY) {
					scrollTop = win.scrollY;
				}
			}
			catch (e) {
				scrollTop = 0;
			}
		}
		var nodes = doc.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6');
		for (var i = 0; i < nodes.length && found.length < 3; i++) {
			var el = nodes[i];
			var text = String(el.textContent || '').trim();
			if (text.length < 12) {
				continue;
			}
			var rect = el.getBoundingClientRect();
			var visible = false;
			if (viewHeight > 0) {
				if (outer) {
					var y = frameTop + rect.top;
					visible = y + rect.height >= 0 && y <= viewHeight;
				}
				else {
					var absoluteTop = rect.top + scrollTop;
					visible = absoluteTop + rect.height >= scrollTop
						&& absoluteTop <= scrollTop + viewHeight;
				}
			}
			else {
				visible = !(rect.bottom < 0 || rect.top > 800);
			}
			if (visible) {
				found.push(text);
			}
		}
		return found;
	}

	/**
	 * 按「视口里看到的那段字」在全文缓存里定位，返回 { pct, reason }。
	 * reason 用来在失败时说清是哪一步没成：no-reader / no-text / not-in-cache / no-cache。
	 */
	function locateVisible(attachment) {
		var reader = readerFor(attachment);
		if (!reader) {
			return Promise.resolve({ pct: null, reason: 'no-reader' });
		}
		var wins = contentWindows(reader);
		// 阅读器窗口里既有外壳界面也有正文 iframe，外壳里也有 <p>。
		// 按「谁的段落文字最多」挑出正文那一层，免得拿界面文字去缓存里找。
		var weights = wins.map(function (win) {
			try {
				return windowTextWeight(win);
			}
			catch (e) {
				return 0;
			}
		});
		var bestIndex = -1;
		var bestWeight = 0;
		for (var b = 0; b < weights.length; b++) {
			if (weights[b] > bestWeight) {
				bestWeight = weights[b];
				bestIndex = b;
			}
		}
		var chunks = [];
		if (bestIndex >= 0 && bestWeight >= 400) {
			// 两种滚动方式都试：章节内部滚动读 iframe 自己的 scrollTop，
			// 整本书铺在长 iframe 里则由外层窗口滚（用户这本书属于后者）。
			// 哪层算出来的段落真的在屏幕上，交给后面的先验比较来判断。
			var modes = ['inner', 'outer'];
			for (var m = 0; m < modes.length; m++) {
				try {
					var got = visibleChunks(wins[bestIndex], modes[m]);
					for (var g = 0; g < got.length; g++) {
						if (chunks.indexOf(got[g]) < 0) {
							chunks.push(got[g]);
						}
					}
				}
				catch (e) {
					// 这层读不到就算了，还有另一层
				}
			}
		}
		if (!chunks.length) {
			WordFreq.logError('当前位置：没读到可见段落，窗口段落字数 [' + weights.join(', ') + ']');
			WordFreq.logError('当前位置：没读到视口文字，阅读器窗口数 '
				+ wins.length + '，附件是 '
				+ (attachment && attachment.attachmentContentType));
			return Promise.resolve({ pct: null, reason: 'no-text' });
		}
		return Promise.resolve()
			.then(function () {
				return WordFreq.source.getText(attachment, { textSource: 'cache' });
			})
			.then(function (text) {
				var fullText = (text && typeof text === 'object') ? text.text : text;
				// 页码折算出来的百分比当先验：只用来在同一个探针的多处出现里挑对那处，
				// 目录里也有章节名，不挑就会永远命中目录那一次（用户遇到的一直 0.6%）。
				var prior = currentPercentOf(attachment);
				// 候选段落可能来自两种滚动假设，命中的位置也可能不同：
				// 取离先验最近的那个命中。先验的 0.7 个百分点偏差不影响这一步，
				// 因为它只是用来在几个候选里挑一个。
				var bestHit = null;
				var bestChunk = '';
				var bestGap = Infinity;
				for (var j = 0; j < chunks.length; j++) {
					var hit = percentOfChunkInText(chunks[j], fullText, prior);
					if (hit === null) {
						continue;
					}
					if (prior === null) {
						bestHit = hit;
						bestChunk = chunks[j];
						break;
					}
					var gap = Math.abs(hit - prior);
					if (gap < bestGap) {
						bestGap = gap;
						bestHit = hit;
						bestChunk = chunks[j];
					}
				}
				if (bestHit !== null) {
					WordFreq.log('当前位置：段落「' + bestChunk.slice(0, 40)
						+ '」定位到 ' + bestHit + '%（页码先验 '
						+ (prior === null ? '无' : prior + '%') + '，候选 '
						+ chunks.length + ' 段）');
					return { pct: bestHit, reason: 'ok' };
				}
				var href = '';
				try {
					href = wins[bestIndex] && wins[bestIndex].location
						&& wins[bestIndex].location.href || '';
				}
				catch (e) {
					href = '(读不到地址)';
				}
				WordFreq.logError('当前位置：缓存里找不到屏幕上的文字；窗口='
					+ href + '；段落字数 [' + weights.join(', ') + ']；屏幕=「'
					+ chunks[0].slice(0, 40) + '」；缓存开头=「'
					+ String(text || '').slice(0, 40) + '」');
				return { pct: null, reason: 'not-in-cache' };
			})
			.catch(function () {
				return { pct: null, reason: 'no-cache' };
			});
	}
	/**
	 * 把两边都压成「只有字母数字」的形式再比：缓存文本与阅读器 DOM 的空白、
	 * 标点、连字符、零宽字符都不一样，按可见字符比才稳。
	 */
	function foldForSearch(text) {
		return String(text || '')
			.toLowerCase()
			.replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, '')
			.replace(/[^0-9a-z\u00c0-\u024f\u4e00-\u9fff']/g, '');
	}

	/**
	 * 在全文里找这段肉眼可见的字，返回它起点占全文的百分比（保留一位小数）。
	 * 探针由长到短试几档；开头没命中时再试中段，绕开段首的页眉、题注。
	 */
	function percentOfChunkInText(chunk, text, priorPct) {
		// 调用方有时递的是 getText() 的返回值（{ text, note }），这里统一取字符串
		if (text && typeof text === 'object' && typeof text.text === 'string') {
			text = text.text;
		}
		var flatText = foldForSearch(text);
		var flatChunk = foldForSearch(chunk);
		if (flatText.length < 8 || flatChunk.length < 8) {
			return null;
		}
		var sizes = [80, 56, 36, 24];
		for (var i = 0; i < sizes.length; i++) {
			var probe = flatChunk.slice(0, sizes[i]);
			if (probe.length < 24) {
				continue;
			}
			var at = nearestOccurrence(flatText, probe, priorPct);
			if (at >= 0) {
				return percentFromOffset(at, flatText.length);
			}
		}
		var middle = Math.floor(flatChunk.length / 3);
		var midProbe = flatChunk.slice(middle, middle + 40);
		if (midProbe.length >= 24) {
			var mid = nearestOccurrence(flatText, midProbe, priorPct);
			if (mid >= 0) {
				return percentFromOffset(Math.max(0, mid - middle), flatText.length);
			}
		}
		return null;
	}

	/**
	 * 在全文里找探针的所有出现位置（最多 200 处），挑离 priorPct 最近的那一处。
	 * 目录里也有章节名，同一个词常出现两次以上；不给先验时取第一处。
	 */
	function nearestOccurrence(flatText, probe, priorPct) {
		var hits = [];
		var at = -1;
		while (hits.length < 200) {
			at = flatText.indexOf(probe, at + 1);
			if (at < 0) {
				break;
			}
			hits.push(at);
		}
		if (!hits.length) {
			return -1;
		}
		if (typeof priorPct !== 'number' || !isFinite(priorPct)) {
			return hits[0];
		}
		var best = hits[0];
		var bestGap = Infinity;
		for (var i = 0; i < hits.length; i++) {
			var pct = (hits[i] / flatText.length) * 100;
			var gap = Math.abs(pct - priorPct);
			if (gap < bestGap) {
				bestGap = gap;
				best = hits[i];
			}
		}
		return best;
	}
	/** 「12 / 340」这种页码文字，返回 { index, total }，解析不出返回 null */
	function parsePageLabel(text) {
		var hit = String(text || '').trim().match(/^(\d{1,5})\s*[\/／]\s*(\d{1,5})$/);
		if (!hit) {
			return null;
		}
		var index = parseInt(hit[1], 10);
		var total = parseInt(hit[2], 10);
		if (!(index > 0) || !(total > 0) || index > total) {
			return null;
		}
		return { index: index, total: total };
	}
	/**
	 * 从阅读器界面上的「第 12 / 340 页」这类文字里读页码。
	 * 阅读器本来就按窗口大小与字号分好页并显示出来，直接用它比自己猜位置稳。
	 * 返回 { index, total }（index 从 1 开始），读不到返回 null。
	 */
	function pageLabelIn(win) {
		var doc = null;
		try {
			doc = win.document;
		}
		catch (e) {
			return null;
		}
		if (!doc || !doc.createTreeWalker) {
			return null;
		}
		var root = doc.body || doc.documentElement;
		if (!root) {
			return null;
		}
		var walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
		var node = null;
		var seen = 0;
		while ((node = walker.nextNode()) && seen < 4000) {
			seen++;
			var text = String(node.nodeValue || '').trim();
			if (!text || text.length > 24) {
				continue;
			}
			var label = parsePageLabel(text);
			if (label) {
				return label;
			}
		}
		return null;
	}

	/** 当前阅读位置百分比：优先读界面上显示的页码 */
	function percentFromPageLabel(attachment) {
		var reader = readerFor(attachment);
		if (!reader) {
			return null;
		}
		var wins = contentWindows(reader);
		for (var i = 0; i < wins.length; i++) {
			var label = null;
			try {
				label = pageLabelIn(wins[i]);
			}
			catch (e) {
				label = null;
			}
			if (!label) {
				continue;
			}
			var pct = percentOfIndex(label.index - 1, label.total);
			if (pct !== null) {
				WordFreq.logError('当前位置：界面上读到 ' + label.index + ' / '
					+ label.total + '，折算 ' + pct + '%');
				return pct;
			}
		}
		return null;
	}
	/** 位置换算成百分比：保留一位小数，钳在 0–100 */
	function percentFromOffset(offset, length) {
		if (typeof offset !== 'number' || !isFinite(offset) || offset < 0) {
			return null;
		}
		if (typeof length !== 'number' || !isFinite(length) || length <= 0) {
			return null;
		}
		var pct = Math.round((offset / length) * 1000) / 10;
		return Math.max(0, Math.min(100, pct));
	}

	/**
	 * 阅读器自己算出来的位置：EPUB 视图每次翻页都会把 pageIndex / pagesCount
	 * 放进 `_internalReader._state.primaryViewStats`，界面上那个页码就是它。
	 * 参数是 stats 对象，返回百分比；缺数据返回 null。
	 */
	function percentOfStats(stats) {
		if (!stats) {
			return null;
		}
		var index = stats.pageIndex;
		var total = stats.pagesCount;
		if (typeof index !== 'number' || typeof total !== 'number') {
			return null;
		}
		return percentOfIndex(index, total);
	}

	/** 从阅读器实例里取视图统计并折算成百分比 */
	function percentFromViewStats(attachment) {
		var reader = readerFor(attachment);
		if (!reader) {
			return null;
		}
		var internal = reader._internalReader;
		var states = [];
		try {
			if (internal && internal._state) {
				states.push(internal._state);
			}
		}
		catch (e) {
			// 读不到就算了
		}
		try {
			if (reader.state) {
				states.push(reader.state);
			}
		}
		catch (e) {
			// 读不到就算了
		}
		for (var i = 0; i < states.length; i++) {
			var state = states[i];
			var stats = state && (state.primary === false
				? state.secondaryViewStats
				: state.primaryViewStats);
			var pct = percentOfStats(stats);
			if (pct !== null) {
				WordFreq.logError('当前位置：阅读器统计 pageIndex=' + stats.pageIndex
					+ ' pagesCount=' + stats.pagesCount + '，折算 ' + pct + '%');
				return pct;
			}
		}
		return null;
	}

	/** 当前阅读位置占全文的百分比（保留一位小数）。拿不到返回 null。 */
	function currentPercentOf(attachment) {
		var direct = percentFromViewStats(attachment);
		if (direct !== null) {
			return direct;
		}
		var labeled = percentFromPageLabel(attachment);
		if (labeled !== null) {
			return labeled;
		}
		return null;
	}
	/* ── 注册 ─────────────────────────────────────────── */

	return {
		PANE_ID: PANE_ID,

		/** 纯函数，供自测核对文件名解析；不参与界面 */
		parsePartName: parsePartName,

		// 下面几个都是纯函数，自测直接调，不碰 Zotero
		formatPercent: formatPercent,
		parsePercent: parsePercent,
		checkPercentRange: checkPercentRange,
		sliceByPercent: sliceByPercent,
		rangeSuffix: rangeSuffix,
		partFileName: partFileName,
		labelOf: labelOf,
		outcomeFromCsv: outcomeFromCsv,
		percentOfIndex: percentOfIndex,
		percentFromOffset: percentFromOffset,
		parsePageLabel: parsePageLabel,
		percentOfStats: percentOfStats,
		nearestOccurrence: nearestOccurrence,
		percentOfChunkInText: percentOfChunkInText,
		foldForSearch: foldForSearch,

		register: function () {
			// 已经注册过就直接返回，避免设置里来回勾选时重复注册
			if (this.paneKey) {
				return this.paneKey;
			}
			if (!Zotero.ItemPaneManager
				|| typeof Zotero.ItemPaneManager.registerSection !== 'function') {
				WordFreq.log('这个 Zotero 没有 ItemPaneManager，分部词频区块没注册');
				return false;
			}

			this.paneKey = Zotero.ItemPaneManager.registerSection({
				paneID: PANE_ID,
				pluginID: WordFreq.pluginID,
				header: {
					l10nID: 'ea-wordfreq-parts-header',
					icon: WordFreq.rootURI + 'chrome/content/icons/parts-16.svg',
				},
				sidenav: {
					l10nID: 'ea-wordfreq-parts-sidenav',
					icon: WordFreq.rootURI + 'chrome/content/icons/parts-20.svg',
					orderable: false,
				},
				bodyXHTML: BODY_XHTML,

				onInit: function ({ doc, body, refresh }) {
					refreshFns.set(body, refresh);
					// 也登记到整本区块的刷新名单：单词本一改，这里的星标要跟着变
					if (WordFreq.pane && WordFreq.pane.trackBody) {
						WordFreq.pane.trackBody(body, refresh);
					}
					ensureStyle(doc);

					// 自定义名单入口：与整本区块共用同一个弹窗
					var customOpen = body.querySelector('.wordfreq-custom-open');
					if (customOpen) {
						customOpen.addEventListener('command', function () {
							if (WordFreq.pane && WordFreq.pane.openCustomPanel) {
								WordFreq.pane.openCustomPanel(doc, customOpen);
								syncCustomCount(body);
							}
						});
						syncCustomCount(body);
					}

					// 输入框右键菜单：页码框填当前页码，百分比框填当前位置
					var popup = ensureContextPopup(doc);
					var targetInput = null;

					[body.querySelector('.wordfreq-parts-from'),
						body.querySelector('.wordfreq-parts-to'),
						body.querySelector('.wordfreq-parts-pct-from'),
						body.querySelector('.wordfreq-parts-pct-to')].forEach(function (input) {
						if (!input) {
							return;
						}
						input.addEventListener('contextmenu', function (event) {
							event.preventDefault();
							event.stopPropagation();
							targetInput = input;
							try {
								popup.openPopupAtScreen(event.screenX, event.screenY, true);
							}
							catch (e) {
								WordFreq.logError('打开右键菜单失败', e);
							}
						});
					});

					var fillItem = popup.querySelector('menuitem');
					if (fillItem) {
						// 菜单项文字按被点的那一行切换
						popup.addEventListener('popupshowing', function () {
							var kind = kindOfInput(targetInput);
							fillItem.setAttribute('label',
								kind === 'pct' ? '填写当前位置' : '填写当前页码');
						});

						fillItem.addEventListener('command', function () {
							if (!targetInput) {
								return;
							}
							var kind = kindOfInput(targetInput);
							var att = currentAttachment.get(body) || null;
							if (!att) {
								// 兜底：按这个窗口当前选中的条目再找一次
								try {
									var pane = (doc.defaultView && doc.defaultView.ZoteroPane)
										|| Zotero.getActiveZoteroPane();
									var selected = (pane && pane.getSelectedItems) ? pane.getSelectedItems() : [];
									if (selected && selected.length) {
										var found = kind === 'pct'
											? WordFreq.source.findTextSource(selected[0])
											: WordFreq.source.findPdf(selected[0]);
										att = found && found.attachment;
									}
								}
								catch (e) {
									att = null;
								}
							}

							if (kind === 'pct') {
								// 百分比切片切的就是全文缓存，所以先拿屏幕上那段字去缓存里定位，
								// 两者用的是同一把尺子；定位不到再退回阅读器页码折算。
								statusOf(body, '正在读取当前位置…');
								locateVisible(att).then(function (found) {
									if (found.pct !== null) {
										targetInput.value = formatPercent(found.pct);
										statusOf(body, '已把当前位置 ' + formatPercent(found.pct)
											+ '% 填进输入框。');
										return;
									}
									var byPage = currentPercentOf(att);
									if (byPage !== null) {
										targetInput.value = formatPercent(byPage);
										statusOf(body, '已按页码折算填入 ' + formatPercent(byPage)
											+ '%（没读到屏幕上的文字，按页数估的，可能差几个百分点）。');
										return;
									}
									statusOf(body, positionFailureText(found.reason));
								}).catch(function (e) {
									WordFreq.logError('换算当前位置失败', e);
									statusOf(body, '没拿到当前位置：读取阅读器位置时出错了。');
								});
								return;
							}

							var page = currentPageOf(att);
							if (page === null) {
								statusOf(body, '没拿到当前页码：请先打开这篇 PDF 并翻到要统计的地方。');
								return;
							}
							targetInput.value = String(page);
							statusOf(body, '已把当前页码 ' + page + ' 填进输入框。');
						});
					}

					var runBtn = body.querySelector('.wordfreq-parts-run');
					if (runBtn) {
						runBtn.addEventListener('command', function () {
							runForBody(doc, body).catch(function (e) {
								WordFreq.logError('分部词频统计失败', e);
							});
						});
					}

					var queryBtn = body.querySelector('.wordfreq-parts-query');
					if (queryBtn) {
						queryBtn.addEventListener('command', function () {
							openPartsPanel(doc, body, queryBtn);
						});
					}

					var hideCustom = body.querySelector('.wordfreq-hide-custom');
					if (hideCustom) {
						hideCustom.addEventListener('command', function () {
							WordFreq.prefSet('paneHideCustom', !!hideCustom.checked);
							resetPage(body);
							render(doc, body);
						});
					}

					var prevBtn = body.querySelector('.wordfreq-prev');
					if (prevBtn) {
						prevBtn.addEventListener('command', function () {
							pageIndex.set(body, Math.max(0, getPage(body) - 1));
							render(doc, body);
						});
					}
					var nextBtn = body.querySelector('.wordfreq-next');
					if (nextBtn) {
						nextBtn.addEventListener('command', function () {
							pageIndex.set(body, getPage(body) + 1);
							render(doc, body);
						});
					}
				},

				onDestroy: function ({ body }) {
					refreshFns.delete(body);
					currentItem.delete(body);
					currentAttachment.delete(body);
					lastError.delete(body);
					hidePanelFor(body);
					pageIndex.delete(body);
				},

				// 区块标题靠插件自己的 ftl，链接必须挂进这个文档
				onRender: function ({ doc, body, item }) {
					if (typeof EnglishAssistant !== 'undefined') {
						EnglishAssistant.injectLocalization(doc);
						EnglishAssistant.applySectionLabels(doc).catch(function () {});
					}

					var previous = currentItem.get(body);
					var changed = !previous || previous.id !== (item && item.id);
					currentItem.set(body, item);

					if (changed) {
						// 换条目时页码回到第一页，打开着的记录弹窗收起来；
						// 这篇要是刚统计过，把范围填回去，方便再跑一次
						resetPage(body);
						hidePanelFor(body);
						lastError.delete(body);
						var outcome = null;
						var attachment = null;
						try {
							attachment = item ? WordFreq.source.findTextSource(item).attachment : null;
						}
						catch (e) {
							attachment = null;
						}
						if (attachment) {
							outcome = lastResults.get(attachment.id) || null;
						}
						if (outcome && outcome.status === 'written') {
							fillRangeInputs(body, outcome.kind || attachmentKind(attachment),
								outcome.from, outcome.to);
						}
						else {
							clearRangeInputs(body);
						}
					}

					render(doc, body);
				},

				// 同步的 onRender 不能读文件；这里先把单词本读进内存，
				// 行尾的星标才能一次画对
				onAsyncRender: async function ({ doc, body }) {
					try {
						if (typeof DeepSeekTranslate !== 'undefined' && DeepSeekTranslate.wordbook) {
							await DeepSeekTranslate.wordbook.load();
						}
					}
					catch (e) {
						WordFreq.logError('读入单词本失败', e);
					}
					render(doc, body);
				},

				onItemChange: function ({ item, body, setEnabled, setSectionSummary }) {
					try {
						// 区块一直显示。没有附件时在正文里说明原因，
						// 比整块消失更容易让人看懂发生了什么。
						setEnabled(true);
						var attachment = item ? WordFreq.source.findTextSource(item).attachment : null;
						if (body) {
							if (attachment) {
								currentAttachment.set(body, attachment);
							}
							else {
								currentAttachment.delete(body);
							}
						}
						if (!attachment) {
							setSectionSummary('需要 PDF 或 EPUB');
						}
						else if (attachmentKind(attachment) === 'pct') {
							setSectionSummary('EPUB 暂不支持');
						}
						else if (lastResults.has(attachment.id)) {
							setSectionSummary('已统计');
						}
						else {
							setSectionSummary('按页码范围统计');
						}
					}
					catch (e) {
						WordFreq.logError('条目窗格判断状态失败', e);
					}
				},
			});
			return !!this.paneKey;
		},

		unregister: function () {
			try {
				if (this.paneKey && Zotero.ItemPaneManager) {
					Zotero.ItemPaneManager.unregisterSection(this.paneKey);
				}
			}
			catch (e) {
				WordFreq.logError('注销分部词频区块失败', e);
			}
			this.paneKey = null;
		},
	};
})();
