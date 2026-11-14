/* 插件的启动、菜单与执行流程。bootstrap.js 只负责加载脚本，挂载都在这里。 */

var WordFreq = WordFreq || {};

WordFreq.PREF_BRANCH = 'extensions.englishAssistant.wordfreq.';

/* ── 读设置。任何一项读不到就用代码里的默认值，保证离线沙箱里也能跑。 ── */
WordFreq.prefGet = function (key, fallback) {
	try {
		var v = Zotero.Prefs.get(this.PREF_BRANCH + key, true);
		return v === undefined || v === null ? fallback : v;
	}
	catch (e) {
		return fallback;
	}
};

WordFreq.prefSet = function (key, value) {
	try {
		Zotero.Prefs.set(this.PREF_BRANCH + key, value, true);
		return true;
	}
	catch (e) {
		this.logError('写入设置失败：' + key, e);
		return false;
	}
};

WordFreq.tokenOpts = function () {
	return {
		mergeCase: this.prefGet('mergeCase', true) !== false,
		splitHyphen: this.prefGet('splitHyphen', true) !== false,
		joinLineBreakHyphen: this.prefGet('joinLineBreakHyphen', true) !== false,
		minLength: this.minLengthFromPref(),
		includeStopwords: this.prefGet('includeStopwords', true) !== false,
		skipSingles: this.prefGet('skipSingles', true) !== false,
		topN: Number(this.prefGet('topN', 0)) || 0,
		lemmatize: this.prefGet('lemmatize', true) !== false,
		mergePossessive: this.prefGet('mergePossessive', true) !== false,
	};
};

/**
 * 设置里写的是「长度小于等于 N 的单词不计入」，分词器要的是「至少几个字母才收」，
 * 两者差一。传 value 时按传进来的算，不传就读首选项。
 */
WordFreq.minLengthFromPref = function (value) {
	var n = value === undefined ? Number(this.prefGet('minWordLength', 1)) : Number(value);
	if (!isFinite(n) || n < 0) {
		n = 0;
	}
	return Math.round(n) + 1;
};

/**
 * 早期版本的 minWordLength 是「短于 N 不计入」（默认 2），现在改成「≤ N 不计入」
 * （默认 1），同一个过滤效果在两种口径下差一。已经装过的用户按标记迁移一次，
 * 免得升级后突然多排除一批两字母的词。
 */
WordFreq.migrateMinWordLength = function () {
	if (this.prefGet('minWordLengthV2', false) === true) {
		return false;
	}
	var old = Number(this.prefGet('minWordLength', 1));
	if (!isFinite(old) || old < 0) {
		old = 1;
	}
	this.prefSet('minWordLength', Math.max(0, Math.round(old) - 1));
	this.prefSet('minWordLengthV2', true);
	return true;
};

WordFreq.langOpts = function () {
	return {
		minTokens: Number(this.prefGet('langMinTokens', 300)) || 300,
		minEnglishPercent: Number(this.prefGet('langMinEnglish', 20)) || 20,
		marginPercent: Number(this.prefGet('langMargin', 130)) || 130,
		maxNonLatinPercent: Number(this.prefGet('langMaxNonLatin', 2)),
	};
};

WordFreq.textOpts = function () {
	return {
		textSource: this.prefGet('textSource', 'auto'),
	};
};

WordFreq.log = function (msg) {
	Zotero.debug('[英文助手·词频] ' + msg);
};

WordFreq.logError = function (msg, e) {
	Zotero.logError(new Error('[英文助手·词频] ' + msg + '：' + ((e && e.message) || e)));
};

/* ── 启动与收尾 ─────────────────────────────────────── */

WordFreq.startup = async function ({ id, version, rootURI }) {
	this.pluginID = id;
	this.pluginVersion = version;
	this.rootURI = rootURI;

	this.log('启动 v' + version + '（' + id + '）');

	// 对外只暴露一个入口：Zotero.EnglishAssistant（见 scripts/main.js）

	// 第一次使用时把默认自定义名单填进去（只看 userListSeeded 标记）
	try {
		if (this.migrateMinWordLength()) {
			this.log('最短词长的口径从「短于 N」换成「≤ N」，已把旧值减一');
		}
	}
	catch (e) {
		this.logError('迁移最短词长失败', e);
	}

	try {
		WordFreq.userlist.init();
	}
	catch (e) {
		this.logError('填入默认自定义名单失败', e);
	}

	// 右侧条目窗格里的区块。这是插件的主入口。
	// 设置里能单独关掉某一个，关掉就不注册，右侧栏的图标一起消失。
	try {
		if (EnglishAssistant.sectionOn('sections.wordfreq')) {
			this.pane.register();
		}
		if (EnglishAssistant.sectionOn('sections.wordfreqParts')) {
			this.partsPane.register();
		}
	}
	catch (e) {
		this.logError('注册条目窗格区块失败', e);
	}

	// 不注册任何菜单。工具菜单那条已经按用户要求去掉；
	// 文库右键菜单（MenuManager 的 main/library/item）更早就撤了：
	// 挂在那里的那版会让右键菜单本身弹不出来。
};

