

## 三个区块可以单独关掉（1.17.5）

- 首选项：`extensions.englishAssistant.sections.translate` / `sections.wordfreq` / `sections.wordfreqParts`，默认都是 true。
- `addon/chrome/content/scripts/main.js` 里新增 `EnglishAssistant.sectionOn(name)`（读不到就按 true）、`syncSections()`（按设置注册或注销，靠 `paneKey || paneID` 判断当前是否已注册）。
- 启动时不再无条件注册：`addon/chrome/content/scripts/translate/main.js` 的 `this.panel.register()`、`addon/chrome/content/scripts/wordfreq/main.js` 的 `this.pane.register()` / `this.partsPane.register()` 都包在 `EnglishAssistant.sectionOn(...)` 里。
- 设置面板顶部新增「右侧区块」组（`#ea-pref-section-translate` / `-wordfreq` / `-wordfreqParts`），勾选框的 `command` 调 `EnglishAssistant.syncSections()`，立即生效、不用重启；关掉时右栏图标与区块一起消失。
- 冒烟测试的 Prefs 桩返回 undefined，`sectionOn` 按「显示」处理，所以「注册了三个条目窗格区块」这条断言照旧成立。

## 三段式区块（1.8.0）

右栏现在有三个区块：AI 翻译、整本词频、分部词频。原来那个「词频」已改名「整本词频」（ftl 的 `ea-wordfreq-pane-header` / `-sidenav` 与 `EnglishAssistant.SECTIONS` 的兜底文案都改了）。

「分部词频」由 `addon/chrome/content/scripts/wordfreq/parts-pane.js` 注册（paneID `ea-wordfreq-parts-pane`）。1.8.0 只把标题、侧栏按钮和图标定下来，正文是空的；图标是 `icons/parts-16.svg` / `icons/parts-20.svg`，分成三段的文档、紫色 #8b5cf6（与翻译的蓝、整本词频的绿区分）。

1.9.0 把分部统计填进了那个空容器，口径与整本词频一致（同一套 `WordFreq.tokenOpts()`、词形归并、语言判定、显示筛选和分页），只是正文来自用户填的页码范围。

- **取文本。** Zotero 的全文缓存 `.zotero-ft-cache` 里没有分页标记，`Zotero.PDFWorker.getFullText(itemID, maxPages)` 也只能取前 N 页，都按不了页切。所以从阅读器的 PDF.js 视图逐页取：按 `Zotero.Reader._readers` 找 `itemID` 相同的 reader，再依次试 `reader._iframeWindow`、`reader._internalReader._iframeWindow`、`reader._internalReader._primaryView._iframeWindow`，拿到带 `PDFViewerApplication` 的那个 window，`await pdfDocument.getPage(p)` 后取 `getTextContent()`。`textContent.items` 按 `hasEOL` 拼换行，行末断词才能还原。阅读器没开、PDF 没加载完、页码超总页数都只写状态行，不抛异常。
- **CSV 命名。** `<PDF 名>_wordfreq_pages_<from>-<to>_<YYYYMMDD-HHmmss>.csv`，写在 PDF 同目录（`WordFreq.output.csvPathFor` + 时间戳后缀）。每次统计都是一份新文件，**分部不覆盖，也没有「更新词频」按钮**；同一秒内重复点才由 `resolveCollision` 加 `_2`。元信息写了 `页码范围: 12-34`、`生成时间`、`全文词次`、`表中词次`、`去重词数`，另有 `页数: 取了几页 / 总页数` 和 `备注: 分部统计，只统计第 12-34 页`。
- **查询分部。** 「开始统计」右边的按钮弹出一个面板（`type="arrow"`，class 走 `wordfreq-panel*`，与「自定义名单」弹窗同一套外观，但 id 独立：`ea-wordfreq-parts-panel` / 宿主 `ea-wordfreq-parts-popupset`），标题写「分部记录（N 个）」，右上角 `✕` 关闭。列表用 `WordFreq.output.listDirAsync`（`IOUtils.getChildren`，退回 nsIFile）扫 PDF 同目录，按文件名前缀认领同一篇 PDF、按时间戳倒序。每项显示「第 12-34 页 · 2026-10-17 17:30:05」，行尾「打开」把 CSV 读回来渲染（口径不变），「删除」确认后只删这个 CSV（`IOUtils.remove(path, { ignoreAbsent: true })`）。列表**分页**，每页 8 条（`PANEL_PAGE_SIZE`），底部「上一页 / 第 x / y 页 / 下一页」，翻页走 `WordFreq.wordfreq.page()`；删掉当前页最后一条时页码越界，由 `page()` 夹回上一页。换条目或销毁区块时弹窗自动收起；统计写完一份后，如果弹窗开着会重新扫一遍目录。

