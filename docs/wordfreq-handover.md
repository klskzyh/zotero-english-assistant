# 交接说明 —— Word Frequency（Zotero 词频统计插件）

写这份文档的目的：把这个插件并进另一个 Zotero 插件时，接手的人不用重新读一遍全部源码，
也能知道**哪里必须改、哪里可以直接删、哪里看着能改其实会出事**。

- 当前版本：2.5.0
- 插件 ID：`wordfreq@klskz.local`
- 实测环境：Zotero 10.0.6 / Gecko 140 / Windows
- 代码位置：`addon/`（打进 XPI 的部分）、`scripts/`（开发工具，不进 XPI）

**如果只想知道合并要动哪里，直接看第五节。** 那一节列了三种并法、操作步骤、
必须改的标识符、以及可以整段删掉的部分。第七节是合并时最容易出事的八处，
第八节写清了哪些功能从未在 Zotero 里验证过。

---

## 一、插件做什么

在 Zotero 右侧的**条目窗格**里加一个「词频」区块：

1. 选中带 PDF 的文献，点「统计词频（英文）」，统计这篇文献的整本词频。
2. 结果写成 CSV，放在 PDF 同目录。
3. 非英文文献直接拒绝，并给出可核查的判定依据。
4. 词形归并：`dogs → dog`、`am/is/are → be`、`walked/walking → walk`。
5. 窗格里的词表可分页；可以把词加进自定义名单，跨文献隐藏。
6. 文献已经统计过时，直接读回 CSV 显示，按钮变成「更新词频」。

**设计上的一条硬规矩：界面上的筛选只影响窗格显示，CSV 始终完整。**
CSV 是数据记录，少一个词就不成立了。合并到别的插件里时请保留这条。

---

## 二、代码结构

```
addon/
  manifest.json                    插件清单
  bootstrap.js                     引导脚本：注册 chrome、按序加载脚本、转交 main.js
  prefs.js                         22 个设置项的默认值
  chrome/content/
    preferences.xhtml              首选项面板
    styles/preferences.css
    icons/                         favicon-48/96.png、section-16/20.svg
    scripts/
      langdata.js      103 行      七套功能词表（语言判定用），纯数据
      userlist.js      129 行      用户自定义隐藏名单，读写设置项
      lemma.js         645 行      词形归并：不规则表 + 后缀规则 + 保护表
      langdetect.js    264 行      三层语言判定
      tokenizer.js     188 行      文本清洗与切词
      wordfreq.js      366 行      排序、筛选、分页、CSV 生成与反解析
      output.js        362 行      路径拼接、文件读写、定位文件
      source.js        241 行      取正文（全文缓存 / 现场提取）
      pane.js          830 行      条目窗格区块（唯一的界面）
      main.js          635 行      启动、设置读取、执行流程、自检
  locale/{zh-CN,en-US}/wordfreq.ftl  界面文案

scripts/                           开发工具，不进 XPI
  check.mjs                        静态检查
  selftest.mjs                     离线自测（181 项）
  lemma-audit.mjs                  归并结果人工审查
  demo.mjs                         端到端仿真，产出样例 CSV
  build.mjs                        打包 XPI（手写 zip，零依赖）
  install.mjs                      校验 XPI + 打印安装步骤

docs/
  zotero-10-api-verified.md        从 omni.ja 源码逐条核实的 Zotero 接口事实
  sample-output/                   真实语料的产出样例
testdata/                          从 Zotero 库里导出的真实全文缓存
```

---

## 三、模块清单

所有模块都挂在一个全局对象 `WordFreq` 上（见第五节关于这个名字的提醒）。

### 纯逻辑模块（不碰 Zotero，可离线测）

