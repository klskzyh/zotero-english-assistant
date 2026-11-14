/* 英文助手的引导脚本。
 *
 * 按 Zotero 7 及以后版本的 bootstrap 插件规范：
 *   startup 时注册 chrome:// 资源，把功能脚本加载进同一个沙箱，
 *   再把控制权交给 scripts/main.js；shutdown 时反向清理。
 *
 * 两个子系统的模块共用一个沙箱，各自挂在自己的命名空间上
 * （translate/ → DeepSeekTranslate，wordfreq/ → WordFreq），互不干扰。
 */

var chromeHandle;
var pluginCtx;

/* 加载顺序：translate/config.js 必须最先，它定义命名空间与共享状态。
 * 其余顺序不敏感——所有跨模块调用都发生在函数体内，加载时只建对象。
 * 两个子系统的 main.js 要在各自模块之后；顶层的 main.js（总入口）最后。 */
var SCRIPTS = [
	'translate/config.js',
	'translate/protocols.js',
	'translate/api.js',
	'translate/context.js',
	'translate/prompts.js',
	'translate/render.js',
	'translate/counts.js',
	'translate/wordbook.js',
	'translate/panel.js',
	'translate/service.js',
	'translate/reader.js',
	'translate/main.js',

	'wordfreq/langdata.js',
	'wordfreq/defaults.js',
	'wordfreq/userlist.js',
	'wordfreq/lemma.js',
	'wordfreq/langdetect.js',
	'wordfreq/tokenizer.js',
	'wordfreq/wordfreq.js',
	'wordfreq/output.js',
	'wordfreq/source.js',
	'wordfreq/pane.js',
	'wordfreq/parts-pane.js',
	'wordfreq/backup.js',
	'wordfreq/main.js',

	'main.js',
];

function install() {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
	await Zotero.initializationPromise;

	// Zotero 7 起提供 rootURI，老版本用 resourceURI 代替
	if (!rootURI) {
		rootURI = resourceURI.spec;
	}

	var aomStartup = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
		.getService(Components.interfaces.amIAddonManagerStartup);
	var manifestURI = Services.io.newURI(rootURI + 'manifest.json');
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		['content', 'english-assistant', rootURI + 'chrome/content/'],
	]);

	pluginCtx = {
		rootURI: rootURI,
		pluginID: id,
		pluginVersion: version,
		_globalThis: null,
	};
	pluginCtx._globalThis = pluginCtx;

	for (var i = 0; i < SCRIPTS.length; i++) {
		Services.scriptloader.loadSubScript(
			rootURI + 'chrome/content/scripts/' + SCRIPTS[i],
			pluginCtx
		);
	}

	await pluginCtx.EnglishAssistant.startup({ id: id, version: version, rootURI: rootURI });
}

async function onMainWindowLoad({ window }, reason) {
	try {
		pluginCtx?.EnglishAssistant?.onMainWindowLoad(window);
	}
	catch (e) {
		Zotero.logError(e);
	}
}

async function onMainWindowUnload({ window }, reason) {
	try {
		pluginCtx?.EnglishAssistant?.onMainWindowUnload(window);
	}
	catch (e) {
		Zotero.logError(e);
	}
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
	// 整个应用退出时不必逐个清理，Zotero 自己会释放
	if (reason === APP_SHUTDOWN) {
		return;
	}

	try {
		pluginCtx?.EnglishAssistant?.shutdown();
	}
	catch (e) {
		Zotero.logError(e);
	}

	Cc['@mozilla.org/intl/stringbundle;1']
		.getService(Components.interfaces.nsIStringBundleService)
		.flushBundles();

	if (chromeHandle) {
		chromeHandle.destruct();
		chromeHandle = null;
	}

	pluginCtx = null;
}

function uninstall() {}
