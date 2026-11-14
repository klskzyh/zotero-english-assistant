/* 插件的启动与收尾。bootstrap.js 只负责加载脚本，具体挂载都在这里。 */

DeepSeekTranslate.startup = async function ({ id, version, rootURI }) {
	this.pluginID = id;
	this.pluginVersion = version;
	this.rootURI = rootURI;

	this.log('启动 v' + version + '（' + id + '）');

	// 对外只暴露一个入口：Zotero.EnglishAssistant（见 scripts/main.js）。
	// 首选项面板里的内联处理函数靠它取到本对象。

	try {
		await this.registerPreferencePane();
	}
	catch (e) {
		this.logError('注册首选项面板失败', e);
	}

	try {
		// 设置里关掉「AI 翻译」区块时不注册，右侧栏就不会出现那个图标
		if (EnglishAssistant.sectionOn('sections.translate')) {
			this.panel.register();
		}
	}
	catch (e) {
		this.logError('注册条目面板失败', e);
	}

	try {
		this.reader.register();
	}
	catch (e) {
		this.logError('注册阅读器弹窗失败', e);
	}

	try {
		this.registerWordbookMenu();
	}
	catch (e) {
		this.logError('注册单词本菜单失败', e);
	}
};

/** 「工具」菜单里挂一条「单词本…」，打开内置单词本窗口 */
DeepSeekTranslate.registerWordbookMenu = function () {
	if (!Zotero.MenuManager || typeof Zotero.MenuManager.registerMenu !== 'function') {
		this.log('这个 Zotero 没有 MenuManager，跳过单词本菜单');
		return;
	}
	var self = this;
	Zotero.MenuManager.registerMenu({
		menuID: 'ea-wordbook-menu',
		pluginID: this.pluginID,
		target: 'main/menubar/tools',
		menus: [{
			menuType: 'menuitem',
			l10nID: 'ea-wordbook-tools-open',
			onShowing: function (event, context) {
				// ftl 万一没生效，至少让这一项有字，别留一条空白菜单
				try {
					var el = context && context.menuElem;
					if (el && !el.getAttribute('label')) {
						el.setAttribute('label', '单词本…');
					}
				}
				catch (e) {
					// 忽略
				}
			},
			onCommand: function () {
				self.wordbook.openWindow();
			},
		}],
	});
};

DeepSeekTranslate.registerPreferencePane = async function () {
	// 翻译与词频共用一个设置面板（1.17.0 起）：一个入口，页面里上下两段。
	// 两份样式都带上，两个片段各自的规则才不会失效。
	var id = await Zotero.PreferencePanes.register({
		pluginID: this.pluginID,
		id: this.PREF_PANE_ID,
		src: 'chrome/content/preferences.xhtml',
		label: '英文助手',
		image: 'chrome/content/icons/section-20.svg',
		stylesheets: [
			'chrome/content/styles/preferences-translate.css',
			'chrome/content/styles/preferences-wordfreq.css',
		],
	});
	this.prefPaneID = id;
	this.log('首选项面板已注册：' + id);
};

/* 首选项面板里的交互。
 *
 * 面板片段加载完成后触发 load 事件，这里把四个控件接上：
 *   服务商下拉  → 换地址、换默认模型、显示或隐藏协议下拉
 *   读取模型    → 调服务商的 /models，把结果填进模型下拉并选中一项
 *   模型下拉    → 选中即写进配置，与手填的输入框互相同步
 *   测试连接    → 用当前界面上的值（不必先保存）发一句很短的话
 *
 * 界面上的值优先：用户改了输入框还没离开焦点就点按钮，也按看到的来。
 */