| 模块 | 公开接口 | 说明 |
|---|---|---|
| `WordFreq.langdata` | `en fr de es it pt nl`、`names`、`scriptNames`、`sets` | 七套功能词表。表里写的是**去掉变音符后的 ASCII 形态**，因为判定时的切词会先折变音符 |
| `WordFreq.lemma` | `of(word, vocab, opts)`、`IRREGULAR`、`NOT_INFLECTED`、`KNOWN_BASES`（别名 `E_VERBS`） | `opts = {possessive, capitalized}`。`vocab` 是本文档出现过的全部词形（Set），用于裁决歧义；`capitalized` 是「基本只以大写出现」的词（Set），专有名词靠它躲开规则剥后缀 |
| `WordFreq.tokenizer` | `normalize(text, opts)`、`tokens(text, opts)`、`count(text, opts)`、`detectTokens(sample)` | `count` 的 `opts.lemmaFn(word, vocab, capitalized)` 可注入归并；返回 `{counts, total, unique, forms}`，`forms` 是 `Map<词元, Map<词形, 次数>>` |
| `WordFreq.langdetect` | `DEFAULTS`、`analyze(text, opts)`、`detect(text, opts)`、`summarize(result)`、`takeSample(text, opts)` | `detect` 返回 `{isEnglish, code, reason, report}`，`code` ∈ `english / script / stopwords / too-short / empty` |
| `WordFreq.wordfreq` | `rank`、`run(text, opts)`、`buildCsv(rows, meta, opts)`、`parseCsv(text)`、`csvField`、`topWords`、`filterForDisplay`、`page` | 全部是纯函数。`run` 返回 `{rows, totalTokens, uniqueWords, listedTokens, lemmatized, mergedForms}` |
| `WordFreq.output` | 路径类：`parentOf / joinPath / baseNameOf / stemOf / extOf / csvPathFor / csvIndexFor`（纯）；IO 类：`existsAsync / existsSync / findCsvAsync / listDirAsync / resolveCollision / writeTextAsync / readTextAsync / revealAsync` | 纯的那几个不碰宿主；IO 类对每个动作都写了回退链 |

### 宿主相关模块

| 模块 | 公开接口 | 用到的宿主接口 |
|---|---|---|
| `WordFreq.userlist` | `set()`、`all()`、`has`、`count`、`add`、`remove`、`toggle`、`clear` | 经由 `WordFreq.prefGet/prefSet` 读写设置项 |
| `WordFreq.source` | `isPdfAttachment`、`findPdf(item)`、`pathOf`、`pagesOf`、`coverageOf(pages)`（纯）、`readCache`、`extract`、`getText(attachment, opts)` | `Zotero.Items.get`、`Zotero.Fulltext.getItemCacheFile/getPages`、`Zotero.PDFWorker.getFullText` |
| `WordFreq.pane` | `PANE_ID`、`register()`、`unregister()`、`reset()` | `Zotero.ItemPaneManager`、`Services.prompt` |
| `WordFreq`（main.js） | `startup`、`shutdown`、`prefGet/prefSet`、`tokenOpts/langOpts/textOpts`、`run(items, window)`、`runOne(attachment, line)`、`debugUI()`、`diagnose()`、`testText(text)` | 见上表 main.js 那行的完整清单 |

**执行流程的入口是 `WordFreq.runOne(attachment, line)`**：它读正文 → 判定语言 → 归并计数 →
写 CSV，返回 `{status: 'written'|'rejected', ...}`，失败时抛异常。窗格调的就是它。
第二个参数是进度行对象，传 `null` 表示不显示进度。

---

## 四、加载顺序

`bootstrap.js` 里的顺序是：

```
langdata → userlist → lemma → langdetect → tokenizer → wordfreq → output → source → pane → main
```

**这个顺序其实不敏感。** 十个脚本都是「加载时只建对象、不调别的模块」，跨模块调用全在函数体内。
真正的要求只有一条：**在调用 `WordFreq.startup()` 之前全部加载完**。
并进宿主插件时照抄这个顺序最省心，但不必为顺序纠结。

有一个例外要注意：`userlist.js` 和 `pane.js` 会在运行时调 `WordFreq.prefGet/prefSet`，
而这两个函数定义在 `main.js` 里（最后加载）。因为都是运行时调用，没问题；
但如果你的宿主把 `main.js` 那部分改写掉了，记得这两个函数仍然要存在。

---

## 五、并进另一个插件的做法

### 5.1 三种并法

| 并法 | 适合什么情况 | 工作量 |
|---|---|---|
| **A. 代码搬进去** | 宿主已有自己的条目窗格区块体系，想让词频成为它的一个区块 | 中。要改的标识符见 5.3 |
| **B. 保持独立插件** | 两个插件各装各的，宿主按需调用 | 小。宿主里写 `if (Zotero.WordFreq) { Zotero.WordFreq.runOne(...) }` |
| **C. 只搬纯逻辑** | 宿主只想要词频算法，界面自己写 | 小。抄前六个模块，自己接界面 |

下面按 A 写。

### 5.2 操作清单

1. 把 `addon/chrome/content/scripts/` 下十个 `.js` 抄进宿主的脚本目录。
2. 在宿主 bootstrap 的脚本列表里加上它们，放在宿主自己的 `startup` 之前。
3. 改掉 `WordFreq` 这个全局名（见 5.3）。
4. 改掉设置项前缀，四处都要改（见 5.3）。
5. 把 `WordFreq.startup()` 里做的事接到宿主的启动流程里，只需要三件：
   - `registerPreferencePane()`
   - `pane.register()`
   - `registerMenus()`（可选，只挂工具菜单）
   并把 `pluginID`、`rootURI` 从宿主的 bootstrap 参数传进来。
