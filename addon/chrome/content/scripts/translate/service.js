/* 翻译流程的调度：取上下文 → 组提示词 → 调接口 → 解析 → 存档 → 刷新面板。 */

DeepSeekTranslate.service = {
	/**
	 * 翻译一段选中文字。
	 * @param {Object} req
	 * @param {number} req.attachmentID - PDF 附件 itemID
	 * @param {string} req.text - 选中的文字
	 * @param {string} [req.pageLabel] - 形如「第 12 页」
	 */
	async translate(req) {
		var D = DeepSeekTranslate;
		var attachmentID = req.attachmentID;
		var text = (req.text || '').trim();

		if (!attachmentID) {
			throw new Error('没有定位到 PDF 附件');
		}
		if (!text) {
			throw new Error('选中内容为空');
		}

		if (D.state.inflight.has(attachmentID)) {
			D.log('该附件已有翻译在进行，忽略这次请求');
			return null;
		}

		// 记下这次的选择，失败重试时要用
		D.state.selection.set(attachmentID, {
			text: text,
			pageLabel: req.pageLabel || '',
			localContext: req.localContext || null,
			at: new Date(),
		});

		var pending = {
			status: 'loading',
			text: text.length > 120 ? text.slice(0, 120) + '…' : text,
		};
		D.state.pending.set(attachmentID, pending);
		D.refreshPanels(attachmentID);

		var task = this._run(attachmentID, text, req.pageLabel, req.localContext)
			.catch(function (e) {
				// _run 内部已经处理过错误，这里只兜底，避免未捕获的 rejection
				D.logError('翻译流程异常', e);
				return null;
			})
			.then(function (entry) {
				D.state.inflight.delete(attachmentID);
				return entry;
			});

		D.state.inflight.set(attachmentID, task);
		return task;
	},

	/** 用上次的选区重试 */
	retry(attachmentID) {
		var D = DeepSeekTranslate;
		var selection = D.state.selection.get(attachmentID);
		if (!selection) {
			D.state.pending.delete(attachmentID);
			D.refreshPanels(attachmentID);
			return Promise.resolve(null);
		}
		D.state.pending.delete(attachmentID);
		return this.translate({
			attachmentID: attachmentID,
			text: selection.text,
			pageLabel: selection.pageLabel,
			localContext: selection.localContext,
		});
	},

	async _run(attachmentID, text, pageLabel, localContext) {
		var D = DeepSeekTranslate;
		var entry = {
			id: Zotero.Utilities.randomString(8),
			at: new Date(),
			text: text,
			pageLabel: pageLabel || '',
			data: null,
			model: '',
			usage: null,
			error: null,
			contextNote: '',
			contextText: '',
		};

		try {
			var attachment = await Zotero.Items.getAsync(attachmentID);
			if (!attachment) {
				throw new Error('附件已不存在');
			}

			var context = null;
			if (D.prefBool('includeContext', true)) {
				context = await D.context.buildContext(attachment, text, pageLabel, localContext);
			}

			var metadata = D.prefBool('includeMetadata', true)
				? D.context.buildMetadata(attachment)
				: null;

			entry.contextNote = this._contextNote(context);
			entry.contextText = this._contextPreview(context, text);

			var messages = D.prompts.buildMessages({
				text: text,
				context: context,
				metadata: metadata,
				pageLabel: pageLabel,
			});

			var result = await D.api.chat(messages, { json: true });
			entry.model = result.model || '';
			entry.usage = result.usage || null;

			var parsed = this.parse(result.content);
			if (parsed) {
				entry.data = parsed;
			}
			else {
				// 模型没给 JSON 时，把正文当译文展示，至少不丢内容
				entry.data = { type: 'sentence', translation: result.content.trim() };
				entry.contextNote = (entry.contextNote ? entry.contextNote + ' · ' : '') + '返回格式异常，已按原文展示';
			}

			// 本书词次，显示在词条那一行右侧。拿不到就不显示，绝不能影响翻译本身
			try {
				entry.count = await D.counts.forEntry(attachment, entry);
			}
			catch (e) {
				D.log('[词次] 计算失败：' + ((e && e.message) || e));
			}
		}
		catch (e) {
			entry.error = (e && e.message) ? e.message : String(e);
			D.logError('翻译失败', e);
		}

		D.state.pending.delete(attachmentID);
		D.pushHistory(attachmentID, entry);
		D.refreshPanels(attachmentID);
		return entry;
	},

	parse(content) {
		var D = DeepSeekTranslate;
		var text = D.prompts.stripCodeFence(content);
		if (!text) {
			return null;
		}
		try {
			return JSON.parse(text);
		}
		catch (e) {
			// 有时前后会多出解释文字，截取最外层的大括号再试
		}
		var start = text.indexOf('{');
		var end = text.lastIndexOf('}');
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(text.slice(start, end + 1));
			}
			catch (e) {
				return null;
			}
		}
		return null;
	},

	_contextNote(context) {
		if (!context) {
			return '未使用上下文';
		}
		if (!context.available) {
			return '无全文索引';
		}
		if (context.source === 'selection') {
			return '已取选中处上下文';
		}
		if (context.matched) {
			return '按全文定位上下文';
		}
		return '未定位到上下文';
	},

	/** 面板里给用户核对用：把实际送出去的上下文拼回可读形式 */
	_contextPreview(context, text) {
		if (!context) {
			return '';
		}
		if (!context.available) {
			return context.reason || '无法取得原文上下文';
		}
		if (context.matched) {
			return context.before + '⟦' + context.selected + '⟧' + context.after;
		}
		return (context.reason || '') + '\n\n' + (context.text || '');
	},
};