## 提示词不做用户自定义（1.11.2）

1.11.0 / 1.11.1 加过一版「设置里可改写三份提示词」（覆盖层 TEMPLATES / overrideOf / resolved，prefs `promptSystem` / `promptKid` / `promptDictionary`，设置面板的「提示词」分组）。用户决定不做，1.11.2 已整套移除：prompts.js 回到三个直接入口 `systemPrompt()` / `kidPrompt()` / `dictionaryPrompt()`，prefs 与设置界面里的相关项都删干净，对应自测断言也已撤掉。**不要再加回来**，除非用户明确要求。

## 多服务商与模型发现（1.12.0）

原来只有一条 DeepSeek 链路：`api.js` 里写死 `{baseURL}/chat/completions`，模型名靠手填。1.12.0 把请求拆成「协议表 + 服务商预设」，设置面板也从「手填模型名」换成「下拉选模型」。

**协议表在哪。** `addon/chrome/content/scripts/translate/protocols.js`（新文件，bootstrap 里排在 `config.js` 之后、`api.js` 之前）。它导出 `DeepSeekTranslate.protocols`，全是纯函数，不发请求：

- `PROTOCOLS` 三套，每套三个函数：`chatRequest(opts)` → `{url, headers, body}`、`parseChat(opts)` → `{content, model, usage}`、`modelsRequest(opts)` → `{url, headers}`。
  - `openai`：`/chat/completions`，`Authorization: Bearer`，system 留在 messages 最前，`json !== false` 时加 `response_format`；列表 `/models`。
  - `anthropic`：`/v1/messages`，`x-api-key` + `anthropic-version: 2023-06-01`，system 单独一个字段，`max_tokens` 必填（默认 1024）；列表 `/v1/models`，同样两个鉴权头。
  - `gemini`：`/v1beta/models/{model}:generateContent?key=...`，body 用 `contents` / `systemInstruction` / `generationConfig`，回复取 `candidates[0].content.parts[].text`（跳过 `thought` 块）；列表 `/v1beta/models?key=...`，返回的 `name` 要去掉 `models/` 前缀。
- `PRESETS` 13 条（deepseek、openai、moonshot、zhipu、dashscope、siliconflow、openrouter、groq、ollama、lmstudio、anthropic、gemini、custom），每条只有 `key / label / protocol / baseURL / defaultModel`。加一家 OpenAI 兼容的服务只加一行。
- 纯函数入口：`joinUrl`（归一化尾部斜杠，已含尾段时不重复拼）、`normalizeModels`（认 `{data}` / `{models}` / 裸数组 / 字符串项，去掉 `models/` 前缀并按 id 去重）、`buildChatRequest`、`buildModelsRequest`、`parseChatReply`、`resolve`、`pickModel`、`isLocal` / `needsKey`（本机地址不要求 Key）。

`api.js` 只剩接线工作：`settings(overrides)` 读 prefs 并用 `resolve` 算实际协议/地址/模型，`chat(messages, opts)` 保持原有签名（`service.js` 与 `wordbook.js` 都不用改），`listModels(overrides)` 固定 8 秒超时，`testConnection(overrides)` 用一句很短的话验证。错误统一成 `{code, message}`，`message` 是中文；`_describeStatus` 覆盖 400/401/402/403/404/413/422/429/5xx，未收录的显示状态码加响应前 200 字。