6. 图标路径按宿主的目录结构调整。
7. 把 `preferences.xhtml` 里的内容并进宿主的首选项面板。
8. 跑宿主自己的静态检查，再跑本项目的 `scripts/check.mjs`（改一下路径即可复用）。
9. 用户装上后跑一次 `Zotero.WordFreq.diagnose()`，本机接口是否齐全一眼就能看出来。

### 5.3 必须改的标识符

| 现在的值 | 出现在哪 | 为什么要改 |
|---|---|---|
| `WordFreq`（全局对象名） | 全部十个脚本 | 名字太通用，宿主或别的插件一撞就互相覆盖。建议改成宿主自己的前缀 |
| `Zotero.WordFreq = this` | `main.js` 的 `startup` | 同上。它是挂到真实 `Zotero` 全局上的，撞了会静默覆盖 |
| `extensions.zotero.wordfreq.` | `main.js` 的 `PREF_BRANCH`、**24 处 `prefGet` 调用**（main.js 20、pane.js 3、userlist.js 1）、`prefs.js` 全部 22 项、`preferences.xhtml` 的 21 个 `preference=` 属性 | 换前缀 |
| `'userHiddenWords'` | `userlist.js` | **这一处是字面量，不在 `PREF_BRANCH` 之下**，改前缀时最容易漏 |
| `wordfreq-section` | `pane.js` 的 `PANE_ID` | 条目窗格区块的 paneID 必须全局唯一 |
| `wordfreq-prefpane` | `main.js` 的 `PREF_PANE_ID` | 首选项面板 id 必须唯一 |
| `wordfreq-style` | `pane.js` 的 `STYLE_ID` | 注入到窗口文档的 `<style>` 的 id |
| `wordfreq-popupset`、`wordfreq-custom-panel` | `pane.js` | 注入到窗口文档的 popupset 与 panel 的 id |
| `wordfreq-*`（`wordfreq-pane-header`、`wordfreq-pane-sidenav`、`wordfreq-tools-run`） | `locale/*/wordfreq.ftl` 与 `pane.js`/`main.js` 的 `l10nID` | 所有插件的 ftl 会合并进同一个源，id 必须带插件前缀 |
| `.wordfreq-*`（CSS 类名） | `pane.js` 注入的样式、`preferences.css` | 建议加宿主前缀，避免样式互相污染 |
| `wordfreq@klskz.local` | `manifest.json`、`preferences.xhtml` 无关 | 合并后这个 id 就不存在了，`pluginID` 要传宿主的 |

### 5.4 可以整段删掉的部分

| 文件 / 代码块 | 为什么可以删 |
|---|---|
| `addon/manifest.json` | 宿主的清单接管 |
| `addon/bootstrap.js` 整个 | 宿主的 bootstrap 接管 |
| `bootstrap.js` 里的 `registerChrome` 那段 | **本插件没有任何地方引用 `chrome://zotero-wordfreq/`**。图标与界面走的是 `rootURI + 'chrome/content/...'` 与 `Zotero.Plugins.resolveURI` 的相对路径，合并后它们会自然指向宿主的根 |
| `main.js` 的 `startup` / `shutdown` / `registerPreferencePane` / `registerMenus` | 宿主已有对应机制时，把这几个函数体搬进宿主的同类函数即可 |
| `onMainWindowLoad` / `onMainWindowUnload` | 已经是空实现。留着只是为了满足 bootstrap 的调用约定，合并后可直接删 |
| `debugUI()` / `diagnose()` / `testText()` | 自检工具。建议留着，排查问题时很省事 |
| `scripts/`、`testdata/`、`docs/sample-output/` | 开发工具与语料，不进发布包 |

---

## 六、数据格式

### 6.1 CSV

UTF-8 带 BOM，CRLF 换行。前几行是 `#` 开头的元信息，之后是表头与数据：

```csv
# 来源文件,english-medium.pdf
# 生成时间,2026-10-16 21:14:08
# 全文词次,10160
# 表中词次,10160
# 去重词数,1998
# 词形归并,已开启，303 个词条由多个词形合并而来
# 语言判定,英语功能词命中率 37.2%，是次高语言（荷兰语 7.1%）的 5.20 倍。
# 取文本方式,取自 Zotero 全文缓存，252 / 252 页
rank,word,count,share_percent,forms
1,the,530,5.2165,
5,be,218,2.1457,is:90; are:47; be:37; was:22; were:14; been:7; being:1
```

