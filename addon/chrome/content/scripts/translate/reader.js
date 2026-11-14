/* 阅读器里的选中弹窗按钮。
 *
 * PDF 阅读器在每次划词时抛出 renderTextSelectionPopup，
 * 我们往弹窗里插一个按钮，点击后就地发起翻译。 */

DeepSeekTranslate.reader = {
	handler: null,

	register() {
		if (this.handler) {
			return;
		}
		var self = this;
		this.handler = function (event) {
			self.onTextSelectionPopup(event);
		};
		Zotero.Reader.registerEventListener(
			'renderTextSelectionPopup',
			this.handler,
			DeepSeekTranslate.pluginID
		);
		DeepSeekTranslate.log('阅读器划词弹窗已挂载');
	},

	unregister() {
		if (!this.handler) {
			return;
		}
		try {
			Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', this.handler);
		}
		catch (e) {
			DeepSeekTranslate.logError('注销阅读器弹窗失败', e);
		}
		this.handler = null;
	},

	onTextSelectionPopup(event) {
		var D = DeepSeekTranslate;

		var reader = event.reader;
		var doc = event.doc;
		var params = event.params || {};
		var annotation = params.annotation || {};
		var text = (annotation.text || '').trim();

		if (!text || !reader) {
			return;
		}

		D.injectStyles(doc);

		// 选区还活着的时候就得把前后文取下来，点按钮时它可能已经消失了
		var localContext = this.captureLocalContext(event);

		var container = this.el(doc, 'div', 'ds-popup');
		var button = this.el(doc, 'button', 'ds-popup-button', 'AI 翻译');
		button.setAttribute('type', 'button');
		var status = this.el(doc, 'div', 'ds-popup-status');

		var pageLabel = this.pageLabelOf(annotation);
		var busy = false;

		button.addEventListener('click', async function (clickEvent) {
			clickEvent.preventDefault();
			clickEvent.stopPropagation();

			if (busy) {
				return;
			}
			busy = true;
			button.disabled = true;
			status.textContent = '翻译中…';
			status.setAttribute('class', 'ds-popup-status ds-popup-status-busy');

			try {
				var entry = await D.service.translate({
					attachmentID: reader.itemID,
					text: text,
					pageLabel: pageLabel,
					localContext: localContext,
				});
				if (entry && entry.error) {
					status.textContent = '失败：' + entry.error;
					status.setAttribute('class', 'ds-popup-status ds-popup-status-error');
				}
				else {
					status.textContent = '完成，结果见右侧「AI 翻译」面板';
					status.setAttribute('class', 'ds-popup-status ds-popup-status-done');
				}
			}
			catch (e) {
				status.textContent = '失败：' + ((e && e.message) || e);
				status.setAttribute('class', 'ds-popup-status ds-popup-status-error');
			}
			finally {
				busy = false;
				button.disabled = false;
			}
		});

		container.appendChild(button);
		container.appendChild(status);

		// append 必须在事件处理里同步调用，这里不能 await
		event.append(container);
	},

	pageLabelOf(annotation) {
		if (!annotation) {
			return '';
		}
		if (annotation.pageLabel) {
			return '第 ' + annotation.pageLabel + ' 页';
		}
		var position = annotation.position;
		if (position && typeof position.pageIndex === 'number') {
			return '第 ' + (position.pageIndex + 1) + ' 页';
		}
		return '';
	},

	/**
	 * 从阅读器 DOM 里取选区前后的原文。
	 *
	 * 不用「在全文里按文字查找」那种做法：同一个词在文中出现多次时，全文查找
	 * 只能命中第一次出现的位置，取回来的会是别处的上下文。这里直接用选区的
	 * DOM Range 取前后文字，锚定的是用户实际选中的那一处。
	 *
	 * PDF 文字层可能在外层阅读器文档里，也可能在它嵌的 iframe 里，两个都试。
	 * 选择器和 Zotero 自己的 setTextLayerSelection 保持一致。
	 */
	captureLocalContext(event) {
		var wins = this.candidateWindows(event);
		for (var i = 0; i < wins.length; i++) {
			try {
				var captured = this.captureFromWindow(wins[i]);
				if (captured) {
					return captured;
				}
			}
			catch (e) {
				// 这个窗口不是文字层，换下一个
			}
		}
		DeepSeekTranslate.log('没有找到可用的文字层，退回按全文定位');
		return null;
	},

	/** 可能承载文字层的窗口，按可能性排列 */
	candidateWindows(event) {
		var wins = [];
		var add = function (win) {
			try {
				if (win && win.document && wins.indexOf(win) < 0) {
					wins.push(win);
				}
			}
			catch (e) {
				// 跨域访问会抛，忽略
			}
		};
		var reader = event.reader;
		add(event.doc && event.doc.defaultView);
		add(reader && reader._iframeWindow);
		try {
			var internal = reader && reader._internalReader;
			add(internal && internal._primaryView && internal._primaryView._iframeWindow);
			add(internal && internal._secondaryView && internal._secondaryView._iframeWindow);
		}
		catch (e) {
			// 内部结构变了也不影响其他候选
		}
		try {
			var frames = event.doc ? event.doc.querySelectorAll('iframe') : [];
			for (var i = 0; i < frames.length; i++) {
				add(frames[i].contentWindow);
			}
		}
		catch (e) {
			// 同上
		}
		return wins;
	},

	/** 在某个窗口里取一次。选区不在文字层里就返回 null */
	captureFromWindow(win) {
		var doc = win.document;
		var selection = win.getSelection ? win.getSelection() : null;
		if (!selection || !selection.rangeCount) {
			return null;
		}
		var range = selection.getRangeAt(0);
		if (range.collapsed) {
			return null;
		}

		var startNode = range.startContainer;
		var startEl = startNode.nodeType === 1 ? startNode : startNode.parentElement;
		if (!startEl || !startEl.closest) {
			return null;
		}
		// PDF 阅读器每页有 data-page-number；EPUB 没有页码，用所在章节或整页当容器
		var pageEl = startEl.closest('[data-page-number]');
		var pageNumber = 0;
		var container = null;
		if (pageEl) {
			container = pageEl.querySelector('.textLayer') || pageEl;
			pageNumber = parseInt(pageEl.getAttribute('data-page-number'), 10) || 0;
		}
		else {
			container = startEl.closest('section')
				|| startEl.closest('article')
				|| startEl.closest('body')
				|| doc.body;
			if (!container) {
				return null;
			}
		}

		var before = this.textUpTo(doc, container, range.startContainer, range.startOffset);
		var after = this.textFrom(doc, container, range.endContainer, range.endOffset);

		// 选区贴着页首或页尾时上下文会很短，从相邻页各补一段
		if (pageNumber) {
			if (before.length < 400) {
				before = this.neighbourPageText(doc, pageNumber - 1, 'tail', 800) + before;
			}
			if (after.length < 400) {
				after = after + this.neighbourPageText(doc, pageNumber + 1, 'head', 800);
			}
		}

		return {
			before: before,
			selected: range.toString(),
			after: after,
		};
	},

	/** 容器开头到指定位置之间的文字 */
	textUpTo(doc, container, node, offset) {
		var range = doc.createRange();
		range.setStart(container, 0);
		try {
			range.setEnd(node, offset);
		}
		catch (e) {
			return '';
		}
		return range.toString();
	},

	/** 指定位置到容器结尾之间的文字 */
	textFrom(doc, container, node, offset) {
		var range = doc.createRange();
		try {
			range.setStart(node, offset);
		}
		catch (e) {
			return '';
		}
		range.setEnd(container, container.childNodes.length);
		return range.toString();
	},

	/** 相邻页的文字，只取靠边的 limit 个字符 */
	neighbourPageText(doc, pageNumber, side, limit) {
		if (pageNumber < 1) {
			return '';
		}
		var el = doc.querySelector('[data-page-number="' + pageNumber + '"] .textLayer');
		if (!el) {
			return '';
		}
		var text = el.textContent || '';
		if (text.length <= limit) {
			return text;
		}
		return side === 'tail' ? text.slice(text.length - limit) : text.slice(0, limit);
	},

	el(doc, tag, className, text) {
		return DeepSeekTranslate.render.el(doc, tag, className, text);
	},
};