**prefs 键**（前缀 `extensions.englishAssistant.translate.`）：

- `provider`（默认 `deepseek`）、`protocol`（默认 `openai`）、`baseURL`（默认 `https://api.deepseek.com`）、`apiKey`、`model`。
- `baseURL` / `apiKey` / `model` 沿用旧键名，1.12.0 之前存的不用迁移。
- 旧配置兼容规则：`provider` 为空（老用户）时按 `custom` + `openai` 处理，`baseURL` 为空时回落到 DeepSeek 官方地址；`protocol` 只在 `provider === 'custom'` 时生效，其它服务商由预设决定协议。

**设置界面**（`addon/chrome/content/preferences-translate.xhtml`）：「DeepSeek 接口」改名「AI 服务」，顺序是服务商 → 服务地址 → API Key →（仅自定义时出现的）协议 → 模型下拉 + 「读取模型」→ 模型名手填框 → 测试连接。模型这一项故意做成两个控件：上面下拉来自 `/models`，下面输入框绑 `model`，两者互相同步；`/models` 读不到时手填照样能用。换服务商会把地址与该家默认模型直接写进配置，并在灰字里说明「已经换了，可以再改」。

**自测。** `scripts/selftest.mjs` 的沙箱现在多加载 `protocols.js` 与 `api.js`，新增 34 项断言（地址拼接、三套协议的 URL/头/body、三套回复解析、模型列表三种形状、旧配置兼容、缺 Key 报错、状态码文案），总数 163 → 197。

**风险点。** Gemini 的 Key 只能放在查询串里，会被访问日志记到；Anthropic 的 `max_tokens` 必填，已在协议层兜 1024；少数服务商的 `/models` 需要额外头或根本不提供（Azure 走部署名），这时只能手填模型名；Ollama / LM Studio 地址是 `http://`，Zotero 的 HTTP 请求允许本机 http，但换成别的明文 http 服务可能被拦。

## EPUB 支持（1.13.0）

- `wordfreq/source.js`：新增 `isEpubAttachment()` / `isTextAttachment()` / `findTextSource()`（认 PDF 与 epub+zip）；`findPdf()` 仍然存在，但改成「EPUB 时返回原因」，只给分部统计用。`getText()` 里 EPUB 走单独分支：只读 `Zotero.Fulltext.getItemCacheFile` 的文本，拿不到就抛「这篇 EPUB 还没有全文索引…」；不走 PDFWorker（EPUB 没有页码也没有 PDF 文字层）。
- 整本词频：`pane.js` 的 5 处 `findPdf` 换成 `findTextSource`，文案里的「PDF」改成「文献 / PDF 或 EPUB」。CSV 仍写在文献同目录，`counts.js` 的「本书词次」按路径查表，对 EPUB 同样成立。
- 分部词频：1.13.0 时仍用 `findPdf`，EPUB 按钮禁用。1.14.0 已改成按字符百分比统计，见下一节「EPUB 分部统计（1.14.0）」。
- 翻译上下文：`context.js` 新增 `budgetFor(attachment)`——EPUB 用 2000 字符、PDF 沿用 pref `contextChars`（1200）；`trimToBudget()` 与 `extractWindow()` 现在先找段落边界（两个换行），找不到再退句子边界，段落断点要落在「后半段」才采用，避免把上下文裁得过短。

## EPUB 分部统计：已停用（1.15.0 起）

EPUB 的分部统计在 1.14.0–1.14.12 试了八版（页码折算 → 视口文字定位 → 阅读器视图统计 → 两种滚动假设），始终无法稳定算出「当前读到哪儿」。根因是阅读器的分页是按排版算的、全文缓存按字符算，两者对不齐（这本书差 0.7 个百分点），而且 EPUB 的滚动发生在正文 iframe 外层，从 chrome 侧拿不到准确的可见文字。
**1.15.0 起：EPUB 选中时区块只显示一句「当前版本的分部统计只支持 PDF，EPUB 还做不了。EPUB 的整本词频可以正常用。」，输入框、按钮、分页全部隐藏。** 百分比相关代码（`sliceByPercent` / `parsePercent` 等纯函数与自测）留着，将来若改用「按章节」或按 CFI 映射可以复用。

