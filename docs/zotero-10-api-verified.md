# Zotero 10.0.6 接口事实（从 omni.ja 源码核实）

本机路径：`C:\Program Files\Zotero\app\omni.ja`（Zotero 自己的 JS）与 `C:\Program Files\Zotero\omni.ja`（Gecko）。
两个 `omni.ja` 都是 zip，条目路径即源码路径。下面每条都标了出处。

版本：Zotero 10.0.6（`compatibility.ini` 的 `LastVersion=10.0.6_20261007153950`）。

---

## 取全文

### `.zotero-ft-cache` 是按页数截断的，不是按字符数

`chrome/content/zotero/xpcom/fulltext.js`

```js
this.indexPDF = async function (filePath, itemID, allPages) {
  var maxPages = Zotero.Prefs.get('fulltext.pdfMaxPages');
  ...
  var { text, extractedPages, totalPages } =
    await Zotero.PDFWorker.getFullText(itemID, allPages ? null : maxPages);
  ...
  await Zotero.File.putContentsAsync(cacheFilePath, text);
```

`defaults/preferences/zotero.js`：

```js
pref("extensions.zotero.fulltext.textMaxLength", 500000);
pref("extensions.zotero.fulltext.pdfMaxPages", 100);
```

两条结论：

1. **PDF 走的是 `pdfMaxPages`（默认 100 页），`textMaxLength` 管不到 PDF。**
   超过 100 页的 PDF，缓存里没有后面的页，但读起来像一份完整文本。
   `textMaxLength` 只在 EPUB 与纯文本那条路上生效（`writeCacheFile`）。
2. 要拿全部页，必须 `PDFWorker.getFullText(itemID, null)`。

本机实测：`zotero.sqlite` 的 `fulltextItems` 表 70 条记录里 11 条
`indexedPages < totalPages`，最大差距是 1121 页的书只索引了 100 页。

### `Zotero.Fulltext.getPages(itemID)`

```js
this.getPages = function (itemID) {
  var sql = "SELECT indexedPages, totalPages AS total FROM fulltextItems WHERE itemID=?";
  return Zotero.DB.rowQueryAsync(sql, itemID);
};
```

**总页数字段叫 `total`，不叫 `totalPages`。** 没索引过时没有这一行。

### `Zotero.Fulltext.getItemCacheFile(item)`

```js
this.getItemCacheFile = function (item) {
  var cacheFile = Zotero.Attachments.getStorageDirectory(item);
  cacheFile.append(this.fulltextCacheFile);
  return cacheFile;
};
```

返回 **nsIFile**（同文件的调用点写的是 `getItemCacheFile(item).path`）。
它是拼出来的，**不保证文件存在**，用前要自己判断。
链接型附件的缓存也放在 `storage/<key>/` 下，不在 PDF 旁边（`indexPDF` 里有这段分支）。

### `Zotero.PDFWorker.getFullText`

`chrome/content/zotero/xpcom/pdfWorker/manager.js`

```js
/**
 * @param {Integer} itemID Attachment item id
 * @param {Integer|null} maxPages Pages count to extract, or all pages if 'null'
 * @param {Boolean} [isPriority]
 * @param {String} [password]
 */
async getFullText(itemID, maxPages, isPriority, password) {
  ...
  if (!attachment.isPDFAttachment()) {
    throw new Error('Item must be a PDF attachment');
  }
  ...
  return result;   // { text, extractedPages, totalPages }
}
```

四个参数，`maxPages` 传 `null` 才是全部页。非 PDF 附件直接抛错。
另有 `getStructuredDocumentText(itemID, options)`，支持 PDF / EPUB / snapshot。

---

## 写文件与定位

`chrome/content/zotero/xpcom/file.js`

```js
this.putContentsAsync = async function (path, data, charset)   // charset 默认 utf-8
this.getContentsAsync = async function (source, charset, maxLength)
this.reveal = async function (file)                            // 收路径字符串
```

`reveal` 内部是 `OS.File.exists(file)` → `this.pathToFile(file)` → `nsIFile.reveal()`，
失败时自己会退回 `Zotero.launchFile`。**传路径字符串，不要传 nsIFile。**

`Zotero.Utilities.Internal` 上**没有** `showInFileManager`。

---

## 条目与附件

`chrome/content/zotero/xpcom/data/item.js`

| 接口 | 出处 | 说明 |
|---|---|---|
| `item.isAttachment()` | 2706 | |
| `item.isPDFAttachment()` | 2788 | `isFileAttachment() && attachmentContentType == 'application/pdf'` |
| `item.attachmentContentType` | 3501 | defineProperty 的 getter |
| `item.getFilePathAsync()` | 3003 | 非附件会抛错 |
| `item.getAttachments(includeTrashed)` | 4256 | **返回 itemID 数组**，不是 Item 对象；对附件调用会抛错 |
| `item.getBestAttachment()` | 4297 | async，返回 `Zotero.Item \| false`，对非普通条目抛错 |

