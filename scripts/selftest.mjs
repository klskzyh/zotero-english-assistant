/**
 * 离线自测：不启动 Zotero，直接把插件脚本加载进一个假沙箱，
 * 用你文献库里真实的全文缓存来验证最容易出错的三处逻辑——
 * 上下文定位、文本清洗、模型返回内容的解析。
 *
 * 用法：node scripts/selftest.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const addonScripts = path.join(projectRoot, 'addon', 'chrome', 'content', 'scripts', 'translate');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
  }
  else {
    failures.push(name + (detail ? ' —— ' + detail : ''));
  }
}

// ── 搭一个最小可用的假 Zotero ────────────────────────────
// prefs 用完整键名，测「关掉某个段落」这类行为时传进来
function createSandbox(prefs = {}) {
  const calls = { errors: [] };
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Zotero: {
      debug: () => {},
      logError: (e) => calls.errors.push(e),
      Prefs: {
        get: (key) => prefs[key],
        set: () => {},
      },
      Utilities: {
        randomString: (n) => Math.random().toString(36).slice(2, 2 + n),
        Internal: {},
      },
      ItemTypes: { getLocalizedName: () => '期刊文章' },
    },
    IOConstants: {},
    Promise,
    Map,
    Set,
    Date,
    JSON,
    Math,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    String,
    Number,
    Array,
    Object,
  };
  vm.createContext(sandbox);
  for (const file of ['config.js', 'protocols.js', 'api.js', 'context.js', 'prompts.js', 'render.js', 'counts.js', 'wordbook.js', 'service.js']) {
    const code = fs.readFileSync(path.join(addonScripts, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  return { sandbox, calls };
}

const { sandbox, calls } = createSandbox();
const D = sandbox.DeepSeekTranslate;
check('命名空间建立', !!D, 'DeepSeekTranslate 未定义');
check('脚本加载期间没有报错', calls.errors.length === 0, String(calls.errors[0] || ''));

// ── 找真实全文缓存 ──────────────────────────────────────
function findCaches(limit = 60) {
  const roots = [
    path.join(os.homedir(), 'Zotero', 'storage'),
    path.join(process.env.APPDATA || '', 'Zotero', 'Zotero', 'Profiles'),
  ];
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 3) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch (e) {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) {
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      }
      else if (entry.name === '.zotero-ft-cache') {
        try {
          const text = fs.readFileSync(full, 'utf8');
          if (text.length > 500) {
            out.push({ full, text });
          }
        }
        catch (e) {
          // 忽略读不了的文件
        }
      }
    }
  };
  for (const root of roots) {
    walk(root, 0);
  }
  return out;
}

const caches = findCaches();
check('在文献库里找到全文缓存文件', caches.length > 0, '没找到 .zotero-ft-cache，上下文相关测试会跳过');

let cjkSample = '';
let latinSample = '';
function cjkRatio(t) {
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk / Math.max(1, t.length);
}
function latinRatio(t) {
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return latin / Math.max(1, t.length);
}
for (const cache of caches) {
  if (cjkRatio(cache.text) > cjkRatio(cjkSample)) {
    cjkSample = cache.text;
  }
  if (latinRatio(cache.text) > latinRatio(latinSample)) {
    latinSample = cache.text;
  }
}

// ── 1. 定位 ────────────────────────────────────────────
if (cjkSample) {
  const mid = Math.floor(cjkSample.length / 2);
  const raw = cjkSample.slice(mid, mid + 60);

  const hit = D.context.locate(cjkSample, raw);
  check('中文选区能定位', !!hit, `选区：${JSON.stringify(raw.slice(0, 30))}`);

  if (hit) {
    const recovered = cjkSample.slice(hit.start, hit.end);
    const strip = (s) => s.replace(/\s+/g, '');
    check(
      '定位结果去掉空白后与选区一致',
      strip(recovered) === strip(raw),
      `得到 ${JSON.stringify(recovered.slice(0, 30))}`
    );
  }

  // 选区是跨行拼接出来的，PDF 阅读器给的就是这种形态
  const joined = raw.replace(/\s+/g, '');
  const hit2 = D.context.locate(cjkSample, joined);
  check('去掉全部空白的中文选区也能定位', !!hit2);

  // 上下文窗口应当包含选中内容，并停在句子边界
  if (hit) {
    const win = D.context.extractWindow(cjkSample, hit.start, hit.end, 400);
    check('上下文窗口包含选中内容', win.selected.length > 0 && cjkSample.slice(win.start ?? hit.start, hit.end).length > 0);
    const before = D.context.tidy(win.before);
    check('窗口长度受控', before.length <= 800, `before 长度 ${before.length}`);
  }
}

if (latinSample) {
  const probe = latinSample.match(/[A-Za-z][A-Za-z'’-]{5,40}/);
  if (probe) {
    const hit = D.context.locate(latinSample, probe[0]);
    check('英文选区能定位', !!hit, `选区：${probe[0]}`);
  }
}

check('定位不存在的文字返回 null', D.context.locate('abcdefg', 'zzzz-not-here') === null);

// 同一个词出现多次时，靠阅读器给的前文当锚点定位到用户真正选中的那一处
const dupText = 'The cat sat down. A dog ran past. The cat slept all afternoon.';
const dupPlain = D.context.locate(dupText, 'cat');
const dupAnchored = D.context.locateAnchored(
  dupText, { before: 'A dog ran past. The ', selected: 'cat' }, 'cat');
check('不锚定时会命中第一次出现', dupPlain && dupPlain.start === 4, String(dupPlain && dupPlain.start));
check('锚点定位命中后一处', dupAnchored && dupAnchored.start > dupPlain.start,
  String(dupAnchored && dupAnchored.start));
check('锚点定位返回的区间覆盖选中词',
  dupAnchored && dupText.slice(dupAnchored.start, dupAnchored.end) === 'cat',
  dupAnchored ? dupText.slice(dupAnchored.start, dupAnchored.end) : 'null');
check('没有前文时锚点定位返回 null',
  D.context.locateAnchored(dupText, { before: '', selected: 'cat' }, 'cat') === null);

// 两侧都拼：只给前文时，同一段落里重复的句式仍可能撞车，后文一起拼更稳
const twoSided = D.context.locateAnchored(
  dupText, { before: 'A dog ran past. The ', selected: 'cat', after: ' slept' }, 'cat');
check('两侧锚点同样命中后一处', twoSided && twoSided.start > dupPlain.start,
  String(twoSided && twoSided.start));
check('两侧锚点区间只覆盖选中词，不含后文',
  twoSided && dupText.slice(twoSided.start, twoSided.end) === 'cat',
  twoSided ? dupText.slice(twoSided.start, twoSided.end) : 'null');

// 前文完全撞不上时，用左右两侧的相似度挑出最像的那一处
const fuzzy = D.context.locateByContext(dupText, 'cat', 'ran past. The ', ' slept');
check('相似度兜底命中后一处', fuzzy && fuzzy.start > 4, String(fuzzy && fuzzy.start));
check('相似度兜底标记了 scored', !!fuzzy && fuzzy.scored === true);
check('相似度兜底在无上下文时仍能给出结果',
  !!D.context.locateByContext(dupText, 'cat', '', ''));
check('相似度兜底对不存在的词返回 null',
  D.context.locateByContext(dupText, 'doggy', 'ran past. The ', ' slept') === null);
check('公共后缀长度算对了', D.context._commonSuffix('xxabc', 'yyabc') === 3,
  String(D.context._commonSuffix('xxabc', 'yyabc')));
check('公共前缀长度算对了', D.context._commonPrefix('abcxx', 'abcyy') === 3,
  String(D.context._commonPrefix('abcxx', 'abcyy')));

// 弯引号、连字符变体
const base = 'The result is “epistemic” in nature and well‑known.';
check('弯引号能匹配直引号', !!D.context.locate(base, '"epistemic"'), '全角引号变体定位失败');
check('不间断连字符能匹配普通连字符', !!D.context.locate(base, 'well-known'), '连字符变体定位失败');

// ── 2. 清洗 ────────────────────────────────────────────
check(
  '汉字之间的空格被去掉',
  D.context.tidy('里盖蒂 ， 年 月 日') === '里盖蒂，年月日',
  JSON.stringify(D.context.tidy('里盖蒂 ， 年 月 日'))
);
check(
  '英文单词之间的空格保留',
  D.context.tidy('the  quick   brown fox') === 'the quick brown fox'
);
check(
  '英文与汉字之间的空格保留',
  D.context.tidy('演奏 Ligeti 的 作品') === '演奏 Ligeti 的作品',
  JSON.stringify(D.context.tidy('演奏 Ligeti 的 作品'))
);

// ── 3. 类型判断 ────────────────────────────────────────
const guess = (t) => D.prompts.guessType(t);
check('单个英文词判为 word', guess('epistemic') === 'word');
check('to + 动词判为 word', guess('to attenuate') === 'word');
check('介词短语判为 phrase', guess('in light of') === 'phrase');
check('完整句子判为 sentence', guess('The lattice vibration contributes to the thermal conductivity.') === 'sentence');
check(
  '多句判为 paragraph',
  guess('First sentence here. Second sentence follows. Third one too.') === 'paragraph'
);
check('两字中文词判为 word', guess('音列') === 'word');
check('中文短语判为 phrase', guess('音乐遗传密码') === 'phrase');
check(
  '中文长句判为 sentence',
  guess('里盖蒂认为自己的音乐遗传密码来自巴托克与斯特拉文斯基的共同影响。') === 'sentence'
);

// ── 3b. 上下文取值：优先用选区前后的原文 ────────────────
// 全文查找只能命中第一次出现的位置，同一个词出现多次就会取错，所以给了
// 选区前后文时必须走 localContext 这条路径，不去读全文。
const ctxLocal = await D.context.buildContext(null, 'device', '第 3 页', {
  before: 'First one. Second one leads to the ',
  selected: 'device',
  after: ' that we use. Another follows.',
});
check('给了选区前后文就直接用它', ctxLocal.source === 'selection' && ctxLocal.matched === true, JSON.stringify(ctxLocal));
check('选区前后文里的选中项正确', ctxLocal.selected === 'device', ctxLocal.selected);
check('前文整理掉多余空白', ctxLocal.before === 'Second one leads to the', JSON.stringify(ctxLocal.before));

const ctxNoLocal = await D.context.buildContext(null, 'device', '第 3 页', null);
check('没有选区前后文时如实报告取不到', ctxNoLocal.available === false);

// trimToBudget 返回未整理的原文，调用方再 tidy；断言用整理后的结果
const trim = (text, side, budget) => D.context.tidy(D.context.trimToBudget(text, side, budget));
check(
  '前文在断点靠前时裁到句子开头',
  trim('A. ' + 'x'.repeat(100), 'tail', 1200) === 'x'.repeat(100)
);
check(
  '前文断点靠后时整段保留',
  trim('x'.repeat(100) + '. A', 'tail', 1200) === 'x'.repeat(100) + '. A'
);
check(
  '后文在断点靠后时裁到句子结尾',
  trim('y'.repeat(100) + '. tail', 'head', 1200) === 'y'.repeat(100) + '.'
);
check(
  '后文断点靠前时整段保留',
  trim('A. ' + 'y'.repeat(100), 'head', 1200) === 'A. ' + 'y'.repeat(100)
);
check('超过预算时先截断', D.context.trimToBudget('z'.repeat(3000), 'head', 100).length === 100);
check('空输入返回空串', D.context.trimToBudget('', 'head', 100) === '');

// EPUB 的上下文预算更大：重排文本没有分页失真，放宽到 2000 字符
check('PDF 预算沿用偏好 1200',
  D.context.budgetFor({ attachmentContentType: 'application/pdf' }) === 1200);
check('EPUB 与 PDF 用同一个预算',
  D.context.budgetFor({ attachmentContentType: 'application/epub+zip' }) === 1200);
const paraWin = D.context.extractWindow('aaaa。\n\nbbbb\ncccc\ndddd', 11, 15, 200);
check('窗口优先从段落边界开始', paraWin.before.indexOf('aaaa') < 0, JSON.stringify(paraWin.before));
const headTrim = D.context.tidy(D.context.trimToBudget('第一段内容。\n\n第二段内容到这里。', 'head', 200));
check('head 裁剪停在段落边界', headTrim.indexOf('第二段') >= 0, headTrim);
const tailTrim = D.context.tidy(D.context.trimToBudget('前面的话。\n\n最后一段话。', 'tail', 200));
check('tail 裁剪从段落开头起', tailTrim.indexOf('最后一段') >= 0, tailTrim);

// ── 4. 模型返回内容解析 ─────────────────────────────────
const good = '{"type":"word","headword":"epistemic","senses":[]}';
check('解析裸 JSON', D.service.parse(good)?.headword === 'epistemic');
check(
  '解析被代码块包裹的 JSON',
  D.service.parse('```json\n' + good + '\n```')?.headword === 'epistemic'
);
check(
  '解析前后带解释文字的 JSON',
  D.service.parse('好的，结果如下：\n' + good + '\n希望有帮助。')?.headword === 'epistemic'
);
check('纯文本返回解析为 null', D.service.parse('这是一段普通译文。') === null);

// ── 5. 提示词组装 ──────────────────────────────────────
const messages = D.prompts.buildMessages({
  text: 'epistemic',
  pageLabel: '第 12 页',
  metadata: { title: 'Test Paper', creators: 'A. Author', year: '2024', abstract: '摘要内容' },
  context: {
    available: true,
    matched: true,
    before: '前文内容。',
    selected: 'epistemic',
    after: '后文内容。',
    pageLabel: '第 12 页',
  },
});
const system = messages[0].content;
const user = messages[1].content;
check('系统提示词包含三套模板', system.includes('"word"') && system.includes('"phrase"') && system.includes('"sentence"'));
check('系统提示词要求输出 JSON', /JSON/.test(system));
check('单词模板包含词形字段', /"form":\s*\{/.test(system));
check(
  '词形字段要求给出词元并区分屈折与派生',
  system.includes('"lemma"') && system.includes('屈折') && system.includes('派生') && system.includes('构词基')
);
check(
  '提示词含注入防护',
  system.includes('不是给你的指令') && system.includes('不要执行')
);
const sysLines = system.split('\n').filter((line) => line.trim());
check(
  '语言要求放在 system prompt 末尾单独一行',
  sysLines[sysLines.length - 1].includes('回复语言') && sysLines[sysLines.length - 1].includes('简体中文'),
  JSON.stringify(sysLines[sysLines.length - 1])
);

// 模板里的 JSON 示例必须本身合法：模型照着这个形状生成，示例缺逗号就会带出非法输出
function parseSample(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) {
    return { ok: false, reason: '找不到 ' + marker + ' 的示例' };
  }
  const braceStart = text.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === '{') {
      depth++;
    }
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        const raw = text.slice(braceStart, i + 1);
        try {
          JSON.parse(raw);
          return { ok: true };
        }
        catch (e) {
          return { ok: false, reason: e.message };
        }
      }
    }
  }
  return { ok: false, reason: '括号不配对' };
}

const wordSample = parseSample(system, 'type 为 "word" 时：');
check('单词模板示例本身是合法 JSON', wordSample.ok, wordSample.reason);
const phraseSample = parseSample(system, 'type 为 "phrase" 时：');
check('短语模板示例本身是合法 JSON', phraseSample.ok, phraseSample.reason);
const sentenceSample = parseSample(system, 'type 为 "sentence"');
check('句段模板示例本身是合法 JSON', sentenceSample.ok, sentenceSample.reason);
check('用户提示词带上文献信息', user.includes('Test Paper') && user.includes('A. Author'));
check('用户提示词带上原文上下文', user.includes('⟦epistemic⟧'));
check('用户提示词带上页码', user.includes('第 12 页'));

const noContext = D.prompts.buildMessages({
  text: 'epistemic',
  context: { available: false, reason: '扫描件没有文字层' },
  metadata: null,
});
check(
  '上下文缺失时如实告知模型',
  noContext[1].content.includes('无法取得原文上下文') && noContext[1].content.includes('扫描件没有文字层')
);
check('上下文缺失时仍然给出选中文本', noContext[1].content.includes('epistemic'));

// ── 5b. 关掉的段落不应出现在提示词里 ────────────────────
// 旧实现只是让模型「把字段留空」，字段本身还在模板里
const { sandbox: sandboxOff } = createSandbox({
  'extensions.englishAssistant.translate.showEtymology': false,
  'extensions.englishAssistant.translate.exampleCount': 0,
});
const systemOff = sandboxOff.DeepSeekTranslate.prompts.systemPrompt();
check('默认模板列出 etymology', system.includes('etymology'));
check('默认模板列出 examples', system.includes('examples'));
check('关掉词源后模板里不再出现 etymology', !systemOff.includes('etymology'));

// ── 5c. 母语幼儿模式 ────────────────────────────────────
const { sandbox: sandboxSimple } = createSandbox({
  'extensions.englishAssistant.translate.explainMode': 'en-simple',
});
const systemSimple = sandboxSimple.DeepSeekTranslate.prompts.systemPrompt();
check('默认不是母语幼儿模式', !system.includes('kidParagraphs'));
check('母语幼儿模式改用 kidParagraphs 这一套字段', systemSimple.includes('"kidParagraphs"'));
check(
  '母语幼儿模式不再要求义项、例句、词源、词形',
  !systemSimple.includes('"senses"') && !systemSimple.includes('"examples"') &&
  !systemSimple.includes('"etymology"') && !systemSimple.includes('"form"')
);
check('母语幼儿模式不再有 inContext 那套字段', !systemSimple.includes('"inContext"'));
check('母语幼儿模式写明读者是六岁左右的孩子', systemSimple.includes('六岁左右'));
check(
  '母语幼儿模式禁止专业术语与学术场景',
  systemSimple.includes('专业术语') && systemSimple.includes('学术的场景')
);
check(
  '母语幼儿模式交代了三段各写什么',
  systemSimple.includes('第一段（必须有）') && systemSimple.includes('第二段（必须有）') &&
  systemSimple.includes('第三段（可以没有）')
);
check('母语幼儿模式明确第三段可以省', systemSimple.includes('只给两段'));
check('母语幼儿模式不再要求学术写作腔', !systemSimple.includes('符合学术写作习惯'));
check('母语幼儿模式的回复语言是简单英文', systemSimple.includes('回复语言：简单的英文'));
check(
  '母语幼儿模式允许少量排版记号',
  systemSimple.includes('两个星号') && systemSimple.includes('两个等号') &&
  systemSimple.includes('表情符号') && systemSimple.includes('不要用任何 markdown')
);
check('两种模式的提示词确实不同', systemSimple !== system);
check('例句设成 0 后模板里不再出现 examples', !systemOff.includes('examples'));
check('关掉词源后硬性要求里也不再提词源', !systemOff.includes('词源字段'));
check('例句设成 0 后硬性要求里也不再提例句', !systemOff.includes('例句给'));
check(
  '关掉这两个段落不影响其他字段',
  systemOff.includes('"inContext"') && systemOff.includes('"form"') && systemOff.includes('"explanation"')
);
check(
  '硬性要求编号在删条后仍然连续',
  (() => {
    const nums = systemOff.split('\n')
      .map((line) => line.match(/^(\d+)\. /))
      .filter(Boolean)
      .map((m) => parseInt(m[1], 10));
    return nums.length > 0 && nums.every((n, i) => n === i + 1);
  })(),
  '编号出现断档'
);
const wordSampleOff = parseSample(systemOff, 'type 为 "word" 时：');
check('关掉词源与例句后，单词模板示例仍合法', wordSampleOff.ok, wordSampleOff.reason);
const phraseSampleOff = parseSample(systemOff, 'type 为 "phrase" 时：');
check('关掉词源与例句后，短语模板示例仍合法', phraseSampleOff.ok, phraseSampleOff.reason);


// ── 5c-2. 极简版（只有一段） ─────────────────────────────
const { sandbox: sandboxMin } = createSandbox({
  'extensions.englishAssistant.translate.explainMode': 'en-minimal',
});
const systemMin = sandboxMin.DeepSeekTranslate.prompts.systemPrompt();
check('极简版提示词要求只写一段', systemMin.includes('只能有一个字符串'));
check('极简版不要求三段式', !systemMin.includes('This sentence means'));
check('极简版与完整幼儿模式提示词不同', systemMin !== systemSimple);

// ── 5c-3. 简体中文·精简 ────────────────────────────────
const { sandbox: sandboxLite } = createSandbox({
  'extensions.englishAssistant.translate.explainMode': 'zh-lite',
});
const systemLite = sandboxLite.DeepSeekTranslate.prompts.systemPrompt();
check('精简模式只要通用释义与本句中的含义',
  systemLite.includes('【本次为「简体中文·精简」】')
  && systemLite.includes('只给通用释义与本句中的含义'));
check('精简模式的模板里没有例句字段', !systemLite.includes('"examples"'));
check('精简模式的模板里没有词源字段', !systemLite.includes('"etymology"'));
check('精简模式的模板里没有讲解字段', !systemLite.includes('"explanation"'));
check('精简模式的模板里没有用法字段', !systemLite.includes('"usage"'));
check('精简模式不要原句与译文', !systemLite.includes('"sentenceTranslation"'));
check('精简模式仍保留通用释义与语境义',
  systemLite.includes('"senses"') && systemLite.includes('"inContext"')
  && systemLite.includes('"gloss"') && systemLite.includes('"note"'));
check('精简模式仍要求给音标', systemLite.includes('"pronunciation"'));
check('精简模式与默认中文提示词不同', systemLite !== systemOff);
const wordSampleLite = parseSample(systemLite, 'type 为 "word" 时：');
check('精简模式的单词模板示例是合法 JSON', wordSampleLite.ok, wordSampleLite.reason);
const phraseSampleLite = parseSample(systemLite, 'type 为 "phrase" 时：');
check('精简模式的短语模板示例是合法 JSON', phraseSampleLite.ok, phraseSampleLite.reason);
// ── 6. 复制成纯文本 ────────────────────────────────────
const copyText = D.render.copyText({
  text: 'recognitions',
  data: {
    type: 'word',
    headword: 'recognition',
    pronunciation: '/ˌrekəɡˈnɪʃn/',
    form: {
      surface: 'recognitions',
      lemma: 'recognition',
      features: '复数',
      relation: '屈折；recognition 本身是 recognize 加 -tion 构成的名词',
      correction: '',
    },
    senses: [{ pos: 'adj.', meaning: '认识的', register: '哲学' }],
    inContext: {
      gloss: 'adj. 认识的',
      note: '文中指认识论层面的',
      evidence: '与 justification 并列出现',
    },
    etymology: '源自希腊语 epistēmē',
    examples: [{ source: 'epistemic humility', translation: '认识上的谦逊' }],
    explanation: '常与 justification 搭配',
  },
});
check('复制文本包含词条', copyText.includes('recognition /ˌrekəɡˈnɪʃn/'));
check('复制文本不再包含词形', !copyText.includes('词形：'));
check(
  '复制文本包含语境义的两部分',
  copyText.includes('在本句中的含义：') &&
  copyText.includes('adj. 认识的') &&
  copyText.includes('文中指认识论层面的')
);
check('复制文本包含例句', copyText.includes('epistemic humility'));

// ── 7. 结果卡片的结构 ──────────────────────────────────
// 用一个只记录标签、class 和文字的假 DOM，检查段落标签与原文行的取舍
function makeFakeDoc() {
  class El {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attrs = {};
      this._text = '';
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k]; }
    set textContent(v) { this._text = String(v); }
    get textContent() { return this._text; }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener() {}
  }
  return {
    createElementNS: (ns, tag) => new El(tag),
    createElement: (tag) => new El(tag),
  };
}

function flatten(el, out = []) {
  out.push({
    tag: el.tagName,
    cls: el.attrs.class || '',
    title: el.attrs.title || '',
    text: el.children.length ? '' : (el.textContent || '').trim(),
  });
  el.children.forEach((child) => flatten(child, out));
  return out;
}

function buildCard(overrides) {
  const entry = Object.assign({
    id: 'x',
    at: new Date(2026, 0, 1, 12, 0, 0),
    text: 'sliders',
    pageLabel: '第 3 页',
    data: {
      type: 'word',
      headword: 'sliders',
      pronunciation: '/ˈslaɪdə(r)/',
      form: { surface: 'sliders', lemma: 'slider', features: '复数' },
      senses: [{ pos: 'n.', meaning: '推子；滑动控制器', register: '电子乐器' }],
      inContext: {
        gloss: 'n. 推子',
        note: '文中指调音台上那排推子',
        sentence: 'The panel is covered with sliders, switches, and buttons.',
        sentenceTranslation: '面板上装满了推子、开关和按钮。',
        targetTerm: '推子',
      },
      examples: [
        { source: 'Push the sliders up during the crescendo.', translation: '在渐强处把推子推上去。' },
        { source: 'He adjusted the volume slider on the mixer.', translation: '他调整了调音台上的音量滑块。' },
      ],
      explanation: '与 knob 的区别在于运动方式。',
      etymology: '源自动词 slide。',
    },
  }, overrides);
  return flatten(D.render.entryCard(makeFakeDoc(), entry, {
    onCopy: () => {},
    onDelete: () => {},
    onCollect: () => {},
    isCollected: (e) => !!e.collected,
  }));
}

const labelsOf = (nodes) => nodes.filter((n) => n.cls.includes('ds-label')).map((n) => n.text);
const has = (nodes, cls) => nodes.some((n) => n.cls.includes(cls));

const wordNodes = buildCard({});
check(
  '卡片里的段落标签按顺序齐全',
  labelsOf(wordNodes).join(' / ') ===
    '通用释义 / 在本句中的含义 / 原句 / 译文 / 例句 / 讲解 / 词源',
  labelsOf(wordNodes).join(' / ')
);
check('义项被包进带标签的段落里', has(wordNodes, 'ds-senses') && labelsOf(wordNodes).includes('通用释义'));
check(
  '词源排在讲解之后',
  labelsOf(wordNodes).indexOf('讲解') >= 0 &&
  labelsOf(wordNodes).indexOf('讲解') < labelsOf(wordNodes).indexOf('词源')
);
check(
  '原句与译文里选中的那处都被高亮',
  (() => {
    const hl = wordNodes.filter((n) => n.cls.includes('ds-hl')).map((n) => n.text);
    return hl.includes('sliders') && hl.includes('推子');
  })(),
  wordNodes.filter((n) => n.cls.includes('ds-hl')).map((n) => n.text).join(',')
);
check('词条与选中内容相同时不重复显示原文行', !has(wordNodes, 'ds-source'));

const inflectedNodes = buildCard({
  text: 'recognitions',
  data: {
    type: 'word',
    headword: 'recognition',
    form: { surface: 'recognitions', lemma: 'recognition', features: '复数' },
    senses: [{ pos: 'n.', meaning: '识别' }],
    inContext: { gloss: 'n. 识别', note: '文中指识别过程' },
  },
});
check('词条与选中内容不同时保留原文行', has(inflectedNodes, 'ds-source'));
check(
  '保留的原文行带标签，且排在最前',
  labelsOf(inflectedNodes).join(' / ') === '原文 / 通用释义 / 在本句中的含义',
  labelsOf(inflectedNodes).join(' / ')
);

const sentenceNodes = buildCard({
  text: 'The panel is covered with sliders.',
  data: { type: 'sentence', translation: '面板上布满了推子。' },
});
check(
  '句段卡片只显示原文和译文',
  has(sentenceNodes, 'ds-source') &&
  has(sentenceNodes, 'ds-translation') &&
  !has(sentenceNodes, 'ds-form') &&
  !has(sentenceNodes, 'ds-senses')
);
check(
  '句段卡片的标签是原文与译文',
  labelsOf(sentenceNodes).join(' / ') === '原文 / 译文',
  labelsOf(sentenceNodes).join(' / ')
);

const emptySensesNodes = buildCard({
  text: 'sliders',
  data: {
    type: 'word',
    headword: 'sliders',
    senses: [{ pos: '', meaning: '', register: '' }, null],
    inContext: { meaning: '面板上的推子' },
  },
});
check('义项全空时不渲染空的通用释义段落', !labelsOf(emptySensesNodes).includes('通用释义'));

// 高亮的本地定位：位置由我们按字面找，不再依赖模型标注
const spanOf = (t, n) => JSON.stringify(D.render.findSpan(t, n));
check('原样匹配时区间正确', spanOf('The panel has sliders here.', 'sliders') === '{"start":14,"end":21}',
  spanOf('The panel has sliders here.', 'sliders'));
check('忽略大小写与首尾空白', spanOf('The Panel has Sliders.', ' sliders ') === '{"start":14,"end":21}',
  spanOf('The Panel has Sliders.', ' sliders '));
check(
  'PDF 汉字之间插了空格也能对上',
  (() => {
    const s = D.render.findSpan('里 盖 蒂 的 音 乐', '盖蒂');
    return !!s && '里 盖 蒂 的 音 乐'.slice(s.start, s.end) === '盖 蒂';
  })()
);
check('找不到时返回 null', D.render.findSpan('nothing here', 'zzz') === null);
check('needle 为空时返回 null', D.render.findSpan('a b c', '') === null);
check('** 标记会被去掉', D.render.stripMarkers('a **b** c') === 'a b c');
check(
  '选中的文字带尾随标点也能对上',
  (() => {
    const s = D.render.findSpan('The panel has sliders switches.', 'sliders,');
    return !!s && 'The panel has sliders switches.'.slice(s.start, s.end) === 'sliders';
  })()
);
check(
  '连字符写法不同也能对上',
  (() => {
    const s = D.render.findSpan('a machinegenerated timbre', 'machine-generated');
    return !!s && 'a machinegenerated timbre'.slice(s.start, s.end) === 'machinegenerated';
  })()
);
check('译词里带括号补充时会取到括号外那一段', D.render.termCandidates('推子（fader）').indexOf('推子') > 0);
check(
  '第一候选定位不到时用后面的候选',
  !!D.render.findSpanAny('面板上装满了推子、开关', D.render.termCandidates('推子（fader）'))
);
check(
  'glossCandidates 抽出中文片段',
  JSON.stringify(D.render.glossCandidates('n. 惯例；习俗')) === '["惯例","习俗"]',
  JSON.stringify(D.render.glossCandidates('n. 惯例；习俗'))
);

// 模型把邻近词的译法一起圈进来时（选 conventions，译文「音乐惯例的改变」，它给「音乐惯例」）
const narrowNodes = buildCard({
  text: 'conventions',
  data: {
    type: 'word',
    headword: 'convention',
    form: { surface: 'conventions', lemma: 'convention', features: '复数' },
    senses: [{ pos: 'n.', meaning: '惯例；习俗' }],
    inContext: {
      gloss: 'n. 惯例',
      note: '文中指音乐上的惯常做法',
      sentence: 'Plato\u2019s concern that changes in musical conventions threaten anarchy.',
      sentenceTranslation: '柏拉图担心音乐惯例的改变会危及社会秩序。',
      targetTerm: '音乐惯例',
    },
  },
});
check(
  '译词圈得太大时用 gloss 里的短释义收窄，且不跳到别处',
  (() => {
    const hl = narrowNodes.filter((n) => n.cls.includes('ds-hl')).map((n) => n.text);
    return hl.includes('惯例') && !hl.includes('音乐惯例') && hl.includes('conventions');
  })(),
  JSON.stringify(narrowNodes.filter((n) => n.cls.includes('ds-hl')).map((n) => n.text))
);

// ── 本书词次（翻译与词频联动）───────────────────────────
const countedNodes = buildCard({ count: { count: 12, from: '词频表' } });
const badge = countedNodes.filter((n) => n.cls.includes('ds-count'));
check('词次显示成「12 次」', badge.length === 1 && badge[0].text === '12 次',
  JSON.stringify(badge.map((n) => n.text)));
check('词次的悬停说明写出来源', badge.length === 1 && badge[0].title.includes('12') && badge[0].title.includes('词频表'),
  badge[0]?.title || '');
check(
  '词次排在词条行里，通用释义之前',
  countedNodes.findIndex((n) => n.cls.includes('ds-count')) <
    countedNodes.findIndex((n) => n.text === '通用释义'),
  String(countedNodes.findIndex((n) => n.cls.includes('ds-count')))
);
check('没有词次时不显示', !buildCard({}).some((n) => n.cls.includes('ds-count')));

// 母语幼儿模式的卡片：只有词条与分段，没有任何区块标题
const kidCard = {
  text: 'observance',
  count: { count: 12, from: '词频表' },
  data: {
    type: 'word',
    headword: 'observance',
    pronunciation: '/əbˈzɜːvəns/',
    kidParagraphs: [
      'An observance is something you do because a rule or a custom says so.',
      'In this sentence it means the religious rites people did in the temple.',
      'You can say: the school has a special observance on Monday.',
    ],
  },
};
const kidNodes = buildCard(kidCard);
check('幼儿模式的卡片没有区块标题', !kidNodes.some((n) => n.cls.includes('ds-label')),
  JSON.stringify(kidNodes.filter((n) => n.cls.includes('ds-label')).map((n) => n.text)));
check('幼儿模式的卡片带 ds-kid 类，供放大字号与换字体', kidNodes.some((n) => n.cls.includes('ds-kid')));
check('幼儿模式的三段都渲染出来',
  kidNodes.filter((n) => n.cls.includes('ds-kid-p')).length === 3,
  String(kidNodes.filter((n) => n.cls.includes('ds-kid-p')).length));
check('幼儿模式仍然显示词条、音标与词次',
  kidNodes.some((n) => n.text === 'observance') &&
  kidNodes.some((n) => n.text === '/əbˈzɜːvəns/') &&
  kidNodes.some((n) => n.cls.includes('ds-count')));
check('幼儿模式只给两段时也能渲染',
  buildCard({ data: { type: 'word', headword: 'x', kidParagraphs: ['a', 'b'] } })
    .filter((n) => n.cls.includes('ds-kid-p')).length === 2);
check('幼儿模式不再渲染通用释义、原句、例句这些区块',
  !kidNodes.some((n) => n.cls.includes('ds-senses')) &&
  !kidNodes.some((n) => n.text === '通用释义') &&
  !kidNodes.some((n) => n.text === '例句'));
check(
  '幼儿模式的复制文本是词条加各段',
  (() => {
    const t = D.render.copyText({
      text: 'observance',
      data: { type: 'word', headword: 'observance', kidParagraphs: ['one', 'two'] },
    });
    return t.includes('observance') && t.includes('one') && t.includes('two');
  })()
);

// 幼儿模式里允许的排版记号
const markNodes = buildCard({
  data: {
    type: 'word',
    headword: 'observance',
    kidParagraphs: [
      'An observance is **a custom** people follow ✅',
      'It is a ==special way== to do something, like a small **party** 🌰',
    ],
  },
});
check(
  '**粗体** 渲染成 strong',
  markNodes.some((n) => n.tag === 'strong' && n.text === 'a custom'),
  JSON.stringify(markNodes.filter((n) => n.tag === 'strong').map((n) => n.text))
);
check(
  '==彩色== 渲染成 ds-kid-em',
  markNodes.some((n) => n.cls.includes('ds-kid-em') && n.text === 'special way'),
  JSON.stringify(markNodes.filter((n) => n.cls.includes('ds-kid-em')).map((n) => n.text))
);
check('表情符号原样保留', markNodes.some((n) => n.text.includes('✅')));
check(
  '落单的记号被去掉，不留星号',
  (() => {
    const nodes = buildCard({ data: { type: 'word', headword: 'x', kidParagraphs: ['a **b and ==c'] } });
    return !nodes.some((n) => n.text.includes('**') || n.text.includes('=='));
  })()
);
check(
  '记号之外的标记不被当成标签',
  !buildCard({ data: { type: 'word', headword: 'x', kidParagraphs: ['a <b>not a tag</b>'] } })
    .some((n) => n.tag === 'b')
);

const pickIndex = { from: '词频表', counts: new Map([['observance', 12]]) };
check('词次查找忽略大小写与首尾空白',
  JSON.stringify(D.counts.pickFromIndex(pickIndex, [' Observances ', 'observance'])) === '{"count":12,"from":"词频表"}',
  JSON.stringify(D.counts.pickFromIndex(pickIndex, [' Observances ', 'observance'])));
check('按优先级取第一个命中的候选',
  D.counts.pickFromIndex(pickIndex, ['observe', 'observance']).count === 12);
check('一个都不命中时返回 null', D.counts.pickFromIndex(pickIndex, ['absent']) === null);
check('索引为空时返回 null', D.counts.pickFromIndex({ from: '词频表', counts: new Map() }, ['x']) === null);

const formsIndex = { from: '词频表', counts: new Map() };
D.counts._addRow(formsIndex, { word: 'dog', count: 3, forms: 'dog:3; dogs:1' });
check('forms 列里的词形也进索引',
  formsIndex.counts.get('dog') === 3 && formsIndex.counts.get('dogs') === 1,
  JSON.stringify([...formsIndex.counts]));

// ── 单词本：存储与分页的纯函数 ──────────────────────────
const wb = D.wordbook;
const wbSource = {
  text: 'observances',
  data: {
    type: 'word',
    headword: 'observance',
    pronunciation: '/əbˈzɜːvəns/',
    senses: [{ pos: 'n.', meaning: '惯例' }],
    inContext: { gloss: 'n. 仪式', note: '文中指宗教仪式', sentence: 'x', sentenceTranslation: 'y' },
    examples: [{ source: 'a', translation: 'b' }],
    explanation: '讲解',
  },
  count: { count: 12, from: '词频表' },
};
const wbItem = wb.entryFromTranslation(wbSource);
check(
  '单词本条目从翻译结果里取到关键字段',
  wbItem && wbItem.lemma === 'observance' && wbItem.surface === 'observances' &&
  wbItem.gloss === 'n. 仪式' && wbItem.count === 12 && wbItem.seenCount === 1,
  JSON.stringify(wbItem && { lemma: wbItem.lemma, gloss: wbItem.gloss, count: wbItem.count })
);
check('句子不收进单词本',
  wb.entryFromTranslation({ text: 'a sentence', data: { type: 'sentence', translation: 'x' } }) === null);
check('短语能收进单词本',
  !!wb.entryFromTranslation({ text: 'in terms of', data: { type: 'phrase', phrase: 'in terms of' } }));
check('去重键忽略大小写', wb.keyOf({ lemma: 'Observance' }) === 'observance');
// 收藏短语时以 AI 给出的完整形式入库，而不是用户划选的那几个字母
const wbPhraseEntry = wb.entryFromTranslation({
  text: 'in terms',
  data: { type: 'phrase', phrase: 'in terms of', senses: [{ pos: 'phr.', meaning: '就……而言' }] },
});
check('短语记的是完整形式', wbPhraseEntry.surface === 'in terms of', wbPhraseEntry.surface);
check('短语的 lemma 也取完整形式', wbPhraseEntry.lemma === 'in terms of', wbPhraseEntry.lemma);
const wbWordEntry = wb.entryFromTranslation({
  text: 'observances',
  data: { type: 'word', headword: 'observance' },
});
check('单词保留划选到的词形', wbWordEntry.surface === 'observances', wbWordEntry.surface);
check('单词的 lemma 取 headword', wbWordEntry.lemma === 'observance', wbWordEntry.lemma);
// 单词本「当前页显示顺序」：只换显示，不改列表本身
const wbOrderList = [1, 2, 3, 4, 5];
const wbReversed = wb.orderedForDisplay(wbOrderList, 'reverse');
check('逆向显示把整页翻过来',
  JSON.stringify(wbReversed) === '[5,4,3,2,1]', JSON.stringify(wbReversed));
check('逆向显示不动原数组',
  JSON.stringify(wbOrderList) === '[1,2,3,4,5]', JSON.stringify(wbOrderList));
check('恢复顺序原样返回',
  JSON.stringify(wb.orderedForDisplay(wbOrderList, 'normal')) === '[1,2,3,4,5]');
const wbShuffled = wb.orderedForDisplay(wbOrderList, 'shuffle');
check('乱序显示元素不变、只换位置',
  wbShuffled.length === 5 && wbShuffled.slice().sort().join() === '1,2,3,4,5',
  JSON.stringify(wbShuffled));

const wbList = [];
const wbFirst = wb.mergeInto(wbList, wbItem);
const wbSecond = wb.mergeInto(wbList, wb.entryFromTranslation(wbSource));
check(
  '同一条第二次只加计数不新增',
  wbFirst.added === true && wbSecond.added === false &&
  wbList.length === 1 && wbList[0].seenCount === 2,
  JSON.stringify({ added: [wbFirst.added, wbSecond.added], len: wbList.length, seen: wbList[0].seenCount })
);

const wbMany = Array.from({ length: 22 }, (_, i) => ({ id: 'i' + i, lemma: 'w' + i }));
const wbPage1 = wb.pageOf(wbMany, 1);
const wbPage3 = wb.pageOf(wbMany, 3);
const wbPage9 = wb.pageOf(wbMany, 9);
check('每页 9 张、共 3 页', wbPage1.pageCount === 3 && wbPage1.items.length === 9,
  wbPage1.items.length + ' / ' + wbPage1.pageCount);
check('最后一页只剩 4 张', wbPage3.items.length === 4 && wbPage3.page === 3, String(wbPage3.items.length));
check('页码越界时夹到最后一页', wbPage9.page === 3 && wbPage9.items.length === 4, String(wbPage9.page));
check('空单词本也算一页', wb.pageOf([], 1).pageCount === 1);

const wbOrder = [];
wb.mergeInto(wbOrder, wb.entryFromTranslation({ text: 'alpha', data: { type: 'word', headword: 'alpha' } }));
wb.mergeInto(wbOrder, wb.entryFromTranslation({ text: 'beta', data: { type: 'word', headword: 'beta' } }));
check(
  '一次移除一批 id 时只去掉命中的',
  (() => {
    const before = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const r = wb.withoutIds(before, ['a', 'c', 'zzz']);
    return r.removed === 2 && r.list.length === 1 && r.list[0].id === 'b';
  })()
);
check('移除空列表不报错', wb.withoutIds([{ id: 'a' }], []).removed === 0);

check(
  '先收藏的排在前面，后加的追加在后面',
  wbOrder[0].lemma === 'alpha' && wbOrder[1].lemma === 'beta',
  JSON.stringify(wbOrder.map((x) => x.lemma))
);
check(
  '单词本改动后的通知在缺模块时也不抛',
  (() => {
    try {
      wb.notifyChanged();
      return true;
    }
    catch (e) {
      return false;
    }
  })()
);
check('卡片那行释义带词性', wb.dictLine({ dictPos: 'n.', dictMeaning: '仪式；惯例' }) === 'n. 仪式；惯例',
  wb.dictLine({ dictPos: 'n.', dictMeaning: '仪式；惯例' }));
check('没有词典释义时退回语境义', wb.dictLine({ gloss: 'n. 仪式' }) === 'n. 仪式');
check('什么都没有时返回空串', wb.dictLine({}) === '');

// 词典提示词：只把单词本身发给模型，不带上下文
const dictMsgs = D.prompts.dictionaryMessages('observance');
check(
  '词典请求就是 system 加一句单词',
  dictMsgs.length === 2 && dictMsgs[1].role === 'user' && dictMsgs[1].content === 'observance',
  JSON.stringify(dictMsgs[1].content)
);
check(
  '词典提示词要音标、词性与中文释义',
  dictMsgs[0].content.includes('pronunciation') && dictMsgs[0].content.includes('"pos"') &&
  dictMsgs[0].content.includes('"meaning"')
);
check(
  '词典提示词要求按词性整理全部含义',
  dictMsgs[0].content.includes('全部常用含义') && dictMsgs[0].content.includes('按词性分组')
);
check(
  '词典输出是按词性分组的 senses 数组',
  dictMsgs[0].content.includes('"senses"') && dictMsgs[0].content.includes('"pos"')
);
check(
  'senses 解析成数组',
  JSON.stringify(wb.sensesFromDict({
    senses: [{ pos: 'n.', meaning: '仪式' }, { pos: 'v.t.', meaning: '遵守' }],
  })) === '[{"pos":"n.","meaning":"仪式"},{"pos":"v.t.","meaning":"遵守"}]',
  JSON.stringify(wb.sensesFromDict({ senses: [{ pos: 'n.', meaning: '仪式' }] }))
);
check(
  '模型只给单条 pos/meaning 时也能解析',
  JSON.stringify(wb.sensesFromDict({ pos: 'n.', meaning: '仪式' })) === '[{"pos":"n.","meaning":"仪式"}]'
);
check('空对象解析成空数组', wb.sensesFromDict({}).length === 0);
check(
  '每个词性一行',
  JSON.stringify(wb.dictLines({
    dictSenses: [{ pos: 'n.', meaning: '仪式' }, { pos: 'v.t.', meaning: '遵守' }],
  })) === '["n. 仪式","v.t. 遵守"]'
);
check('没有词典义项时退回语境义', JSON.stringify(wb.dictLines({ gloss: 'n. 仪式' })) === '["n. 仪式"]');
check(
  '释义行数有上限',
  wb.dictLines({ dictSenses: [1, 2, 3, 4, 5].map((n) => ({ pos: 'n.', meaning: 'm' + n })) }, 4).length === 4
);


// 收藏按钮的两种状态
check('不在单词本时按钮是「收藏」',
  buildCard({}).some((n) => n.tag === 'button' && n.text === '收藏'));
check('已在单词本时按钮是「移除收藏」',
  buildCard({ collected: true }).some((n) => n.tag === 'button' && n.text === '移除收藏'));

// 单字母选中时的定位：不能落在别的词内部
const chantLine = 'Chant was learned by rote once a year.';
check(
  '单字母选中时取独立成词的那一处',
  (() => {
    const s = D.render.findSpan(chantLine, 'a');
    return !!s && chantLine.slice(s.start - 1, s.end + 1) === ' a ';
  })(),
  JSON.stringify(D.render.findSpan(chantLine, 'a'))
);
check('找不到独立位置时退到第一次出现',
  JSON.stringify(D.render.findSpan('observances', 'observance')) === '{"start":0,"end":10}',
  JSON.stringify(D.render.findSpan('observances', 'observance')));
check(
  '中文单字也一样优先独立位置',
  (() => {
    const s = D.render.findSpan('演唱与一次演唱', '一次');
    return !!s && '演唱与一次演唱'.slice(s.start, s.end) === '一次';
  })()
);

const hlDoc = makeFakeDoc();
const hlBox = hlDoc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
D.render.highlightText(hlDoc, hlBox, 'The panel has sliders here.', 'sliders');
const hlNodes = flatten(hlBox).filter((n) => n.text);
// flatten 会 trim 掉首尾空白，所以拼回来比较时把空白一并去掉
const squeeze = (s) => String(s).replace(/\s+/g, '');
check(
  '选中的那处渲染成 ds-hl，其余按纯文本',
  hlNodes.some((n) => n.cls.includes('ds-hl') && n.text === 'sliders') &&
  squeeze(hlNodes.map((n) => n.text).join('')) === squeeze('The panel has sliders here.'),
  JSON.stringify(hlNodes.map((n) => n.cls + ':' + n.text))
);
check(
  '定位不到时整段按纯文本，不加高亮',
  (() => {
    const box = hlDoc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    D.render.highlightText(hlDoc, box, 'nothing matches', 'zzz');
    const nodes = flatten(box).filter((n) => n.text);
    return nodes.length === 1 && !nodes[0].cls.includes('ds-hl');
  })()
);
const tagBox = hlDoc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
D.render.highlightText(hlDoc, tagBox, 'a <b>not a tag</b>', 'not');
check('文本里的尖括号不会被解析成标签', !flatten(tagBox).some((n) => n.tag === 'b'));

const errorNodes = buildCard({ error: '接口返回 401', data: null });
check('失败卡片只显示错误，不渲染结果主体', has(errorNodes, 'ds-error') && !has(errorNodes, 'ds-result'));

// ── 多服务商：地址拼接、三套协议的请求与回复 ─────────────
// 这一块全部是纯函数，不碰网络，所以能把地址与 body 逐字符比对
const P = D.protocols;
check('协议表里有三套协议',
  !!P && ['openai', 'anthropic', 'gemini'].every((key) => !!P.PROTOCOLS[key]),
  Object.keys(P.PROTOCOLS || {}).join(','));

check('拼地址时多余的斜杠会被去掉',
  P.joinUrl('https://api.openai.com/v1/', '/models') === 'https://api.openai.com/v1/models',
  P.joinUrl('https://api.openai.com/v1/', '/models'));
check('地址里已经有尾段时不重复拼',
  P.joinUrl('https://api.deepseek.com/chat/completions', 'chat/completions')
  === 'https://api.deepseek.com/chat/completions',
  P.joinUrl('https://api.deepseek.com/chat/completions', 'chat/completions'));
check('地址为空时拼出空串', P.joinUrl('', 'models') === '');

const oaReq = P.buildChatRequest('openai', {
  baseURL: 'https://api.example.com/v1/',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  messages: [{ role: 'system', content: '你是助手' }, { role: 'user', content: '你好' }],
  temperature: 0.2,
  maxTokens: 128,
});
check('openai 请求地址是 /chat/completions',
  oaReq.url === 'https://api.example.com/v1/chat/completions', oaReq.url);
check('openai 用 Bearer 鉴权',
  oaReq.headers.Authorization === 'Bearer sk-test', JSON.stringify(oaReq.headers));
check('openai body 带 model、stream 与 JSON 输出',
  oaReq.body.model === 'gpt-4o-mini' && oaReq.body.stream === false
  && oaReq.body.response_format.type === 'json_object'
  && oaReq.body.max_tokens === 128 && oaReq.body.temperature === 0.2,
  JSON.stringify(oaReq.body));
check('openai 把 system 留在 messages 最前面',
  oaReq.body.messages.length === 2 && oaReq.body.messages[0].role === 'system',
  JSON.stringify(oaReq.body.messages));

const anReq = P.buildChatRequest('anthropic', {
  baseURL: 'https://api.anthropic.com',
  apiKey: 'ak-test',
  model: 'claude-3-5-sonnet-latest',
  messages: [{ role: 'system', content: '你是助手' }, { role: 'user', content: '你好' }],
  temperature: 0,
  maxTokens: 64,
  json: false,
});
check('anthropic 请求地址是 /v1/messages',
  anReq.url === 'https://api.anthropic.com/v1/messages', anReq.url);
check('anthropic 用 x-api-key 与版本头，不用 Authorization',
  anReq.headers['x-api-key'] === 'ak-test'
  && anReq.headers['anthropic-version'] === '2023-06-01'
  && !anReq.headers.Authorization,
  JSON.stringify(anReq.headers));
check('anthropic 把 system 单独拿出来，max_tokens 必填',
  anReq.body.system === '你是助手' && anReq.body.messages.length === 1
  && anReq.body.messages[0].role === 'user' && anReq.body.max_tokens === 64,
  JSON.stringify(anReq.body));
check('anthropic 没给 max_tokens 时也有默认值',
  P.buildChatRequest('anthropic', {
    baseURL: 'https://api.anthropic.com', apiKey: 'k', model: 'm',
    messages: [{ role: 'user', content: 'x' }],
  }).body.max_tokens === 1024);

const gmReq = P.buildChatRequest('gemini', {
  baseURL: 'https://generativelanguage.googleapis.com/',
  apiKey: 'gm-test',
  model: 'models/gemini-2.0-flash',
  messages: [{ role: 'system', content: '你是助手' }, { role: 'user', content: '你好' }],
  temperature: 0.1,
  maxTokens: 256,
});
check('gemini 模型名进路径，Key 进查询串',
  gmReq.url === 'https://generativelanguage.googleapis.com/v1beta/models/'
    + 'gemini-2.0-flash:generateContent?key=gm-test', gmReq.url);
check('gemini body 用 contents 与 systemInstruction',
  gmReq.body.contents.length === 1 && gmReq.body.contents[0].parts[0].text === '你好'
  && gmReq.body.systemInstruction.parts[0].text === '你是助手'
  && gmReq.body.generationConfig.maxOutputTokens === 256,
  JSON.stringify(gmReq.body));

const oaModels = P.normalizeModels('openai', {
  data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
});
check('openai 模型列表取 data[].id',
  oaModels.length === 2 && oaModels[1].id === 'deepseek-reasoner'
  && oaModels[0].label === 'deepseek-chat',
  JSON.stringify(oaModels));
check('openai 直接返回裸数组也能解析',
  JSON.stringify(P.normalizeModels('openai', [{ id: 'a' }, 'b']))
  === '[{"id":"a","label":"a"},{"id":"b","label":"b"}]',
  JSON.stringify(P.normalizeModels('openai', [{ id: 'a' }, 'b'])));
const gmModels = P.normalizeModels('gemini', {
  models: [
    { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
    { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
  ],
});
check('gemini 的 models/ 前缀被去掉，displayName 当标签',
  gmModels[0].id === 'gemini-2.0-flash' && gmModels[0].label === 'Gemini 2.0 Flash',
  JSON.stringify(gmModels));
check('anthropic 的 display_name 当标签',
  P.normalizeModels('anthropic', {
    data: [{ id: 'claude-3-5-sonnet-latest', display_name: 'Claude 3.5 Sonnet' }],
  })[0].label === 'Claude 3.5 Sonnet');
check('同一模型只留一条',
  P.normalizeModels('openai', { data: [{ id: 'x' }, { id: 'x' }] }).length === 1);
check('读到模型后优先选原来保存的那个',
  P.pickModel([{ id: 'a' }, { id: 'b' }], 'b') === 'b'
  && P.pickModel([{ id: 'a' }], 'zzz') === 'a'
  && P.pickModel([], 'zzz') === '');

check('openai 回复取 choices[0].message.content',
  P.parseChatReply('openai', {
    choices: [{ message: { content: '你好' } }], model: 'gpt-4o-mini',
    usage: { total_tokens: 9 },
  }).content === '你好');
check('anthropic 回复拼接所有 text 块，跳过其它类型',
  P.parseChatReply('anthropic', {
    content: [{ type: 'text', text: '你' }, { type: 'thinking', text: '略' }, { type: 'text', text: '好' }],
  }).content === '你好');
check('gemini 回复拼接 parts，跳过思考块',
  P.parseChatReply('gemini', {
    candidates: [{ content: { parts: [{ text: '你' }, { text: '好', thought: true }] } }],
    modelVersion: 'gemini-2.0-flash',
  }).content === '你');

// 推理型模型：额度花在思考上时 content 是空的，得能认出这两个字段
const spentReply = P.parseChatReply('openai', {
  choices: [{
    message: { content: '', reasoning_content: '先想一下……' },
    finish_reason: 'length',
  }],
  model: 'deepseek-v4-pro',
});
check('空回复带上 finish_reason', spentReply.finishReason === 'length', spentReply.finishReason);
check('空回复记下思考字数', spentReply.reasoningChars === 6, String(spentReply.reasoningChars));
check('普通回复没有 finish_reason 时留空串',
  P.parseChatReply('openai', { choices: [{ message: { content: '好' } }] }).finishReason === '');
check('普通回复的思考字数为 0',
  P.parseChatReply('openai', { choices: [{ message: { content: '好' } }] }).reasoningChars === 0);
check('回复里带 error 时抛可读错误',
  (() => {
    try {
      P.parseChatReply('openai', { error: { message: '额度不足' } });
      return false;
    }
    catch (e) {
      return e.code === 'API_ERROR' && e.message === '额度不足';
    }
  })());

check('没填 Key 时抛 NO_API_KEY',
  (() => {
    try {
      P.buildChatRequest('openai', {
        baseURL: 'https://api.example.com/v1', apiKey: '', model: 'm',
        messages: [{ role: 'user', content: 'x' }],
      });
      return false;
    }
    catch (e) {
      return e.code === 'NO_API_KEY' && /API Key/.test(e.message);
    }
  })());
check('本机服务不填 Key 也能构造请求',
  P.buildChatRequest('openai', {
    baseURL: 'http://localhost:11434/v1', apiKey: '', model: 'llama3.2',
    messages: [{ role: 'user', content: 'x' }],
  }).url === 'http://localhost:11434/v1/chat/completions');
check('读模型列表同样要求 Key',
  (() => {
    try {
      P.buildModelsRequest('gemini', { baseURL: 'https://x.test', apiKey: '' });
      return false;
    }
    catch (e) {
      return e.code === 'NO_API_KEY';
    }
  })());

// 旧配置兼容：1.12.0 之前没有 provider / protocol 这两个键
const legacy = P.resolve({ provider: '', protocol: '', baseURL: '', model: '' });
check('旧配置（没有 provider）按自定义 + openai 处理',
  legacy.provider === 'custom' && legacy.protocol === 'openai'
  && legacy.baseURL === 'https://api.deepseek.com',
  JSON.stringify(legacy));
check('老配置里的地址与模型继续生效',
  (() => {
    const r = P.resolve({
      provider: '', protocol: '', baseURL: 'https://my.proxy/v1', model: 'my-model',
    });
    return r.baseURL === 'https://my.proxy/v1' && r.model === 'my-model';
  })());
check('选了预设时协议由预设决定，不受 protocol 干扰',
  P.resolve({ provider: 'anthropic', protocol: 'openai', baseURL: '', model: '' }).protocol
    === 'anthropic'
  && P.resolve({ provider: 'gemini', protocol: '', baseURL: '', model: '' }).baseURL
    === 'https://generativelanguage.googleapis.com');
check('预设覆盖需求里列出的全部服务商',
  ['deepseek', 'openai', 'moonshot', 'zhipu', 'dashscope', 'siliconflow',
    'openrouter', 'groq', 'ollama', 'lmstudio', 'anthropic', 'gemini', 'custom']
    .every((key) => !!P.presetOf(key)));

// api.js 的错误文案：面板上直接显示的就是这些句子
check('401 提示 API Key 无效', D.api._describeStatus(401, '').includes('API Key 无效'));
check('未知状态码带上状态码与服务说明',
  (() => {
    const msg = D.api._describeStatus(418, '{"error":{"message":"我是一只茶壶"}}');
    return msg.includes('418') && msg.includes('我是一只茶壶');
  })());
check('设置里读不到 provider 时回落 DeepSeek',
  (() => {
    const s = D.api.settings();
    return s.provider === 'deepseek' && s.protocol === 'openai'
      && s.baseURL === 'https://api.deepseek.com';
  })());

// ── 输出 ───────────────────────────────────────────────
console.log(`全文缓存样本：${caches.length} 个`);
if (cjkSample) {
  console.log(`  中文样本 ${cjkSample.length} 字符`);
}
if (latinSample) {
  console.log(`  拉丁文样本 ${latinSample.length} 字符`);
}
console.log(`通过 ${passed} 项。`);
if (failures.length) {
  console.error(`失败 ${failures.length} 项：`);
  for (const f of failures) {
    console.error('  ✗ ' + f);
  }
  process.exit(1);
}