原 1.14.0 的实现记录：

- `wordfreq/parts-pane.js`：区块不再调 `source.findPdf()`，改用 `findTextSource()` + `attachmentKind()`（EPUB 认 `application/epub+zip` 与 `.epub` 路径）。PDF 与 EPUB 共用一套词表、分页、星标、自定义名单；范围输入框分成两行，按附件类型切换显示。
- PDF 仍是页码：校验、从阅读器 PDF.js 逐页取文本、CSV 命名 `<名>_wordfreq_pages_12-34_YYYYMMDD-HHMMSS.csv`、元信息 `页码范围: 12-34` 与 `页数` 都没动。
- EPUB 用字符百分比：输入 0–100、可带小数，校验起始 ≥ 0、起始 < 结束、结束 ≤ 100。文本取 `source.getText(attachment, { textSource: 'cache' })`，起点 `floor(len * from / 100)`、终点 `ceil(len * to / 100)`，slice 后走同一个 `wordfreq.run(text, tokenOpts())`。CSV 命名 `<书名>_wordfreq_pct_10-20_YYYYMMDD-HHMMSS.csv`，元信息写 `取文本方式: 取自 Zotero 全文缓存（EPUB）`、`范围: 10%-20%（按字符比例）`、`备注: 分部统计，只统计第 10%-20%（按字符比例）`，不写 `页数`。
- 文件名解析：`parsePartName()` 先比 `<stem>_wordfreq_pages_` 再比 `<stem>_wordfreq_pct_`，两个前缀互不包含，旧文件照旧识别；`NAME_RE_PCT` 允许小数范围。返回值带 `kind: 'pages' | 'pct'`，`labelOf()` 统一给出「第 12-34 页」/「第 10%-20%」。
- 历史列表：`listHistory()` 两种文件都收，`sortKey` 是时间戳，按时间倒序混排；打开与删除沿用原有逻辑，删除仍确认，状态行按类型说 PDF/EPUB。
- `wordfreq/wordfreq.js`：`buildCsv()` 的元信息键序在 `page_range` 后加了 `range→范围`，只有 EPUB 分部会传。
- 自测：`scripts/wordfreq-selftest.mjs` 新增 26 项（百分比换算与取整、文件名生成与解析、两类互不误认、非法范围、短文本与空文本切片、CSV 元信息回读），总数 208 → 234。
- 纯函数导出在 `WordFreq.partsPane` 上：`formatPercent` / `parsePercent` / `checkPercentRange` / `sliceByPercent` / `rangeSuffix` / `partFileName` / `labelOf` / `outcomeFromCsv` / `percentOfIndex`。

## 分部输入框的右键填位置（1.14.2）

- 四个输入框（`.wordfreq-parts-from/.to`、`.wordfreq-parts-pct-from/.to`）都绑了 `contextmenu`，共用一个 `menupopup`（`#ea-parts-popup`）。
- 菜单项文字在 `popupshowing` 时按 `kindOfInput(targetInput)` 切换：页码框写「填写当前页码」，百分比框写「填写当前位置」。
- 1.14.3 起百分比优先走**文字定位**：`percentOfVisibleText()` 取阅读器 iframe 里视口内第一段带字的 `p/li/blockquote/h*`，交给 `percentOfChunkInText(chunk, text)`——全文缓存两端都压成单空格，探针由长到短试 `60/40/28/18/12` 字，命中就用 `percentFromOffset(pos, len)` 换算（保留一位小数、钳 0–100）。EPUB 的 `pageIndex/pages` 经常没有或不准，这条才是主力路径。\n- 拿到 null 才退回页码范围：`currentPercentOf(attachment)` 沿用 `currentPageOf()` 那批阅读器内部字段（`reader.state` / `_state` / `_internalReader._state` / `_primaryView._state` 的 `pageIndex` 与 `pages`），交给 `percentOfIndex(index, total)` 换算：保留一位小数、钳在 0–100，缺页数返回 null 并提示「没拿到当前位置」。
- 兜底取附件按类型分派：百分比走 `findTextSource`，页码仍走 `findPdf`。


