# 开发记录

目录用途：Zotero 10.0.6 的英文文献整本词频统计插件。
建立：2026-10-16 15:39。18:00 开工，19:0x 完成。
**交付说明看 [README.md](README.md)。** 这个文件只是过程记录，供日后回头查。

## 用户的原始需求

1. 统计英文文献 PDF 的整本词频（每个单词出现多少次）。
2. 统计完成后在 PDF 同目录下写出记录全部词频的 CSV。只输出 CSV。
3. 非英文文献直接拒绝，并给出判定依据。

约束：用户不在电脑前，已开 auto review；**用户无法重启 Zotero**，插件不能在 Zotero 内实测。

## 时间线

**15:39–16:00** 讲思路、搭骨架。写完 manifest / prefs / bootstrap / 七个功能脚本 /
首选项面板 / locale / 打包脚本 / 静态检查脚本 / 离线自测脚本，一行都没跑。
用户要求复杂工作留到 6 点之后，停手，目标暂停。

**18:00–19:05** 继续。

1. 静态检查通过。
2. 离线自测跑出 4 个失败，其中一个是真的 bug：中文文献因为切不出拉丁词，
   被误报成「文本太短」而不是「非英文」。原因是语言判定里词数门槛排在了
   书写系统判断前面。调整顺序后修复。
3. 核实 Zotero 10.0.6 接口。挖出两个改变设计的事实：
   - `.zotero-ft-cache` 是按**页数**截断的（`fulltext.pdfMaxPages` 默认 100），
     不是按字符数（`textMaxLength` 只管 EPUB 和纯文本）。原设计用「每页字符数」
     猜截断，猜错了方向。改成比 `getPages()` 的已索引页数与总页数。
     查 `zotero.sqlite` 确认这个坑在本机真实存在：70 条索引记录里 11 条不完整，
     最夸张的是 1121 页的书只索引了 100 页。
   - `getPages()` 的总页数字段叫 `total` 不叫 `totalPages`。原代码读错了字段，
     会一直以为没有页数信息。修。
4. 抽出 `source.coverageOf()` 纯函数，让「整本还是前 100 页」这个判断能进离线自测。
5. 扩测试到 75 项，补上输出路径拼接、缓存覆盖判断、真实语料（含短英文、
   无文字层的乐谱 PDF）。
6. 加 `scripts/demo.mjs` 做端到端仿真，用真实语料产出 CSV 到 `docs/sample-output/`，
   逐字节核对 BOM 与 CRLF。
7. 写 `scripts/install.mjs`（解包校验 XPI + 打印安装步骤），打包并校验通过。
8. 写 README 与 `docs/zotero-10-api-verified.md`。
9. 把通用的接口事实写回 skill `zotero-plugin-dev`。

## 用户装完之后的反馈与 1.0.1

用户装 1.0.0、重启后跑 `Zotero.WordFreq.diagnose()`，结果是所有接口都在
（包括全局 `IOUtils.writeUTF8`、`PathUtils.join`），七套词表也加载了。
但**右键 PDF 看不到菜单项**。

查出原因：`Zotero.Plugins.init()` 会 `await` 每个插件的 `startup`，
而 `Plugins.init()` 跑在主窗口打开之前。1.0.0 在 `startup` 里调
`Zotero.getMainWindows()` 往窗口 DOM 塞菜单，那一刻数组是空的，什么都没塞进去。
也不能改成 `await Zotero.uiReadyPromise`——窗口加载反过来依赖插件初始化，会死锁。

1.0.1 的修法：改用 Zotero 10 的官方接口 `Zotero.MenuManager.registerMenu()`，
target 用 `main/library/item`（条目右键菜单）和 `main/menubar/tools`（工具菜单，
不依赖选中内容的第二个入口）。窗口生命周期交给 Zotero 管，不再碰 DOM。
`onShowing(event, context)` 的 context 直接带 `items`，用 `setVisible()` 控显隐。
老版本没有 MenuManager 时才退回 DOM 注入，并补上延时重试与 `Services.wm` 监听。

同时加了 `Zotero.WordFreq.debugMenus()`，报告菜单注册方式与各窗口的 DOM 状态。

## 1.1.0：撤掉右键菜单，改成条目窗格区块

用户反馈：插件启用后**右键书籍经常弹不出右键菜单**，禁用插件就正常。这比「菜单项时有时无」
严重，说明挂在 `main/library/item` 上有副作用（原因没能定位，也没法在无界面环境里复现）。

用户提出改用右侧条目窗格，并希望留出扩展余地。1.1.0 照此重构：

- 删掉 `main/library/item` 的注册，以及整套 DOM 注入回退代码
  （`addToWindow` / `removeFromWindow` / `attachToAllWindows` / `scheduleWindowAttach`）。
