/* 英文助手的总入口。
 *
 * 两个子系统各自独立启动：翻译（scripts/translate/，挂成 DeepSeekTranslate）
 * 和词频（scripts/wordfreq/，挂成 WordFreq）。任何一个启动失败都不会挡住另一个，
 * 失败信息写进 Zotero 的调试输出。
 *
 * 对外只暴露一个句柄，方便在「工具 → 开发者 → 运行 JavaScript」里调试：
 *   Zotero.EnglishAssistant.translate   翻译子系统
 *   Zotero.EnglishAssistant.wordfreq    词频子系统
 */

var EnglishAssistant = {
	pluginID: '',
	pluginVersion: '',
	rootURI: '',

	translate: null,
	wordfreq: null,

	log(msg) {
		Zotero.debug('[英文助手] ' + msg);
	},

	logError(msg, e) {
		Zotero.logError(new Error('[英文助手] ' + msg + (e ? ': ' + e : '')));
	},

	/** 合并后的设置面板：翻译与词频在同一个页面上，两个 vbox 各自接线一次 */
	prefsRoot: {
		onLoad(event) {
			var root = event.target;
			var translateBox = root && root.querySelector('#ea-translate-prefs');
			var wordfreqBox = root && root.querySelector('#ea-wordfreq-prefs');
			if (translateBox && DeepSeekTranslate && DeepSeekTranslate.prefsPane) {
				try {
					DeepSeekTranslate.prefsPane.onLoad({ target: translateBox });
				}
				catch (e) {
					EnglishAssistant.logError('翻译设置面板接线失败', e);
				}
			}
			if (wordfreqBox && WordFreq && WordFreq.prefsPane) {
				try {
					WordFreq.prefsPane.onLoad({ target: wordfreqBox });
				}
				catch (e) {
					EnglishAssistant.logError('词频设置面板接线失败', e);
				}
			}
		},
	},

	/** 两个子系统。顺序决定右侧边栏里两个区块的上下位置：先启动的在上面。
	 *  两个区块都是非可拖拽（sidenav.orderable = false），所以位置完全由这里决定。 */
	modules() {
		return [
			['整本词频', this.wordfreq],
			['翻译', this.translate],
		];
	},

	/** 三个右侧区块对应的首选项。关掉就不注册那个区块。 */
	SECTION_PREFS: [
		['sections.translate', 'panel', 'AI 翻译'],
		['sections.wordfreq', 'pane', '整本词频'],
		['sections.wordfreqParts', 'partsPane', '分部词频'],
	],

	/** 某个区块是否要显示；没设过就按显示处理 */
	sectionOn(name) {
		try {
			var value = Zotero.Prefs.get('extensions.englishAssistant.' + name, true);
			return value !== false;
		}
		catch (e) {
			return true;
		}
	},

	/** 取某个区块已经在用的注册键（没注册返回 null） */
	sectionKey(spec) {
		var mod = spec[1] === 'panel'
			? (typeof DeepSeekTranslate !== 'undefined' ? DeepSeekTranslate.panel : null)
			: (typeof WordFreq !== 'undefined' ? WordFreq[spec[1]] : null);
		if (!mod) {
			return null;
		}
		return mod.paneKey || mod.paneID || null;
	},

	/** 按设置项注册或注销三个区块。设置面板里勾选框一变就调一次。 */
	syncSections() {
		var self = this;
		this.SECTION_PREFS.forEach(function (spec) {
			var want = self.sectionOn(spec[0]);
			var mod = spec[1] === 'panel'
				? (typeof DeepSeekTranslate !== 'undefined' ? DeepSeekTranslate.panel : null)
				: (typeof WordFreq !== 'undefined' ? WordFreq[spec[1]] : null);
			if (!mod) {
				return;
			}
			var has = !!(mod.paneKey || mod.paneID);
			if (want === has) {
				return;
			}
			try {
				if (want) {
					mod.register();
					self.log('按设置重新显示区块：' + spec[2]);
				}
				else {
					mod.unregister();
					self.log('按设置隐藏区块：' + spec[2]);
				}
			}
			catch (e) {
				self.logError('切换区块显示状态失败（' + spec[2] + '）', e);
			}
		});
	},

	async startup({ id, version, rootURI }) {
		this.pluginID = id;
		this.pluginVersion = version;
		this.rootURI = rootURI;

		this.translate = DeepSeekTranslate;
		this.wordfreq = WordFreq;

		// 先挂句柄：某个子系统启动时抛异常，也还能从控制台查到状态
		Zotero.EnglishAssistant = this;

		this.log('启动 v' + version + '（' + id + '）');

		var list = this.modules();
		for (var i = 0; i < list.length; i++) {
			try {
				await list[i][1].startup({ id: id, version: version, rootURI: rootURI });
			}
			catch (e) {
				this.logError(list[i][0] + '子系统启动失败', e);
			}
		}
	},

	/** 把同一个生命周期钩子依次转给两个子系统，各自包一层 try/catch */
	dispatch(method, arg) {
		var list = this.modules();
		for (var i = 0; i < list.length; i++) {
			var mod = list[i][1];
			if (!mod || typeof mod[method] !== 'function') {
				continue;
			}
			try {
				mod[method](arg);
			}
			catch (e) {
				this.logError(list[i][0] + '子系统 ' + method + ' 失败', e);
			}
		}
	},

	/** 插件的 ftl 文件名。Zotero 把所有插件的 ftl 合并进一个 L10n 源，
	 *  资源名就是文件名，要自己把 link 挂进文档才生效。 */
	L10N_FILE: 'english-assistant.ftl',
	L10N_LINK_ID: 'ea-localization',

	/* 两个区块的文案：paneID、标题文案 id、侧栏文案 id、取不到文案时的兜底。
	 * 区块标题写 label，侧栏按钮的提示写 tooltiptext —— 与 Zotero 自己的写法一致。 */
	SECTIONS: [
		{
			pane: 'ea-translate-pane',
			header: 'ea-translate-pane-header',
			sidenav: 'ea-translate-pane-sidenav',
			label: 'AI 翻译',
		},
		{
			pane: 'ea-wordfreq-pane',
			header: 'ea-wordfreq-pane-header',
			sidenav: 'ea-wordfreq-pane-sidenav',
			label: '词频',
		},
	],

	alert(parent, title, message) {
		try {
			Zotero.alert(parent || Zotero.getMainWindow(), title, message);
		}
		catch (e) {
			this.log(title + '\n' + message);
		}
	},

	/** 把插件的 ftl 挂进窗口文档。
	 *  Zotero 的主窗口只链接了它自己的 zotero.ftl，插件的 ftl 必须自己注入，
	 *  否则区块标题、侧栏提示、工具菜单项都拿不到文案，表现为一片空白且不报错。
	 *  链接必须装在 XUL 的 linkset 里（Zotero 自己的 zoteroPane.xhtml 就是这么写的），
	 *  直接挂在 window 下不会被处理。 */
	injectLocalization(doc) {
		if (!doc || !doc.documentElement) {
			return;
		}
		if (doc.getElementById(this.L10N_LINK_ID)) {
			return;
		}
		try {
			var link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
			link.setAttribute('rel', 'localization');
			link.setAttribute('href', this.L10N_FILE);

			var host = link;
			if (typeof doc.createXULElement === 'function') {
				host = doc.createXULElement('linkset');
				host.appendChild(link);
			}
			host.id = this.L10N_LINK_ID;
			(doc.head || doc.documentElement).appendChild(host);
		}
		catch (e) {
			this.logError('注入界面文案失败', e);
		}
	},

	/** 找区块元素。data-pane 通常在 collapsible-section 上，但有的结构挂在外层自定义元素上。 */
	findSection(doc, paneID) {
		var el = doc.querySelector('collapsible-section[data-pane="' + paneID + '"]');
		if (el) {
			return el;
		}
		var wrapper = doc.querySelector('item-pane-custom-section[data-pane="' + paneID + '"]')
			|| doc.querySelector('[data-pane="' + paneID + '"]');
		if (!wrapper) {
			return null;
		}
		if (wrapper.localName === 'collapsible-section') {
			return wrapper;
		}
		return wrapper.querySelector('collapsible-section');
	},

	/** 给一个元素补一条文案属性：先问 Fluent，取不到就用兜底，宁可显示中文也不留空白 */
	async applyLabel(doc, el, l10nID, attr, fallback) {
		if (!el || el.hasAttribute(attr)) {
			return;
		}
		var value = '';
		try {
			if (doc.l10n) {
				var messages = await doc.l10n.formatMessages([{ id: l10nID }]);
				var msg = messages && messages[0];
				(msg && msg.attributes ? msg.attributes : []).forEach(function (a) {
					if (a.name === attr) {
						value = a.value;
					}
				});
			}
		}
		catch (e) {
			// 取不到就走兜底
		}
		try {
			el.setAttribute(attr, value || fallback);
		}
		catch (e) {
			this.logError('写入区块文案失败', e);
		}
	},

	/** 显式把标题与提示补上。
	 *  区块元素可能在 link 挂进文档之前就建好了，Fluent 不保证回头再处理一次。 */
	async applySectionLabels(doc) {
		if (!doc || !doc.querySelector) {
			return;
		}
		for (var i = 0; i < this.SECTIONS.length; i++) {
			var spec = this.SECTIONS[i];
			await this.applyLabel(doc, this.findSection(doc, spec.pane), spec.header, 'label', spec.label);
			await this.applyLabel(
				doc,
				doc.querySelector('item-pane-sidenav .btn[data-l10n-id="' + spec.sidenav + '"]'),
				spec.sidenav,
				'tooltiptext',
				spec.label
			);
		}
	},

	/** 高亮自检：拿内存里最近一条翻译记录，看选中的文字与译词能不能在模型抄的句子里定位到 */
	diagnoseHighlight() {
		var D = DeepSeekTranslate;
		var lines = [];

		var latest = null;
		try {
			D.state.history.forEach(function (list) {
				(list || []).forEach(function (e) {
					if (!latest) {
						latest = e;
					}
					else if (e && e.at && latest.at && e.at > latest.at) {
						latest = e;
					}
				});
			});
		}
		catch (e) {
			lines.push('读历史记录失败：' + e);
		}

		if (!latest) {
			lines.push('内存里还没有翻译记录。先在 PDF 里翻译一次，再跑这个自检。');
		}
		else {
			var data = latest.data || {};
			var ctx = (data.inContext && typeof data.inContext === 'object') ? data.inContext : {};
			var R = D.render;

			lines.push('选中文字：' + JSON.stringify(latest.text || ''));
			lines.push('inContext 里的字段：' + (Object.keys(ctx).join('、') || '（是字符串，不是对象）'));
			lines.push('');

			var sentence = R.stripMarkers(ctx.sentence || '');
			lines.push('原句：' + JSON.stringify(sentence));
			var span1 = R.findSpan(sentence, latest.text);
			lines.push('→ 在这一句里定位选中文字：' + (span1 ? JSON.stringify(span1) : '找不到'));
			lines.push('');

			var translation = R.stripMarkers(ctx.sentenceTranslation || '');
			lines.push('targetTerm：' + JSON.stringify(ctx.targetTerm || '（没给）'));
			lines.push('译文：' + JSON.stringify(translation));
			var span2 = R.findSpanAny(translation, R.termCandidates(ctx.targetTerm));
			lines.push('→ 在译文里定位译词：' + (span2 ? JSON.stringify(span2) : '找不到'));
		}

		var doc = null;
		try {
			doc = Zotero.getMainWindow().document;
		}
		catch (e) {
			doc = null;
		}
		if (doc && doc.querySelectorAll) {
			var hits = doc.querySelectorAll('.ds-hl');
			lines.push('');
			lines.push('页面里 .ds-hl 元素：' + hits.length + ' 个');
			if (hits.length) {
				var style = null;
				try {
					style = doc.defaultView.getComputedStyle(hits[0]);
				}
				catch (e) {
					style = null;
				}
				lines.push('第一个高亮的文字：' + JSON.stringify(hits[0].textContent || ''));
				lines.push('它的背景色：' + (style ? style.backgroundColor : '（拿不到）'));
			}
		}

		this.alert(null, '英文助手 · 高亮自检', lines.join('\n'));
	},

	/** 词次自检：这一篇能不能从词频表里拿到词次，查的是什么键 */
	async diagnoseCounts() {
		var D = DeepSeekTranslate;
		var lines = [];
		var W = (typeof WordFreq !== 'undefined') ? WordFreq : null;
		lines.push('词频模块可用：' + (W && W.wordfreq && W.source && W.output ? '是' : '否'));

		var latest = null;
		var latestAtt = null;
		try {
			D.state.history.forEach(function (list, attID) {
				(list || []).forEach(function (e) {
					if (!latest) {
						latest = e;
						latestAtt = attID;
					}
				});
			});
		}
		catch (e) {
			lines.push('读历史记录失败：' + e);
		}

		if (!latest) {
			lines.push('');
			lines.push('内存里还没有翻译记录。先翻译一次再跑自检。');
			this.alert(null, '英文助手 · 词次自检', lines.join('\n'));
			return;
		}

		try {
			var attachment = await Zotero.Items.getAsync(latestAtt);
			var index = await D.counts.forAttachment(attachment);
			lines.push('');
			lines.push('词频表索引：' + (index ? index.counts.size + ' 个词' : '没有（没生成，或读不到）'));

			var data = latest.data || {};
			var keys = [data.form && data.form.lemma, data.headword,
				data.form && data.form.surface, latest.text];
			lines.push('记录类型：' + (data.type || '（无）'));
			lines.push('选中文字：' + JSON.stringify(latest.text || ''));
			lines.push('查找用的键：' + JSON.stringify(keys));
			lines.push('查到：' + JSON.stringify(D.counts.pickFromIndex(index, keys)));
			lines.push('条目上存的值：' + JSON.stringify(latest.count || null));
		}
		catch (e) {
			lines.push('自检本身出错：' + ((e && e.message) || e));
		}

		this.alert(null, '英文助手 · 词次自检', lines.join('\n'));
	},

	/** 文案自检：把窗口、链接、元素、文案四层状态一次列出来，装到机器上排查用 */
	async diagnoseL10n() {
		var lines = [];
		lines.push('主窗口加载钩子：调用过 ' + (this.mainWindowLoads || 0) + ' 次');
		lines.push('Zotero 版本：' + Zotero.version);

		var wins = [];
		try {
			var enumerator = Services.wm.getEnumerator('navigator:browser');
			while (enumerator.hasMoreElements()) {
				wins.push(enumerator.getNext());
			}
		}
		catch (e) {
			lines.push('枚举窗口失败：' + e);
		}
		lines.push('浏览器窗口数：' + wins.length);

		for (var w = 0; w < wins.length; w++) {
			var doc = wins[w].document;
			if (!doc || !doc.documentElement) {
				continue;
			}
			var root = doc.documentElement;
			lines.push('');
			lines.push('窗口 ' + (w + 1) + '：<' + root.localName
				+ ' windowtype=' + (root.getAttribute('windowtype') || '无') + '>');

			var host = doc.getElementById(this.L10N_LINK_ID);
			lines.push('  插件 ftl 链接：' + (host ? ('有，装在 <' + host.localName + '> 里') : '没有'));

			var hrefs = [];
			doc.querySelectorAll('link[rel="localization"]').forEach(function (l) {
				hrefs.push(l.getAttribute('href'));
			});
			lines.push('  文档里的 ftl：' + (hrefs.join('、') || '（无）'));

			var paneIds = [];
			doc.querySelectorAll('collapsible-section').forEach(function (s) {
				paneIds.push(s.getAttribute('data-pane') || '(空)');
			});
			var customIds = [];
			doc.querySelectorAll('item-pane-custom-section').forEach(function (c) {
				customIds.push(c.getAttribute('data-pane') || '(空)');
			});
			lines.push('  collapsible-section ' + paneIds.length + ' 个：' + (paneIds.join('、') || '无'));
			lines.push('  item-pane-custom-section ' + customIds.length + ' 个：' + (customIds.join('、') || '无'));

			for (var i = 0; i < this.SECTIONS.length; i++) {
				var spec = this.SECTIONS[i];
				var sec = this.findSection(doc, spec.pane);
				var btn = doc.querySelector('item-pane-sidenav .btn[data-l10n-id="' + spec.sidenav + '"]');
				lines.push('  ' + spec.header + '：' + (sec
					? ('元素在，label = ' + (sec.getAttribute('label') || '（空）'))
					: '没找到元素'));
				lines.push('  ' + spec.sidenav + '：' + (btn
					? ('按钮在，tooltiptext = ' + (btn.getAttribute('tooltiptext') || '（空）'))
					: '没找到按钮'));
			}

			if (doc.l10n) {
				try {
					var ids = [];
					this.SECTIONS.forEach(function (s) {
						ids.push({ id: s.header });
					});
					var messages = await doc.l10n.formatMessages(ids);
					messages.forEach(function (m, idx) {
						var attrs = m && m.attributes
							? m.attributes.map(function (a) { return a.name + '=' + a.value; }).join(' ')
							: '（取不到）';
						lines.push('  文案 ' + ids[idx].id + '：' + attrs);
					});
				}
				catch (e) {
					lines.push('  取文案报错：' + e);
				}
			}
		}

		this.alert(null, '英文助手 · 文案自检', lines.join('\n'));
	},

	onMainWindowLoad(window) {
		this.mainWindowLoads = (this.mainWindowLoads || 0) + 1;

		var doc = window && window.document;
		this.injectLocalization(doc);

		this.dispatch('onMainWindowLoad', window);

		/* 区块与侧栏按钮通常在窗口加载完成之后才建出来，
		 * 所以隔一小会儿再补两遍文案（插件沙箱里没有 setTimeout）。 */
		var self = this;
		[300, 1500].forEach(function (ms) {
			Zotero.Promise.delay(ms).then(function () {
				return self.applySectionLabels(doc);
			}).catch(function (e) {
				self.logError('补写区块标题失败', e);
			});
		});
	},

	onMainWindowUnload(window) {
		this.dispatch('onMainWindowUnload', window);
	},

	shutdown() {
		this.dispatch('shutdown');

		try {
			delete Zotero.EnglishAssistant;
		}
		catch (e) {
			Zotero.EnglishAssistant = undefined;
		}
	},
};
