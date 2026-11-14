/* 翻译用的对话接口，按设置里的服务商与协议发请求。
 *
 * 拼地址、拼 body、解析回复这些纯逻辑都在 protocols.js 里；这里只负责三件事：
 *   1. 读设置，算出实际要用的协议、地址、模型；没有 Key 时给出可读的报错
 *   2. 把 { url, headers, body } 接到 Zotero.HTTP.request 上
 *   3. 统一处理超时、非 2xx 状态码与 JSON 解析失败
 *
 * 对外保持 chat(messages, opts) 这个签名不变，service.js 与 wordbook.js 都按它调用，
 * 换协议不需要改调用方。
 */

DeepSeekTranslate.api = {
	/** 把 prefs 里的设置算成「实际要用的协议 / 地址 / 模型」。
	 *  overrides 用于设置面板：用户改了输入框还没保存时，也能先试一次。 */
	settings(overrides) {
		var D = DeepSeekTranslate;
		var raw = {
			provider: D.prefString('provider', 'deepseek'),
			protocol: D.prefString('protocol', 'openai'),
			baseURL: D.prefString('baseURL', D.protocols.DEFAULT_BASE_URL),
			model: D.prefString('model', ''),
		};
		var o = overrides || {};
		var keys = ['provider', 'protocol', 'baseURL', 'model'];
		for (var i = 0; i < keys.length; i++) {
			if (o[keys[i]] !== undefined && o[keys[i]] !== null) {
				raw[keys[i]] = o[keys[i]];
			}
		}
		var resolved = D.protocols.resolve(raw);
		resolved.apiKey = (o.apiKey !== undefined && o.apiKey !== null
			? String(o.apiKey)
			: D.apiKey()).trim();
		return resolved;
	},

	/**
	 * 发一次对话，返回 { content, model, usage, raw }。
	 * @param {Array<{role: string, content: string}>} messages
	 * @param {{json?: boolean, temperature?: number, maxTokens?: number,
	 *          timeoutMs?: number, provider?: string, protocol?: string,
	 *          baseURL?: string, apiKey?: string, model?: string}} [opts]
	 * @returns {Promise<{content: string, model: string, usage: Object, raw: Object}>}
	 */
	async chat(messages, opts) {
		var D = DeepSeekTranslate;
		var options = opts || {};
		var settings = this.settings(options);
		var temperature = this._number(options.temperature, D.prefString('temperature', '0.3'), 0.3);
		var maxTokens = this._number(options.maxTokens, D.prefInt('maxTokens', 2048), 2048);
		var timeoutMs = this._number(options.timeoutMs, D.prefInt('timeoutMs', 90000), 90000);

		var attempt = async (budget) => {
			var req = D.protocols.buildChatRequest(settings.protocol, {
				baseURL: settings.baseURL,
				apiKey: settings.apiKey,
				model: settings.model,
				messages: messages,
				temperature: temperature,
				maxTokens: budget,
				json: options.json !== false,
			});
			var res = await this._request('POST', req, timeoutMs);
			var data = this._readResponse(res);
			var parsed = D.protocols.parseChatReply(settings.protocol, data);
			return {
				parsed: parsed,
				content: (parsed.content || '').trim(),
				raw: data,
				budget: budget,
			};
		};

		var first = await attempt(maxTokens);
		if (first.content) {
			return {
				content: first.content,
				model: first.parsed.model || settings.model,
				usage: first.parsed.usage || null,
				raw: first.raw,
			};
		}

		// 空内容 + 额度用尽：推理型模型把预算花在思考上了（reasoning_content 有字、
		// content 是空的），中文模式要写完整词条时最容易撞上。加倍额度重试一次。
		var spentOnThinking = first.parsed.finishReason === 'length'
			|| (first.parsed.reasoningChars || 0) > 0;
		if (spentOnThinking && first.budget < 8192) {
			var bigger = Math.min(first.budget * 2, 8192);
			D.log('上一次返回是空的（finish_reason=' + (first.parsed.finishReason || '空')
				+ '，思考 ' + (first.parsed.reasoningChars || 0) + ' 字），把上限从 '
				+ first.budget + ' 提到 ' + bigger + ' 再试一次');
			var second = await attempt(bigger);
			if (second.content) {
				return {
					content: second.content,
					model: second.parsed.model || settings.model,
					usage: second.parsed.usage || null,
					raw: second.raw,
				};
			}
		}

		if (spentOnThinking) {
			throw this._error(
				'EMPTY_RESPONSE',
				'服务返回了空内容（' + (settings.label || '接口') + ' · ' + settings.model + '）。'
				+ '这个模型把额度花在思考上了：思考写了 '
				+ (first.parsed.reasoningChars || 0) + ' 字，正式回答没剩空间，'
				+ '加倍到 ' + first.budget * 2 + ' 之后仍然是这样。'
				+ '把最大输出调大，或者换一个不「先想再答」的模型。'
			);
		}
		throw this._error(
			'EMPTY_RESPONSE',
			'服务返回了空内容（' + (settings.label || '接口') + ' · ' + settings.model + '）。'
			+ '常见原因是模型名不对、额度用完，或这个模型不支持 JSON 输出。'
		);
	},

	/** 用一句很短的话验证能不能通。设置面板的「测试连接」用它。 */
	async testConnection(overrides) {
		var o = overrides || {};
		var opts = { json: false, maxTokens: 64, temperature: 0 };
		var keys = ['provider', 'protocol', 'baseURL', 'apiKey', 'model'];
		for (var i = 0; i < keys.length; i++) {
			if (o[keys[i]] !== undefined && o[keys[i]] !== null) {
				opts[keys[i]] = o[keys[i]];
			}
		}
		return this.chat([
			{ role: 'system', content: '你只需要回答确认信息。' },
			{ role: 'user', content: '请回复两个字：可用' },
		], opts);
	},

	/** 读服务商的模型列表，返回 [{ id, label }]。超时 8 秒。 */
	async listModels(overrides) {
		var D = DeepSeekTranslate;
		var settings = this.settings(overrides);
		var req = D.protocols.buildModelsRequest(settings.protocol, {
			baseURL: settings.baseURL,
			apiKey: settings.apiKey,
		});

		var res = await this._request('GET', req, 8000);
		var data = this._readResponse(res);
		var models = D.protocols.normalizeModels(settings.protocol, data);
		if (!models.length) {
			throw this._error(
				'NO_MODELS',
				'接口通了，但没有返回可用的模型列表（' + settings.baseURL + '）。'
				+ '这家服务可能不提供 /models，直接在设置里手填模型名就行。'
			);
		}
		return models;
	},

	/* ── 请求与错误处理 ─────────────────────────────────── */

	async _request(method, req, timeoutMs) {
		var options = {
			headers: req.headers,
			responseType: 'text',
			timeout: timeoutMs,
			// 状态码由我们自己看，否则 401 这类错误拿不到响应正文里的说明
			successCodes: false,
		};
		if (req.body !== undefined) {
			options.body = JSON.stringify(req.body);
		}
		try {
			return await Zotero.HTTP.request(method, req.url, options);
		}
		catch (e) {
			throw this._wrapNetworkError(e, req.url, timeoutMs);
		}
	},

	/** 非 2xx 抛可读的错误；2xx 返回解析好的 JSON */
	_readResponse(res) {
		var status = res && typeof res.status === 'number' ? res.status : 0;
		var body = this._textOf(res);
		if (status && (status < 200 || status >= 300)) {
			throw this._error('HTTP_' + status, this._describeStatus(status, body));
		}
		try {
			return JSON.parse(body);
		}
		catch (e) {
			throw this._error(
				'BAD_JSON',
				'服务返回的不是 JSON（HTTP ' + (status || '?') + '）：' + this._briefOf(body)
			);
		}
	},

	_textOf(res) {
		if (!res) {
			return '';
		}
		if (typeof res.response === 'string') {
			return res.response;
		}
		if (typeof res.responseText === 'string') {
			return res.responseText;
		}
		return '';
	},

	_wrapNetworkError(e, url, timeoutMs) {
		var message = String((e && e.message) || e || '');
		var xhr = e && e.xmlhttp;
		var status = (e && e.status) || (xhr && xhr.status);
		if (status) {
			return this._error('HTTP_' + status, this._describeStatus(status, this._textOf(xhr)));
		}
		if (/timeout|timed out|time out|超时/i.test(message)) {
			var seconds = Math.round((timeoutMs || 90000) / 1000);
			return this._error(
				'TIMEOUT',
				'请求超时：' + seconds + ' 秒内没有回应。检查网络与代理，或换一个服务地址。'
			);
		}
		if (DeepSeekTranslate.protocols.isLocal(url)) {
			return this._error(
				'NETWORK',
				'连不上本机服务（' + url + '）。确认 Ollama 或 LM Studio 已经启动，端口没被占用。'
			);
		}
		return this._error('NETWORK', '网络请求失败：' + (message || '没有拿到回应'));
	},

	/** 常见状态码翻译成人话，后面接服务自己给的说明，截到 200 字 */
	_describeStatus(status, body) {
		var known = {
			400: '请求格式不对（400），也可能是模型名或服务商不支持。',
			401: 'API Key 无效或已失效（401）。',
			402: '账户余额不足（402）。',
			403: '没有权限（403）：Key 可能没开通这个模型。',
			404: '接口地址不存在（404），检查设置里的服务地址。',
			413: '请求内容太大（413），把上下文长度调小再试。',
			422: '参数不被接受（422），多半是模型名不对。',
			429: '请求太频繁或额度用完了（429），等一会儿再试。',
			500: '服务端出错（500），稍后重试。',
			502: '网关错误（502），稍后重试。',
			503: '服务暂时不可用（503），稍后重试。',
			504: '网关超时（504），稍后重试。',
		};
		var head = known[status];
		if (!head && status >= 500) {
			head = '服务端出错（' + status + '），稍后重试。';
		}
		var detail = this._briefOf(this._extractApiMessage(body));
		if (head) {
			return detail ? head + ' ' + detail : head;
		}
		return '请求失败（HTTP ' + status + '）：' + (detail || '服务没有给出说明');
	},

	/** 从错误响应体里抽出一句能看的话，三种协议的形状都照顾到 */
	_extractApiMessage(body) {
		var raw = String(body == null ? '' : body);
		if (!raw) {
			return '';
		}
		try {
			var data = JSON.parse(raw);
			var error = (data && data.error) || data;
			if (typeof error === 'string') {
				return error;
			}
			if (error && typeof error === 'object') {
				return String(error.message || error.msg || error.detail || error.code || '');
			}
		}
		catch (e) {
			// 不是 JSON，整段当说明
		}
		return raw;
	},

	_briefOf(value, limit) {
		var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
		var max = limit || 200;
		return s.length > max ? s.slice(0, max) + '…' : s;
	},

	_error(code, message) {
		var e = new Error(message);
		e.code = code;
		return e;
	},

	/** 取数字：先看传入值，再看设置里的字符串，最后用兜底 */
	_number(value, fallbackValue, fallback) {
		var n = typeof value === 'number' ? value : parseFloat(value);
		if (!isNaN(n)) {
			return n;
		}
		var f = typeof fallbackValue === 'number' ? fallbackValue : parseFloat(fallbackValue);
		return isNaN(f) ? fallback : f;
	},
};