- 新增 `pane.js`，用 `Zotero.ItemPaneManager.registerSection` 注册一个
  「词频」区块（paneID `wordfreq-section`）：按钮「统计词频（英文）」+「打开 CSV」，
  状态行 + 结果区（词次、去重、取文本方式、Top 10、CSV 路径）。
  结果按附件 itemID 缓存，切走再切回来还在。
- 保留 `main/menubar/tools` 一条，用于一次处理多个选中条目。
- 自检命令从 `debugMenus()` 改成 `debugUI()`（旧名保留为别名）。

## 2.0.0：词形归并

用户要求把同一个词的屈折变化合并统计：dog 3 次 + dogs 5 次 → dog 8 次，am/is/are 都算 be。

做法：新增 `lemma.js`，三条路一起用——不规则表（am→be、went→go、children→child）、
后缀规则（-s/-es/-ies/-ed/-ing，配禁剥表与已知原形表）、文档词汇表（裁决 used 归 us 还是 use）。
只并屈折变化，派生词（happiness/national/quickly）不动；规则的 -er/-est 不并，
因为学术文本里那多半是 computer/reader 这类施事名词。

CSV 增加 `forms` 列记录合并明细（`dog:8,...,dog:3; dogs:5`），合并结果可回溯。

误例是靠 `scripts/lemma-audit.mjs` 拿三份真实语料审出来的，一共修了三类：
1. 专有名词被剥后缀（Sachs→sach）→ 加「小写占比低于四分之一即视为专有名词」的保护。
2. `-e` 结尾动词缺原形（invoked→invok）→ 分四批把约 600 个原形补进 KNOWN_BASES。
3. `un-` 加过去分词的形容词被剥（unchanged→unchang）→ 只有整词本身是动词才剥。

顺带修掉一个真 bug：`pulled` 会被削成 `pul`——双写还原没有区分 ll/ss/ff/zz
这几种本身合法的英文词尾。

实测：长语料（整本书）词形去重 10231 → 词元 8243，减少 19.4%；
`be` 以 1856 次升到高频第 5 位。

## 2.1.0：窗格里的词表筛选与分页

用户要求：侧边栏显示高频词时，能按需隐藏常用词（the、be、very）和简单词（cat、dog、music），
两者都要能开关，词多时分页显示。

做法：
- 新增 `wordlists.js`（手写的常用词表 + 筛选判据）与 `simplewords.js`（生成的简单词表）。
- 简单词表用 Google Trillion Word Corpus 派生的公开一万词表取前 5000，
  由 `scripts/make-wordlist.mjs` 生成，源数据留在 `data/` 下，重新生成不用联网。
  判据是「排名 ≤ 设置里的数」，默认 2000：cat(1760)、dog(1047)、music(129) 藏，
  instrument(3682)、tone(4082) 留。
- `wordfreq.js` 加 `filterForDisplay()` 与 `page()` 两个纯函数，都能离线测。
- `pane.js` 加两个复选框（直接读写设置项，与设置面板同步）、分页控件、
  以及每个合并词条的 forms 明细。
- **筛选只作用于窗格显示，CSV 始终完整。**

顺带：缩写形式（you're、you'll、don't）进不规则表。它们带撇号，后缀规则动不了，
不处理就会冒进高频榜。

实测（默认设置）：长语料 8243 个词元 → 隐藏常用词 165、简单词 1041，剩 7030，
第一页变成 instrument / tone / composer / piano / technological。

## 2.2.0：用户自定义隐藏名单

用户要求：词表每行左边加个按钮，点了把词加进「用户名单」，之后读任何文件都不再显示它；
是否启用同样由用户勾选。

做法：
- 新增 `userlist.js`：名单存在设置项 `userHiddenWords` 里（JSON 数组），
  提供 add / remove / toggle / clear / has / all / set / count。词按小写存，读写带缓存，
  设置项被手改坏时按空名单兜底。
- `pane.js`：每行左边一个 ＋ / － 按钮（词按参数传进按钮工厂，不用循环闭包变量——
  否则所有按钮都会指向最后一个词）；窗格底部加「自定义名单」管理区，
  逐条 ✕ 移除 + 一键清空；第三个复选框「隐藏自定义单词」。
- `filterForDisplay` 的判定顺序：自定义 → 常用词 → 简单词。用户亲手指定的词排最前，
  计数也记在它头上。
- 名单全局生效：在 A 文献里加的词，读 B 文献时同样被滤掉。

selftest 里的假 `Zotero.Prefs` 改成了 Map 支撑的真存取，这样名单的读写能真的往返一趟；
顺带把 `main.js` 也加载进沙箱，`prefGet` / `prefSet` 因此可以被测到。

## 2.3.0：按用户反馈调整四处

1. **不再自动弹出 CSV 所在文件夹。** `revealAfterWrite` 默认改成 false。
   窗格里本来就有「打开 CSV」按钮，要看的时候自己点。
