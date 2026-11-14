/* 文件写入与定位。
 *
 * 插件要跟宿主提供的文件接口打交道，而不同 Zotero 小版本暴露的接口不太一样，
 * 所以这里对每个动作都写了一条回退链，从新的接口往老的退。
 * 纯逻辑（拼路径、拼内容）留在 wordfreq.js 里，这个文件只管 IO。
 */

var WordFreq = WordFreq || {};

WordFreq.output = (function () {
	function getIOUtils() {
		try {
			if (typeof IOUtils !== 'undefined' && IOUtils) {
				return IOUtils;
			}
		}
		catch (e) {
			// 全局作用域里没有，继续往下试
		}
		try {
			return ChromeUtils.importESModule('resource://gre/modules/IOUtils.sys.mjs').IOUtils;
		}
		catch (e) {
			return null;
		}
	}

	function getPathUtils() {
		try {
			if (typeof PathUtils !== 'undefined' && PathUtils) {
				return PathUtils;
			}
		}
		catch (e) {
			// 同上
		}
		try {
			return ChromeUtils.importESModule('resource://gre/modules/PathUtils.sys.mjs').PathUtils;
		}
		catch (e) {
			return null;
		}
	}

	function fileFor(path) {
		var f = Components.classes['@mozilla.org/file/local;1']
			.createInstance(Components.interfaces.nsIFile);
		f.initWithPath(path);
		return f;
	}

	/** 目录部分。优先用 PathUtils，拿不到就手工切。 */
	function parentOf(path) {
		var PU = getPathUtils();
		if (PU && typeof PU.parent === 'function') {
			try {
				return PU.parent(path);
			}
			catch (e) {
				// 落到手工切分
			}
		}
		var idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
		return idx > 0 ? path.slice(0, idx) : path;
	}

	function joinPath(dir, name) {
		var PU = getPathUtils();
		if (PU && typeof PU.join === 'function') {
			try {
				return PU.join(dir, name);
			}
			catch (e) {
				// 落到手工拼接
			}
		}
		var sep = dir.indexOf('\\') >= 0 ? '\\' : '/';
		return dir.replace(/[\\/]+$/, '') + sep + name;
	}

	/** 文件名部分，含扩展名 */
	function baseNameOf(path) {
		var idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
		return idx >= 0 ? path.slice(idx + 1) : path;
	}

	/** 去掉扩展名的文件名 */
	function stemOf(path) {
		var base = baseNameOf(path);
		var dot = base.lastIndexOf('.');
		return dot > 0 ? base.slice(0, dot) : base;
	}

	function extOf(path) {
		var base = baseNameOf(path);
		var dot = base.lastIndexOf('.');
		return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
	}

	function existsSync(path) {
		var IOU = getIOUtils();
		if (IOU && typeof IOU.exists === 'function') {
			try {
				var r = IOU.exists(path);
				// 有的版本返回 Promise，同步判断不了，交给调用方走异步版本
				if (r && typeof r.then !== 'function') {
					return r;
				}
			}
			catch (e) {
				// 落到 nsIFile
			}
		}
		try {
			return fileFor(path).exists();
		}
		catch (e) {
			return false;
		}
	}

	async function existsAsync(path) {
		var IOU = getIOUtils();
		if (IOU && typeof IOU.exists === 'function') {
			try {
				var r = IOU.exists(path);
				if (r && typeof r.then === 'function') {
					return !!(await r);
				}
				return !!r;
			}
			catch (e) {
				// 落到 nsIFile
			}
		}
		try {
			return fileFor(path).exists();
		}
		catch (e) {
			return false;
		}
	}

	/**
	 * 拼输出文件路径：与 PDF 同目录，文件名 = PDF 名 + 后缀 + .csv
	 *
	 * @param {string} pdfPath
	 * @param {object} opts suffix
	 * @returns {string}
	 */
	function csvPathFor(pdfPath, opts) {
		opts = opts || {};
		var suffix = opts.suffix === undefined ? '_wordfreq' : opts.suffix;
		var name = stemOf(pdfPath) + suffix + '.csv';
		return joinPath(parentOf(pdfPath), name);
	}

	/**
	 * 同名文件已经存在、且设置里不允许覆盖时，加 _2、_3 直到不冲突。
	 *
	 * @returns {Promise<string>}
	 */
	async function resolveCollision(path, overwrite) {
		if (overwrite) {
			return path;
		}
		if (!(await existsAsync(path))) {
			return path;
		}
		var dir = parentOf(path);
		var base = baseNameOf(path);
		var dot = base.lastIndexOf('.');
		var stem = dot > 0 ? base.slice(0, dot) : base;
		var ext = dot > 0 ? base.slice(dot) : '';
		for (var i = 2; i < 1000; i++) {
			var candidate = joinPath(dir, stem + '_' + i + ext);
			if (!(await existsAsync(candidate))) {
				return candidate;
			}
		}
		return path;
	}

	/** 写文本文件，返回实际写入的路径 */
	async function writeTextAsync(path, text) {
		var IOU = getIOUtils();
		if (IOU && typeof IOU.writeUTF8 === 'function') {
			try {
				await IOU.writeUTF8(path, text);
				return path;
			}
			catch (e) {
				Zotero.debug('[英文助手·词频] IOUtils.writeUTF8 失败，改用 Zotero.File：' + e);
			}
		}
		if (Zotero.File && typeof Zotero.File.putContentsAsync === 'function') {
			await Zotero.File.putContentsAsync(path, text);
			return path;
		}
		throw new Error('找不到可用的文件写入接口');
	}

	/** 读文本文件 */
	async function readTextAsync(path) {
		var IOU = getIOUtils();
		if (IOU && typeof IOU.readUTF8 === 'function') {
			try {
				return await IOU.readUTF8(path);
			}
			catch (e) {
				Zotero.debug('[英文助手·词频] IOUtils.readUTF8 失败，改用 Zotero.File：' + e);
			}
		}
		return Zotero.File.getContentsAsync(path);
	}

	/**
	 * 纯函数：判断一个文件名是不是某篇 PDF 的词频表，是的话返回它的序号。
	 *
	 * 设置里关掉覆盖时，重名会写成 `<名>_wordfreq_2.csv`、`_3.csv`，
	 * 所以找已有结果不能只认那一个固定名字。
	 *
	 * @param {string} name 目录里的文件名
	 * @param {string} stem PDF 去掉扩展名的文件名
	 * @param {string} suffix 设置里的后缀
	 * @returns {number|null} 序号（没带序号的是 1），不是就返回 null
	 */
	function csvIndexFor(name, stem, suffix) {
		if (!name || !stem) {
			return null;
		}
		if (!/\.csv$/i.test(name)) {
			return null;
		}
		var prefix = stem + (suffix === undefined ? '_wordfreq' : suffix);
		// 至少要留下 prefix 加 ".csv" 四个字符
		if (name.length < prefix.length + 4) {
			return null;
		}
		if (name.slice(0, prefix.length) !== prefix) {
			return null;
		}
		var middle = name.slice(prefix.length, name.length - 4);
		if (middle === '') {
			return 1;
		}
		if (!/^_\d+$/.test(middle)) {
			return null;
		}
		return parseInt(middle.slice(1), 10);
	}

	/** 列目录，返回文件名数组。拿不到就返回空数组。 */
	async function listDirAsync(dir) {
		var IOU = getIOUtils();
		if (IOU && typeof IOU.getChildren === 'function') {
			try {
				return (await IOU.getChildren(dir)) || [];
			}
			catch (e) {
				Zotero.debug('[英文助手·词频] IOUtils.getChildren 失败，改用 nsIFile：' + e);
			}
		}
		try {
			var out = [];
			var entries = fileFor(dir).directoryEntries;
			while (entries.hasMoreElements()) {
				out.push(entries.getNext().QueryInterface(Components.interfaces.nsIFile).leafName);
			}
			return out;
		}
		catch (e) {
			return [];
		}
	}

	/**
	 * 找这篇 PDF 已经生成过的词频表。
	 * 先试默认文件名，没有再扫目录里带序号的版本，取序号最大的那个。
	 *
	 * @returns {Promise<string|null>}
	 */
	async function findCsvAsync(pdfPath, suffix) {
		var exact = csvPathFor(pdfPath, { suffix: suffix });
		if (await existsAsync(exact)) {
			return exact;
		}
		var dir = parentOf(pdfPath);
		var stem = stemOf(pdfPath);
		var names = await listDirAsync(dir);
		var best = null;
		var bestIndex = 0;
		for (var i = 0; i < names.length; i++) {
			var index = csvIndexFor(names[i], stem, suffix);
			if (index !== null && index > bestIndex) {
				bestIndex = index;
				best = names[i];
			}
		}
		return best ? joinPath(dir, best) : null;
	}

	/** 在文件管理器里定位到文件。全部失败也不抛错，定位只是顺手做的事。 */
	async function revealAsync(path) {
		// Zotero.File.reveal 收的是路径字符串，内部走 OS.File.exists 和 pathToFile，
		// 传 nsIFile 进去在有的版本上会判断失败。它自己已经带了跨平台回退。
		try {
			if (Zotero.File && typeof Zotero.File.reveal === 'function') {
				await Zotero.File.reveal(path);
				return true;
			}
		}
		catch (e) {
			Zotero.debug('[英文助手·词频] Zotero.File.reveal 失败：' + e);
		}
		try {
			// 退一步：只把所在文件夹打开
			if (typeof Zotero.launchFile === 'function') {
				Zotero.launchFile(parentOf(path));
				return true;
			}
		}
		catch (e) {
			Zotero.debug('[英文助手·词频] Zotero.launchFile 失败：' + e);
		}
		try {
			// 最后兜底：Windows 上用 explorer /select
			var exe = fileFor('C:\\Windows\\explorer.exe');
			if (!exe.exists()) {
				return false;
			}
			var proc = Components.classes['@mozilla.org/process/util;1']
				.createInstance(Components.interfaces.nsIProcess);
			proc.init(exe);
			var args = ['/select,' + path];
			proc.run(false, args, args.length);
			return true;
		}
		catch (e) {
			Zotero.debug('[英文助手·词频] explorer /select 失败：' + e);
			return false;
		}
	}

	return {
		parentOf: parentOf,
		joinPath: joinPath,
		baseNameOf: baseNameOf,
		stemOf: stemOf,
		extOf: extOf,
		existsAsync: existsAsync,
		existsSync: existsSync,
		csvPathFor: csvPathFor,
		csvIndexFor: csvIndexFor,
		findCsvAsync: findCsvAsync,
		listDirAsync: listDirAsync,
		resolveCollision: resolveCollision,
		writeTextAsync: writeTextAsync,
		readTextAsync: readTextAsync,
		revealAsync: revealAsync,
	};
})();
