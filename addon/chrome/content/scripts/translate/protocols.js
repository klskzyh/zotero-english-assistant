/* 三套对话协议的实现：拼地址、拼请求、解析回复与模型列表。
 *
 * 这里全是纯函数，不发网络请求。api.js 把这里造出来的 url / headers / body
 * 交给 Zotero.HTTP.request。分开写是为了能离线自测：沙箱里没有 Zotero，
 * 但这些函数可以直接调用、逐字符比对。
 *
 * 三套协议的差别只在三处：请求地址、认证头、回复里正文的位置。
 * PROTOCOLS 把每一套收成三个函数（chatRequest、parseChat、modelsRequest），
 * 服务商预设 PRESETS 只引用协议名与默认地址，所以加一家「OpenAI 兼容」的服务
 * 只要往 PRESETS 里加一行，不用碰请求代码。
 */

DeepSeekTranslate.protocols = (function () {
	var DEFAULT_BASE_URL = 'https://api.deepseek.com';
	var DEFAULT_MODEL = 'deepseek-chat';
	var ANTHROPIC_VERSION = '2023-06-01';

	/* ── 小工具 ─────────────────────────────────────────── */

	function fail(code, message) {
		var e = new Error(message);
		e.code = code;
		return e;
	}

	function text(value) {
		return String(value == null ? '' : value).trim();
	}

	function brief(value, limit) {
		var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
		var max = limit || 200;
		return s.length > max ? s.slice(0, max) + '…' : s;
	}

	/** 拼地址：去掉 base 末尾与 path 开头的斜杠，不会拼出 //。
	 *  base 里已经含这段路径时原样返回——有人会把完整接口地址填进服务地址。 */
	function joinUrl(base, path) {
		var b = text(base).replace(/\/+$/, '');
		var p = text(path).replace(/^\/+/, '');
		if (!b) {
			return '';
		}
		if (!p) {
			return b;
		}
		if (b === p || b.slice(-(p.length + 1)) === '/' + p) {
			return b;
		}
		return b + '/' + p;
	}

	function withQuery(url, name, value) {
		var sep = url.indexOf('?') >= 0 ? '&' : '?';
		return url + sep + encodeURIComponent(name) + '=' + encodeURIComponent(value);
	}

	/** 本机服务通常不校验 Key：Ollama 与 LM Studio 不填也能用 */
	function isLocal(baseURL) {
		var host = text(baseURL).replace(/^https?:\/\//i, '');
		return /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(host);
	}

	function needsKey(baseURL) {
		return !isLocal(baseURL);
	}

	/** 把 {role, content} 数组拆成「系统提示」与其余轮次。
	 *  openai 把 system 留在 messages 里，另外两套要单独拿出来。 */
	function splitMessages(messages) {
		var list = Array.isArray(messages) ? messages : [];
		var system = [];
		var turns = [];
		for (var i = 0; i < list.length; i++) {
			var m = list[i] || {};
			var content = typeof m.content === 'string' ? m.content : partsText(m.content);
			if (!content) {
				continue;
			}
			if (m.role === 'system') {
				system.push(content);
			}
			else {
				turns.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: content });
			}
		}
		return { system: system.join('\n\n'), messages: turns };
	}

	/** content 是一种多段数组时把文字拼起来 */
	function partsText(content) {
		if (!Array.isArray(content)) {
			return '';
		}
		var out = '';
		for (var i = 0; i < content.length; i++) {
			var part = content[i];
			if (part && typeof part.text === 'string') {
				out += part.text;
			}
		}
		return out;
	}

	/* ── 三套协议 ───────────────────────────────────────── */

	var PROTOCOLS = {
		/* OpenAI 兼容：覆盖大部分服务商，包括 DeepSeek、月之暗面、智谱、
		 * 通义千问、硅基流动、OpenRouter、Groq、Ollama、LM Studio。 */
		openai: {
			key: 'openai',
			label: 'OpenAI 兼容',
			chatRequest: function (opts) {
				var split = splitMessages(opts.messages);
				var list = split.system
					? [{ role: 'system', content: split.system }].concat(split.messages)
					: split.messages;
				var body = {
					model: opts.model,
					messages: list,
					stream: false,
				};
				if (typeof opts.temperature === 'number') {
					body.temperature = opts.temperature;
				}
				if (opts.maxTokens) {
					body.max_tokens = opts.maxTokens;
				}
				// 翻译要的是结构化 JSON，服务端支持时能少一层解析失败
				if (opts.json !== false) {
					body.response_format = { type: 'json_object' };
				}
				var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
				if (opts.apiKey) {
					headers.Authorization = 'Bearer ' + opts.apiKey;
				}
				return {
					url: joinUrl(opts.baseURL, 'chat/completions'),
					headers: headers,
					body: body,
				};
			},
			parseChat: function (json) {
				var choices = json && Array.isArray(json.choices) ? json.choices : [];
				var choice = choices[0] || {};
				var message = choice.message || {};
				// 推理型模型（deepseek-v4 之类）会先往 reasoning_content 里写思考，
				// 额度用完时 content 是空的。这两个字段拿上来，调用方才说得清失败原因。
				var reasoning = typeof message.reasoning_content === 'string'
					? message.reasoning_content
					: (typeof message.reasoning === 'string' ? message.reasoning : '');
				return {
					content: typeof message.content === 'string'
						? message.content
						: partsText(message.content),
					model: (json && json.model) || '',
					usage: (json && json.usage) || null,
					finishReason: choice.finish_reason || '',
					reasoningChars: reasoning.length,
				};
			},
			modelsRequest: function (opts) {
				var headers = { 'Accept': 'application/json' };
				if (opts.apiKey) {
					headers.Authorization = 'Bearer ' + opts.apiKey;
				}
				return { url: joinUrl(opts.baseURL, 'models'), headers: headers };
			},
		},

		/* Anthropic：系统提示单独一个字段，max_tokens 必填，鉴权走 x-api-key。
		 * 不用 Authorization 头，与 openai 正好相反。 */
		anthropic: {
			key: 'anthropic',
			label: 'Anthropic',
			chatRequest: function (opts) {
				var split = splitMessages(opts.messages);
				var body = {
					model: opts.model,
					// Anthropic 硬性要求这个字段，缺了直接 400
					max_tokens: opts.maxTokens || 1024,
					messages: split.messages.length
						? split.messages
						: [{ role: 'user', content: 'ping' }],
				};
				if (split.system) {
					body.system = split.system;
				}
				if (typeof opts.temperature === 'number') {
					body.temperature = opts.temperature;
				}
				return {
					url: joinUrl(opts.baseURL, 'v1/messages'),
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': opts.apiKey || '',
						'anthropic-version': ANTHROPIC_VERSION,
					},
					body: body,
				};
			},
			parseChat: function (json) {
				var blocks = json && Array.isArray(json.content) ? json.content : [];
				var out = '';
				for (var i = 0; i < blocks.length; i++) {
					var block = blocks[i] || {};
					// 只有 type 为 text 的块是正文；thinking 之类的跳过
					if (block.type === 'text' && typeof block.text === 'string') {
						out += block.text;
					}
				}
				return {
					content: out,
					model: (json && json.model) || '',
					usage: (json && json.usage) || null,
				};
			},
			modelsRequest: function (opts) {
				return {
					url: joinUrl(opts.baseURL, 'v1/models'),
					headers: {
						'Accept': 'application/json',
						'x-api-key': opts.apiKey || '',
						'anthropic-version': ANTHROPIC_VERSION,
					},
				};
			},
		},

		/* Gemini：模型名在路径里，Key 在查询串里，系统提示是 systemInstruction，
		 * 回复在 candidates[0].content.parts[].text。 */
		gemini: {
			key: 'gemini',
			label: 'Google Gemini',
			chatRequest: function (opts) {
				var split = splitMessages(opts.messages);
				var contents = [];
				for (var i = 0; i < split.messages.length; i++) {
					var m = split.messages[i];
					contents.push({
						// 在这套协议里模型自己的发言叫 model
						role: m.role === 'assistant' ? 'model' : 'user',
						parts: [{ text: m.content }],
					});
				}
				var body = { contents: contents };
				if (split.system) {
					body.systemInstruction = { parts: [{ text: split.system }] };
				}
				var generation = {};
				if (typeof opts.temperature === 'number') {
					generation.temperature = opts.temperature;
				}
				if (opts.maxTokens) {
					generation.maxOutputTokens = opts.maxTokens;
				}
				if (opts.json !== false) {
					generation.responseMimeType = 'application/json';
				}
				if (Object.keys(generation).length) {
					body.generationConfig = generation;
				}
				var model = text(opts.model).replace(/^models\//, '');
				var url = joinUrl(opts.baseURL, 'v1beta/models/' + model + ':generateContent');
				return {
					url: withQuery(url, 'key', opts.apiKey || ''),
					headers: { 'Content-Type': 'application/json' },
					body: body,
				};
			},
			parseChat: function (json) {
				var candidates = json && Array.isArray(json.candidates) ? json.candidates : [];
				var first = candidates[0] || {};
				var parts = first.content && Array.isArray(first.content.parts)
					? first.content.parts
					: [];
				var out = '';
				for (var i = 0; i < parts.length; i++) {
					var part = parts[i] || {};
					// 带 thought 标记的是思考过程，不算正文
					if (part.thought) {
						continue;
					}
					if (typeof part.text === 'string') {
						out += part.text;
					}
				}
				return {
					content: out,
					model: (json && json.modelVersion) || '',
					usage: (json && json.usageMetadata) || null,
				};
			},
			modelsRequest: function (opts) {
				var url = joinUrl(opts.baseURL, 'v1beta/models');
				return {
					url: withQuery(url, 'key', opts.apiKey || ''),
					headers: { 'Accept': 'application/json' },
				};
			},
		},
	};

	/* ── 服务商预设 ─────────────────────────────────────── */

	/* baseURL 不带结尾斜杠，也不带 /chat/completions 这类尾段：
	 * 那一段由协议自己拼，用户改成中转地址时也不用跟着改。 */
	var PRESETS = [
		{ key: 'deepseek', label: 'DeepSeek（深度求索）', protocol: 'openai', baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
		{ key: 'openai', label: 'OpenAI', protocol: 'openai', baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
		{ key: 'moonshot', label: '月之暗面 Kimi', protocol: 'openai', baseURL: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
		{ key: 'zhipu', label: '智谱 GLM', protocol: 'openai', baseURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
		{ key: 'dashscope', label: '通义千问（阿里云）', protocol: 'openai', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
		{ key: 'siliconflow', label: '硅基流动', protocol: 'openai', baseURL: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen2.5-7B-Instruct' },
		{ key: 'openrouter', label: 'OpenRouter', protocol: 'openai', baseURL: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini' },
		{ key: 'groq', label: 'Groq', protocol: 'openai', baseURL: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
		{ key: 'ollama', label: 'Ollama（本机）', protocol: 'openai', baseURL: 'http://localhost:11434/v1', defaultModel: 'llama3.2' },
		{ key: 'lmstudio', label: 'LM Studio（本机）', protocol: 'openai', baseURL: 'http://localhost:1234/v1', defaultModel: 'local-model' },
		{ key: 'anthropic', label: 'Anthropic Claude', protocol: 'anthropic', baseURL: 'https://api.anthropic.com', defaultModel: 'claude-3-5-sonnet-latest' },
		{ key: 'gemini', label: 'Google Gemini', protocol: 'gemini', baseURL: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.0-flash' },
		{ key: 'custom', label: '自定义', protocol: 'openai', baseURL: '', defaultModel: '' },
	];

	function presetOf(key) {
		var want = text(key);
		for (var i = 0; i < PRESETS.length; i++) {
			if (PRESETS[i].key === want) {
				return PRESETS[i];
			}
		}
		return null;
	}

	function normalizeProtocol(name) {
		var want = text(name);
		return Object.prototype.hasOwnProperty.call(PROTOCOLS, want) ? want : 'openai';
	}

	/* 把 prefs 里读到的四项算成实际要用的协议、地址与模型。
	 *
	 * 兼容老配置：1.12.0 之前没有 provider 这个键，provider 为空时按
	 * 「自定义 + openai」处理；地址为空时回落到 DeepSeek 的官方地址。
	 * 拿不准的 provider 值同样当自定义，避免整块翻译不可用。 */
	function resolve(input) {
		var raw = input || {};
		var provider = text(raw.provider);
		var protocol = text(raw.protocol);
		var baseURL = text(raw.baseURL);
		var model = text(raw.model);
		var preset = provider ? presetOf(provider) : null;

		if (!preset || preset.key === 'custom') {
			return {
				provider: 'custom',
				label: '自定义',
				protocol: normalizeProtocol(protocol),
				baseURL: baseURL || DEFAULT_BASE_URL,
				model: model || DEFAULT_MODEL,
			};
		}
		return {
			provider: preset.key,
			label: preset.label,
			protocol: normalizeProtocol(preset.protocol),
			baseURL: baseURL || preset.baseURL || DEFAULT_BASE_URL,
			model: model || preset.defaultModel || DEFAULT_MODEL,
		};
	}

	/* ── 请求与解析 ─────────────────────────────────────── */

	/** 造一次对话请求。返回 { url, headers, body }，body 是对象，发之前再转字符串。 */
	function buildChatRequest(protocol, options) {
		var opts = options || {};
		var baseURL = text(opts.baseURL);
		var apiKey = text(opts.apiKey);
		var model = text(opts.model) || DEFAULT_MODEL;
		var name = normalizeProtocol(protocol);

		if (!baseURL) {
			throw fail('NO_BASE_URL', '还没有填写服务地址。在设置里选一个服务商，或手动填入接口地址。');
		}
		if (!apiKey && needsKey(baseURL)) {
			throw fail('NO_API_KEY', '还没有填写 API Key。本机服务（Ollama、LM Studio）不用填，其它服务商要先申请一个。');
		}
		if (!Array.isArray(opts.messages) || !opts.messages.length) {
			throw fail('NO_MESSAGES', '没有要发送的内容：messages 是空的。');
		}

		return PROTOCOLS[name].chatRequest({
			baseURL: baseURL,
			apiKey: apiKey,
			model: model,
			messages: opts.messages,
			temperature: typeof opts.temperature === 'number' ? opts.temperature : undefined,
			maxTokens: typeof opts.maxTokens === 'number' ? opts.maxTokens : undefined,
			json: opts.json !== false,
		});
	}

	/** 造一次「列出模型」请求。返回 { url, headers }。
	 *  注意各家地址不同：openai 是 /models，anthropic 是 /v1/models，gemini 是
	 *  /v1beta/models 且 Key 放在查询串里。 */
	function buildModelsRequest(protocol, options) {
		var opts = options || {};
		var baseURL = text(opts.baseURL);
		var apiKey = text(opts.apiKey);
		var name = normalizeProtocol(protocol);

		if (!baseURL) {
			throw fail('NO_BASE_URL', '还没有填写服务地址。');
		}
		if (!apiKey && needsKey(baseURL)) {
			throw fail('NO_API_KEY', '还没有填写 API Key，读不到模型列表。');
		}
		return PROTOCOLS[name].modelsRequest({ baseURL: baseURL, apiKey: apiKey });
	}

	/** 从回复里取出正文、模型名与用量。
	 *  正文可能为空（被截断、被安全策略拦下），这里如实返回空串，
	 *  由 api.js 决定报什么错。 */
	function parseChatReply(protocol, json) {
		var name = normalizeProtocol(protocol);
		if (!json || typeof json !== 'object') {
			throw fail('BAD_REPLY', '服务返回的内容不是 JSON：' + brief(json));
		}
		if (json.error) {
			throw fail('API_ERROR', describeApiError(json.error));
		}
		var parsed = PROTOCOLS[name].parseChat(json);
		return {
			content: parsed.content || '',
			model: parsed.model || '',
			usage: parsed.usage || null,
			finishReason: parsed.finishReason || '',
			reasoningChars: parsed.reasoningChars || 0,
		};
	}

	/** 模型列表统一成 [{ id, label }]，三种形状都认：
	 *  openai 的 { data: [...] } 或裸数组、anthropic 的 { data: [...] }、gemini 的
	 *  { models: [{ name: "models/xxx", displayName }] }。gemini 的 name 要去掉
	 *  models/ 前缀，否则拿它发请求会拼成 models/models/xxx。 */
	function normalizeModels(protocol, json) {
		normalizeProtocol(protocol);
		var list = modelList(json);
		var out = [];
		var seen = {};
		for (var i = 0; i < list.length; i++) {
			var raw = list[i];
			var id = '';
			var label = '';
			if (typeof raw === 'string') {
				id = text(raw);
			}
			else if (raw && typeof raw === 'object') {
				id = text(raw.id || raw.name || raw.model);
				label = text(raw.display_name || raw.displayName || raw.label);
			}
			id = id.replace(/^models\//, '');
			if (!id || seen[id]) {
				continue;
			}
			seen[id] = true;
			out.push({ id: id, label: label || id });
		}
		return out;
	}

	function modelList(json) {
		if (Array.isArray(json)) {
			return json;
		}
		if (!json || typeof json !== 'object') {
			return [];
		}
		var keys = ['data', 'models', 'items'];
		for (var i = 0; i < keys.length; i++) {
			if (Array.isArray(json[keys[i]])) {
				return json[keys[i]];
			}
		}
		return [];
	}

	/** 读到模型列表之后该选哪一个：保存的那个还在列表里就用它，否则用第一个。 */
	function pickModel(models, saved) {
		var list = Array.isArray(models) ? models : [];
		var want = text(saved);
		for (var i = 0; i < list.length; i++) {
			if (list[i] && list[i].id === want) {
				return want;
			}
		}
		return list.length ? list[0].id : '';
	}

	/** 服务在 200 里回一个错误对象时，把里面的话抽出来 */
	function describeApiError(error) {
		if (typeof error === 'string') {
			return error;
		}
		var message = text(error && (error.message || error.msg || error.detail));
		var hint = text(error && error.code);
		if (message) {
			return message;
		}
		if (hint && !/^-?\d+$/.test(hint)) {
			return '接口报错：' + hint;
		}
		return '接口返回了一个错误：' + brief(JSON.stringify(error));
	}

	return {
		DEFAULT_BASE_URL: DEFAULT_BASE_URL,
		DEFAULT_MODEL: DEFAULT_MODEL,
		ANTHROPIC_VERSION: ANTHROPIC_VERSION,
		PROTOCOLS: PROTOCOLS,
		PRESETS: PRESETS,
		joinUrl: joinUrl,
		isLocal: isLocal,
		needsKey: needsKey,
		presetOf: presetOf,
		normalizeProtocol: normalizeProtocol,
		resolve: resolve,
		buildChatRequest: buildChatRequest,
		buildModelsRequest: buildModelsRequest,
		parseChatReply: parseChatReply,
		normalizeModels: normalizeModels,
		pickModel: pickModel,
		brief: brief,
	};
})();
