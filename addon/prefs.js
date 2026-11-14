/* 英文助手的默认设置。
 *
 * Zotero 启动插件时会执行这个文件，把这里声明的值写进默认分支。
 * 用户在首选项里改过的值存在自己的 prefs.js 里，插件升级时不会被覆盖。
 * 改动默认值时，只影响没动过该项的用户。
 *
 * 两个子系统各自一段：翻译在 translate 下，词频在 wordfreq 下。
 * 界面上绑定的每一项都必须在这里有默认值，否则控件会显示为空。
 */

// ══ 翻译（原本的 DeepSeek Translate）════════════════════

// ── AI 服务 ─────────────────────────────────────────────
// 服务商预设：deepseek / openai / moonshot / zhipu / dashscope / siliconflow /
// openrouter / groq / ollama / lmstudio / anthropic / gemini / custom
// 预设表在 scripts/translate/protocols.js 的 PRESETS 里。
// 1.12.0 之前没有 provider 这个键：值为空时按「自定义 + openai」处理，
// 老配置里的 baseURL 与 model 继续生效，不需要手动迁移。
pref("extensions.englishAssistant.translate.provider", "deepseek");
// 协议：openai / anthropic / gemini。只有服务商为 custom 时界面才显示，
// 其它服务商的协议由预设表决定，这里只作为自定义时的取值。
pref("extensions.englishAssistant.translate.protocol", "openai");
// 填到接口根地址为止，不要带 /chat/completions；末尾斜杠会被规范化
pref("extensions.englishAssistant.translate.baseURL", "https://api.deepseek.com");
pref("extensions.englishAssistant.translate.apiKey", "");
pref("extensions.englishAssistant.translate.model", "deepseek-chat");
pref("extensions.englishAssistant.translate.temperature", "0.3");
pref("extensions.englishAssistant.translate.maxTokens", 2048);
pref("extensions.englishAssistant.translate.timeoutMs", 90000);

// ── 翻译行为 ────────────────────────────────────────────
// 目标语言，写自然语言即可，例如「简体中文」「日语」
pref("extensions.englishAssistant.translate.targetLang", "简体中文");
// 解释语言：zh = 目标语言（默认）；en-simple = 母语幼儿模式，用很简单的英文解释
pref("extensions.englishAssistant.translate.explainMode", "zh");
pref("extensions.englishAssistant.translate.includeContext", true);
pref("extensions.englishAssistant.translate.includeMetadata", true);
pref("extensions.englishAssistant.translate.contextChars", 1200);
pref("extensions.englishAssistant.translate.exampleCount", 2);
pref("extensions.englishAssistant.translate.showEtymology", true);

// ── 界面 ────────────────────────────────────────────────
pref("extensions.englishAssistant.translate.maxHistory", 30);

// ══ 词频（原本的 Word Frequency）════════════════════════

// ── 切词口径 ────────────────────────────────────────────
// 合并大小写：The 与 the 算同一个词
pref("extensions.englishAssistant.wordfreq.mergeCase", true);
// 连字符处拆词：well-known 记作 well 与 known
pref("extensions.englishAssistant.wordfreq.splitHyphen", true);
// PDF 行末断词还原：informa-\ntion 记作 information
pref("extensions.englishAssistant.wordfreq.joinLineBreakHyphen", true);
// 短于这个长度的词不计入。默认 2：a、I 这类单字母词不单独占一行
pref("extensions.englishAssistant.wordfreq.minWordLength", 1);
pref("extensions.englishAssistant.wordfreq.minWordLengthV2", false);
// 忽略只出现一次的词。默认开启：只出现一次的多是专名与拼写变体，留在表里是噪音
pref("extensions.englishAssistant.wordfreq.skipSingles", true);
// 只输出前 N 个高频词，0 表示全部输出
pref("extensions.englishAssistant.wordfreq.topN", 0);
// 输出里是否保留停用词。默认保留，因为要的是「每个单词出现多少次」
pref("extensions.englishAssistant.wordfreq.includeStopwords", true);
// 词形归并：dogs 并进 dog，am/is/are 并进 be，walked/walking 并进 walk。
// 只并屈折变化，不并派生（happiness 不会并进 happy）。
pref("extensions.englishAssistant.wordfreq.lemmatize", true);
// 把所有格一起并进去：dog's 记作 dog
pref("extensions.englishAssistant.wordfreq.mergePossessive", true);

// ── 语言判定 ────────────────────────────────────────────
// 关掉之后不再拒绝非英文文献，直接统计
pref("extensions.englishAssistant.wordfreq.langCheck", true);
// 样本少于这么多词就不判定语言
pref("extensions.englishAssistant.wordfreq.langMinTokens", 300);
// 英语功能词命中率门槛，百分数
pref("extensions.englishAssistant.wordfreq.langMinEnglish", 20);
// 英语领先次高语言的比例门槛，百分数（130 表示要领先 1.3 倍）
pref("extensions.englishAssistant.wordfreq.langMargin", 130);
// 非拉丁字母占比超过这个百分数就判为非英文
pref("extensions.englishAssistant.wordfreq.langMaxNonLatin", 2);

// ── 取文本 ──────────────────────────────────────────────
// auto：优先用 Zotero 已建好的全文缓存，发现它只覆盖了部分页就现场提取
// cache：只用全文缓存，没有就报错
// extract：总是现场提取 PDF 文字层
pref("extensions.englishAssistant.wordfreq.textSource", "auto");

// ── 条目窗格里的词表显示 ────────────────────────────────
// 只影响窗格里显示的那份高频词列表，CSV 始终是完整的。
// 隐藏用户自己加进名单的词（名单在条目窗格里维护）
pref("extensions.englishAssistant.wordfreq.paneHideCustom", true);
// 自定义隐藏名单，存成 JSON 数组。跨文献生效，由条目窗格里的按钮维护。
pref("extensions.englishAssistant.wordfreq.userHiddenWords", "[]");
// 默认自定义名单是否已经填过。清空名单后不会因为重启又冒出来
pref("extensions.englishAssistant.wordfreq.userListSeeded", false);
// 词表每页显示多少个词。窗格里的词表和自定义名单弹窗共用这个值。
pref("extensions.englishAssistant.wordfreq.panePageSize", 20);

// ── 输出 ────────────────────────────────────────────────
// 加在 PDF 文件名后面的后缀
pref("extensions.englishAssistant.wordfreq.suffix", "_wordfreq");
// 同名文件已存在时直接覆盖。关掉则自动加 _2、_3 这样的序号
pref("extensions.englishAssistant.wordfreq.overwrite", true);
// 写 UTF-8 BOM。CSV 里有中文元信息行时，Excel 靠它识别编码
pref("extensions.englishAssistant.wordfreq.bom", true);
// 写完后在文件管理器里定位到该文件。默认关：统计完自动弹文件夹太打扰，
// 窗格里本来就有「打开 CSV」按钮，要看的时候自己点。
pref("extensions.englishAssistant.wordfreq.revealAfterWrite", false);
// 在调试输出里打印判定过程的中间数值
pref("extensions.englishAssistant.wordfreq.debug", false);
// ── 右侧区块 ────────────────────────────────────────────
// 三个区块是否在条目右侧栏显示。关掉就不注册那个区块，侧栏图标一起消失。
pref("extensions.englishAssistant.sections.translate", true);
pref("extensions.englishAssistant.sections.wordfreq", true);
pref("extensions.englishAssistant.sections.wordfreqParts", true);