---

## 界面

### 插件生命周期与主窗口的时序

`chrome/content/zotero/xpcom/plugins.js`

```js
this.init = async function () {
  ...
  for (let addon of addons) {
    ...
    await _callMethod(addon, 'startup', REASONS.APP_STARTUP);   // 83 行
  }
  ...
  const mainWindowListener = { onOpenWindow(xulWindow) { ... onMainWindowLoad ... } };
  Services.wm.addListener(mainWindowListener);                  // 124 行
};
```

`zotero.js` 里 `await Zotero.Plugins.init()`（443 行）跑在开窗之前，
`uiIsReady()`（448 行）在更后面。后果：

- **`startup` 里 `Zotero.getMainWindows()` 拿到的是空数组**，往窗口 DOM 里塞东西必然失败。
- **不要在 `startup` 里 `await Zotero.uiReadyPromise`**：窗口加载反过来依赖插件初始化完成，两边互等会死锁。
- `onMainWindowLoad` 由 `Plugins.init()` 末尾注册的 `Services.wm` 监听器触发，只对
  `chrome://zotero/content/zoteroPane.xhtml` 的窗口生效。
  `_callMethod`（224 行）会 `await` 插件的返回值。

### 条目窗格区块：用 `Zotero.ItemPaneManager.registerSection`

`chrome/content/zotero/xpcom/pluginAPI/itemPaneManager.js`

```js
Zotero.ItemPaneManager.registerSection({
  paneID: 'my-plugin-pane',              // 必填，不能和内置 paneID 冲突
  pluginID: 'my-plugin@me',              // 必填
  header:  { l10nID: 'xxx', icon: uri }, // 必填，l10nID 与 icon 都要给；icon 16×16
  sidenav: { l10nID: 'yyy', icon: uri }, // 侧栏按钮，icon 20×20
  bodyXHTML: '<vbox>...</vbox>',         // 可选，可选片段
  onInit, onDestroy, onItemChange, onRender, onAsyncRender, onToggle,
  sectionButtons: [{ type, icon, l10nID, onClick }],
});
Zotero.ItemPaneManager.unregisterSection(paneID);
```

- `onRender` 是**必填**且**不能是 async**。耗时的事情放 `onAsyncRender`。
- 回调参数里，`onInit` 会多给一个 `refresh()`；`onItemChange` / `onRender` 给 `body`、`item`、
  `doc`，另有 `setEnabled` / `setSectionSummary` / `setL10nArgs`。
- `bodyXHTML` 经 `MozXULElement.parseXULToFragment` 解析，默认 XUL 命名空间，
  放进 `<html:div data-type="body">`（`itemPaneCustomSection.js` 51 行）。
  HTML 元素要显式写 `xmlns="http://www.w3.org/1999/xhtml"`。
- 区块元素上带 `data-pane="<paneID>"`，排查时用 `doc.querySelector('[data-pane="xxx"]')` 找。
- 内置 paneID 不能占用：`info`、`abstract`、`attachments`、`notes`、`attachment-info`、
  `attachment-annotations`、`libraries-collections`、`tags`、`related`。
- **这个接口没有 `stylesheets` 选项**，样式要么内联，要么按 Zotero 默认外观走。

### 插件菜单：用 `Zotero.MenuManager`

`chrome/content/zotero/xpcom/pluginAPI/menuManager.js`

```js
Zotero.MenuManager.registerMenu({ menuID, pluginID, target, menus: [ ... ] });
Zotero.MenuManager.unregisterMenu(menuID);
```

`target` 的合法值（`VALID_TARGETS`，30–59 行）里有：

| target | 用途 |
|---|---|
| `main/library/item` | 文库条目右键菜单 |
| `main/library/collection` | 收藏夹右键菜单 |
| `main/menubar/tools` | 工具菜单 |
| `main/menubar/file|edit|view|go|help` | 其它主菜单 |
| `main/tab` | 标签右键菜单 |
| `reader/menubar/*` | 阅读器窗口菜单 |
| `itemPane/info/row`、`sidenav/locate` 等 | 其它位置 |

菜单项字段：`menuType`（`menuitem` / `separator` / `submenu`）、`l10nID`、
`l10nArgs`、`icon` / `darkIcon`、`enableForTabTypes`、
`onShowing` / `onShown` / `onHiding` / `onHidden` / `onCommand`、`menus`（子菜单）。

回调签名：

```js
onShowing(event, context)   // context.setVisible(bool) / setEnabled / setIcon / setL10nArgs / menuElem
onCommand(event, context)
```

`main/library/item` 的 context 由 `zoteroPane.buildItemContextMenu()`（4685 行）提供，
里面直接带 **`items`**（当前选中的条目数组），不用自己去问 ZoteroPane。

两个约定：