WordFreq.shutdown = function () {
	this.log('关闭');

	try {
		this.pane.unregister();
		this.partsPane.unregister();
	}
	catch (e) {
		this.logError('注销条目窗格区块失败', e);
	}
};

/* bootstrap.js 会调这两个钩子，留成空实现，免得报 not a function。
 * 菜单和窗格都由 Zotero 的接口自己管窗口生命周期，这里不需要做事。 */
WordFreq.onMainWindowLoad = function (window) {};
WordFreq.onMainWindowUnload = function (window) {};

WordFreq.hasPdfInItems = function (items) {
	if (!items || !items.length) {
		return false;
	}
	for (var i = 0; i < items.length; i++) {
		try {
			if (this.source.findPdf(items[i]).attachment) {
				return true;
			}
		}
		catch (e) {
			// 单个条目读失败不影响其它条目
		}
	}
	return false;
};

/** 从当前活动的 Zotero 窗口取选中条目并跑。工具菜单走这里。 */
WordFreq.runFromActivePane = async function () {
	var items = [];
	var window = null;
	try {
		window = Zotero.getMainWindow ? Zotero.getMainWindow() : null;
		var pane = (window && window.ZoteroPane) || Zotero.getActiveZoteroPane();
		items = pane ? pane.getSelectedItems() : [];
	}
	catch (e) {
		this.logError('取选中条目失败', e);
	}
	await this.run(items, window);
};

/* ── 执行流程 ───────────────────────────────────────── */

/**
 * 对一批条目跑词频统计。菜单走这里，「运行 JavaScript」里也可以直接调：
 *   Zotero.EnglishAssistant.wordfreq.run(Zotero.getActiveZoteroPane().getSelectedItems())
 */
WordFreq.run = async function (items, window) {
	items = items || [];
	var targets = [];
	var skipped = [];

	for (var i = 0; i < items.length; i++) {
		var found = this.source.findPdf(items[i]);
		if (found.attachment) {
			targets.push(found.attachment);
		}
		else {
			skipped.push({ title: this.titleOf(items[i]), reason: found.reason });
		}
	}

	if (!targets.length) {
		var only = skipped.length
			? skipped.map(function (s) { return s.title + '：' + s.reason; }).join('\n')
			: '没有选中任何条目。';
		this.alert(window, '统计词频', only);
		return { written: [], rejected: [], failed: skipped };
	}

	var pw = null;
	var lines = [];
	try {
		pw = new Zotero.ProgressWindow({ closeOnClick: true });
		pw.changeHeadline('统计词频');
		for (var t = 0; t < targets.length; t++) {
			// 第一个参数是图标键，不是图片路径。给错只会让那一行没有小图标，
			// 不影响进度和文字。
			lines.push(new pw.ItemProgress('attachment', this.titleOf(targets[t])));
		}
		pw.show();
	}
	catch (e) {
		this.logError('进度窗口创建失败，改为静默执行', e);
		pw = null;
	}

	var written = [];
	var rejected = [];
	var failed = skipped.slice();

	for (var k = 0; k < targets.length; k++) {
		var attachment = targets[k];
		var title = this.titleOf(attachment);
		var line = lines[k] || null;
		try {
			var outcome = await this.runOne(attachment, line);
			if (outcome.status === 'written') {
				written.push(outcome);
			}
			else {
				rejected.push(outcome);
			}
		}
		catch (e) {
			this.logError('统计「' + title + '」失败', e);
			if (line) {
				line.setError();
				line.setText(title + '：失败');
			}
			failed.push({ title: title, reason: (e && e.message) || String(e) });
		}
	}

	if (pw) {
		try {
			pw.startCloseTimer(12000);
		}
		catch (e) {
			// 关不掉就算了
		}
	}

	this.reportSummary(window, written, rejected, failed);
	return { written: written, rejected: rejected, failed: failed };
};

