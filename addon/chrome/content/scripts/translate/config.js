/* 命名空间、设置读取与共享状态。
 * 这个文件必须最先加载，其余文件都往 DeepSeekTranslate 上挂东西。 */

var DeepSeekTranslate = {
	pluginID: '',
	pluginVersion: '',
	rootURI: '',

	PREF_BRANCH: 'extensions.englishAssistant.translate.',
	PANE_ID: 'ea-translate-pane',
	PREF_PANE_ID: 'ea-prefs',
	STYLE_ID: 'ea-translate-styles',
	STYLE_URI: 'chrome://english-assistant/content/styles/panel.css',

	// 各条状态都按附件 itemID 索引：同一个附件在不同窗口里共享同一份历史
	state: {
		history: new Map(),   // attachmentItemID -> [entry]
		selection: new Map(), // attachmentItemID -> { text, pageLabel, at }
		pending: new Map(),   // attachmentItemID -> { status: 'loading'|'error', message }
		inflight: new Map(),  // attachmentItemID -> Promise
		textCache: new Map(), // attachmentItemID -> Promise<string>
		panes: new Map(),     // paneUID -> { refresh, itemID, attachmentID }
	},

	log(msg) {
		Zotero.debug('[英文助手·翻译] ' + msg);
	},

	logError(msg, e) {
		Zotero.logError(new Error('[英文助手·翻译] ' + msg + (e ? ': ' + e : '')));
	},

	/** 读一个设置项，读不到就用 fallback */
	pref(key, fallback) {
		try {
			var value = Zotero.Prefs.get(this.PREF_BRANCH + key, true);
			if (value === undefined || value === null) {
				return fallback;
			}
			return value;
		}
		catch (e) {
			return fallback;
		}
	},

	prefString(key, fallback) {
		var value = this.pref(key, fallback);
		return typeof value === 'string' ? value : String(value ?? fallback ?? '');
	},

	prefInt(key, fallback) {
		var value = parseInt(this.pref(key, fallback), 10);
		return isNaN(value) ? fallback : value;
	},

	prefBool(key, fallback) {
		var value = this.pref(key, fallback);
		if (typeof value === 'boolean') {
			return value;
		}
		return !!fallback;
	},

	setPref(key, value) {
		try {
			Zotero.Prefs.set(this.PREF_BRANCH + key, value, true);
		}
		catch (e) {
			this.logError('写入设置失败 ' + key, e);
		}
	},

	apiKey() {
		return this.prefString('apiKey', '').trim();
	},

	hasApiKey() {
		return !!this.apiKey();
	},

	/** 往文档里挂一次样式表，重复调用无副作用 */
	injectStyles(doc) {
		if (!doc || !doc.documentElement) {
			return;
		}
		if (doc.getElementById(this.STYLE_ID)) {
			return;
		}
		try {
			var link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
			link.id = this.STYLE_ID;
			link.setAttribute('rel', 'stylesheet');
			link.setAttribute('type', 'text/css');
			link.setAttribute('href', this.STYLE_URI);
			doc.documentElement.appendChild(link);
		}
		catch (e) {
			this.logError('注入样式表失败', e);
		}
	},

	/** 打开本插件的首选项面板 */
	openPreferences() {
		try {
			Zotero.Utilities.Internal.openPreferences(this.PREF_PANE_ID);
		}
		catch (e) {
			this.logError('打开首选项失败', e);
		}
	},

	copyToClipboard(text) {
		if (!text) {
			return;
		}
		try {
			if (Zotero.Utilities.Internal.copyTextToClipboard) {
				Zotero.Utilities.Internal.copyTextToClipboard(text);
				return;
			}
		}
		catch (e) {
			// 换下一个办法
		}
		try {
			var helper = Cc['@mozilla.org/widget/clipboardhelper;1']
				.getService(Ci.nsIClipboardHelper);
			helper.copyString(text);
		}
		catch (e) {
			this.logError('复制到剪贴板失败', e);
		}
	},

	/**
	 * 确认框。返回 Promise<boolean>，用户点「确定」才是 true。
	 * 拿不到提示服务时退成 window.confirm；两者都不行就当用户取消，绝不擅自执行。
	 */
	async confirm(parentWindow, title, text) {
		var win = parentWindow || null;
		if (!win) {
			try {
				win = Zotero.getMainWindow();
			}
			catch (e) {
				win = null;
			}
		}
		try {
			var ServicesNS = (typeof Services !== 'undefined' && Services) || null;
			if (!ServicesNS) {
				ServicesNS = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services;
			}
			if (ServicesNS && ServicesNS.prompt && win) {
				return !!ServicesNS.prompt.confirm(win, title, text);
			}
		}
		catch (e) {
			this.logError('确认框调用失败', e);
		}
		try {
			if (win && typeof win.confirm === 'function') {
				return !!win.confirm(text);
			}
		}
		catch (e) {
			this.logError('退路的确认框也失败了', e);
		}
		return false;
	},

	/** 取某个附件的翻译历史，没有就返回空数组 */
	getHistory(attachmentID) {
		return this.state.history.get(attachmentID) || [];
	},

	pushHistory(attachmentID, entry) {
		var list = this.state.history.get(attachmentID) || [];
		list.unshift(entry);
		var max = Math.max(5, this.prefInt('maxHistory', 30));
		if (list.length > max) {
			list.length = max;
		}
		this.state.history.set(attachmentID, list);
	},

	clearHistory(attachmentID) {
		this.state.history.delete(attachmentID);
		this.state.pending.delete(attachmentID);
	},

	/** 把附件的状态变化通知给所有正在显示它的面板 */
	refreshPanels(attachmentID) {
		this.state.panes.forEach(function (pane) {
			if (!pane.refresh) {
				return;
			}
			// attachmentID 为空表示刷新所有面板
			if (attachmentID && pane.attachmentID && pane.attachmentID !== attachmentID) {
				return;
			}
			try {
				pane.refresh();
			}
			catch (e) {
				DeepSeekTranslate.logError('刷新面板失败', e);
			}
		});
	},

	formatTime(date) {
		var d = date || new Date();
		var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
		return pad(d.getHours()) + ':' + pad(d.getMinutes());
	},
};
