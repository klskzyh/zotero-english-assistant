# Zotero 10 插件接口笔记

这份笔记记录的是**在本机实际提取 Zotero 源码后核对过的**接口事实，不是照抄文档。
核对环境：Zotero 10.0.6，BuildID 20261007153950，Gecko 140。

开发这个插件时踩过或绕开过的点都记在这里，以后再改插件不用重新逆向一遍。

## 0. 怎么重新提取 Zotero 源码

Zotero 的应用代码打包在 `C:\Program Files\Zotero\app\omni.ja`（47 MB）里，`ja` 文件就是 zip，可以直接按条目读取：

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead("C:\Program Files\Zotero\app\omni.ja")
$z.Entries | Where-Object { $_.FullName -match 'pluginAPI/' } | ForEach-Object { $_.FullName }
$e = $z.Entries | Where-Object { $_.FullName -eq 'chrome/content/zotero/xpcom/pluginAPI/itemPaneManager.js' }
[System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, "$env:TEMP\itemPaneManager.js", $true)
$z.Dispose()
```

想知道某个 API 在哪个文件里定义，逐条目读出文本搜关键字即可（`$e.Open()` 配 `StreamReader`）。
根目录下还有一个 10 MB 的 `omni.ja`，那部分是 Firefox 自身的代码。

`tmp/zotero-src/grep-omni.ps1` 把这个动作包好了，两个包都能搜，还能直接把命中的条目导出到 `tmp/zotero-src/`：

```powershell
& tmp\zotero-src\grep-omni.ps1 -Pattern 'startupScanScopes' -Archive 'C:\Program Files\Zotero\omni.ja'   # 搜 Firefox 那部分
& tmp\zotero-src\grep-omni.ps1 -Pattern 'ItemPaneManager'                                                 # 搜 Zotero 那部分
```

界面图标的样式规则在 `chrome/content/zotero-platform/win/zotero.css` 里（mac / unix 各有一份同样的），
插件图标相关的选择器是 `item-pane-sidenav .btn[custom]` 和 `item-pane-custom-section ... .title::before`。

安装好的插件可以直接当参考实现读：`%APPDATA%\Zotero\Zotero\Profiles\<profile>\extensions\` 下的 `.xpi` 同样是 zip。

## 1. 插件的加载流程

`bootstrap.js` 的生命周期函数：`install` / `startup` / `onMainWindowLoad` / `onMainWindowUnload` / `shutdown` / `uninstall`。

`startup({ id, version, resourceURI, rootURI })` 里要做两件事：

```js
// Zotero 7 起提供 rootURI；老版本要用 resourceURI.spec 兜底
var aomStartup = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
  .getService(Components.interfaces.amIAddonManagerStartup);
