/* 右侧条目窗格里的词频区块。
 *
 * 这是插件唯一的界面入口。区块由 Zotero 的 ItemPaneManager 管理，
 * 随选中条目自动渲染，不参与任何菜单。
 *
 * 内容：统计结果摘要 + 高频词列表 + 分页 + 一个打开自定义名单弹窗的按钮。
 * 词表每行左边有个小按钮，点了把词加进自定义名单。
 * 名单是全局的，在别的文献里也生效，点底部的按钮在弹窗里管理。
 * 筛选只影响窗格显示，CSV 始终完整。
 */

var WordFreq = WordFreq || {};

WordFreq.pane = (function () {
	var PANE_ID = 'ea-wordfreq-pane';
	var PANEL_ID = 'ea-wordfreq-custom-panel';
	var STYLE_ID = 'ea-wordfreq-style';
	var DEFAULT_PAGE_SIZE = 20;
	// 每行左边那个小按钮上的符号。用 U+2212 减号本身，
	// 不用 emoji 那个 ➖——emoji 在不同字体下会渲染成彩色方块，尺寸也不受控。
	var MARK_CHAR = '\u2212';

	// 附件 itemID → 上一次的运行结果。切换条目再切回来时还能看到上次的结果。
	var lastResults = new Map();
	// 每个区块当前渲染的条目、上次写出的文件、正在跑、Zotero 给的 refresh()、当前页码
	var currentItem = new WeakMap();
	var lastPath = new WeakMap();
	var running = new WeakSet();
	var refreshFns = new WeakMap();
	// 还活着的区块 body：单词本改动后要统一刷新，星标才不会停在旧状态
	var liveBodies = new Set();
	var pageIndex = new WeakMap();
	// 名单弹窗：当前页码，以及是谁打开的（改动名单后要顺手刷新那块窗格）
	var panelPage = new WeakMap();
	var panelBody = new WeakMap();
	// 已经去磁盘上找过词频表的附件，避免每次渲染都问一遍文件系统
	var csvChecked = new Set();

	// 条目窗格区块没有 stylesheets 选项，样式只能自己注入。
	// XUL 的 button 默认有主题给的最小宽度和内边距，不把 appearance 关掉
	// 就没法把它缩到 18px。
	var PANE_STYLE = [
		'.wordfreq-pane button.wordfreq-mark {',
		'  appearance: none; -moz-appearance: none;',
		'  min-width: 0; width: 18px; min-height: 0; height: 18px;',
		'  padding: 0; margin: 0 5px 0 0;',
		'  font-size: 11px; line-height: 16px; text-align: center;',
		'  border: 1px solid rgba(128,128,128,.45); border-radius: 3px;',
		'  background: transparent; color: inherit;',
		'}',
		'.wordfreq-pane button.wordfreq-mark:hover { background: rgba(128,128,128,.22); }',
		'.wordfreq-pane button.wordfreq-mark[data-inlist="true"] { opacity: .45; }',
		'.wordfreq-pane .wordfreq-word { min-height: 18px; }',
		'.wordfreq-pane .wordfreq-count { font-variant-numeric: tabular-nums; margin-left: 8px; }',
		'.wordfreq-pane button.wordfreq-star {',
		'  appearance: none; -moz-appearance: none;',
		'  min-width: 0; width: 20px; min-height: 0; height: 20px;',
		'  padding: 0; margin: 0 0 0 6px;',
		'  font-size: 15px; line-height: 18px; text-align: center;',
		'  border: none; background: transparent; color: inherit;',
		'}',
		'.wordfreq-pane button.wordfreq-star:hover { background: rgba(128,128,128,.22); border-radius: 3px; }',
		'.wordfreq-pane button.wordfreq-star[data-inbook="true"] { color: #faa700; }',
		'.wordfreq-pane .wordfreq-footer { margin-top: .5em; }',
		'.wordfreq-panel { width: 300px; padding: 8px 10px 6px; }',
		'.wordfreq-panel-head { margin-bottom: 6px; }',
		'.wordfreq-panel-title { font-weight: 600; font-size: 12px; opacity: .9; }',
		'.wordfreq-panel-btns { margin-top: 4px; }',
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
		'.wordfreq-panel-list { overflow-y: auto; max-height: 320px; min-height: 40px; margin-top: 2px; }',
		'.wordfreq-panel-row { min-height: 22px; }',
		'.wordfreq-panel button.wordfreq-panel-x {',
		'  appearance: none; -moz-appearance: none;',
		'  min-width: 0; width: 20px; min-height: 0; height: 20px;',
		'  padding: 0; margin: 0 6px 0 0; font-size: 10px; line-height: 18px;',
		'  border: 1px solid rgba(128,128,128,.35); border-radius: 50%;',
		'  background: transparent; color: inherit; opacity: .75;',
		'}',
		'.wordfreq-panel button.wordfreq-panel-x:hover { opacity: 1; }',
		'.wordfreq-panel button.wordfreq-panel-x:hover { background: rgba(209,59,59,.18); color: #d13b3b; border-color: rgba(209,59,59,.5); }',
	].join('\n');

	var BODY_XHTML = [
		'<vbox class="wordfreq-pane" flex="1">',
		'  <hbox class="wordfreq-actions" align="center">',
		'    <button class="wordfreq-run" label="统计词频（英文）" />',
		'    <button class="wordfreq-open" label="打开 CSV" hidden="true" />',
		'  </hbox>',
		'  <description class="wordfreq-status" />',
		'  <vbox class="wordfreq-result" flex="1" />',
		'  <hbox class="wordfreq-pager" align="center" hidden="true">',
		'    <button class="wordfreq-prev" label="上一页" />',
		'    <description class="wordfreq-pageinfo" flex="1" />',
		'    <button class="wordfreq-next" label="下一页" />',
		'  </hbox>',
		'  <checkbox class="wordfreq-hide-custom" label="隐藏自定义单词" native="true" />',
		'  <hbox class="wordfreq-footer">',
		'    <button class="wordfreq-custom-open" label="自定义名单" />',
		'  </hbox>',
		'</vbox>',
	].join('\n');

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

	function setText(body, className, text) {
		var el = body.querySelector('.' + className);
		if (el) {
			el.textContent = text;
		}
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

	function addLine(doc, box, text, options) {
		options = options || {};
		var line = doc.createXULElement('description');
		line.classList.add(options.cls || 'wordfreq-line');
		line.textContent = text;
		if (options.style) {
			line.setAttribute('style', options.style);
		}
		box.appendChild(line);
		return line;
	}

	/** 把读回来的 CSV 拼成一份和跑统计时同样形状的结果 */
	function outcomeFromCsv(parsed, outPath, pdfPath) {
		var meta = parsed.meta || {};
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
		return {
			status: 'written',
			loadedFromCsv: true,
			pdfPath: pdfPath,
			outPath: outPath,
			totalTokens: total,
			uniqueWords: unique,
			note: meta['取文本方式'] || '',
			generated: meta['生成时间'] || '',
			rows: parsed.rows,
		};
	}

	/**
	 * 这篇文献要是已经统计过，磁盘上就有词频表。直接读回来渲染，
	 * 用户不用再点一次「统计词频」。读表比重提一遍 PDF 全文快得多。
	 */
	async function loadExisting(doc, body, item) {
		if (!item) {
			return;
		}
		var att = null;
		try {
			att = WordFreq.source.findTextSource(item).attachment;
		}
		catch (e) {
			return;
		}
		if (!att || lastResults.has(att.id) || csvChecked.has(att.id)) {
			return;
		}
		csvChecked.add(att.id);

		var pdfPath = await WordFreq.source.pathOf(att);
		if (!pdfPath) {
			return;
		}
		var outPath = await WordFreq.output.findCsvAsync(
			pdfPath, WordFreq.prefGet('suffix', '_wordfreq')
		);
		if (!outPath) {
			return;
		}
		var text = await WordFreq.output.readTextAsync(outPath);
		var parsed = WordFreq.wordfreq.parseCsv(text);
		if (!parsed.rows.length) {
			return;
		}

		// 读文件是异步的，用户可能已经切到别的条目了，别把数据盖到别人头上
		var current = currentItem.get(body);
		if (!current || current.id !== item.id) {
			return;
		}

		lastResults.set(att.id, outcomeFromCsv(parsed, outPath, pdfPath));
		lastPath.set(body, outPath);
		resetPage(body);
		render(doc, body);

		var refresh = refreshFns.get(body);
		if (refresh) {
			try {
				refresh();
			}
			catch (e) {
				// 只是更新折叠时的摘要，失败不影响显示
			}
		}
	}

	/** 已经有词频表了，重新统计之前问一句 */
	function confirmUpdate(doc, outPath) {
		var win = null;
		try {
			win = (doc && doc.defaultView) || Zotero.getMainWindow();
		}
		catch (e) {
			win = null;
		}
		var msg = '这篇文献已经有词频表了：\n' + outPath
			+ '\n\n重新统计会覆盖它，词频和词元数都会重新算一遍。要继续吗？';
		try {
			return Services.prompt.confirm(win, '更新词频', msg);
		}
		catch (e) {
			// 弹不出确认框就别拦着用户
			WordFreq.logError('弹确认框失败，直接继续', e);
			return true;
		}
	}

	/** 把样式注入到窗口文档里，一个文档只注一次 */
	function ensureStyle(doc) {
		try {
			if (doc.getElementById(STYLE_ID)) {
				return;
			}
			var style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
			style.id = STYLE_ID;
			style.textContent = PANE_STYLE;
			(doc.documentElement || doc.head).appendChild(style);
		}
		catch (e) {
			WordFreq.logError('注入样式失败', e);
		}
	}

	/* ── 词表里每行左边的小按钮 ───────────────────────── */

	/**
	 * 词作为参数传进来，不用循环里的闭包变量——那样每个按钮都会指向最后一个词。
	 */
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

	function renderWords(doc, body, box, paged) {
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
			countEl.textContent = String(row.count);

			line.appendChild(wordEl);
			line.appendChild(countEl);
			line.appendChild(makeCollectButton(doc, body, row.word));
			box.appendChild(line);
		}
	}

	/**
	 * 行尾的收藏星标。与翻译界面的「收藏」是同一份数据：
	 * 同一个词在两处看到的状态一致，点第二次会先确认再移出。
	 */
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
			var ok = await DeepSeekTranslate.confirm(null, '移出单词本', '把「' + word + '」移出单词本？');
			if (!ok) {
				return;
			}
			await book.removeByWord(word);
		}
		else {
			await book.addWord(word);
		}
	}

	/* ── 自定义名单弹窗 ───────────────────────────────── */

	function ensurePanel(doc) {
		var panel = doc.getElementById(PANEL_ID);
		if (panel) {
			return panel;
		}

		var host = doc.getElementById('ea-wordfreq-popupset');
		if (!host) {
			host = doc.createXULElement('popupset');
			host.id = 'ea-wordfreq-popupset';
			doc.documentElement.appendChild(host);
		}

		panel = doc.createXULElement('panel');
		panel.id = PANEL_ID;
		panel.setAttribute('type', 'arrow');

		var box = doc.createXULElement('vbox');
		box.classList.add('wordfreq-panel');
		box.setAttribute('flex', '1');

		// 标题与按钮分两行：名单标题会很长（「自定义名单（445 个）」），
		// 跟四个按钮挤在一行里会把标题压成竖排
		var head = doc.createXULElement('vbox');
		head.classList.add('wordfreq-panel-head');

		var titleRow = doc.createXULElement('hbox');
		titleRow.setAttribute('align', 'center');
		var title = doc.createXULElement('description');
		title.classList.add('wordfreq-panel-title');
		title.setAttribute('flex', '1');
		title.setAttribute('crop', 'end');

		var clearBtn = doc.createXULElement('button');
		clearBtn.classList.add('wordfreq-panel-clear');
		clearBtn.setAttribute('label', '清空');
		clearBtn.addEventListener('command', async function () {
			var total = WordFreq.userlist.count();
			if (!total) {
				return;
			}
			var ok = await confirmIn(doc,
				'清空自定义名单',
				'把名单里的 ' + total + ' 个词全部清空？清空后它们会重新出现在词表里。');
			if (!ok) {
				return;
			}
			WordFreq.userlist.clear();
			panelPage.set(panel, 0);
			fillPanel(doc, panel);
			refreshOpener(doc, panel);
		});

		// 导入 / 导出：文件格式是 JSON（也接受一行一个词的纯文本）
		var exportBtn = doc.createXULElement('button');
		exportBtn.setAttribute('label', '导出');
		exportBtn.setAttribute('tooltiptext', '把名单导出成 JSON 文件');
		exportBtn.addEventListener('command', function () {
			exportList(doc).catch(function (e) { alertIn(doc, '导出自定义名单', '导出失败：' + ((e && e.message) || e)); });
		});

		var importBtn = doc.createXULElement('button');
		importBtn.setAttribute('label', '导入');
		importBtn.setAttribute('tooltiptext', '从 JSON 或纯文本导入名单，按词去重合并');
		importBtn.addEventListener('command', function () {
			importList(doc, panel).catch(function (e) { alertIn(doc, '导入自定义名单', '导入失败：' + ((e && e.message) || e)); });
		});

		var closeBtn = doc.createXULElement('button');
		closeBtn.classList.add('wordfreq-panel-x');
		closeBtn.setAttribute('label', '✕');
		closeBtn.setAttribute('tooltiptext', '关闭');
		closeBtn.addEventListener('command', function () {
			panel.hidePopup();
		});

		titleRow.appendChild(title);
		titleRow.appendChild(closeBtn);
		head.appendChild(titleRow);

		var btnRow = doc.createXULElement('hbox');
		btnRow.classList.add('wordfreq-panel-btns');
		btnRow.setAttribute('align', 'center');
		[importBtn, exportBtn, clearBtn].forEach(function (btn) {
			btn.classList.add('wordfreq-panel-btn');
			btnRow.appendChild(btn);
		});
		head.appendChild(btnRow);

		var list = doc.createXULElement('vbox');
		list.classList.add('wordfreq-panel-list');
		list.setAttribute('flex', '1');

		var pager = doc.createXULElement('hbox');
		pager.classList.add('wordfreq-panel-pager');
		pager.setAttribute('align', 'center');
		var prev = doc.createXULElement('button');
		prev.classList.add('wordfreq-panel-prev');
		prev.setAttribute('label', '上一页');
		prev.addEventListener('command', function () {
			panelPage.set(panel, Math.max(0, (panelPage.get(panel) || 0) - 1));
			fillPanel(doc, panel);
		});
		var info = doc.createXULElement('description');
		info.classList.add('wordfreq-panel-pageinfo');
		info.setAttribute('flex', '1');
		var next = doc.createXULElement('button');
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

	/** 弹确认框；翻译子系统可用就借它的 confirm，否则退回窗口自带的那套 */
	async function confirmIn(doc, title, text) {
		var win = doc && doc.defaultView;
		try {
			if (typeof DeepSeekTranslate !== 'undefined' && DeepSeekTranslate.confirm) {
				return await DeepSeekTranslate.confirm(win, title, text);
			}
		}
		catch (e) {
			WordFreq.logError('确认框失败', e);
		}
		try {
			return !!(win && win.confirm(text));
		}
		catch (e) {
			return false;
		}
	}

	/**
	 * 选一个文件。save = true 走保存对话框。
	 *
	 * Zotero 10 把 FilePicker 放在 `chrome://zotero/content/modules/filePicker.mjs` 里，
	 * 没有挂在 `Zotero` 对象上；`show()` 也是异步的。
	 * （之前写成 `new Zotero.FilePicker()` + 同步 show，构造函数直接抛异常、
	 * 抛进 catch 只写了日志，界面上就表现为「点了没反应」。）
	 */
	async function pickFile(save, title, defaultName) {
		var mod = null;
		try {
			mod = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
		}
		catch (e) {
			mod = null;
		}
		var FilePicker = mod && mod.FilePicker;
		if (!FilePicker) {
			throw new Error('这个 Zotero 没有 FilePicker 模块');
		}
		var fp = new FilePicker();
		fp.init(Zotero.getMainWindow(), title, save ? fp.modeSave : fp.modeOpen);
		fp.appendFilters(fp.filterAll);
		if (save && defaultName) {
			fp.defaultString = defaultName;
		}
		var rv = await fp.show();
		var ok = (rv === fp.returnOK) || (rv === fp.returnReplace);
		if (!ok) {
			return null;
		}
		// Zotero 的 FilePicker 把 file 改成「路径字符串」了（不是 nsIFile），
		// 所以这里别再取 .path；两种形态都兼容一下
		var chosen = fp.file;
		if (!chosen) {
			return null;
		}
		return (typeof chosen === 'string') ? chosen : (chosen.path || null);
	}

	function alertIn(doc, title, text) {
		var win = doc && doc.defaultView;
		try {
			WordFreq.alert(win, title, text);
		}
		catch (e) {
			WordFreq.logError(title, e);
		}
	}

	async function exportList(doc) {
		var words = WordFreq.userlist.all();
		if (!words.length) {
			alertIn(doc, '导出自定义名单', '名单是空的，没有可导出的内容。');
			return;
		}
		var file = await pickFile(true, '导出自定义名单', 'wordfreq-custom-list.json');
		if (!file) {
			return;
		}
		var text = JSON.stringify({ version: 1, words: words }, null, 2);
		await Zotero.File.putContentsAsync(file, text);
		alertIn(doc, '导出自定义名单', '已导出 ' + words.length + ' 个词：\n' + file);
	}

	async function importList(doc, panel) {
		var file = await pickFile(false, '导入自定义名单');
		if (!file) {
			return;
		}
		var text = await Zotero.File.getContentsAsync(file);
		var words = WordFreq.userlist.parse(text);
		if (!words.length) {
			alertIn(doc, '导入自定义名单', '这个文件里没找到可用的词。');
			return;
		}
		words.forEach(function (word) {
			WordFreq.userlist.add(word);
		});
		panelPage.set(panel, 0);
		fillPanel(doc, panel);
		refreshOpener(doc, panel);
		alertIn(doc, '导入自定义名单',
			'从文件里读到 ' + words.length + ' 个词，名单现在共 ' + WordFreq.userlist.count() + ' 个。');
	}

	function makePanelRow(doc, panel, word) {
		var line = doc.createXULElement('hbox');
		line.classList.add('wordfreq-panel-row');
		line.setAttribute('align', 'center');

		var label = doc.createXULElement('description');
		label.setAttribute('flex', '1');
		label.setAttribute('crop', 'end');
		label.textContent = word;

		var removeBtn = doc.createXULElement('button');
		removeBtn.classList.add('wordfreq-panel-x');
		removeBtn.setAttribute('label', '✕');
		removeBtn.setAttribute('tooltiptext', '从名单里移除');
		removeBtn.addEventListener('command', function () {
			WordFreq.userlist.remove(word);
			fillPanel(doc, panel);
			refreshOpener(doc, panel);
		});

		// 移除按钮放左边（用户要求），词在右
		line.appendChild(removeBtn);
		line.appendChild(label);
		return line;
	}

	/** 名单改动之后，把打开它的那块窗格也刷新一下 */
	function refreshOpener(doc, panel) {
		var body = panelBody.get(panel);
		if (body) {
			render(doc, body);
		}
	}

	function fillPanel(doc, panel) {
		var words = WordFreq.userlist.all();
		// 名单弹窗比词表每页少显示六个（用户两次要求递减），行高够，不会挤
		var pageSize = Math.max(1, uiOpts().pageSize - 6);

		var title = panel.querySelector('.wordfreq-panel-title');
		if (title) {
			title.textContent = '自定义名单（' + words.length + ' 个）';
		}

		var list = panel.querySelector('.wordfreq-panel-list');
		var paged = WordFreq.wordfreq.page(words, pageSize, panelPage.get(panel) || 0);
		panelPage.set(panel, paged.pageIndex);

		if (list) {
			clear(list);
			if (!words.length) {
				addLine(doc, list, '名单是空的。在词表里点每行左边的 − 把词加进来。',
					{ cls: 'wordfreq-line', style: 'white-space:normal;line-height:1.5;opacity:.75' });
			}
			else {
				for (var i = 0; i < paged.rows.length; i++) {
					list.appendChild(makePanelRow(doc, panel, paged.rows[i]));
				}
			}
		}

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

	function openPanel(doc, body, anchor) {
		var panel;
		try {
			panel = ensurePanel(doc);
		}
		catch (e) {
			WordFreq.logError('创建自定义名单弹窗失败', e);
			return;
		}
		panelBody.set(panel, body);
		panelPage.set(panel, 0);
		fillPanel(doc, panel);
		try {
			panel.openPopup(anchor, 'after_end', 0, 6, false, false);
		}
		catch (e) {
			WordFreq.logError('打开自定义名单弹窗失败', e);
		}
	}

	/* ── 主渲染 ───────────────────────────────────────── */

	function render(doc, body) {
		var item = currentItem.get(body);
		var runBtn = body.querySelector('.wordfreq-run');
		var openBtn = body.querySelector('.wordfreq-open');
		var pager = body.querySelector('.wordfreq-pager');
		var prevBtn = body.querySelector('.wordfreq-prev');
		var nextBtn = body.querySelector('.wordfreq-next');
		var resultBox = body.querySelector('.wordfreq-result');
		var hideCustom = body.querySelector('.wordfreq-hide-custom');
		var customOpen = body.querySelector('.wordfreq-custom-open');
		if (resultBox) {
			clear(resultBox);
		}

		var customCount = WordFreq.userlist.count();
		if (customOpen) {
			customOpen.setAttribute('label', '自定义名单（' + customCount + ' 个）');
		}
		var opts = uiOpts();
		if (hideCustom) {
			hideCustom.checked = opts.hideCustom;
			hideCustom.disabled = customCount === 0;
		}

		var target = { attachment: null, reason: '没有选中条目。' };
		try {
			if (item) {
				target = WordFreq.source.findTextSource(item);
			}
		}
		catch (e) {
			target = { attachment: null, reason: '读取条目失败：' + ((e && e.message) || e) };
		}

		var isRunning = running.has(body);

		if (!target.attachment) {
			if (runBtn) {
				runBtn.disabled = true;
			}
			show(openBtn, false);
			show(pager, false);
			setText(body, 'wordfreq-status', target.reason || '这个条目没有可用于统计的 PDF 或 EPUB。');
			return;
		}

		var att = target.attachment;
		var outcome = lastResults.get(att.id);
		var hasResult = !!(outcome && outcome.status === 'written');

		if (runBtn) {
			runBtn.disabled = isRunning;
			runBtn.setAttribute('label', isRunning
				? (hasResult ? '更新中…' : '统计中…')
				: (hasResult ? '更新词频' : '统计词频（英文）'));
		}

		if (isRunning) {
			show(openBtn, false);
			show(pager, false);
			setText(body, 'wordfreq-status', '正在统计，文献越长越慢，请稍等…');
			return;
		}

		if (!outcome) {
			show(openBtn, false);
			show(pager, false);
			setText(body, 'wordfreq-status',
				'点上面的按钮统计这篇文献的整本词频，CSV 会写在文献同目录。');
			return;
		}

		if (outcome.status !== 'written') {
			var isReject = outcome.status === 'rejected';
			show(openBtn, false);
			show(pager, false);
			setText(body, 'wordfreq-status', isReject ? '已拒绝统计。' : '统计失败。');
			if (resultBox) {
				addLine(doc, resultBox, outcome.reason || '（没有更多信息）', {
					cls: 'wordfreq-line',
					style: 'white-space:normal;line-height:1.6' + (isReject ? '' : ';color:#c62828'),
				});
				if (isReject && outcome.code) {
					addLine(doc, resultBox, '判定类型：' + outcome.code,
						{ cls: 'wordfreq-line', style: 'opacity:.7' });
				}
			}
			return;
		}

		// ── 统计成功 ──
		// 窗格里只留词表本身，不写状态文字、不列统计行，也不显示 CSV 路径
		// （要知道文件在哪，点「打开 CSV」）。
		setText(body, 'wordfreq-status', '');
		show(openBtn, !!lastPath.get(body));

		var allRows = outcome.rows || [];
		var filtered = WordFreq.wordfreq.filterForDisplay(allRows, {
			hideCustom: opts.hideCustom,
			customWords: WordFreq.userlist.set(),
		});
		var paged = WordFreq.wordfreq.page(filtered.rows, opts.pageSize, getPage(body));
		pageIndex.set(body, paged.pageIndex);

		if (!resultBox) {
			return;
		}

		// 结果区里只放词表本身。统计数字、取文本方式、合并明细都不显示，
		// 需要那些信息看 CSV。
		if (!filtered.rows.length) {
			addLine(doc, resultBox,
				'当前筛选把 ' + allRows.length + ' 个词元全滤掉了。'
				+ '把下面的「隐藏自定义单词」关掉，或者去名单弹窗里清一清。',
				{ cls: 'wordfreq-line', style: 'white-space:normal;line-height:1.6' });
		}
		else {
			renderWords(doc, body, resultBox, paged);
		}

		show(pager, filtered.rows.length > 0);
		setText(body, 'wordfreq-pageinfo',
			'第 ' + (paged.pageIndex + 1) + ' / ' + paged.totalPages + ' 页');
		if (prevBtn) {
			prevBtn.disabled = paged.pageIndex <= 0;
		}
		if (nextBtn) {
			nextBtn.disabled = paged.pageIndex >= paged.totalPages - 1;
		}
	}

	async function runForBody(doc, body) {
		var item = currentItem.get(body);
		var target = null;
		try {
			target = item ? WordFreq.source.findTextSource(item) : null;
		}
		catch (e) {
			WordFreq.logError('取 PDF 失败', e);
		}
		if (!target || !target.attachment) {
			render(doc, body);
			return;
		}

		running.add(body);
		render(doc, body);

		try {
			var outcome = await WordFreq.runOne(target.attachment, null);
			lastResults.set(target.attachment.id, outcome);
			if (outcome.status === 'written') {
				lastPath.set(body, outcome.outPath);
			}
		}
		catch (e) {
			WordFreq.logError('统计词频失败', e);
			lastResults.set(target.attachment.id, {
				status: 'failed',
				reason: (e && e.message) || String(e),
			});
		}

		running.delete(body);
		resetPage(body);
		render(doc, body);

		var refresh = refreshFns.get(body);
		if (refresh) {
			try {
				refresh();
			}
			catch (e) {
				// 刷新只影响折叠时的摘要，失败不影响结果
			}
		}
	}

	function openForBody(body) {
		var path = lastPath.get(body);
		if (path) {
			WordFreq.output.revealAsync(path);
		}
	}

	return {
		PANE_ID: PANE_ID,

		/** 刷新所有开着的词频区块（单词本改动后调用，星标才跟着变） */
		refreshAll: function () {
			liveBodies.forEach(function (body) {
				var fn = refreshFns.get(body);
				if (!fn) {
					return;
				}
				try {
					fn();
				}
				catch (e) {
					WordFreq.logError('刷新词频区块失败', e);
				}
			});
		},

		/** 让别的区块的 body 也进 refreshAll() 的刷新名单（分部词频靠它同步星标） */
		trackBody: function (body, refresh) {
			if (!body) {
				return;
			}
			liveBodies.add(body);
			if (refresh) {
				refreshFns.set(body, refresh);
			}
		},

		untrackBody: function (body) {
			if (body) {
				liveBodies.delete(body);
				refreshFns.delete(body);
			}
		},

		/** 供其它区块调用：打开自定义名单弹窗（不绑定某个词表的刷新） */
		openCustomPanel: function (doc, anchor) {
			openPanel(doc, null, anchor);
		},

		register: function () {
			// 已经注册过就直接返回，避免设置里来回勾选时重复注册
			if (this.paneID) {
				return this.paneID;
			}
			if (!Zotero.ItemPaneManager
				|| typeof Zotero.ItemPaneManager.registerSection !== 'function') {
				WordFreq.log('这个 Zotero 没有 ItemPaneManager，条目窗格区块没注册');
				return false;
			}

			var paneID = Zotero.ItemPaneManager.registerSection({
				paneID: PANE_ID,
				pluginID: WordFreq.pluginID,
				header: {
					l10nID: 'ea-wordfreq-pane-header',
					icon: WordFreq.rootURI + 'chrome/content/icons/wordfreq-16.svg',
				},
				sidenav: {
					l10nID: 'ea-wordfreq-pane-sidenav',
					icon: WordFreq.rootURI + 'chrome/content/icons/wordfreq-20.svg',
					// 和翻译区块一样固定位置：顺序由注册顺序决定，不让拖拽改
					orderable: false,
				},
				bodyXHTML: BODY_XHTML,

				onInit: function ({ doc, body, refresh }) {
					refreshFns.set(body, refresh);
				liveBodies.add(body);
					ensureStyle(doc);

					function on(selector, handler) {
						var el = body.querySelector(selector);
						if (el) {
							el.addEventListener('command', handler);
						}
					}

					on('.wordfreq-run', function () {
						// 已经有词频表时，按钮是「更新词频」，点之前先确认一下
						var existing = null;
						try {
							var current = currentItem.get(body);
							var att = current
								? WordFreq.source.findTextSource(current).attachment
								: null;
							existing = att ? lastResults.get(att.id) : null;
						}
						catch (e) {
							existing = null;
						}
						if (existing && existing.status === 'written'
							&& !confirmUpdate(doc, existing.outPath)) {
							return;
						}
						runForBody(doc, body);
					});
					on('.wordfreq-open', function () {
						openForBody(body);
					});

					var hideCustom = body.querySelector('.wordfreq-hide-custom');
					if (hideCustom) {
						hideCustom.addEventListener('command', function () {
							WordFreq.prefSet('paneHideCustom', !!hideCustom.checked);
							resetPage(body);
							render(doc, body);
						});
					}

					on('.wordfreq-prev', function () {
						pageIndex.set(body, Math.max(0, getPage(body) - 1));
						render(doc, body);
					});
					on('.wordfreq-next', function () {
						pageIndex.set(body, getPage(body) + 1);
						render(doc, body);
					});

					var customOpen = body.querySelector('.wordfreq-custom-open');
					if (customOpen) {
						customOpen.addEventListener('command', function () {
							openPanel(doc, body, customOpen);
						});
					}
				},

				onDestroy: function ({ body }) {
					refreshFns.delete(body);
				},

				onItemChange: function ({ item, setEnabled, setSectionSummary }) {
					try {
						// 区块一直显示。没有 PDF 时在正文里说明原因，
						// 比整块消失更容易让人看懂发生了什么。
						setEnabled(true);
						var target = item
							? WordFreq.source.findTextSource(item)
							: { attachment: null, reason: '' };
						if (!target.attachment) {
							setSectionSummary('无 PDF/EPUB');
						}
						else {
							setSectionSummary(lastResults.has(target.attachment.id) ? '已统计' : '可统计');
						}
					}
					catch (e) {
						WordFreq.logError('条目窗格判断状态失败', e);
					}
				},

				onRender: function ({ doc, body, item }) {
					// 区块标题、侧栏提示这些文案靠插件自己的 ftl，链接必须挂进这个文档。
					// 放在渲染路径里而不是窗口加载钩子上：这个函数一定会被调用。
					if (typeof EnglishAssistant !== 'undefined') {
						EnglishAssistant.injectLocalization(doc);
						EnglishAssistant.applySectionLabels(doc).catch(function () {});
					}

					var previous = currentItem.get(body);
					// 换条目时页码回到第一页
					if (!previous || previous.id !== (item && item.id)) {
						resetPage(body);
					}
					currentItem.set(body, item);
					render(doc, body);
				},

				// 同步的 onRender 不能读文件。这里去磁盘上看这篇文献有没有
				// 现成的词频表，有就直接读回来显示，用户不用再点一次按钮。
				onAsyncRender: async function ({ doc, body, item }) {
					// 先把单词本读进内存，行尾的星标才能一次画对
					try {
						if (typeof DeepSeekTranslate !== 'undefined' && DeepSeekTranslate.wordbook) {
							await DeepSeekTranslate.wordbook.load();
						}
					}
					catch (e) {
						WordFreq.logError('读入单词本失败', e);
					}
					render(doc, body);
					try {
						await loadExisting(doc, body, item);
					}
					catch (e) {
						WordFreq.logError('读取已有词频表失败', e);
					}
				},
			});

			this.paneID = paneID;
			WordFreq.log('条目窗格区块已注册：' + paneID);
			return !!paneID;
		},

		unregister: function () {
			try {
				if (this.paneID && Zotero.ItemPaneManager) {
					Zotero.ItemPaneManager.unregisterSection(this.paneID);
				}
			}
			catch (e) {
				WordFreq.logError('注销条目窗格区块失败', e);
			}
			// 必须清掉：留着旧键的话，设置里再打开开关时会被当成「已经注册过」，
			// 区块就再也回不来
			this.paneID = null;
			// 统计结果特意不清：关掉区块只是不显示，再打开时应该接着看之前那份表
		},

		/** 供调试与冒烟：当前缓存了几篇文献的结果 */
		cachedCount: function () {
			return lastResults.size;
		},

		/** 供调试：清掉缓存的结果，让区块回到初始状态 */
		reset: function () {
			lastResults.clear();
		},
	};
})();
