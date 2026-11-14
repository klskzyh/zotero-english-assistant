/* 条目面板里的「AI 翻译」区块。
 *
 * 翻译结果按附件归档，所以同一个 PDF 在哪打开都能看到同一份历史。
 * 面板本身不发起翻译，它只负责展示；发起方是阅读器弹窗或面板上的重试按钮。 */

DeepSeekTranslate.panel = {
	paneKey: null,

	register() {
		if (this.paneKey) {
			return this.paneKey;
		}
		var self = this;
		var D = DeepSeekTranslate;

		var key = Zotero.ItemPaneManager.registerSection({
			paneID: D.PANE_ID,
			pluginID: D.pluginID,
			header: {
				l10nID: 'ea-translate-pane-header',
				icon: 'chrome://english-assistant/content/icons/section-16.svg',
			},
			sidenav: {
				l10nID: 'ea-translate-pane-sidenav',
				icon: 'chrome://english-assistant/content/icons/section-20.svg',
				orderable: false,
			},
			bodyXHTML: '<div xmlns="http://www.w3.org/1999/xhtml" class="ds-panel"></div>',
			onInit: function (props) { self.onInit(props); },
			onDestroy: function (props) { self.onDestroy(props); },
			onItemChange: function (props) { self.onItemChange(props); },
			onRender: function (props) { self.onRender(props); },
			onAsyncRender: function (props) { return self.onAsyncRender(props); },
			sectionButtons: [
				{
					type: 'ds-settings',
					icon: 'chrome://zotero/skin/16/universal/options.svg',
					l10nID: 'ea-translate-button-settings',
					onClick: function () { D.openPreferences(); },
				},
				{
					type: 'ds-clear',
					icon: 'chrome://zotero/skin/16/universal/trash.svg',
					l10nID: 'ea-translate-button-clear',
					onClick: function (props) {
						var pane = D.state.panes.get(props.body.dataset.dsUid);
						if (pane && pane.attachmentID) {
							D.clearHistory(pane.attachmentID);
							D.refreshPanels(pane.attachmentID);
						}
					},
				},
			],
		});

		if (key) {
			this.paneKey = key;
			D.log('条目面板区块已注册：' + key);
		}
		else {
			D.logError('条目面板区块注册失败');
		}
		return this.paneKey;
	},

	unregister() {
		if (!this.paneKey) {
			return;
		}
		try {
			Zotero.ItemPaneManager.unregisterSection(this.paneKey);
		}
		catch (e) {
			DeepSeekTranslate.logError('注销条目面板区块失败', e);
		}
		this.paneKey = null;
	},

	onInit({ body, refresh }) {
		var uid = Zotero.Utilities.randomString(8);
		body.dataset.dsUid = uid;
		DeepSeekTranslate.state.panes.set(uid, {
			refresh: refresh,
			itemID: null,
			attachmentID: null,
		});
	},

	onDestroy({ body }) {
		if (body && body.dataset) {
			DeepSeekTranslate.state.panes.delete(body.dataset.dsUid);
		}
	},

	onItemChange({ item, setEnabled }) {
		// 任何条目都能看到这个区块，没有 PDF 时区块内部会给出说明
		setEnabled(!!item);
	},

	onRender({ doc, body, item }) {
		var D = DeepSeekTranslate;
		D.injectStyles(doc);

		// 区块标题、侧栏提示这些文案靠插件自己的 ftl，链接必须挂进这个文档。
		// 放在渲染路径里而不是窗口加载钩子上：这个函数一定会被调用。
		if (typeof EnglishAssistant !== 'undefined') {
			EnglishAssistant.injectLocalization(doc);
			EnglishAssistant.applySectionLabels(doc).catch(function () {});
		}

		var root = body.querySelector('.ds-panel');
		if (!root) {
			return;
		}
		root.replaceChildren();

		var content = this.el(doc, 'div', 'ds-panel-body');
		content.dataset.dsRole = 'content';
		content.appendChild(this.el(doc, 'div', 'ds-hint', '正在读取文献…'));
		root.appendChild(content);

		var pane = D.state.panes.get(body.dataset.dsUid);
		if (pane) {
			pane.itemID = item ? item.id : null;
		}
	},

	async onAsyncRender({ doc, body, item }) {
		var D = DeepSeekTranslate;
		var content = body.querySelector('[data-ds-role="content"]');
		if (!content) {
			return;
		}
		content.replaceChildren();

		var pane = D.state.panes.get(body.dataset.dsUid);

		if (!item) {
			content.appendChild(this.el(doc, 'div', 'ds-hint', '没有选中的条目。'));
			return;
		}

		var attachment = null;
		try {
			attachment = await D.context.resolveAttachment(item);
		}
		catch (e) {
			D.logError('解析附件失败', e);
		}

		if (pane) {
			pane.attachmentID = attachment ? attachment.id : null;
		}

		if (!attachment) {
			content.appendChild(this.el(doc, 'div', 'ds-hint',
				'这条文献没有可用的 PDF 附件。上下文取自 PDF 全文，所以需要先添加 PDF。'));
			return;
		}

		if (!D.hasApiKey()) {
			var warn = this.el(doc, 'div', 'ds-warn');
			warn.appendChild(this.el(doc, 'div', null, '还没有配置 AI 服务的 API Key，翻译功能不可用。'));
			var actions = this.el(doc, 'div', 'ds-warn-actions');
			actions.appendChild(this.el(doc, 'button', 'ds-btn', '打开设置'));
			actions.lastChild.setAttribute('type', 'button');
			actions.lastChild.addEventListener('click', function (event) {
				event.preventDefault();
				D.openPreferences();
			});
			warn.appendChild(actions);
			content.appendChild(warn);
		}

		var pending = D.state.pending.get(attachment.id);
		if (pending) {
			var box = this.el(doc, 'div', 'ds-pending');
			if (pending.status === 'loading') {
				box.appendChild(this.el(doc, 'div', 'ds-spinner-row', '正在翻译…'));
				if (pending.text) {
					box.appendChild(this.el(doc, 'div', 'ds-source', pending.text));
				}
			}
			else {
				box.setAttribute('class', 'ds-pending ds-pending-error');
				box.appendChild(this.el(doc, 'div', 'ds-error', pending.message || '翻译失败。'));
				var retryRow = this.el(doc, 'div', 'ds-warn-actions');
				retryRow.appendChild(this.el(doc, 'button', 'ds-btn', '重试'));
				retryRow.lastChild.setAttribute('type', 'button');
				var self = this;
				retryRow.lastChild.addEventListener('click', function (event) {
					event.preventDefault();
					DeepSeekTranslate.service.retry(attachment.id);
				});
				box.appendChild(retryRow);
				content.appendChild(box);
			}
		}

		var history = D.getHistory(attachment.id);
		if (!history.length && !pending) {
			content.appendChild(this.el(doc, 'div', 'ds-hint',
				'在 PDF 里选中词语、短语或段落，点击浮出的「AI 翻译」按钮。结果会出现在这里。'));
			return;
		}

		var self = this;
		// 先把单词本读进内存，卡片的「收藏 / 已收藏」才能一次画对
		try {
			await D.wordbook.load();
		}
		catch (e) {
			D.logError('读入单词本失败', e);
		}
		var handlers = {
			onCopy: function (text) { D.copyToClipboard(text); },
			onDelete: function (id) { self.deleteEntry(attachment.id, id); },
			onCollect: function (entry, btn) {
				D.wordbook.add(entry).then(function (result) {
					if (result && result.entry) {
						btn.textContent = '移除收藏';
						if (btn.dataset) {
							btn.dataset.collected = '1';
						}
					}
					else {
						btn.textContent = (result && result.reason) || '没收进去';
						btn.disabled = true;
					}
				}).catch(function (e) {
					D.logError('收藏失败', e);
					btn.textContent = '收藏失败';
				});
			},
			onUncollect: function (entry, btn) {
				D.confirm(null, '移出单词本', '把「' + (entry.text || '') + '」移出单词本？').then(function (ok) {
					if (!ok) {
						return null;
					}
					return D.wordbook.removeByKey(entry).then(function (removed) {
						if (removed) {
							btn.textContent = '收藏';
							if (btn.dataset) {
								btn.dataset.collected = '0';
							}
						}
					});
				}).catch(function (e) {
					D.logError('移除收藏失败', e);
				});
			},
			isCollected: function (entry) {
				return D.wordbook.isCollected(entry);
			},
		};
		history.forEach(function (entry) {
			content.appendChild(D.render.entryCard(doc, entry, handlers));
		});
	},

	deleteEntry(attachmentID, entryID) {
		var D = DeepSeekTranslate;
		var list = D.getHistory(attachmentID);
		var next = list.filter(function (e) { return e.id !== entryID; });
		D.state.history.set(attachmentID, next);
		D.refreshPanels(attachmentID);
	},

	el(doc, tag, className, text) {
		return DeepSeekTranslate.render.el(doc, tag, className, text);
	},
};