- 元信息行的键是中文，`parseCsv()` 认的就是这些中文标签。改标签要同步改解析。
- `forms` 列只在词条由多个词形合并而来时才有内容，含分号与冒号，会被双引号包起来。
- `parseCsv(text)` 返回 `{meta, rows}`，`rows` 元素形如 `{word, count, share, forms}`。

### 6.2 设置项里的自定义名单

`extensions.zotero.wordfreq.userHiddenWords`，值是一段 JSON 数组字符串，词按小写、排序后存储：

```
["deleuze","kittler"]
```

解析失败（被手改坏）时按空名单处理，不抛异常。

---

## 七、合并时最容易出问题的几处

这一节是从 `docs/zotero-10-api-verified.md` 里挑出来的、踩过或差点踩到的坑。
每条都给了一行结论和出处，细节看那份文档。

1. **不要往文库右键菜单（`main/library/item`）挂东西。** 本插件 1.0.1 挂过，
   结果是**右键菜单本身经常弹不出来**，禁用插件即恢复。1.1.0 整条撤掉，改用条目窗格区块。
   原因没能定位，所以没有「正确写法」可给，只有「别用这个 target」。
2. **`startup` 里 `Zotero.getMainWindows()` 是空数组。** `Zotero.Plugins.init()` 在开窗之前
   就 `await` 了每个插件的 `startup`。**也不要在这个阶段 `await Zotero.uiReadyPromise`**——
   窗口加载反过来依赖插件初始化完成，两边互等会死锁。
3. **`.zotero-ft-cache` 是按页数截断的，默认只有前 100 页**（`fulltext.pdfMaxPages`）。
   超长文献的缓存读起来像一份完整文本，但后面几百页根本不在里面。
   要整本就得 `Zotero.PDFWorker.getFullText(itemID, null)`。顺带：
   **`Zotero.Fulltext.getPages(itemID)` 返回的字段叫 `total`，不叫 `totalPages`。**
4. **`Zotero.File.reveal(path)` 收路径字符串**，传 nsIFile 在有的版本上判断失败。
   `Zotero.Utilities.Internal` 上**没有** `showInFileManager`。
5. **`Zotero.ProgressWindow` 的 `ItemProgress` 第一个参数是图标键**（拿去拼 CSS 类），
   不是图片路径。它的所有方法都包在 `_deferUntilWindowLoad` 里，`show()` 之前调用会排队，
   这是 Zotero 自己的写法。
6. **条目窗格区块没有 `stylesheets` 选项。** 样式只能自己往窗口文档里注入 `<style>`。
   而且 **XUL 的 `<button>` 带主题给的最小宽度与内边距，不把 `appearance: none` 关掉就缩不小**。
7. **插件的 ftl 会合并进同一个 L10n 源**，所有文案 id 必须带插件前缀，否则会和别的插件撞。
8. **`Services.prompt.confirm(win, title, msg)`** 是标准的确认框；`Zotero.alert` 只有确定按钮。

---

## 八、验证状态

### 已经验证过的

| 项 | 怎么验的 |
|---|---|
| 语言判定准确度 | 三份真实英文语料判为英文（英语功能词命中率 37%–46%，门槛 20%），中文判为非英文（非拉丁字母 100%），无文字层的乐谱 PDF 判为「文本太短」 |
| 切词、归并、计数 | 181 项离线自测，跑在 `node:vm` 假沙箱里 |
| 归并质量 | 拿三份真实语料切出八千多个词元逐个人工审查，修掉三类错例（专有名词被剥后缀、`-e` 动词缺原形、`un-` 形容词被误剥） |
| CSV 生成与反解析 | 含一条往返测试：真实语料跑一遍 → 写 CSV → 读回来，逐行核对词、次数、`forms` 明细 |
| 输出路径拼接、已有文件查找 | 单测覆盖，含中文文件名、带空格文件名、`_2`/`_3` 序号版本 |
| XPI 包结构 | `scripts/install.mjs` 解包逐条核对清单字段与文件清单 |
| 用到的 Zotero 接口 | 从 `omni.ja` 真源码逐条核实，见 `docs/zotero-10-api-verified.md` |

### 没有验证过的（**都需要装进 Zotero 才能确认，交接时请如实转达**）