## 最短词长的口径（1.16.2）

设置项改叫「统计方式」，最短词长从「短于 N 不计入」换成「**小于等于 N 的单词不计入，0 表示全部计入**」。

- `wordfreq.minWordLength` 的含义变了：存的是「排除到第几个字母」，分词器要的是「至少几个字母才收」，两者差一。换算集中在 `WordFreq.minLengthFromPref(value)`（`addon/chrome/content/scripts/wordfreq/main.js:48`），`tokenOpts()` 里只调它，不再自己 `Number()`。
- `prefs.js` 默认值 2 → **1**（等价于旧口径的「≥2 个字母才收」），新增标记 `wordfreq.minWordLengthV2`（默认 false）。
- 迁移：`WordFreq.migrateMinWordLength()`（`main.js:61`）在 `WordFreq.startup()` 里跑一次——没有标记就把旧值减一（下限 0）再打标记。旧值 3 → 新值 2，过滤效果不变。
- 自测新增 12 项（0/1/3/小数/负数/非数字的换算，迁移减一、打标记、只迁一次、下限 0），词频自测 300 项。
## 设置文案改版（1.16.1）

按用户逐条标注重写，原则是「一行说清、不解释原理」：

- 词频面板：屈折变化的标签改成「（包括单复数、动词时态、不规则形式的合并统计）」，删掉其后那条解释「只并屈折变化…」；删掉「忽略只出现一次的词」的解释；最短词长改成「短于这个长度的词不计入，1 表示全部计入」；语言判定提示改成「注意：不建议关闭，因为非英文语言的统计效果并未经过测试！」
- **删掉整个「条目窗格显示」组**：`paneHideCustom` 不再出现在设置里，按默认值 `true` 走（窗格隐藏自定义名单里的词）。用户原话「这项设置删除」。
- 自定义名单：「恢复默认名单」的说明改成「将自定义名单恢复到初始状态，注意，这可能会导致当前名单丢失！」
- 翻译面板：删掉服务商下面那行动态说明（`#ds-pref-provider-note` 节点移除；`refreshProviderNote()` 里本来就有 `if (!note) return`，留着不报错）；服务地址说明合成一句「默认地址随服务商自动切换，一般不用改；确有需要也可以自己改。」
- 模型名标签改成「模型名（备用）」，说明改成「这里一般不需要自己填；上方读不到模型名时，可以在这里手动填写。」
- 解释语言的三个选项去掉括号后缀：`简体中文（默认）` / `简单英文` / `简单英文·极简`；下面改成三行，分别说明中文、简单英文、简单英文·极简各给什么。
- 配置备份说明：第一行「里面包含本插件的全部设置」；第二行「文件里有 API Key，不要随意发给别人！单词本（即收藏）不会被备份，它在 Zotero 数据目录的 wordbook.json，需要单独复制那个文件。」
## 简体中文·精简（1.17.2）