/** 单个附件的完整流程 */
WordFreq.runOne = async function (attachment, line) {
	var title = this.titleOf(attachment);
	var textOpts = this.textOpts();

	if (line) {
		line.setProgress(5);
		line.setText(title + '：读取正文…');
	}

	var pdfPath = await this.source.pathOf(attachment);
	if (!pdfPath) {
		throw new Error('拿不到这个附件的文件路径。');
	}

	var got = await this.source.getText(attachment, textOpts);

	if (line) {
		line.setProgress(40);
		line.setText(title + '：判定语言…');
	}

	var langResult = null;
	var thresholds = this.langOpts();
	if (this.prefGet('langCheck', true) !== false) {
		langResult = this.langdetect.detect(got.text, thresholds);
		this.log(this.langdetect.summarize(langResult) + ' ← ' + title);
		if (this.prefGet('debug', false)) {
			this.log('判定报告：' + JSON.stringify({
				tokens: langResult.report.tokens,
				scriptCounts: langResult.report.scriptCounts,
				shares: langResult.report.shares,
				diacriticShare: langResult.report.diacriticShare,
			}));
		}
		if (!langResult.isEnglish) {
			if (line) {
				line.setError();
				line.setText(title + '：非英文，已跳过');
			}
			return {
				status: 'rejected',
				title: title,
				pdfPath: pdfPath,
				reason: langResult.reason,
				code: langResult.code,
			};
		}
	}

	if (line) {
		line.setProgress(65);
		line.setText(title + '：统计词频…');
	}

	var stats = this.wordfreq.run(got.text, this.tokenOpts());

	if (line) {
		line.setProgress(85);
		line.setText(title + '：写出 CSV…');
	}

	var outPath = this.output.csvPathFor(pdfPath, { suffix: this.prefGet('suffix', '_wordfreq') });
	outPath = await this.output.resolveCollision(outPath, this.prefGet('overwrite', true) !== false);

	var filterNotes = [];
	if (this.prefGet('includeStopwords', true) === false) {
		filterNotes.push('已过滤英语停用词');
	}
	if (this.prefGet('skipSingles', true) !== false) {
		filterNotes.push('已忽略只出现一次的词');
	}

	var csv = this.wordfreq.buildCsv(stats.rows, {
		source: this.output.baseNameOf(pdfPath),
		generated: this.timestamp(),
		total_words: stats.totalTokens,
		listed_words: stats.listedTokens,
		unique_words: stats.uniqueWords,
		lemma: stats.lemmatized
			? '已开启，' + stats.mergedForms + ' 个词条由多个词形合并而来'
			: '已关闭，按原样统计',
		language: langResult ? langResult.reason : '未做语言判定',
		text_source: got.note,
		pages: got.totalPages ? (got.pages + ' / ' + got.totalPages) : '',
		note: filterNotes.join('；'),
	}, { bom: this.prefGet('bom', true) !== false });

	await this.output.writeTextAsync(outPath, csv);

	if (line) {
		line.setProgress(100);
		line.setText(this.output.stemOf(pdfPath) + '：' + stats.totalTokens + ' 词次 / '
			+ stats.uniqueWords + ' 个词');
	}

	if (this.prefGet('revealAfterWrite', true) !== false) {
		await this.output.revealAsync(outPath);
	}

	return {
		status: 'written',
		title: title,
		pdfPath: pdfPath,
		outPath: outPath,
		totalTokens: stats.totalTokens,
		uniqueWords: stats.uniqueWords,
		top: this.wordfreq.topWords(stats.rows, 10),
		note: got.note,
		mergedForms: stats.mergedForms,
		// 条目窗格要拿全部行做筛选和分页，所以整份带回去。
		// 一本 600 KB 的书约 8000 行，留着不占多少内存。
		rows: stats.rows,
	};
};

/** 跑完之后把结果告诉用户。全部成功就不弹窗，只留进度窗口。 */
WordFreq.reportSummary = function (window, written, rejected, failed) {
	var lines = [];

	for (var i = 0; i < written.length; i++) {
		lines.push('已写出：' + written[i].outPath
			+ '\n　' + written[i].totalTokens + ' 词次，去重 ' + written[i].uniqueWords + ' 个'
			+ (written[i].note ? '（' + written[i].note + '）' : '')
			+ '\n　高频词：' + written[i].top);
	}
	for (var r = 0; r < rejected.length; r++) {
		lines.push('已拒绝：' + rejected[r].title + '\n　' + rejected[r].reason);
	}
	for (var f = 0; f < failed.length; f++) {
		lines.push('未处理：' + failed[f].title + '\n　' + failed[f].reason);
	}

	if (!rejected.length && !failed.length) {
		return;
	}
	WordFreq.alert(window, '统计词频', lines.join('\n\n'));
};