2. **行内按钮缩小到约 18px**（原来是一个整宽的 XUL 按钮，约 60px），
   符号从 ＋ 改成 −（U+2212，不是 emoji 那个 ➖，emoji 在不同字体下尺寸不受控）。
   条目窗格区块没有 stylesheets 选项，样式靠往窗口文档里注入一个 style 元素；
   XUL button 默认带主题的最小宽度与内边距，得把 `appearance` 关掉才缩得下去。
3. **自定义名单从窗格底部挪进单独的弹窗。** 底部只留一个「自定义名单（N 个）」按钮，
   点开是一个 XUL `panel`，里面的列表按「每页显示多少个词」分页，可逐条移除、可清空。
   panel 建在窗口文档的 popupset 里，跟主窗口同一个 JS 上下文，
   比开 chrome:// 对话框省事，也不用给对话框单独准备一套加载逻辑。
4. **去掉常用词与简单词筛选。** 相应的两个复选框、三个设置项、
   `wordlists.js`、`simplewords.js`、生成脚本与 data 目录一并删除，XPI 从 73.7 KB 降到 54 KB。
   `includeStopwords`（CSV 输出里是否保留停用词）是另一回事，保留，回到用 langdata.en 判。

## 2.4.0：已有词频表就直接显示

用户要求：检测到当前 PDF 已经生成过词频表，就直接在侧边栏显示，不用再点「统计词频」；
这种情况下按钮改成「更新词频」，点了先弹确认。

做法：
- `wordfreq.js` 加 `parseCsv()`：把写出的那份 CSV 反解析回 `{meta, rows}`。
  不用重新提取 PDF 全文——表里该有的都有，而且显示的就是磁盘上那份表的真实内容。
- `output.js` 加 `findCsvAsync()` 与纯函数 `csvIndexFor()`：
  先试默认文件名，没有再扫目录里带序号的版本（覆盖关掉时会写成 `_2`、`_3`），取序号最大的。
  `csvIndexFor` 是纯函数，文件名匹配的边界情况都在离线自测里。
- `pane.js` 加 `onAsyncRender`：同步的 `onRender` 不能读文件，所以在这里去查已有表、
  读回来、拼成和跑统计时同样形状的结果，再渲染。查过的附件记在 `csvChecked` 里，
  不重复问文件系统；异步读完还会比对当前条目 id，避免用户切走后把数据盖到别人头上。
- 按钮文案随状态变：没有结果时「统计词频（英文）」，有结果时「更新词频」。
  点「更新词频」先用 `Services.prompt.confirm` 问一句，确认了才重算。

顺带修掉 `csvIndexFor` 里一个边界 bug：默认文件名（`paper_wordfreq.csv`）因为长度判断写成
`<=` 而被判成「不匹配」，导致连最基本的那种表都找不到。

自测里加了一条**往返测试**：拿真实语料跑一遍，写出 CSV 再读回来，逐行核对词、次数、
forms 明细与全文词次。这条守住的就是「读回来的数据要和重新算的一致」。

## 2.5.0：窗格只留词表

用户要求：去掉「已有词频表，直接显示。」「全文词次……」「取文本……」这几行文字，
去掉每个词下方的「合并自」明细与前面的序号，每页改成 20 个词。

做法：
- 结果区不再写任何统计行。成功时状态文字也清空，窗格里只剩词表。
  统计数字、取文本方式、合并明细都还在 CSV 里，需要的时候看表。
- 词表每行只留：小按钮、词、次数。序号与合并明细都去掉。
- `DEFAULT_PAGE_SIZE` 与 `panePageSize` 的默认值从 10 改成 20。
- 顺带删掉随之无用的 `shortForms()` 与 `.wordfreq-rank` 样式规则。

保留了两种必要提示：出错／被拒绝时的说明，以及「筛选把所有词都滤掉了」的提醒——
没有它们，用户看到空白区块不知道发生了什么。CSV 路径那行也留着，它是用来定位文件的。

## 最后的验证状态

```
node scripts/check.mjs      检查通过（7 个脚本、17 项设置对齐、l10n 全覆盖）
node scripts/selftest.mjs   通过 75 项
node scripts/demo.mjs       5 份语料，3 份出 CSV、2 份正确拒绝
node scripts/build.mjs      18 个文件，30.7 KB
node scripts/install.mjs    XPI 检查通过
```

## 没做的事

- 插件没在 Zotero 里装过、没跑过。用户无法重启 Zotero，所以这一步留给用户。
  未验证项逐条列在 README 第一节。
- 真语法/德语的拒绝路径只有构造样本测过。这个 Zotero 库里没有法语、德语文献，
  `testdata/latin-other.txt` 因此没生成。构造样本是过的，而且阈值余量很大
  （英语实测 37%–46%，门槛 20%），风险低。

## 留在工作区里的东西

- `..\tmp-zotero-api-2026-10-16\` 是侦察 Zotero 接口时的临时目录，
  里面有 `all/`（3549 个 Zotero 源文件解包）和 `src/`（手工挑的 8 个）。
  查接口很快，留着有用；不要了随时可删。