- `explainMode` 多一个取值 `zh-lite`，下拉文案「简体中文·精简」。`prompts.js` 的 `systemPrompt()` 里 `var lite = explainMode === 'zh-lite'`，不走幼儿模式那两条分支。
- 输出模板跟着缩：`senses` 去掉 `register` 字段；`inContext` 只留 `gloss` 与 `note`（且 `note` 是最后一个字段，收尾不带逗号，否则拼出来的 JSON 示例会多一个逗号）；`examples` / `explanation` / `etymology` / `usage` 全部不出现。
- 规则段用 `if (!lite && ...)` 跳过例句与词源两条，另加三条：只要 senses 与 inContext.gloss/note、senses 每个词性一行、句子与段落只给 translation。
- 模板末尾插了一段 `【本次为「简体中文·精简」】` 说明，紧跟 `【第二步】` 之后（排在幼儿模式那段之前）。
- `render.js` 不用改：缺 `sentence` / `sentenceTranslation` 时那两块本来就不渲染，卡片自然只剩「释义」与「在本句中的含义」。
- 自测新增 9 项（提示词含精简说明、四个字段不出现、senses/inContext 仍在、音标仍在、两份模板示例仍是合法 JSON），翻译自测 221 → 232。
## 推理型模型的空回复（1.17.1）

现象：简体中文模式下报「服务返回了空内容（DeepSeek · deepseek-v4-pro）」，而其他解释语言正常。

原因：这类模型先写思考再写回答，思考记在 `message.reasoning_content`，额度不够时 `content` 就是空的，`finish_reason` 为 `length`。中文模式要写完整词条（义项、例句、词源），最容易把额度耗光。

- `protocols.js` 的 openai `parseChat` 多取两个字段：`finishReason`（`choice.finish_reason`）与 `reasoningChars`（`reasoning_content` 或 `reasoning` 的长度）；`parseChatReply` 原样透传，另两种协议没有这两个字段时是空串 / 0。
- `api.js` 的 `chat()` 改成 `attempt(budget)` 内部函数：第一次拿 `maxTokens` 发；内容为空且「额度用尽或有思考内容」时，把上限翻倍（上限 8192）重试一次；仍然为空就抛专门的错误，说明思考写了多少字、加倍后仍是空、建议调大最大输出或换模型。日志会写一行 `上一次返回是空的（finish_reason=…，思考 N 字），把上限从 X 提到 Y 再试一次`。
- 翻译自测新增 4 项（finish_reason、思考字数、普通回复两个字段的默认值），共 221 项。
## 设置合并成一个入口（1.17.0）

Zotero 的「设置 → 英文助手」原来有两个条目（`英文助手 · 翻译`、`英文助手 · 词频`），现在只有一个「英文助手」。

- 片段：`addon/chrome/content/preferences.xhtml`，根节点 `#ea-prefs-root`，里面依次是 `#ea-translate-prefs` 与 `#ea-wordfreq-prefs` 两个 vbox，中间一条 `.ea-prefs-divider`。这两个 vbox 就是原来两个文件的内容，逐字搬过来，只在外面加了 `<label class="ea-prefs-title"><html:h2>翻译/词频</html:h2></label>` 当大标题。
- 接线：`onload` 只挂在根节点上，调 `Zotero.EnglishAssistant.prefsRoot.onLoad(event)`（`addon/chrome/content/scripts/main.js` 的 `prefsRoot`），由它分别把两个 vbox 交给 `DeepSeekTranslate.prefsPane.onLoad({ target: vbox })` 与 `WordFreq.prefsPane.onLoad({ target: vbox })`。两个子处理器都用 `event.target.ownerDocument`，所以传 vbox 进去一样能拿到文档。
- 注册：只保留 `DeepSeekTranslate.registerPreferencePane()`，`label: '英文助手'`、`src: 'chrome/content/preferences.xhtml'`、`stylesheets` 里**两份 CSS 都列**（`preferences-translate.css` + `preferences-wordfreq.css`），少了哪份对应段落的排版就散。`WordFreq.registerPreferencePane()` 与其调用、`WordFreq.PREF_PANE_ID` 已删除。
- 面板 id 从 `ea-translate-prefs` 改为 `ea-prefs`（`translate/config.js` 的 `PREF_PANE_ID`），「去设置里填 Key」这类跳转仍用 `Zotero.Utilities.Internal.openPreferences(...)`。
- 大标题样式 `.ea-prefs-title`、分隔线 `.ea-prefs-divider` 写在 `preferences-translate.css` 末尾。
- 冒烟断言改成「只注册一个面板、指向 preferences.xhtml、标题就是「英文助手」」。
## 配置备份（1.16.0）