1. 条目窗格区块能否正常显示：侧栏按钮、折叠标题、正文里的按钮、复选框、分页控件。
2. 首选项面板能否正常渲染，尤其是下拉框的双向绑定。
3. 词表行左边那个小按钮的实际尺寸与响应。
4. 「自定义名单」按钮弹出的 panel 能否正常打开关闭、分页、逐条移除、清空。
5. 分页按钮在首页与末页能否正确置灰。
6. 选中已统计过的文献时能否自动读回 CSV 显示。
7. 「更新词频」的确认框能否弹出，取消是否有效。
8. CSV 能否真的写进 `storage/<附件 key>/` 目录，「打开 CSV」能否定位到文件。
9. 整本书现场提取（`PDFWorker.getFullText(id, null)`）的耗时。
10. 卸载/禁用时区块与菜单能否干净撤掉。

**这个插件从来没有在 Zotero 界面里跑过。** 开发环境打不开 Zotero 界面，所以上面十条全部
只能靠用户实装后确认。装好后跑这两行可以快速定位问题：

```js
Zotero.WordFreq.diagnose()   // 逐个探测用到的宿主接口在不在
Zotero.WordFreq.debugUI()    // 区块注册情况、各窗口 DOM、当前选中项能否找到 PDF
```

---

## 九、随附的开发工具

这几个脚本可以整个搬到宿主项目里，改一下路径常量即可：

| 脚本 | 作用 | 搬过去要注意 |
|---|---|---|
| `check.mjs` | 静态检查：语法、ftl 文案 id 是否都有定义、`preferences.xhtml` 绑定的键是否都在 `prefs.js` 有默认值、代码里 `prefGet('...')` 的键是否存在、XHTML 是否良构、bootstrap 脚本列表与实际文件是否对得上 | 改 `addonDir` 与必需文件清单。这几类错误的表现都是「装上去什么都不显示」，很难从界面反推 |
| `selftest.mjs` | 离线自测：用 `node:vm` 建沙箱，塞一个假的 `Zotero`（含 Map 支撑的 `Prefs`），按 bootstrap 顺序加载纯逻辑脚本 | 这是本项目最值钱的部分。改代码 → 跑一次，比每次重启 Zotero 快得多 |
| `lemma-audit.mjs` | 把归并结果摊开，列出「纯靠规则推出的词元」，非词的就是切错的 | 词表要增补时用它收敛 |
| `demo.mjs` | 拿真实语料跑端到端，产出 CSV 到 `docs/sample-output/` | 用来给用户看输出长什么样 |
| `build.mjs` | 手写 zip 打包，零依赖 | 可以直接用于宿主项目 |
| `install.mjs` | 解包校验 XPI 并打印安装步骤 | 同上 |

**推荐保留的做法**：把「后果最重的判断」抽成纯函数（只收普通对象、返回字符串），
这样它能进离线沙箱测。本项目里有两个例子：`source.coverageOf()`（决定统计整本还是前 100 页）
和 `output.csvIndexFor()`（决定能不能找到已有词频表）。这两个函数都因为写错了边界而真出过 bug，
而且都是靠单测发现的。

---

## 十、还没做的事

按当时讨论过但没实现的，列在这里免得重复讨论：

- **批量统计**：目前一次只能处理一个条目。`WordFreq.run(items, window)` 已经支持数组，
  挂到工具菜单上的那条路就是走它，但界面没有批量入口。
- **规则比较级不合并**：`bigger`、`happier` 不并进 `big`、`happy`。
  学术文本里 `-er` 绝大多数是施事名词（`computer`、`reader`、`user`），按规则剥会剥出 `comput`。
  要支持得引入形容词词表。
- **情态动词合并**：`could → can`、`would → will`、`should → shall`、`might → may`。
  这是语料库语言学的通行做法，但如果你觉得别扭，在 `lemma.js` 的 `VERB_FORMS` 里
  删掉那几行即可。
- **只有中英两套界面文案**：`locale/` 下是 `zh-CN` 与 `en-US`。
- **没有安装脚本自动装进 profile**：Zotero 默认关掉了 `extensions/` 目录的启动扫描，
  装插件只能走界面，所以 `install.mjs` 只做校验与提示。
- **PDF 提取时丢掉的连字符**：`machine-generated` 有时被提取成 `machinegenerated`，
  会被当成一个没见过的词。数量很少，没处理。

---

## 十一、参考

- `docs/zotero-10-api-verified.md` —— 从 `omni.ja` 真源码逐条核实的接口事实，
  带文件路径与行号。合并时如果对某个接口有疑问，先看这份。
- `README.md` —— 面向使用者的说明：安装、验收步骤、设置项、未验证清单。
- `PROGRESS.md` —— 开发过程记录，每一版改了什么、为什么改。
- 开发过程中还留了一份解包的 Zotero 源码在 `../tmp-zotero-api-2026-10-16/`
  （`all/` 是 3549 个文件的完整解包，`src/` 是手工挑的 8 个）。
  查接口很快，不要了可以随时删。
