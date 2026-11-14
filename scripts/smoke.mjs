/**
 * 合并后的冒烟测试：按 bootstrap.js 的顺序把全部功能脚本加载进同一个沙箱，
 * 塞一个假的 Zotero 宿主，然后跑一遍 startup → onMainWindowLoad → shutdown。
 *
 * 这是最接近 Zotero 实际启动流程的离线验证：任何「加载时就炸」「注册时漏了某个
 * 接口」「子系统之间互相踩」的问题都能在这里暴露，不用装进 Zotero 才发现。
 * 脚本清单直接从 bootstrap.js 里读，避免和真加载顺序脱节。
 *
 * 用法：npm run smoke
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const addonDir = path.join(projectRoot, 'addon');
const scriptsDir = path.join(addonDir, 'chrome', 'content', 'scripts');

const failures = [];
let passed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
  }
  else {
    failures.push(name + (detail ? ' —— ' + detail : ''));
  }
}

// ── 从 bootstrap.js 里读脚本清单 ────────────────────────
const bootstrap = fs.readFileSync(path.join(addonDir, 'bootstrap.js'), 'utf8');
const listMatch = bootstrap.match(/var SCRIPTS = \[([\s\S]*?)\];/);
if (!listMatch) {
  console.error('bootstrap.js 里找不到 SCRIPTS 列表');
  process.exit(1);
}
const SCRIPTS = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

// ── 假宿主 ──────────────────────────────────────────────
const calls = {
  sections: [],
  prefPanes: [],
  menus: [],
  readerEvents: [],
  unregisteredSections: [],
  unregisteredMenus: [],
};
const errors = [];
const prefStore = new Map();

function createElement(localName) {
  const attrs = {};
  const children = [];
  return {
    localName,
    attrs,
    children,
    style: {},
    setAttribute: (k, v) => { attrs[k] = v; },
    appendChild: (el) => { children.push(el); return el; },
    querySelectorAll: () => children,
  };
}

function createWindow() {
  const appended = [];
  const doc = {
    appended,
    documentElement: { appendChild: (el) => appended.push(el) },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElementNS: (ns, name) => createElement(name),
    createXULElement: (name) => createElement(name),
  };
  return { document: doc };
}

const win = createWindow();

const Zotero = {
  initializationPromise: Promise.resolve(),
  debug: () => {},
  logError: (e) => errors.push(e),
  getMainWindows: () => [],
  Prefs: {
    get: (key) => prefStore.get(key),
    set: (key, value) => { prefStore.set(key, value); },
  },
  Utilities: {
    randomString: (n) => 'x'.repeat(n || 8),
    Internal: { openPreferences() {}, copyTextToClipboard() {} },
    ItemTypes: { getLocalizedName: () => '条目类型' },
  },
  ItemPaneManager: {
    registerSection: (options) => { calls.sections.push(options); return options.paneID; },
    unregisterSection: (key) => { calls.unregisteredSections.push(key); },
  },
  PreferencePanes: {
    register: async (options) => { calls.prefPanes.push(options); return options.id; },
  },
  MenuManager: {
    registerMenu: (options) => { calls.menus.push(options); return options.menuID; },
    unregisterMenu: (id) => { calls.unregisteredMenus.push(id); },
  },
  Reader: {
    registerEventListener: (type, handler, pluginID) => { calls.readerEvents.push(type); },
    unregisterEventListener: () => {},
  },
  Items: { get: () => null, getAsync: async () => null },
  Fulltext: {
    getItemCacheFile: () => null,
    getPages: async () => null,
    getIndexedState: () => null,
  },
  PDFWorker: {
    getFullText: async () => ({ text: '', extractedPages: 0, totalPages: 0 }),
  },
  Attachments: { getStorageDirectory: () => null },
  File: { getContentsAsync: async () => '', putContentsAsync: async () => {}, reveal() {} },
  HTTP: { request: async () => ({ response: '' }) },
  // 插件沙箱里没有 setTimeout，Zotero 这边提供的是 Zotero.Promise.delay
  Promise: { delay: () => Promise.resolve() },
  ProgressWindow: function () { return { changeHeadline() {}, addLines() {}, show() {}, startCloseTimer() {} }; },
  alert: () => {},
};

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  Zotero,
  PathUtils: {
    join: (...parts) => path.win32.join(...parts),
    parent: (p) => path.win32.dirname(p),
    tempDir: 'C:\\Temp',
  },
  IOUtils: {
    exists: async () => false,
    readUTF8: async () => '',
    writeUTF8: async () => {},
  },
  Cc: {},
  Ci: {},
  Components: { classes: {}, interfaces: {} },
  Services: {
    wm: { addListener() {}, removeListener() {}, getEnumerator: () => ({}) },
    prompt: { confirm: () => true, alert() {} },
    io: {},
    prefs: { getBoolPref: () => false, setBoolPref() {}, addObserver() {}, removeObserver() {} },
    scriptloader: {},
  },
  APP_SHUTDOWN: 2,
};
vm.createContext(sandbox);

// ── 1. 按 bootstrap 的顺序加载，加载期间不能报错 ──────────
check('bootstrap 脚本清单非空', SCRIPTS.length > 0, `读到 ${SCRIPTS.length} 条`);
for (const rel of SCRIPTS) {
  const full = path.join(scriptsDir, rel);
  if (!fs.existsSync(full)) {
    check(`脚本存在：${rel}`, false, '文件不存在');
    continue;
  }
  try {
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: rel });
  }
  catch (e) {
    check(`加载 ${rel}`, false, String(e && e.message ? e.message : e));
  }
}
check('全部脚本加载完成，加载期间宿主没记到错误', errors.length === 0, String(errors[0] || ''));

// ── 2. 命名空间与总入口 ─────────────────────────────────
check('翻译命名空间建立', !!sandbox.DeepSeekTranslate);
check('词频命名空间建立', !!sandbox.WordFreq);
check('总入口建立', !!sandbox.EnglishAssistant && typeof sandbox.EnglishAssistant.startup === 'function');

// ── 3. startup ──────────────────────────────────────────
await sandbox.EnglishAssistant.startup({
  id: 'english-assistant@klskz.local',
  version: '1.0.0',
  rootURI: 'file:///plugin/',
});

check('启动期间没有异常', errors.length === 0, String(errors[0] || ''));
check('挂了对外句柄 Zotero.EnglishAssistant', !!Zotero.EnglishAssistant);
check('句柄下能看到两个子系统',
  !!Zotero.EnglishAssistant?.translate && !!Zotero.EnglishAssistant?.wordfreq);

check('注册了三个条目窗格区块', calls.sections.length === 3, `实际 ${calls.sections.length}`);
const paneIDs = calls.sections.map((s) => s.paneID);
check('两个 paneID 不重名', new Set(paneIDs).size === paneIDs.length, paneIDs.join(', '));
check('paneID 都带 ea- 前缀', paneIDs.every((id) => id.startsWith('ea-')), paneIDs.join(', '));
check('每个区块都带标题文案 id', calls.sections.every((s) => !!s.header?.l10nID));
check('每个区块都带侧栏文案 id', calls.sections.every((s) => !!s.sidenav?.l10nID));
check('每个区块都带图标', calls.sections.every((s) => !!s.header?.icon && !!s.sidenav?.icon));

// 设置里来回勾「右侧区块」时走的就是 unregister → register，
// 注销后必须把注册键清掉，否则再打开时会被当成「已注册」，区块回不来。
const paneBefore = calls.sections.length;
sandbox.WordFreq.pane.unregister();
check('注销整本词频区块后清掉了 paneID', !sandbox.WordFreq.pane.paneID,
  String(sandbox.WordFreq.pane.paneID));
sandbox.WordFreq.pane.register();
check('整本词频区块注销后能重新注册', calls.sections.length === paneBefore + 1,
  `实际 ${calls.sections.length}`);
// 关掉区块只是不显示，再打开时之前统计过的整本词频数据要还在，
// 所以 unregister 必须保留 lastResults（只清 paneID）。
const cachedBefore = sandbox.WordFreq.pane.cachedCount();
sandbox.WordFreq.pane.unregister();
check('注销区块不会清掉已统计的结果',
  typeof cachedBefore === 'number' && sandbox.WordFreq.pane.cachedCount() === cachedBefore,
  `${cachedBefore} → ${sandbox.WordFreq.pane.cachedCount()}`);
sandbox.WordFreq.pane.register();

const partsBefore = calls.sections.length;
sandbox.WordFreq.partsPane.unregister();
sandbox.WordFreq.partsPane.register();
check('分部词频区块注销后能重新注册', calls.sections.length === partsBefore + 1,
  `实际 ${calls.sections.length}`);

check('只注册一个首选项面板（翻译与词频合并）', calls.prefPanes.length === 1,
  `实际 ${calls.prefPanes.length}`);
check('首选项面板指向合并后的片段',
  calls.prefPanes.length === 1 && calls.prefPanes[0].src === 'chrome/content/preferences.xhtml',
  calls.prefPanes.map((p) => p.src).join(', '));
check('首选项面板标题不再带子模块后缀',
  calls.prefPanes.length === 1 && calls.prefPanes[0].label === '英文助手',
  calls.prefPanes.map((p) => p.label).join(', '));

check('注册了阅读器划词监听', calls.readerEvents.includes('renderTextSelectionPopup'), calls.readerEvents.join(', '));
check(
  '只注册单词本这一个菜单',
  calls.menus.length === 1 &&
  calls.menus[0].menuID === 'ea-wordbook-menu' &&
  calls.menus[0].target === 'main/menubar/tools',
  JSON.stringify(calls.menus.map((m) => m.menuID + '@' + m.target))
);

// ── 4. 主窗口加载：翻译那边要注入样式，总入口要注入插件自己的 ftl ────
sandbox.EnglishAssistant.onMainWindowLoad(win);
await new Promise((resolve) => setImmediate(resolve));

const injected = win.document.appended.filter((el) => el.id === 'ea-translate-styles');
check('主窗口加载时注入了翻译样式', injected.length === 1, `实际 ${injected.length}`);

// 少了这个 link，区块标题、侧栏提示、工具菜单项都会是空白，而且不报错。
// 而且它必须装在 XUL 的 linkset 里 —— 直接挂在 window 下不会被处理。
const l10nHost = win.document.appended.filter((el) => el.localName === 'linkset');
check('本地化链接装在 linkset 里', l10nHost.length === 1, `实际 ${l10nHost.length}`);
const l10nLink = (l10nHost[0]?.children || []).filter((el) => el.attrs?.rel === 'localization');
check('linkset 里的 link 指向 english-assistant.ftl',
  l10nLink[0]?.attrs?.href === 'english-assistant.ftl',
  String(l10nLink[0]?.attrs?.href));
check('总入口带上了补写标题与自检的方法',
  typeof sandbox.EnglishAssistant.applySectionLabels === 'function'
  && typeof sandbox.EnglishAssistant.diagnoseL10n === 'function');
check('主窗口加载期间没有异常', errors.length === 0, String(errors[0] || ''));

// ── 5. shutdown ─────────────────────────────────────────
sandbox.EnglishAssistant.shutdown();
check('关闭时注销了三个区块',
  ['ea-translate-pane', 'ea-wordfreq-pane', 'ea-wordfreq-parts-pane']
    .every((id) => calls.unregisteredSections.includes(id)),
  calls.unregisteredSections.join(', '));
check('关闭时注销了单词本菜单',
  calls.unregisteredMenus.length === 1 && calls.unregisteredMenus[0] === 'ea-wordbook-menu',
  calls.unregisteredMenus.join(', '));
check('关闭时摘掉了对外句柄', !Zotero.EnglishAssistant);
check('关闭期间没有异常', errors.length === 0, String(errors[0] || ''));

// ── 输出 ────────────────────────────────────────────────
console.log(`按 bootstrap 顺序加载了 ${SCRIPTS.length} 个脚本。`);
if (failures.length) {
  console.error(`\n通过 ${passed} 项。\n失败 ${failures.length} 项：`);
  for (const f of failures) {
    console.error('  ✗ ' + f);
  }
  process.exit(1);
}
console.log(`通过 ${passed} 项。`);