- `addon/chrome/content/scripts/wordfreq/backup.js`，暴露 `WordFreq.backup`。放在 wordfreq 目录只是因为自测沙箱只加载那一个目录，与功能归属无关。
- 范围：`extensions.englishAssistant.*` 下的全部首选项（含 `wordfreq.userHiddenWords` 里存的自定义名单）。单词本 `wordbook.json` 属于用户数据，**不在备份里**，避免「导入设置」顺手覆盖收藏。
- 文件格式：`{ format: 'english-assistant-config', version: 1, exportedAt, pluginVersion, prefs: { 'extensions.englishAssistant.…': 值 } }`，缩进 2 空格，键按名字排序。
- 纯函数（自测直调）：`pickPrefs` / `buildBackup` / `parseBackup` / `coerceValue` / `summarize` / `fileNameFor`。
- 导入按目标首选项的**现有类型**写回（`getPrefType`）：int 用 `Math.round`、bool 认 `true`/`'true'`/`1`、字符串 `String()`。类型不认识或转换失败的键跳过并计数，不新建首选项。
- 文件选择器走 `chrome://zotero/content/modules/filePicker.mjs` 的 `FilePicker` 类；`fp.file` 是**路径字符串**（这两个坑在 1.6.3/1.6.4 踩过）。
- 界面：`preferences-translate.xhtml` 最后新增「配置备份」组（`#ds-pref-export-config` / `#ds-pref-import-config` / `#ds-pref-backup-status`），在 `DeepSeekTranslate.prefsPane.onLoad()` 里接线。
- 导入完成后依次调 `WordFreq.userlist.init()`、`WordFreq.pane.refreshAll()`、`DeepSeekTranslate.refreshPanels()`，让名单与两个面板按新设置重画。
- 自测：`scripts/wordfreq-selftest.mjs` 新增 22 项，词频自测 288 项。
## 已知问题：EPUB（2026-10-30 记录，2026-10-31 更新）

用户说过「EPUB 依旧存在问题，但暂时不想改了，先记下来」。分部统计已在 1.14.0 补上（见上一节）；下面几条仍按「用户主动提起再改」处理。

现状与已知问题：

1. **整本词频与 EPUB 分部统计都依赖 Zotero 全文索引**：`getText()` 的 EPUB 分支只读 `Zotero.Fulltext.getItemCacheFile`，没索引直接抛「这篇 EPUB 还没有全文索引」。图片型/固定版式 EPUB、以及 Zotero 索引失败的书写，会一直统计不出来。
2. **翻译上下文可能仍不对**：1.13.1 已把 EPUB 改成「跳过阅读器给的 localContext、走全文定位 + 1200 字符窗口」，但用户实测后仍反馈有问题（未说明具体表现）。下次排查时优先确认：EPUB 是否命中 `locate()`（命中与否决定走窗口还是退回阅读器那一句）、`Zotero.Fulltext` 缓存的 EPUB 文本是否与阅读器选区文本差异过大。
3. **百分比切分的固有缺陷**：按字符数切片会落在句子中间，开头结尾可能带半句；EPUB 缓存是纯文本，没有章节标记，做不到「按章统计」。短文本上百分比区间可能切出空串或极短的片段，界面会给「这个百分比区间里没有文字」的提示。
4. **未在真机验证过的部分**：EPUB 的整本与分部 CSV 落盘位置（`_wordfreq.csv` 与 `_wordfreq_pct_…csv`）、`counts.js` 的「本书词次」对 EPUB 是否命中同一份表、`getText()` EPUB 分支的 `note` 文案。

排查入口：`wordfreq/source.js`（`isEpubAttachment` / `findTextSource` / `getText` 的 EPUB 分支）、`translate/context.js`（`isEpub()` / `budgetFor()` / `buildContext()`）、`wordfreq/parts-pane.js`（`attachmentKind` / `sliceByPercent` / `runForBody` 的 EPUB 分支）。