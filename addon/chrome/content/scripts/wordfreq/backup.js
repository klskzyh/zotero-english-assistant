/*
 * 配置备份：把扩展的全部首选项打包成一个 JSON 文件，换机器、重装、分享时整体搬运。
 *
 * 为什么只备份首选项：插件的设置、自定义名单、单词本的排序状态全都在
 * `extensions.englishAssistant.*` 下面（自定义名单是 `wordfreq.userHiddenWords`
 * 这个字符串首选项里的 JSON），所以一份文件就够了，不用去碰 Zotero 的目录。
 *
 * 单词本本身（wordbook.json）属于用户数据，不在这里：它在数据目录里，
 * 单独复制更直观，也不该被「导入设置」顺手覆盖掉。
 */
var WordFreq = WordFreq || {};

WordFreq.backup = (function () {
	var PREFIX = 'extensions.englishAssistant.';
	var FORMAT = 'english-assistant-config';
	var FORMAT_VERSION = 1;

	/* ── 纯逻辑（自测直接调，不碰 Zotero） ─────────────── */

	/** 只留下本插件的键，按名字排序，导出文件读起来顺序稳定 */
	function pickPrefs(map) {
		var out = {};
		Object.keys(map || {}).sort().forEach(function (key) {
			if (key.indexOf(PREFIX) === 0) {
				out[key] = map[key];
			}
		});
		return out;
	}

	/** 组装导出用的对象 */
	function buildBackup(map, meta) {
		var info = meta || {};
		return {
			format: FORMAT,
			version: FORMAT_VERSION,
			exportedAt: info.exportedAt || new Date().toISOString(),
			pluginVersion: info.pluginVersion || '',
			prefs: pickPrefs(map),
		};
	}

	/** 解析导入的文件内容；格式不对时抛出中文原因 */
	function parseBackup(text) {
		var data = null;
		try {
			data = typeof text === 'string' ? JSON.parse(text) : text;
		}
		catch (e) {
			throw new Error('这个文件不是有效的 JSON。');
		}
		if (!data || typeof data !== 'object') {
			throw new Error('这个文件里没有可导入的内容。');
		}
		if (data.format !== FORMAT) {
			throw new Error('这不是「英文助手」导出的配置文件。');
		}
		if (!data.prefs || typeof data.prefs !== 'object') {
			throw new Error('配置文件里没有设置项。');
		}
		return data;
	}

	/** 按目标首选项的类型把值转过去；转不了返回 null，调用方跳过这一项 */
	function coerceValue(type, value) {
		if (type === 'int') {
			var n = Number(value);
			return isFinite(n) ? Math.round(n) : null;
		}
		if (type === 'bool') {
			return value === true || value === 'true' || value === 1;
		}
		if (value === null || value === undefined) {
			return '';
		}
		return String(value);
	}

	/** 导入前给人看的摘要：几项设置、名单里几个词 */
	function summarize(data) {
		var prefs = (data && data.prefs) || {};
		var keys = Object.keys(prefs);
		var words = 0;
		var raw = prefs[PREFIX + 'wordfreq.userHiddenWords'];
		if (typeof raw === 'string') {
			try {
				var list = JSON.parse(raw);
				if (Array.isArray(list)) {
					words = list.length;
				}
			}
			catch (e) {
				words = 0;
			}
		}
		return {
			count: keys.length,
			words: words,
			hasKey: typeof prefs[PREFIX + 'translate.apiKey'] === 'string'
				&& prefs[PREFIX + 'translate.apiKey'] !== '',
		};
	}

	/** 默认文件名：english-assistant-config-20261031-183000.json */
	function fileNameFor(now) {
		var d = now || new Date();
		var pad = function (n) {
			return n < 10 ? '0' + n : String(n);
		};
		return 'english-assistant-config-' + d.getFullYear() + pad(d.getMonth() + 1)
			+ pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes())
			+ pad(d.getSeconds()) + '.json';
	}

	/* ── 与 Zotero 打交道 ─────────────────────────────── */

	function prefTypeName(key) {
		try {
			var type = Services.prefs.getPrefType(key);
			if (type === Services.prefs.PREF_INT) {
				return 'int';
			}
			if (type === Services.prefs.PREF_BOOL) {
				return 'bool';
			}
			if (type === Services.prefs.PREF_STRING) {
				return 'string';
			}
		}
		catch (e) {
			// 读不到当作不存在
		}
		return '';
	}

	/** 把当前所有首选项读成一个普通对象 */
	function collectPrefs() {
		var map = {};
		var names = [];
		try {
			names = Services.prefs.getChildList(PREFIX);
		}
		catch (e) {
			names = [];
		}
		for (var i = 0; i < names.length; i++) {
			var key = names[i];
			var type = prefTypeName(key);
			try {
				if (type === 'int') {
					map[key] = Services.prefs.getIntPref(key);
				}
				else if (type === 'bool') {
					map[key] = Services.prefs.getBoolPref(key);
				}
				else if (type === 'string') {
					map[key] = Services.prefs.getStringPref(key);
				}
			}
			catch (e) {
				// 单个键读不到不影响整体
			}
		}
		return map;
	}

	/** 确认框：优先用 moz 的 prompt，窗口里没有就退回 window.confirm */
	function confirmUi(win, title, text) {
		try {
			var prompt = Services.prompt;
			var parent = win || Zotero.getMainWindow();
			if (prompt && parent) {
				return !!prompt.confirm(parent, title, text);
			}
		}
		catch (e) {
			WordFreq.logError('确认框调用失败，改用 window.confirm', e);
		}
		try {
			return !!(win && win.confirm && win.confirm(text));
		}
		catch (e) {
			return false;
		}
	}

	/** 取文件选择器；Zotero 7+ 只有这一条路能用 */
	function pickerClass() {
		try {
			var mod = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
			if (mod && mod.FilePicker) {
				return mod.FilePicker;
			}
		}
		catch (e) {
			WordFreq.logError('加载文件选择器失败', e);
		}
		return null;
	}

	async function writeText(path, text) {
		try {
			await IOUtils.writeUTF8(path, text);
			return;
		}
		catch (e) {
			WordFreq.logError('IOUtils.writeUTF8 失败，改用 nsIFile', e);
		}
		var file = Components.classes['@mozilla.org/file/local;1']
			.createInstance(Components.interfaces.nsIFile);
		file.initWithPath(path);
		var stream = Components.classes['@mozilla.org/network/file-output-stream;1']
			.createInstance(Components.interfaces.nsIFileOutputStream);
		stream.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);
		var conv = Components.classes['@mozilla.org/intl/converter-output-stream;1']
			.createInstance(Components.interfaces.nsIConverterOutputStream);
		conv.init(stream, 'UTF-8');
		conv.writeString(text);
		conv.close();
	}

	async function readText(path) {
		try {
			return await IOUtils.readUTF8(path);
		}
		catch (e) {
			WordFreq.logError('IOUtils.readUTF8 失败，改用 nsIFile', e);
		}
		var file = Components.classes['@mozilla.org/file/local;1']
			.createInstance(Components.interfaces.nsIFile);
		file.initWithPath(path);
		var stream = Components.classes['@mozilla.org/network/file-input-stream;1']
			.createInstance(Components.interfaces.nsIFileInputStream);
		stream.init(file, 0x01, 0o444, 0);
		var conv = Components.classes['@mozilla.org/intl/converter-input-stream;1']
			.createInstance(Components.interfaces.nsIConverterInputStream);
		conv.init(stream, 'UTF-8', 0, 0);
		var chunk = {};
		var out = '';
		while (conv.readString(4096, chunk) !== 0) {
			out += chunk.value;
		}
		try {
			conv.close();
		}
		catch (e) {
			// 关不掉也不影响已经读到的内容
		}
		return out;
	}

	/** 导出：选文件 → 写 JSON */
	async function exportAll(win, statusFn) {
		var report = typeof statusFn === 'function' ? statusFn : function () {};
		var Picker = pickerClass();
		if (!Picker) {
			report('这个 Zotero 版本不支持选择文件，导不出来。');
			return false;
		}
		var fp = new Picker();
		fp.init(win, '导出所有设置', fp.modeSave);
		fp.appendFilters(fp.filterAll);
		fp.defaultString = fileNameFor(new Date());
		fp.defaultExtension = 'json';
		var choice = await fp.show();
		if (choice !== fp.returnOK && choice !== fp.returnReplace) {
			return false;
		}
		var path = String(fp.file || '');
		if (!path) {
			report('没拿到保存路径。');
			return false;
		}
		var map = collectPrefs();
		var data = buildBackup(map, {
			exportedAt: new Date().toISOString(),
			pluginVersion: (WordFreq.pluginVersion && WordFreq.pluginVersion()) || '',
		});
		await writeText(path, JSON.stringify(data, null, 2));
		report('已导出 ' + Object.keys(data.prefs).length + ' 项设置到 '
			+ path + '。里面有 API Key，分享前记得删掉。');
		return true;
	}

	/** 导入：选文件 → 确认 → 逐项写回 */
	async function importAll(win, statusFn) {
		var report = typeof statusFn === 'function' ? statusFn : function () {};
		var Picker = pickerClass();
		if (!Picker) {
			report('这个 Zotero 版本不支持选择文件，导不进来。');
			return false;
		}
		var fp = new Picker();
		fp.init(win, '导入设置', fp.modeOpen);
		fp.appendFilters(fp.filterAll);
		fp.defaultExtension = 'json';
		var choice = await fp.show();
		if (choice !== fp.returnOK) {
			return false;
		}
		var path = String(fp.file || '');
		if (!path) {
			report('没拿到文件路径。');
			return false;
		}
		var data = parseBackup(await readText(path));
		var info = summarize(data);
		var ok = confirmUi(win, '导入设置',
			'要导入 ' + info.count + ' 项设置吗？当前设置会被覆盖'
			+ (info.words ? '，自定义名单会换成文件里的 ' + info.words + ' 个词' : '')
			+ (info.hasKey ? '，API Key 也会被替换' : '') + '。');
		if (!ok) {
			return false;
		}
		var applied = 0;
		var skipped = 0;
		Object.keys(data.prefs).forEach(function (key) {
			if (key.indexOf(PREFIX) !== 0) {
				skipped++;
				return;
			}
			var type = prefTypeName(key);
			if (!type) {
				// 这个版本没有这个首选项，跳过而不是凭空造一个
				skipped++;
				return;
			}
			var value = coerceValue(type, data.prefs[key]);
			if (value === null) {
				skipped++;
				return;
			}
			try {
				if (type === 'int') {
					Services.prefs.setIntPref(key, value);
				}
				else if (type === 'bool') {
					Services.prefs.setBoolPref(key, value);
				}
				else {
					Services.prefs.setStringPref(key, value);
				}
				applied++;
			}
			catch (e) {
				WordFreq.logError('写入首选项失败：' + key, e);
				skipped++;
			}
		});
		// 名单与面板都按新设置重画
		try {
			WordFreq.userlist.init();
		}
		catch (e) {
			// 名单没加载成功不影响设置本身
		}
		try {
			WordFreq.pane.refreshAll();
		}
		catch (e) {
			// 面板没开着时这里会失败，忽略
		}
		try {
			DeepSeekTranslate.refreshPanels();
		}
		catch (e) {
			// 同上
		}
		report('已导入 ' + applied + ' 项设置'
			+ (skipped ? '，跳过 ' + skipped + ' 项（这个版本没有或类型不对）' : '')
			+ '。');
		return true;
	}

	return {
		PREFIX: PREFIX,
		FORMAT: FORMAT,
		pickPrefs: pickPrefs,
		buildBackup: buildBackup,
		parseBackup: parseBackup,
		coerceValue: coerceValue,
		summarize: summarize,
		fileNameFor: fileNameFor,
		collectPrefs: collectPrefs,
		exportAll: exportAll,
		importAll: importAll,
	};
})();