- `main/library/item` 与 `main/library/collection` 在 `GROUPED_TARGETS` 里，
  顶层不允许放 `separator`，菜单项多了 Zotero 会自动收进一个二级菜单。
- `icon` 最终走 CSS 变量 `--custom-menu-icon-light: url(...)`，所以给绝对 URI。
- `l10nID` 是写成 `menuElem.dataset.l10nId`（453 行），由文档的 L10n 本地化，
  插件自己的 ftl 会被合并进来，id 必须带插件前缀。

### 条目右键菜单会「收纳」，而且实测挂上去会让菜单弹不出来

`_groupMenus()` 对 `GROUPED_TARGETS`（`main/library/item`、`main/library/collection`）
会先算一次 `_computeAvailableMenuNum()`：

```js
let availableHeight = maxMenuHeight - popupPadding -
  separatorHeight * separatorCount - menuHeight * menuCount;   // 后两项数的是 Zotero 自己的菜单项
let availableMenuCount = Math.floor(availableHeight / menuHeight);
```

放不下就把插件项塞进 `menu-custom-group-submenu`（英文 `More Options…`）子菜单；
`availableMenuCount` 为负时 `menus.slice(0, 负数)` 得到空数组，插件项**全部**进子菜单。
选中条目数一变（多选会多出「合并条目」等），或换个矮屏，结果就变。

**本插件实测：注册 `main/library/item` 之后，右键菜单本身经常弹不出来，禁用插件即恢复。**
所以最终没有用它，改走条目窗格区块。要用这个 target 的插件请留意这一点。

### 文献列表右键菜单的 DOM 结构（旧做法）

`zoteroPane.xhtml` 第 977 行有 `<menupopup id="zotero-itemmenu">`，
第 749 行有 `<menupopup id="menu_ToolsPopup">`。
`buildItemContextMenu()`（4157 行）每次弹出前重建，开头只清理带 `zotero-locate` 的首子元素：

```js
while (menu.firstChild && menu.firstChild.getAttribute("zotero-locate")) {
  menu.removeChild(menu.firstChild);
}
```

### `Zotero.PreferencePanes.register`

`chrome/content/zotero/xpcom/pluginAPI/preferencePanes.js`

```js
register: async function (options) {
  if (!options.pluginID || !options.src) throw new Error('pluginID and src must be provided');
  ...
  options.scripts ||= [];
  options.stylesheets ||= [];
  let addPaneOptions = {
    id: options.id || `plugin-pane-${Zotero.Utilities.randomString()}-${options.pluginID}`,
    rawLabel: options.label || (await Zotero.Plugins.getName(options.pluginID)),
    image: options.image && (await Zotero.Plugins.resolveURI(options.pluginID, options.image)) || (...),
    src: await Zotero.Plugins.resolveURI(options.pluginID, options.src),
    ...
```

`pluginID` 与 `src` 必填，其余可选。`image` / `stylesheets` / `scripts` 都按插件根解析相对路径。
`id` 重复会抛错。

### 进度窗口

`chrome/content/zotero/xpcom/progressWindow.js`

```js
Zotero.ProgressWindow = function (options = {}) {
  var _window = options.window || null;
  var _closeOnClick = typeof options.closeOnClick == 'undefined' ? true : options.closeOnClick;
```

`changeHeadline` / `addLines` / `addDescription` / `ItemProgress` 及其
`setProgress` / `setText` / `setError` / `setItemTypeAndIcon` **全部包在
`_deferUntilWindowLoad` 里**：

```js
function _deferUntilWindowLoad(fn) {
  return function () {
    if (_window && _window.closed) return;
    if (_windowLoaded) { fn.apply(this, Array.prototype.slice.call(arguments)); }
    else { _deferredUntilWindowLoad.push(fn); ... }
  };
}
```

两个后果：

1. 在 `show()` 之前创建 `ItemProgress` 是合法的，调用会排队，窗口加载后按顺序重放。
   Zotero 自己的 `fulltext.js`（1811–1819 行）就是这么写的。
2. `ItemProgress` 的第一个参数是**图标键**（喂给 `icon-${cssIcon}` 拼 CSS 类），
   不是图片路径。Zotero 自己传的是 `'journalArticle'` 这类条目类型。

### 其它

`chrome/content/zotero/xpcom/zotero.js`

| 接口 | 行 | 说明 |
|---|---|---|
| `Zotero.getMainWindows()` | 84 | 返回 `navigator:browser` 的窗口数组 |
| `Zotero.launchFile(file)` | 1150 | |
| `Zotero.alert(window, title, msg)` | 1447 | 直接转 `Services.prompt.alert(window, ...)` |

---

## 清单要求

`chrome/content/zotero/xpcom/extension.js` 的 `parseManifest()` 对 `type == "extension"`
强制要求 `applications.zotero` 里有 `id`、`update_url`、`strict_max_version`，
缺任一项会让安装报 `ERROR_CORRUPT_FILE`。