chromeHandle = aomStartup.registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [
  ['content', '<短名>', rootURI + 'chrome/content/'],
]);
Services.scriptloader.loadSubScript(rootURI + 'chrome/content/scripts/main.js', ctx);
```

`shutdown` 里收到 `reason === APP_SHUTDOWN` 时直接返回，整个应用退出时不用自己清理。

**`prefs.js` 由 Zotero 自动执行**（`plugins.js` 的 `setDefaultPrefs`），它把文件当作一个带 `pref(name, value)` 方法的对象来跑，所以文件里只写 `pref("...", ...)` 调用即可，不需要别的包装。用户改过的值存在用户分支，升级插件不会覆盖。

**`locale/` 目录同样自动注册**（`plugins.js` 的 `registerLocales`）：插件根下 `locale/<语言>/*.ftl` 会被合并进一个名为 `zotero-plugins` 的 L10nFileSource，资源 id 就是文件名。要引用它，在 XHTML 里写 `<html:link rel="localization" href="<文件名>.ftl"/>`。由于所有插件的 ftl 合并成一个源，文案 id 必须自己加前缀避免撞车。

`manifest.json` 用 `applications.zotero`，字段为 `id` / `strict_min_version` / `strict_max_version` / `update_url`。实测 `strict_max_version` 写 `10.9.9` 可以正常加载。

## 2. 条目面板区块

`Zotero.ItemPaneManager.registerSection(options)`，返回 `paneID` 或 `false`。

```js
Zotero.ItemPaneManager.registerSection({
  paneID: 'my-pane',            // 唯一
  pluginID: 'me@example.com',   // 填了之后插件卸载时自动注销
  header:  { l10nID: '...', icon: 'chrome://.../16.svg' },   // l10nID 必填
  sidenav: { l10nID: '...', icon: 'chrome://.../20.svg', orderable: false },
  bodyXHTML: '<div xmlns="http://www.w3.org/1999/xhtml" class="x"></div>',
  onInit, onDestroy, onItemChange, onRender, onAsyncRender, onToggle,
  sectionButtons: [{ type, icon, l10nID, onClick }],
});
```

几条实测结论：

- `header.l10nID` 是必填的字符串，写错或 ftl 里没有这个 id，区块标题会是空白。
- `bodyXHTML` 走 `MozXULElement.parseXULToFragment`，**按 XML 严格解析**，而且默认命名空间是 XUL。要放 HTML 元素必须显式写 `xmlns="http://www.w3.org/1999/xhtml"`，否则拿到的是 XUL 元素，HTML 那套样式不生效。
- `onInit` 拿到 `refresh()`，把它存下来就能在外部数据变化时重新渲染该面板。`onDestroy` 里要清掉引用。
- `onRender` 不能是 async；耗时的部分放 `onAsyncRender`。
- `sectionButtons` 的图标要用 Zotero 自带的路径，实测存在的有 `chrome://zotero/skin/16/universal/options.svg`、`trash.svg`、`open-link.svg`。注意**没有** `settings.svg`，写成它按钮会没图标。
- `registerInfoRow` 是同一套机制的另一种用途（条目信息里加一行），这里没用上。

## 3. 首选项面板

```js
await Zotero.PreferencePanes.register({
  pluginID, id, src: 'chrome/content/preferences.xhtml',
  label: 'DeepSeek Translate',
  image: 'chrome/content/icons/section-20.svg',
  scripts: [...], stylesheets: [...], helpURL,
});
```

`src` / `image` / `scripts` 可以写相对插件根目录的路径，Zotero 会用 `Zotero.Plugins.resolveURI` 解析。

片段本身按 XML 解析，XUL 是默认命名空间，HTML 元素要加 `html:` 前缀（这个前缀由 Zotero 注入，**不用自己声明 xmlns:html**）。顶层可以有多个元素（通常是 `<linkset>` 加一个 `<vbox>`）。

**设置绑定**：元素上写 `preference="extensions.xxx.yyy"` 就会自动双向绑定，不需要自己写读写代码。取值走 `elem.value`，勾选框走 `elem.checked`，所以 `<textbox>` 和 `<checkbox preference="...">` 直接可用。XHTML 里绑定的键必须在 `prefs.js` 里有默认值，否则控件显示为空——这个坑值得写进自动检查。

**加载完成钩子**：面板根元素上的 `onload` 会在片段插入后触发，这是挂按钮监听的地方：

```xml
<vbox id="my-prefpane" onload="Zotero.MyPlugin.prefsPane.onLoad(event)">
```

元素上的 `oncommand` 属性也会被转成真正的监听器。

打开面板：`Zotero.Utilities.Internal.openPreferences('<paneID>')`。注意它的第二个参数现在是 options 对象，传字符串会直接抛错。

## 4. 阅读器划词事件

```js
Zotero.Reader.registerEventListener('renderTextSelectionPopup', (event) => {
  const { reader, doc, params, append } = event;
  // params.annotation.text 是选中的文字
  append(element);   // 必须在处理函数里同步调用
}, pluginID);
```

事件是从阅读器 iframe 里派发过来的。客户端代码里构造事件的写法是：

```js
const event = new CustomEvent('customEvent', {
  detail: { type: `render${type}`, doc: document, append, params: props }
});
```

其中 `type` 传的是 `'TextSelectionPopup'`，所以插件侧收到的事件名是 `renderTextSelectionPopup`。`params` 就是传给选区弹窗组件的 props，包含 `annotation`（选区被当作一个高亮注释对象来构造）、`textSelectionAnnotationMode`、`enableAddToNote` 等。`annotation` 里有 `text`、`color`、`pageLabel`，PDF 里还有 `position.pageIndex` 和 `position.rects`。

`append` 内建了一个「必须同步调用」的约束，事件处理函数里 `await` 之后就调不动了——所以按钮点击后的异步逻辑要挂在按钮自己的监听器上，不能写在事件回调的 await 之后。

`reader.itemID` 是当前 PDF 附件的 itemID，这是把划词和附件归档关联起来的关键。

## 5. 全文与上下文

可用的几条路：

| 接口 | 说明 |
|---|---|
| `Zotero.Fulltext.getItemCacheFile(item)` | 返回附件存储目录下 `.zotero-ft-cache` 的 nsIFile，这个文件就是抽好的全文 |
| `Zotero.PDFWorker.getFullText(itemID, maxPages)` | 现场提取，返回 `{ text, extractedPages, totalPages }`，`maxPages` 传 `null` 表示全部页 |
| `Zotero.PDFWorker.getStructuredDocumentText(itemID, opts)` | 结构化文本（PDF / EPUB / 快照），形状未在本次核对中确认 |
| `Zotero.Fulltext.getPages(itemID)` | 只返回已索引页数和总页数，**不是正文** |
| `Zotero.Fulltext.getIndexedState(item)` | 索引状态，可用来判断该不该提示用户「这篇没索引」 |

`.zotero-ft-cache` 的实际格式（用真实文件核过）：纯文本，**按行分隔的文本片段，没有分页符**（form feed 计数为 0）。汉字之间带空格，例如 `里盖蒂 ， 年 月 日到访纽约`。这意味着：

- 上下文里拿不到页码，页码只能从划词事件的 `annotation.position.pageIndex` 取。
- 定位选中文字时必须先把两边的空白全部去掉再比对，否则永远匹配不上。

附件存储目录：`Zotero.Attachments.getStorageDirectory(item)`。取文件内容用 `Zotero.File.getContentsAsync(path)`，判断存在用 `IOUtils.exists(path)`。

## 6. HTTP

`Zotero.HTTP.request(method, url, options)`，相关选项：

- `body`、`headers`、`responseType`、`timeout`（默认 30000）、`successCodes`、`errorDelayIntervals`、`noRetryOnThrottle`、`debug`。

**关键点：默认只在 2xx 时算成功，其他状态码抛 `Zotero.HTTP.UnexpectedStatusException`。** 想在出错时读到接口返回的错误正文，把 `successCodes` 显式设成 `false`——源码里这个值的含义是「任何状态码都放行」（`if (options.successCodes === false) success = true;`），然后自己看 `xhr.status`。这样能把 DeepSeek 返回的 `{"error":{"message":...}}` 原样转述给用户。

异常对象上带着 `xmlhttp`、`url`、`status` 字段，超时和不安全连接各有专门的异常类型。

## 7. 其他核对过的 API

| 用途 | 调用 |
|---|---|
| 从条目推 PDF 附件 | `await item.getBestAttachment()`，**只能对常规条目调用，对附件会抛错** |
| 附件找父条目 | `item.parentItem` |
| 取字段 | `item.getField('title')`，取不到返回 `false` 而不是空串 |
| 作者 | `item.getCreators()`，每项可能是 `{firstName, lastName}` 或 `{name}` |
| 全部主窗口 | `Zotero.getMainWindows()` |
| 剪贴板 | `Zotero.Utilities.Internal.copyTextToClipboard(text)` |
| 随机串 | `Zotero.Utilities.randomString(8)` |
| 调试输出 | `Zotero.debug(...)`，看「帮助 → 调试输出」 |

`Zotero.ItemTypes.getLocalizedName(itemTypeID)` 用于把文献类型转成界面语言，这次没有逐个核对，调用处做了 try/catch。
