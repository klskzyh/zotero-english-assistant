/* 用户自定义的隐藏名单。
 *
 * 一份全局名单，跨文献生效：在任一文档里把某个词加进去，
 * 之后读别的文献也不再显示它。
 *
 * 存在设置项里而不是文件里：跟着 Zotero 的设置一起持久化，
 * 不用操心路径、权限和插件升级时的文件迁移。几百个词也就几 KB 的 JSON。
 */

var WordFreq = WordFreq || {};

WordFreq.userlist = (function () {
	// 键名写成字面量，不用常量拼。scripts/check.mjs 会扫代码里读取的设置项键名，
	// 核对它们在 prefs.js 里都有默认值；用变量拼会漏检。
	var EMPTY = new Set();
	var cacheRaw = null;
	var cacheSet = null;
	function normalize(word) {
		return String(word == null ? '' : word).toLowerCase();
	}

	/** 当前名单。设置项里的原始字符串没变就复用上次的解析结果。 */
	function set() {
		var raw = WordFreq.prefGet('userHiddenWords', '[]');
		if (typeof raw !== 'string') {
			raw = '[]';
		}
		if (raw === cacheRaw && cacheSet) {
			return cacheSet;
		}
		var list = [];
		try {
			list = JSON.parse(raw);
		}
		catch (e) {
			// 设置被人手改坏了就当作空名单，不要让整个面板挂掉
			WordFreq.log('自定义名单解析失败，按空名单处理：' + e);
			list = [];
		}
		if (!Array.isArray(list)) {
			list = [];
		}
		var out = new Set();
		for (var i = 0; i < list.length; i++) {
			var w = normalize(list[i]);
			if (w) {
				out.add(w);
			}
		}
		cacheRaw = raw;
		cacheSet = out;
		return out;
	}

	function save(next) {
		var arr = [];
		next.forEach(function (w) {
			arr.push(w);
		});
		arr.sort();
		WordFreq.prefSet('userHiddenWords', JSON.stringify(arr));
		cacheRaw = null;
		cacheSet = null;
	}

	function all() {
		var out = [];
		set().forEach(function (w) {
			out.push(w);
		});
		out.sort();
		return out;
	}

	function has(word) {
		return set().has(normalize(word));
	}

	function count() {
		return set().size;
	}

	function add(word) {
		var w = normalize(word);
		if (!w || has(w)) {
			return false;
		}
		var next = new Set(set());
		next.add(w);
		save(next);
		return true;
	}

	function remove(word) {
		var w = normalize(word);
		if (!w || !has(w)) {
			return false;
		}
		var next = new Set(set());
		next.delete(w);
		save(next);
		return true;
	}

	/** 在名单里就移出，不在就加进去。返回操作后是否在名单里。 */
	function toggle(word) {
		if (has(word)) {
			remove(word);
			return false;
		}
		add(word);
		return true;
	}

	/**
	 * 第一次使用时把默认名单填进去。
	 * 只看 `userListSeeded` 这个标记：用户后来自己清空名单，重启也不会被重新填上。
	 */
	function init() {
		if (WordFreq.prefGet('userListSeeded', false) === true) {
			return;
		}
		var defaults = (WordFreq.defaultUserList || []).slice();
		// 用户可能已经在装插件之前就手动加过词，合并而不是覆盖
		var existing = Array.from(set());
		defaults.forEach(function (word) {
			if (existing.indexOf(word) < 0) {
				existing.push(word);
			}
		});
		save(new Set(existing));
		WordFreq.prefSet('userListSeeded', true);
		WordFreq.log('已填入默认自定义名单：' + existing.length + ' 个词');
	}

	/** 设置里的「恢复默认名单」：整体替换成默认那份 */
	function resetToDefault() {
		var defaults = new Set(WordFreq.defaultUserList || []);
		save(defaults);
		WordFreq.prefSet('userListSeeded', true);
		return defaults.size;
	}

	function clear() {
		save(new Set());
	}

	/**
	 * 纯函数：把导入文件的内容解析成词表。
	 * 支持三种写法：JSON 数组、`{ "words": [...] }`、一行一个词的纯文本。
	 */
	function parse(text) {
		var raw = String(text == null ? '' : text).trim();
		if (!raw) {
			return [];
		}
		var list = null;
		try {
			var json = JSON.parse(raw);
			list = Array.isArray(json)
				? json
				: (json && Array.isArray(json.words) ? json.words : null);
		}
		catch (e) {
			list = null;
		}
		if (!list) {
			list = raw.split(/\r?\n/);
		}
		var out = [];
		list.forEach(function (item) {
			var word = String(item == null ? '' : item).trim();
			if (word && out.indexOf(word) < 0) {
				out.push(word);
			}
		});
		return out;
	}


	return {
		set: set,
		all: all,
		has: has,
		count: count,
		add: add,
		remove: remove,
		toggle: toggle,
		clear: clear,
		init: init,
		resetToDefault: resetToDefault,
		parse: parse,
	};
})();