WordFreq.alert = function (window, title, message) {
	// Zotero.alert 直接把 window 转给 Services.prompt.alert，传 null 时
	// 在部分平台不会弹窗，所以这里补一个主窗口。
	var parent = window || null;
	if (!parent) {
		try {
			parent = Zotero.getMainWindow ? Zotero.getMainWindow() : null;
		}
		catch (e) {
			parent = null;
		}
	}
	Zotero.alert(parent, title, message);
};

WordFreq.titleOf = function (item) {
	try {
		if (!item) {
			return '（未知条目）';
		}
		if (item.isAttachment && item.isAttachment()) {
			var parent = item.parentItem;
			var parentTitle = parent ? parent.getField('title') : '';
			var attTitle = item.getField('title') || '';
			return attTitle || parentTitle || 'PDF 附件';
		}
		return item.getField('title') || '（无标题）';
	}
	catch (e) {
		return '（无标题）';
	}
};

WordFreq.timestamp = function () {
	var d = new Date();
	function pad(n) {
		return (n < 10 ? '0' : '') + n;
	}
	return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
		+ ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
};

/* ── 自检 ───────────────────────────────────────────── */

/**
 * 界面自检：报告条目窗格区块与菜单的注册情况，以及当前选中项能不能统计。
 * 在「工具 → 开发者 → 运行 JavaScript」里执行：
 *   Zotero.EnglishAssistant.wordfreq.debugUI()
 */
WordFreq.debugUI = function () {
	var lines = [];
	lines.push('插件版本：' + this.pluginVersion);
	lines.push('ItemPaneManager 可用：' + typeof (Zotero.ItemPaneManager || {}).registerSection);
	lines.push('窗格区块 paneID：' + (this.pane.paneID || '没注册上'));

	var windows = [];
	try {
		windows = Zotero.getMainWindows() || [];
	}
	catch (e) {
		lines.push('取主窗口失败：' + e);
	}
	lines.push('主窗口数：' + windows.length);

	for (var i = 0; i < windows.length; i++) {
		try {
			var doc = windows[i].document;
			// 区块元素上带 data-pane="<paneID>"，Zotero 自己加的
			var section = doc.querySelector('[data-pane="ea-wordfreq-pane"]');
			var sidenav = doc.querySelector('[data-pane="ea-wordfreq-pane"][data-type="sidenav"]');
			var toolsPopup = doc.getElementById('menu_ToolsPopup');
			lines.push('窗口 ' + (i + 1)
				+ '：窗格区块 ' + (section ? '在' : '没找到')
				+ (sidenav ? '（侧栏按钮也在）' : '')
				+ '，工具菜单 ' + (toolsPopup ? '在' : '没有'));
		}
		catch (e) {
			lines.push('窗口 ' + (i + 1) + '：检查失败（' + e + '）');
		}
	}

	try {
		var pane = Zotero.getActiveZoteroPane();
		var items = pane ? pane.getSelectedItems() : [];
		lines.push('当前选中 ' + items.length + ' 个条目');
		for (var k = 0; k < items.length; k++) {
			var found = this.source.findPdf(items[k]);
			lines.push('　' + this.titleOf(items[k]) + ' → '
				+ (found.attachment ? '找到 PDF' : '没有 PDF：' + found.reason));
		}
	}
	catch (e) {
		lines.push('取选中项失败：' + e);
	}

	var text = lines.join('\n');
	Zotero.debug('[英文助手·词频] 界面自检\n' + text);
	WordFreq.alert(null, '英文助手 · 词频 界面自检', text);
	return text;
};

// 旧名字，留个别名免得记混
WordFreq.debugMenus = WordFreq.debugUI;

/**
 * 在「工具 → 开发者 → 运行 JavaScript」里执行下面这一行，会打印一份环境自检：
 *   Zotero.EnglishAssistant.wordfreq.diagnose()
 * 用来确认这个 Zotero 版本里各个接口是否可用。
 */
