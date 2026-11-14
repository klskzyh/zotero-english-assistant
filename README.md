# 英文助手（Zotero 插件）

适用于 Zotero 的英文阅读助手插件，功能包含：**划词翻译**、**整本 / 分部词频统计**、**单词本**。
本文档由klskzyh与DeepSeek共同编辑完成。

![版本](https://img.shields.io/badge/版本-0.1.0--beta.1-orange)
![Zotero](https://img.shields.io/badge/Zotero-7.0%20~%2010.x-blue)
![许可](https://img.shields.io/badge/许可-MIT-green)


## 这个插件能做什么

- **划词翻译**：在 PDF 或 EPUB 里选中词、短语、句子、段落，交给任意一家带 API 的大模型服务翻译。插件会把选中位置前后的原文、文献的标题作者年份摘要一起送过去，所以单词和短语可以根据文献上下文给出释义，而不只是词典里的一串义项。
- **整本词频**：统计一篇英文文献的整本词频，结果写成 CSV 放在文献同目录，用于阅读整本文献之前大致判断哪些词语需要提前了解。
- **分部词频**：只统计 PDF 的某几页，单独出一份 CSV，不覆盖整本结果。
- **单词本**：值得记的词和短语收进插件自带的单词本，从「工具 → 单词本…」打开，卡片式浏览。

- 支持 Zotero 7 及以上，开发与实测环境是 Zotero 10.0.6（Gecko 140）
  
## 功能一览

| 功能 | 位置 | 说明 |
|---|---|---|
| 划词翻译 | 阅读器选区 → 「AI 翻译」 | 四档解释语言：简体中文、简体中文·精简、简单英文、简单英文·极简 |
| 整本词频 | 右侧「整本词频」区块 | 输出 CSV，带元信息，可复现 |
| 分部词频 | 右侧「分部词频」区块 | 只 PDF；PDF 要先在阅读器里打开 |
| 单词本 | 工具 → 单词本… | 收藏自动补音标与按词性的释义 |
| 配置备份 | 设置 → 配置备份 | 全部首选项导出成一个 JSON |
| 区块开关 | 设置 → 右侧区块 | 三个区块可以分别隐藏 |

## 安装

**从 Releases 装（推荐）**

1. 到 [Releases](../../releases) 下载最新一版的 `english-assistant.xpi`。
2. Zotero 里「工具 → 插件」，右上角齿轮 → 「Install Plugin From File…」，选中刚下载的 `.xpi`。
3. 重启 Zotero。
4. 打开「编辑 → 设置 → 英文助手」，在「AI 服务」里选服务商、填 API Key、读取模型。

**从源码装**

```powershell
npm run release      # 打包到 dist/english-assistant.xpi，并在文件管理器里选中它
```

然后在 Zotero 里同样用齿轮 → 「Install Plugin From File…」选中 `dist/english-assistant.xpi`。

## 支持的文件格式

- **非扫描格式PDF**：支持良好。
- **EPUB**：划词翻译可用、整本词频可用；分部词频暂不支持。


## 用法：划词翻译

1. 打开 PDF，选中要查的内容。
2. 划词弹窗里点「AI 翻译」。
3. 结果显示在右侧「AI 翻译」区块，按文献归档，在目前的版本中，每次重启zotero，AI翻译的历史结果会清空。


**四档解释语言**

| 档位 | 卡片内容 |
|---|---|
| 简体中文 | 音标、通用释义（按词性）、在本句中的含义、原句与译文、例句、讲解、词源 |
| 简体中文·精简 | 只给通用释义和在本句中的含义，回复更快 |
| 简单英文 | 两三段简单英文，像给母语幼儿解释；会话式说明 |
| 简单英文·极简 | 同上但更短，通常只给一句话 |


## 用法：单词本

使用插件时可从**翻译卡片**和**词频表**中随时收藏单词。

第一次收藏时会自动补音标和词典释义（由大模型自动生成）。

## 用法：整本词频

1. 打开一本PDF（或 EPUB）格式文献。
2. 右侧「整本词频」区块点「统计词频」。
3. 结果写成 CSV 放在文献同目录（`storage/<附件 key>/`），区块里同时显示可翻页的词表。

- 这一功能不依赖ai大模型，因此建议在阅读任何英文文献前先扫描一遍整本词频，不用担心浪费token。
- 目前插件主要支持英文文献阅读，因此判定为非英文的文献会被拒绝扫描词频，设置里可以关掉这个门槛（但是不太建议）。
- 词形默认归并：`dogs → dog`、`am/is/are → be`、`walked/walking → walk`；只并屈折变化，不并派生（`happiness` 不会并进 `happy`）。
- 自带一份默认自定义白名单（约三百个最简单的词），可以自行加词、移除、导入导出名单、恢复默认。
- 统计方式（停用词、最短词长、忽略只出现一次的词、前 N 个）会同时影响 CSV，元信息会写明这次用了哪些过滤，结果可复现。

## 用法：分部词频

1. 在阅读器里打开想要阅读的PDF文档。
2. 右侧「分部词频」区块填起始页和结束页，输入框上右键可以「填写当前页码」。
3. 区块里的词表带分页、隐藏自定义单词、单词本星标，行为和整本词频一样。

- EPUB 暂时不支持分部统计。

## 用法：配置备份

设置面板最下面的「配置备份」一组：

- **导出所有配置…**：把本插件的全部首选项写成 JSON（默认名 `english-assistant-config-20261031-183000.json`），含接口地址、模型、解释语言、上下文开关、词频统计方式、自定义名单。
- **导入所有配置…**：选一个之前导出的文件，确认后逐项写回；文件里没有的项保持不动，不认识的键跳过。

两件要注意的事：

- **文件里包含用户的 API Key**，所以不要将导出的配置文件轻易发给别人，重要
- **单词本不在里面**，它在 Zotero 数据目录的 `wordbook.json`。

## AI 服务

理论上支持DeepSeek、OpenAI、月之暗面 Kimi、智谱 GLM、通义千问、硅基流动、OpenRouter、Groq、Ollama、LM Studio、Anthropic Claude、Google Gemini及其他「自定义」大模型厂商服务，开发与测试使用的是DeepSeek，其他厂商服务未经过验证。


## 隐私与数据

- 插件只把你**选中的文字、选区附近的原文、文献元数据**发给你在设置里指定的服务商；没有其它网络请求，也不收集任何遥测。
- API Key 明文存在 Zotero 自己的 `prefs.js` 里，和其他 Zotero 设置一样；共用电脑时留意。导出配置文件时会把 Key 一起导出。
- Gemini 的 Key 只能放在查询串里（这套协议如此），会出现在服务端与中间代理的访问日志里；走中转服务时留意。
- 单词本、词频 CSV 都写在本地，不上传。

## 已知限制

- **测试版**：界面与提示词还在调整。
- **扫描版 PDF 没有文字层时取不到上下文**：翻译会照常进行并标明上下文不可用，词频会因文本太短而拒绝。
- **语境定位可能失败**：PDF 文字层与选区不一致时（罕见字符、连字、断词），插件会说明定位失败。
- **翻译历史在内存里**：重启 Zotero 后清空。
- **只处理阅读器里的划词**：注释、条目字段、网页快照暂不支持。
- **词源和例句由模型生成，仅作参考。**
- **词频偶尔丢连字符**：`machine-generated` 有时被提取成 `machinegenerated`，当成没见过的词。数量很少，没有特殊处理。
- **EPUB 分部统计暂不支持。**
- 少数服务商的 `/models` 需要额外权限（如 Azure OpenAI 用的是部署名），可能需要手动填写模型名称。

## 开发

```powershell
npm run check     # 静态检查：语法、文案、设置绑定、XML 良构、资源引用、清单字段
npm run selftest  # 两套离线自测：翻译 232 项 + 词频 300 项，都不需要 Zotero
npm run smoke     # 离线冒烟：按 bootstrap 顺序整体加载，跑启动与收尾，32 项
npm run verify    # 上面三件事一起做，提交前跑这个
npm run build     # 打包到 dist/
npm run release   # 打包并在文件管理器里选中 .xpi
npm run demo      # 拿 testdata 里的真实语料跑词频端到端
npm run lemma-audit  # 摊开词形归并结果供人工审查
npm run icons     # 重新生成 PNG 图标（需要 Pillow）
```

改完源码要重启 Zotero 才生效。调试信息在「帮助 → 调试输出」里，搜 `英文助手`。也可以在「工具 → 开发者 → 运行 JavaScript」里直接调：

```js
await Zotero.EnglishAssistant.translate.context.buildContext(
  await Zotero.Items.getAsync(Zotero.getActiveZoteroPane().getSelectedItems()[0].id),
  '要查的短语'
);

Zotero.EnglishAssistant.wordfreq.diagnose();   // 逐个探测用到的宿主接口
Zotero.EnglishAssistant.wordfreq.debugUI();    // 区块注册情况、各窗口 DOM
```

设置项存在 `prefs.js` 里（44 项，界面只暴露常用的一部分），加勾选项要同时改 `addon/prefs.js` 与设置面板，否则 `npm run check` 会报「设置项未接线」。

## 目录结构

```
addon/                          插件本体，打包时整个目录压成 .xpi
  manifest.json                 插件声明，Zotero 从这里读 ID 与版本
  bootstrap.js                  引导脚本：注册 chrome:// 资源、按序加载 26 个模块
  prefs.js                      默认设置（44 项）
  chrome/content/
    preferences.xhtml           设置面板（翻译 + 词频 + 配置备份一个入口）
    wordbook.xhtml              单词本窗口
    scripts/
      main.js                   总入口 EnglishAssistant，编排两个子系统
      translate/                翻译的 12 个模块（config、protocols、api、context、
                                prompts、render、counts、wordbook、panel、service、
                                reader、main）
      wordfreq/                 词频的 13 个模块（langdata、defaults、userlist、lemma、
                                langdetect、tokenizer、wordfreq、output、source、pane、
                                parts-pane、backup、main）
    styles/                     区块、单词本、设置面板的样式
    icons/                     区块图标（Lucide，见 icons/LICENSE-lucide.txt）与 PNG 图标
  locale/{zh-CN,en-US}/english-assistant.ftl   界面文案，id 都带 ea- 前缀
scripts/                        开发脚本（打包、检查、自测、冒烟、图标生成），不进插件
testdata/                       词频自测用的真实语料
docs/                           接口核对笔记、提示词基线、开发过程记录
dist/                           打包产物（不进版本控制）
```

## 许可与致谢

- 插件代码由DeepSeek生成。
- 代码以 **MIT** 许可发布，见 [LICENSE](LICENSE)。
- 侧栏与设置里的图标取自 [Lucide](https://github.com/lucide-icons/lucide)，ISC 许可，版权与许可全文见 `addon/chrome/content/icons/LICENSE-lucide.txt`。
- 感谢 Zotero 开放插件接口，以及各服务商提供的模型与 API。