DeepSeekTranslate.prefsPane = {
	onLoad(event) {
		var doc = event.target.ownerDocument;
		var provider = doc.getElementById('ds-pref-provider');
		if (!provider) {
			// 不是这个面板（或被旧缓存加载）
			return;
		}
		var self = this;

		provider.addEventListener('command', function () {
			self.onProviderChange(doc);
		});

		var modelsButton = doc.getElementById('ds-pref-models');
		if (modelsButton) {
			modelsButton.addEventListener('command', function () {
				self.loadModels(doc);
			});
		}

		var modelList = doc.getElementById('ds-pref-model');
		if (modelList) {
			modelList.addEventListener('command', function () {
				self.onModelPick(doc);
			});
		}

		var modelText = doc.getElementById('ds-pref-model-text');
		if (modelText) {
			// 手填的模型名失焦时反选下拉框里对应的一项
			modelText.addEventListener('change', function () {
				self.syncModelSelection(doc);
			});
		}

		var testButton = doc.getElementById('ds-pref-test');
		if (testButton) {
			testButton.addEventListener('command', function () {
				self.testConnection(doc);
			});
		}

		// 右侧区块：三个勾选框控制对应区块是否注册
		['ea-pref-section-translate', 'ea-pref-section-wordfreq',
			'ea-pref-section-wordfreqParts'].forEach(function (id) {
			var box = doc.getElementById(id);
			if (!box) {
				return;
			}
			box.addEventListener('command', function () {
				if (typeof EnglishAssistant !== 'undefined' && EnglishAssistant.syncSections) {
					EnglishAssistant.syncSections();
				}
			});
		});

		// 配置备份：导出/导入本插件的全部首选项
		var statusNote = doc.getElementById('ds-pref-backup-status');
		var report = function (text) {
			if (statusNote) {
				statusNote.textContent = text;
			}
		};
		var exportButton = doc.getElementById('ds-pref-export-config');
		if (exportButton) {
			exportButton.addEventListener('command', function () {
				var B = WordFreq.backup;
				if (!B) {
					return;
				}
				report('正在导出…');
				B.exportAll(doc.defaultView, report).catch(function (e) {
					report('导出失败：' + ((e && e.message) || e));
				});
			});
		}
		var importButton = doc.getElementById('ds-pref-import-config');
		if (importButton) {
			importButton.addEventListener('command', function () {
				var B = WordFreq.backup;
				if (!B) {
					return;
				}
				report('正在导入…');
				B.importAll(doc.defaultView, report).catch(function (e) {
					report('导入失败：' + ((e && e.message) || e));
				});
			});
		}

		// 打开面板时按保存的设置把界面摆好：协议下拉的显隐、已有模型的那一项
		this.applySavedValues(doc);
		this.syncProtocolField(doc);
		this.refreshProviderNote(doc);
		this.fillSavedModel(doc);
	},

	/** 面板刚插进来时，preference 绑定未必已经把值写进控件。
	 *  这里按 prefs 兜一遍，避免服务商读成空串、协议下拉显隐判断错。 */
	applySavedValues(doc) {
		var D = DeepSeekTranslate;
		var pairs = [
			['ds-pref-provider', D.prefString('provider', 'deepseek')],
			['ds-pref-protocol', D.prefString('protocol', 'openai')],
			['ds-pref-baseURL', D.prefString('baseURL', D.protocols.DEFAULT_BASE_URL)],
			['ds-pref-apiKey', D.apiKey()],
		];
		for (var i = 0; i < pairs.length; i++) {
			var node = doc.getElementById(pairs[i][0]);
			if (node && !node.value) {
				node.value = pairs[i][1] || '';
			}
		}
	},

	/** 换服务商：地址与默认模型换成该家的，并说明做了什么 */
	onProviderChange(doc) {
		var D = DeepSeekTranslate;
		var preset = D.protocols.presetOf(this._value(doc, 'ds-pref-provider'));
		this.syncProtocolField(doc);

		if (!preset || preset.key === 'custom') {
			this.refreshProviderNote(doc);
			return;
		}

		var baseInput = doc.getElementById('ds-pref-baseURL');
		if (baseInput && preset.baseURL) {
			baseInput.value = preset.baseURL;
			D.setPref('baseURL', preset.baseURL);
		}

		var model = preset.defaultModel || '';
		if (model) {
			var text = doc.getElementById('ds-pref-model-text');
			if (text) {
				text.value = model;
			}
			D.setPref('model', model);
			this.fillModelList(doc, [{ id: model, label: model }], model);
		}

		var note = doc.getElementById('ds-pref-provider-note');
		if (note) {
			var protocol = (D.protocols.PROTOCOLS[preset.protocol] || {}).label || preset.protocol;
			note.textContent = '已填入 ' + preset.label + ' 的默认地址与模型（协议 ' + protocol
				+ '）。地址和模型都还可以再改。';
		}
		var status = doc.getElementById('ds-pref-models-status');
		if (status) {
			this._setStatus(status, '', 'inherit');
		}
	},

	/** 协议下拉只在「自定义」时出现，其它服务商的协议由预设表决定 */
	syncProtocolField(doc) {
		var field = doc.getElementById('ds-pref-protocol-field');
		if (!field) {
			return;
		}
		var key = this._value(doc, 'ds-pref-provider');
		var preset = DeepSeekTranslate.protocols.presetOf(key);
		field.hidden = !!(preset && preset.key !== 'custom');
	},

	/** 服务商下面那行灰字：平时显示默认地址与协议 */
	refreshProviderNote(doc) {
		var D = DeepSeekTranslate;
		var note = doc.getElementById('ds-pref-provider-note');
		if (!note) {
			return;
		}
		var preset = D.protocols.presetOf(this._value(doc, 'ds-pref-provider'));
		if (!preset || preset.key === 'custom') {
			note.textContent = '自定义：填接口根地址，并在上面选协议（默认 OpenAI 兼容）。';
			return;
		}
		var protocol = (D.protocols.PROTOCOLS[preset.protocol] || {}).label || preset.protocol;
		note.textContent = '默认地址 ' + preset.baseURL + '，协议 ' + protocol + '。';
	},

	/** 面板打开时，把已保存的模型作为下拉里唯一的一项并选中 */
	fillSavedModel(doc) {
		var saved = DeepSeekTranslate.prefString('model', '');
		var text = doc.getElementById('ds-pref-model-text');
		if (text && saved) {
			text.value = saved;
		}
		this.fillModelList(doc, saved ? [{ id: saved, label: saved }] : [], saved);
	},

	/** 重建模型下拉；返回值是实际选中的模型名（空列表返回空串） */
	fillModelList(doc, models, selected) {
		var list = doc.getElementById('ds-pref-model');
		if (!list) {
			return '';
		}
		var popup = list.querySelector('menupopup');
		if (!popup) {
			return '';
		}
		while (popup.firstChild) {
			popup.removeChild(popup.firstChild);
		}

		var picked = -1;
		for (var i = 0; i < models.length; i++) {
			var entry = models[i];
			var label = entry.label && entry.label !== entry.id ? entry.label : entry.id;
			var item = this._menuItem(doc, entry.id, label, false);
			// 模型名可能很长，下拉宽度有限，鼠标停留时给出完整名字
			item.setAttribute('tooltiptext', entry.label && entry.label !== entry.id
				? entry.id + '（' + entry.label + '）'
				: entry.id);
			popup.appendChild(item);
			if (entry.id === selected) {
				picked = i;
			}
		}

		if (!models.length) {
			popup.appendChild(this._menuItem(doc, '', '还没有读到模型', true));
			list.selectedIndex = 0;
			return '';
		}
		list.selectedIndex = picked >= 0 ? picked : 0;
		return models[picked >= 0 ? picked : 0].id;
	},

	/** 手动选了下拉里的一项：写进配置，并同步手填框 */
	onModelPick(doc) {
		var list = doc.getElementById('ds-pref-model');
		if (!list) {
			return;
		}
		var value = String(list.value == null ? '' : list.value);
		if (!value) {
			return;
		}
		DeepSeekTranslate.setPref('model', value);
		var text = doc.getElementById('ds-pref-model-text');
		if (text) {
			text.value = value;
		}
		var status = doc.getElementById('ds-pref-models-status');
		if (status) {
			this._setStatus(status, '已选模型：' + value, 'ok');
		}
	},

	/** 手填了模型名：下拉里有的就选中，没有就把它作为唯一一项 */
	syncModelSelection(doc) {
		var text = doc.getElementById('ds-pref-model-text');
		var list = doc.getElementById('ds-pref-model');
		if (!text || !list) {
			return;
		}
		var want = String(text.value == null ? '' : text.value).trim();
		if (!want) {
			return;
		}
		var items = list.querySelectorAll('menuitem');
		for (var i = 0; i < items.length; i++) {
			if (items[i].getAttribute('value') === want) {
				list.selectedIndex = i;
				return;
			}
		}
		this.fillModelList(doc, [{ id: want, label: want }], want);
	},

	/** 读模型列表：8 秒超时，失败时把原因写在状态行 */
	async loadModels(doc) {
		var status = doc.getElementById('ds-pref-models-status');
		var button = doc.getElementById('ds-pref-models');
		var overrides = this.formValues(doc);
		this._setStatus(status, '正在读取模型列表…', 'busy');
		if (button) {
			button.disabled = true;
		}
		try {
			var models = await DeepSeekTranslate.api.listModels(overrides);
			var saved = overrides.model || DeepSeekTranslate.prefString('model', '');
			var selected = DeepSeekTranslate.protocols.pickModel(models, saved);
			this.fillModelList(doc, models, selected);
			DeepSeekTranslate.setPref('model', selected);
			var text = doc.getElementById('ds-pref-model-text');
			if (text) {
				text.value = selected;
			}
			this._setStatus(status, '读到 ' + models.length + ' 个模型，已选中 ' + selected, 'ok');
		}
		catch (e) {
			this._setStatus(status, (e && e.message) || String(e), 'error');
		}
		finally {
			if (button) {
				button.disabled = false;
			}
		}
	},

	async testConnection(doc) {
		var status = doc.getElementById('ds-pref-test-status');
		if (!status) {
			return;
		}
		var overrides = this.formValues(doc);
		this._setStatus(status, '正在测试…', 'busy');
		try {
			var result = await DeepSeekTranslate.api.testConnection(overrides);
			var reply = (result.content || '').trim().replace(/\s+/g, ' ').slice(0, 40);
			this._setStatus(status, '连接正常，模型 ' + result.model + ' 回复：' + reply, 'ok');
		}
		catch (e) {
			this._setStatus(status, (e && e.message) || String(e), 'error');
		}
	},

	/** 界面上的当前值。这些控件都绑定了 preference，正常已经写进配置；
	 *  这里再读一遍，是为了让「改了还没失焦就点按钮」也能按看到的来。 */
	formValues(doc) {
		var model = this._value(doc, 'ds-pref-model-text').trim();
		if (!model) {
			model = this._value(doc, 'ds-pref-model');
		}
		return {
			provider: this._value(doc, 'ds-pref-provider'),
			protocol: this._value(doc, 'ds-pref-protocol'),
			baseURL: this._value(doc, 'ds-pref-baseURL').trim(),
			apiKey: this._value(doc, 'ds-pref-apiKey').trim(),
			model: model,
		};
	},

	_value(doc, id) {
		var node = doc.getElementById(id);
		if (!node) {
			return '';
		}
		return String(node.value == null ? '' : node.value);
	},

	_menuItem(doc, value, label, disabled) {
		var item;
		try {
			item = doc.createXULElement('menuitem');
		}
		catch (e) {
			item = doc.createElement('menuitem');
		}
		item.setAttribute('value', value);
		item.setAttribute('label', label);
		if (disabled) {
			item.setAttribute('disabled', 'true');
		}
		return item;
	},

	_setStatus(node, text, kind) {
		if (!node) {
			return;
		}
		node.setAttribute('value', text);
		node.textContent = text;
		var colors = {
			ok: '#2e7d32',
			error: '#c62828',
			busy: '#767676',
		};
		node.style.color = colors[kind] || 'inherit';
	},
};

DeepSeekTranslate.shutdown = function () {
	this.log('关闭');

	try {
		if (Zotero.MenuManager && typeof Zotero.MenuManager.unregisterMenu === 'function') {
			Zotero.MenuManager.unregisterMenu('ea-wordbook-menu');
		}
	}
	catch (e) {
		this.logError('注销单词本菜单失败', e);
	}

	try {
		this.reader.unregister();
	}
	catch (e) {
		this.logError('清理阅读器弹窗失败', e);
	}

	try {
		this.panel.unregister();
	}
	catch (e) {
		this.logError('清理条目面板失败', e);
	}

	// Zotero 会按 pluginID 自动注销首选项面板和区块，这里只清自己的状态
	this.state.panes.clear();
	this.state.inflight.clear();
	this.state.textCache.clear();
};

DeepSeekTranslate.onMainWindowLoad = function (window) {
	try {
		this.injectStyles(window.document);
	}
	catch (e) {
		this.logError('主窗口初始化失败', e);
	}
};

DeepSeekTranslate.onMainWindowUnload = function (window) {
	// 样式随窗口销毁，不需要单独清理
};