WordFreq.diagnose = function () {
	var report = {};
	function probe(name, fn) {
		try {
			var v = fn();
			report[name] = v === undefined ? '可用' : v;
		}
		catch (e) {
			report[name] = '不可用：' + ((e && e.message) || e);
		}
	}

	probe('插件版本', function () { return Zotero.EnglishAssistant.wordfreq.pluginVersion; });
	probe('Zotero 版本', function () { return Zotero.version; });
	probe('Fulltext.getItemCacheFile', function () { return typeof Zotero.Fulltext.getItemCacheFile; });
	probe('Fulltext.getPages', function () { return typeof Zotero.Fulltext.getPages; });
	probe('PDFWorker.getFullText', function () { return typeof Zotero.PDFWorker.getFullText; });
	probe('PreferencePanes.register', function () { return typeof Zotero.PreferencePanes.register; });
	probe('ItemPaneManager.registerSection', function () {
		return typeof Zotero.ItemPaneManager.registerSection;
	});
	probe('Zotero.File.putContentsAsync', function () { return typeof Zotero.File.putContentsAsync; });
	probe('Zotero.File.reveal', function () { return typeof Zotero.File.reveal; });
	probe('IOUtils.writeUTF8', function () {
		return typeof IOUtils !== 'undefined' ? typeof IOUtils.writeUTF8 : '全局里没有 IOUtils';
	});
	probe('PathUtils.join', function () {
		return typeof PathUtils !== 'undefined' ? typeof PathUtils.join : '全局里没有 PathUtils';
	});
	probe('进度窗口', function () {
		var pw = new Zotero.ProgressWindow({ closeOnClick: true });
		var ok = pw && pw.ItemProgress;
		pw.close();
		return ok ? '可用' : '构造成功但没有 ItemProgress';
	});
	probe('词表条数', function () {
		var counts = {};
		for (var code in WordFreq.langdata.sets) {
			counts[code] = WordFreq.langdata.sets[code].size;
		}
		return JSON.stringify(counts);
	});

	var text = '';
	for (var key in report) {
		text += key + '：' + report[key] + '\n';
	}
	Zotero.debug('[英文助手·词频] 自检\n' + text);
	WordFreq.alert(null, '英文助手 · 词频 自检', text);
	return report;
};

/** 只跑纯逻辑，不碰文件。用来在控制台里对一段文本试判定。 */
WordFreq.testText = function (text) {
	var det = this.langdetect.detect(text, this.langOpts());
	var stats = this.wordfreq.run(text, this.tokenOpts());
	this.log(this.langdetect.summarize(det));
	return {
		lang: det.code,
		isEnglish: det.isEnglish,
		reason: det.reason,
		totalTokens: stats.totalTokens,
		uniqueWords: stats.uniqueWords,
		top: this.wordfreq.topWords(stats.rows, 20),
	};
};

/** 设置面板里的按钮处理器（onload 里接线） */
WordFreq.prefsPane = {
	onLoad(event) {
		try {
			var doc = event && event.target && event.target.ownerDocument;
			var btn = doc && doc.getElementById('wf-pref-reset-list');
			if (!btn) {
				return;
			}
			btn.addEventListener('command', function () {
				WordFreq.resetUserList(doc);
			});
		}
		catch (e) {
			WordFreq.logError('接线「恢复默认名单」失败', e);
		}
	},
};

/** 把自定义名单整体恢复成默认那份，先确认 */
WordFreq.resetUserList = async function (doc) {
	var win = (doc && doc.defaultView) || Zotero.getMainWindow();
	var total = WordFreq.userlist.count();
	var text = '把自定义名单恢复成默认的 ' + ((WordFreq.defaultUserList || []).length)
		+ ' 个词？' + (total ? '\n当前的 ' + total + ' 个词会被替换掉。' : '');
	var ok = false;
	try {
		if (typeof DeepSeekTranslate !== 'undefined' && DeepSeekTranslate.confirm) {
			ok = await DeepSeekTranslate.confirm(win, '恢复默认名单', text);
		}
		else {
			ok = !!win.confirm(text);
		}
	}
	catch (e) {
		ok = false;
	}
	if (!ok) {
		return;
	}
	var size = WordFreq.userlist.resetToDefault();
	try {
		if (WordFreq.pane && WordFreq.pane.refreshAll) {
			WordFreq.pane.refreshAll();
		}
	}
	catch (e) {
		// 面板刷不刷新不影响名单本身
	}
	WordFreq.alert(win, '恢复默认名单', '已恢复成默认的 ' + size + ' 个词。');
};