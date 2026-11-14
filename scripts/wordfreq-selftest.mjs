/**
 * 离线自测：不启动 Zotero，把纯逻辑脚本加载进一个假的沙箱里跑。
 *
 * 覆盖三块最容易出错、又最值得测的逻辑：文本清洗与切词、词频与 CSV 生成、
 * 语言判定。语言判定还会拿你文献库里真实的全文缓存来跑（放在 testdata/），
 * 并把中间数值全部打出来，方便校准阈值。
 *
 * 用法：node scripts/selftest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const scriptDir = path.join(projectRoot, 'addon', 'chrome', 'content', 'scripts', 'wordfreq');
const testdataDir = path.join(projectRoot, 'testdata');

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

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `得到 ${a}，期望 ${e}`);
}

// ── 搭沙箱：只加载不碰 Zotero 的纯逻辑脚本 ──────────────
// 这些脚本只在函数体内引用 Zotero，加载时不执行，所以可以整体搬进沙箱。
// PathUtils 用 node:path 的 win32 实现喂进去，模拟 Zotero 运行时提供的那个全局。
function createSandbox() {
  const errors = [];
  // 假 Prefs 用一个 Map 兜着，这样 userlist 的读写能真的往返一趟
  const prefStore = new Map();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    PathUtils: {
      join: (...parts) => path.win32.join(...parts),
      parent: (p) => path.win32.dirname(p),
    },
    Zotero: {
      debug: () => {},
      logError: (e) => errors.push(e),
      Prefs: {
        get: (key) => prefStore.get(key),
        set: (key, value) => { prefStore.set(key, value); },
      },
    },
    __prefStore: prefStore,
  };
  vm.createContext(sandbox);
  const files = [
    'langdata.js', 'defaults.js', 'userlist.js', 'lemma.js', 'langdetect.js', 'tokenizer.js',
    'wordfreq.js', 'output.js', 'source.js', 'pane.js', 'parts-pane.js', 'backup.js', 'main.js',
  ];
  for (const file of files) {
    const code = fs.readFileSync(path.join(scriptDir, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  return { sandbox, errors, prefStore };
}

const { sandbox, errors, prefStore } = createSandbox();
const W = sandbox.WordFreq;
check('命名空间建立', !!W);
check('脚本加载期间没有报错', errors.length === 0, String(errors[0] || ''));
if (!W) {
  console.error('WordFreq 没有建立，后面没法测了。');
  process.exit(1);
}

const T = W.tokenizer;
const F = W.wordfreq;
const L = W.langdetect;
const O = W.output;
const S = W.source;
check('output 模块加载', !!O);
check('source 模块加载', !!S);
check('pane 模块加载', !!W.pane && W.pane.PANE_ID === 'ea-wordfreq-pane');

// ── 1. 清洗与切词 ──────────────────────────────────────
eq('基本切词并转小写', T.tokens('The quick brown fox.'), ['the', 'quick', 'brown', 'fox']);
eq('保留大小写', T.tokens('The Cat', { mergeCase: false }), ['The', 'Cat']);
eq('变音符折掉，不产生 na + ve 这类假词', T.tokens('naïve café'), ['naive', 'cafe']);
eq('NFKC 拆连字 ﬁ ﬂ', T.tokens('The ﬁnal ﬂow'), ['the', 'final', 'flow']);
eq('连字 ﬀ ﬃ', T.tokens('oﬀ ﬃnal'), ['off', 'ffinal']);
eq('行末断词还原', T.tokens('informa-\ntion is here'), ['information', 'is', 'here']);
eq('行末断词带缩进也能还原', T.tokens('informa-\n   tion'), ['information']);
eq('关掉行末断词还原', T.tokens('informa-\ntion', { joinLineBreakHyphen: false }), ['informa', 'tion']);
eq('连字符默认拆词', T.tokens('well-known result'), ['well', 'known', 'result']);
eq('连字符不拆时整体成词', T.tokens('well-known', { splitHyphen: false }), ['well-known']);
eq('撇号统一：弯撇号', T.tokens('it\u2019s fine'), ["it's", 'fine']);
eq('撇号保留在词内', T.tokens("don't stop"), ["don't", 'stop']);
eq('软连字符与零宽字符被删掉', T.tokens('a\u00adb\u200bc'), ['abc']);
eq('破折号当分隔符', T.tokens('one\u2014two'), ['one', 'two']);
eq('非断行连字符 U+2010 也还原', T.tokens('informa\u2010\ntion'), ['information']);
eq('数字与标点不进词表', T.tokens('1990, 3.14; pp. 42-45'), ['pp']);
eq('中文不进英文词表', T.tokens('这是中文 the end'), ['the', 'end']);

const counted = T.count('the the cat', {});
check('计数总数正确', counted.total === 3, String(counted.total));
check('去重数正确', counted.unique === 2, String(counted.unique));
check('词频数值正确', counted.counts.get('the') === 2 && counted.counts.get('cat') === 1);

const minLen = T.count('the a an i', { minLength: 2 });
eq('按最短长度过滤', Array.from(minLen.counts.keys()).sort(), ['an', 'the']);

// ── 2. 排序、筛选、CSV ─────────────────────────────────
const ranked = F.rank(new Map([['b', 2], ['a', 2], ['c', 5]]), 9);
eq('次数降序，并列按字母升序', ranked.map((r) => r.word), ['c', 'a', 'b']);
check('占比按全文词次算', Math.abs(ranked[0].share - 5 / 9) < 1e-9);

// the cat sat on the mat the —— 共 7 个词次，the 出现 3 次
const run1 = F.run('the cat sat on the mat the', {});
check('run 的 totalTokens 正确', run1.totalTokens === 7, String(run1.totalTokens));
check('run 的排序正确', run1.rows[0].word === 'the' && run1.rows[0].count === 3);
check('run 的 listedTokens 等于总数', run1.listedTokens === 7, String(run1.listedTokens));

const run2 = F.run('the cat sat on the mat the', { includeStopwords: false });
check('过滤停用词后 the 消失', !run2.rows.some((r) => r.word === 'the'));
check('过滤后 uniqueWords 与输出一致', run2.uniqueWords === run2.rows.length,
  `${run2.uniqueWords} vs ${run2.rows.length}`);
check('过滤不改变 totalTokens', run2.totalTokens === 7, String(run2.totalTokens));

const run3 = F.run('a b c d e f g h', { topN: 3 });
check('topN 截断生效', run3.rows.length === 3, String(run3.rows.length));

// 忽略只出现一次的词（设置项默认开启，纯函数要显式传才过滤）
const runSingles = F.run('the cat sat on the mat the', { skipSingles: true });
check('skipSingles 只留下出现两次以上的词',
  runSingles.rows.length === 1 && runSingles.rows[0].word === 'the',
  JSON.stringify(runSingles.rows.map((r) => r.word + ':' + r.count)));
check('skipSingles 不改变全文词次', runSingles.totalTokens === 7, String(runSingles.totalTokens));
check('skipSingles 下表中词次只算留下的行', runSingles.listedTokens === 3, String(runSingles.listedTokens));
check('skipSingles 下去重词数按筛选后算', runSingles.uniqueWords === 1, String(runSingles.uniqueWords));
const runSinglesLemma = F.run('dog dogs cat', { skipSingles: true });
check('按归并后的次数判断：dog 与 dogs 各一次会留下',
  runSinglesLemma.rows.length === 1 && runSinglesLemma.rows[0].word === 'dog' && runSinglesLemma.rows[0].count === 2,
  JSON.stringify(runSinglesLemma.rows.map((r) => r.word + ':' + r.count)));
check('不传 skipSingles 时不过滤', F.run('the cat sat on the mat the', {}).rows.length === 5,
  String(F.run('the cat sat on the mat the', {}).rows.length));

eq('CSV 字段转义', F.csvField('a,b'), '"a,b"');
eq('CSV 引号转义', F.csvField('say "hi"'), '"say ""hi"""');
eq('CSV 普通字段不加引号', F.csvField('plain'), 'plain');

const csv = F.buildCsv(run1.rows, { source: 'paper.pdf', total_words: 8 }, {});
check('CSV 带 UTF-8 BOM', csv.charCodeAt(0) === 0xfeff);
check('CSV 有表头', csv.includes('rank,word,count,share_percent'));
check('CSV 有元信息行', csv.includes('# 来源文件,paper.pdf'));
check('CSV 换行用 CRLF', csv.includes('\r\n'));
check('CSV 行数正确', csv.trim().split('\r\n').length === 3 + run1.rows.length,
  String(csv.trim().split('\r\n').length));

const csvNoBom = F.buildCsv([], {}, { bom: false });
check('可以关掉 BOM', csvNoBom.charCodeAt(0) !== 0xfeff);

// ── 2b. 输出路径与缓存覆盖判断 ──────────────────────────
const PDF = 'C:\\Users\\klskz\\Zotero\\storage\\ABCD1234\\Patteson - 2016 - Instruments for new music.pdf';
eq('CSV 与 PDF 同目录同名',
  O.csvPathFor(PDF, { suffix: '_wordfreq' }),
  'C:\\Users\\klskz\\Zotero\\storage\\ABCD1234\\Patteson - 2016 - Instruments for new music_wordfreq.csv');
eq('去掉扩展名取文件名', O.stemOf(PDF), 'Patteson - 2016 - Instruments for new music');
eq('取所在目录', O.parentOf(PDF), 'C:\\Users\\klskz\\Zotero\\storage\\ABCD1234');
eq('取扩展名', O.extOf(PDF), 'pdf');
eq('中文文件名的路径也能拼',
  O.csvPathFor('D:\\文献\\音乐与词频.pdf', { suffix: '_wf' }),
  'D:\\文献\\音乐与词频_wf.csv');
eq('后缀为空时直接替换扩展名',
  O.csvPathFor(PDF, { suffix: '' }),
  'C:\\Users\\klskz\\Zotero\\storage\\ABCD1234\\Patteson - 2016 - Instruments for new music.csv');

// 缓存覆盖判断决定统计的是整本书还是前 100 页，是后果最重的一处逻辑。
// Zotero 建索引时最多提前 fulltext.pdfMaxPages（默认 100）页。
eq('缓存覆盖完整', S.coverageOf({ indexedPages: 252, totalPages: 252 }), 'complete');
eq('缓存只覆盖前 100 页', S.coverageOf({ indexedPages: 100, totalPages: 221 }), 'partial');
eq('缓存只覆盖 100 / 1121 页', S.coverageOf({ indexedPages: 100, totalPages: 1121 }), 'partial');
eq('没有页数信息', S.coverageOf({ indexedPages: 0, totalPages: 0 }), 'unknown');
eq('缺字段时保守返回 unknown', S.coverageOf({}), 'unknown');
eq('pages 为空时返回 unknown', S.coverageOf(null), 'unknown');

// ── 2c. 词形归并 ───────────────────────────────────────
const LM = W.lemma;
check('lemma 模块加载', !!LM);
const lem = (word, capitalized) => LM.of(word, new Set(), { capitalized: capitalized || new Set() });

eq('名词复数 -s', lem('dogs'), 'dog');
eq('名词复数 -es', lem('boxes'), 'box');
eq('名词复数 -ies', lem('babies'), 'baby');
eq('-ves 复数', lem('knives'), 'knife');
eq('-ses 复数回到 -se', lem('roses'), 'rose');
eq('-sses 复数回到 -ss', lem('classes'), 'class');
eq('不规则复数 children', lem('children'), 'child');
eq('不规则复数 people', lem('people'), 'person');
eq('拉丁语复数 analyses', lem('analyses'), 'analysis');
eq('动词第三人称单数', lem('walks'), 'walk');
eq('动词过去式', lem('walked'), 'walk');
eq('动词现在分词', lem('walking'), 'walk');
eq('双写辅音还原 stop', lem('stopped'), 'stop');
eq('双写 ll 不误削', lem('pulled'), 'pull');
eq('双写 zz 不误削', lem('buzzed'), 'buzz');
eq('双写 ll 不误削 2', lem('drilled'), 'drill');
eq('-ied 还原', lem('studied'), 'study');
eq('-e 结尾动词还原', lem('liked'), 'like');
eq('避开 us 陷阱', lem('used'), 'use');
eq('避开 not 陷阱', lem('noted'), 'note');
eq('避开 mak 陷阱', lem('making'), 'make');
eq('be 的六种形式都归一', ['am', 'is', 'are', 'was', 'were', 'been', 'being'].map(lem).join(','),
  'be,be,be,be,be,be,be');
eq('have 的三单', lem('has'), 'have');
eq('go 的过去式', lem('went'), 'go');
eq('write 的过去分词', lem('written'), 'write');
eq('不规则比较级', lem('better'), 'good');
eq('情态动词过去式', lem('could'), 'can');
eq('禁剥表 news', lem('news'), 'news');
eq('禁剥表 physics', lem('physics'), 'physics');
eq('禁剥表 during', lem('during'), 'during');
eq('禁剥表 unexpected', lem('unexpected'), 'unexpected');
eq('un- 形容词不剥', lem('unchanged'), 'unchanged');
eq('un- 动词照常剥', lem('unfolded'), 'unfold');
eq('所有格并入', lem("dog's"), 'dog');
eq('缩写所有格并入', lem("it's"), 'it');
eq('专有名词不剥后缀', lem('sachs', new Set(['sachs'])), 'sachs');
eq('没有被标成专有名词时照常剥', lem('sachs'), 'sach');
eq('派生词不并 happiness', lem('happiness'), 'happiness');
eq('派生词不并 national', lem('national'), 'national');
eq('派生词不并 quickly', lem('quickly'), 'quickly');

const lc = T.count('dog dogs dog dogs dogs', {
  lemmaFn: (w, v, c) => LM.of(w, v, { capitalized: c }),
});
check('计数按原形合并', lc.counts.get('dog') === 5, String(lc.counts.get('dog')));
check('词形明细记下来了',
  lc.forms.get('dog').get('dog') === 2 && lc.forms.get('dog').get('dogs') === 3);

const runL = F.run('dog dogs dog dogs dogs', {});
eq('run 默认做归并', [runL.rows.length, runL.rows[0].word, runL.rows[0].count], [1, 'dog', 5]);
eq('forms 列内容', runL.rows[0].forms, 'dogs:3; dog:2');
check('归并后 totalTokens 不变', runL.totalTokens === 5, String(runL.totalTokens));
check('CSV 增加了 forms 列', F.buildCsv(runL.rows, {}, {}).includes('rank,word,count,share_percent,forms'));

const runNoLemma = F.run('dog dogs dog dogs dogs', { lemmatize: false });
eq('关掉归并后分开统计', runNoLemma.rows.length, 2);
eq('关掉归并后 forms 为空', runNoLemma.rows[0].forms || '', '');

const runOnly = F.run('the cat sat on the mat', {});
eq('be 之外的动词也归并', runOnly.rows.map((r) => r.word).sort(), ['cat', 'mat', 'on', 'sit', 'the']);

// ── 2d. 分页 ───────────────────────────────────────────
const nums = [];
for (let i = 0; i < 25; i++) {
  nums.push({ word: 'w' + i, count: 25 - i });
}
const p1 = F.page(nums, 10, 0);
eq('第 1 页 10 行', [p1.rows.length, p1.pageIndex, p1.totalPages, p1.total], [10, 0, 3, 25]);
eq('第 1 页第一行', p1.rows[0].word, 'w0');
const p2 = F.page(nums, 10, 2);
eq('最后一页只有 5 行', p2.rows.length, 5);
eq('最后一页第一行', p2.rows[0].word, 'w20');
eq('页码越界夹回最后一页', F.page(nums, 10, 99).pageIndex, 2);
eq('页码为负夹回第一页', F.page(nums, 10, -5).pageIndex, 0);
eq('空列表也至少有 1 页', F.page([], 10, 0).totalPages, 1);
eq('每页数量非法时退回 10', F.page(nums, 0, 0).rows.length, 10);

// ── 2e. 用户自定义名单 ─────────────────────────────────
const UL = W.userlist;
const UL_PREF = 'extensions.englishAssistant.wordfreq.userHiddenWords';
check('userlist 模块加载', !!UL);
check(
  '名单导入：JSON 数组',
  JSON.stringify(UL.parse('["alpha","beta","alpha"]')) === '["alpha","beta"]',
  JSON.stringify(UL.parse('["alpha","beta","alpha"]'))
);
check(
  '名单导入：{words:[...]}',
  JSON.stringify(UL.parse('{"version":1,"words":["a","b"]}')) === '["a","b"]'
);
check(
  '名单导入：一行一个词的纯文本',
  JSON.stringify(UL.parse('alpha\r\nbeta\r\n\r\n  gamma  ')) === '["alpha","beta","gamma"]',
  JSON.stringify(UL.parse('alpha\r\nbeta\r\n\r\n  gamma  '))
);
check('名单导入：空内容得到空数组', UL.parse('   ').length === 0);

// 默认自定义名单
const defaults = W.defaultUserList || [];
check('默认名单有几百个词', defaults.length >= 200 && defaults.length <= 500, String(defaults.length));
check('默认名单没有重复', new Set(defaults).size === defaults.length,
  String(defaults.length - new Set(defaults).size));
check('默认名单全是小写且非空', defaults.every((w) => typeof w === 'string' && w && w === w.toLowerCase()));
check('默认名单里有最基础的词', ['the', 'and', 'of', 'be', 'to'].every((w) => defaults.indexOf(w) >= 0));
check(
  '默认名单只放原形，不收屈折形式',
  ['went', 'gone', 'men', 'children', 'words', 'times', 'said', 'better', 'is', 'has']
    .every((w) => defaults.indexOf(w) < 0),
  ['went', 'men', 'words', 'said'].filter((w) => defaults.indexOf(w) >= 0).join(',')
);
check(
  '默认名单里的词都等于自己的词元',
  defaults.every((w) => {
    const lem = String(W.lemma.of(w, new Set(defaults), { possessive: true }) || '').toLowerCase();
    return lem === w;
  }),
  JSON.stringify(defaults.filter((w) => {
    const lem = String(W.lemma.of(w, new Set(defaults), { possessive: true }) || '').toLowerCase();
    return lem !== w;
  }))
);


check('prefGet / prefSet 可用', typeof W.prefGet === 'function' && typeof W.prefSet === 'function');
eq('初始名单为空', UL.all(), []);

UL.add('deleuze');
UL.add('Kittler');
UL.add('deleuze');
eq('加进去、小写化、去重', UL.all(), ['deleuze', 'kittler']);
check('has 大小写不敏感', UL.has('DELEUZE'));
eq('计数', UL.count(), 2);
eq('设置项里是排序后的 JSON 数组', prefStore.get(UL_PREF), '["deleuze","kittler"]');

eq('toggle 已在名单里的词返回 false', UL.toggle('deleuze'), false);
check('toggle 之后移除了', !UL.has('deleuze'));
eq('toggle 不在名单里的词返回 true', UL.toggle('mager'), true);
check('toggle 之后加进去了', UL.has('mager'));

UL.remove('mager');
eq('remove 之后', UL.all(), ['kittler']);

// 设置项被手改坏时不能让面板挂掉
prefStore.set(UL_PREF, '{这不是 JSON');
eq('坏 JSON 按空名单处理', UL.count(), 0);
prefStore.set(UL_PREF, '[]');

UL.clear();
eq('clear 之后名单为空', UL.all(), []);
eq('clear 之后设置项也是空数组', prefStore.get(UL_PREF), '[]');

// 自定义名单的筛选
const dispRows = [
  { word: 'the', count: 100 },
  { word: 'dog', count: 50 },
  { word: 'instrument', count: 20 },
  { word: 'synthesizer', count: 8 },
];
UL.add('dog');
UL.add('instrument');
const cf1 = F.filterForDisplay(dispRows, { hideCustom: true, customWords: UL.set() });
eq('自定义名单能滤掉词', cf1.rows.map((r) => r.word), ['the', 'synthesizer']);
eq('自定义隐藏计数', cf1.hiddenCustom, 2);
const cf2 = F.filterForDisplay(dispRows, { hideCustom: false, customWords: UL.set() });
eq('关掉筛选就不滤', cf2.rows.length, 4);
eq('关掉筛选时隐藏计数为 0', cf2.hiddenCustom, 0);
const cf3 = F.filterForDisplay(dispRows, { hideCustom: true, customWords: new Set() });
eq('名单为空时不过滤', cf3.rows.length, 4);
check('筛选不改动传进来的原数组', dispRows.length === 4);
UL.clear();

// ── 2f. CSV 反解析与已有词频表的查找 ────────────────────
const csvSample = F.buildCsv(
  [
    { word: 'dog', count: 8, share: 0.08, forms: 'dogs:5; dog:3' },
    { word: 'the', count: 92, share: 0.92, forms: '' },
  ],
  {
    source: 'a,b.pdf',
    total_words: 100,
    listed_words: 100,
    unique_words: 2,
    language: '英语',
    text_source: '取自缓存',
  },
  {}
);
const parsed = F.parseCsv(csvSample);
eq('解析出两行', parsed.rows.length, 2);
eq('第一行是 dog', parsed.rows[0].word, 'dog');
eq('次数解析成数字', parsed.rows[0].count, 8);
eq('forms 字段带分号也解析对了', parsed.rows[0].forms, 'dogs:5; dog:3');
eq('元信息里的带逗号字段', parsed.meta['来源文件'], 'a,b.pdf');
eq('元信息里的中文标签', parsed.meta['全文词次'], '100');
eq('第二行 forms 为空', parsed.rows[1].forms, '');
check('占比换回小数', Math.abs(parsed.rows[0].share - 0.08) < 1e-9);
eq('BOM 不影响解析', F.parseCsv('\ufeff' + csvSample).rows.length, 2);
check('空文本不报错', F.parseCsv('').rows.length === 0);
check('认不出来的文本不报错', F.parseCsv('这不是 CSV\n随便写点什么').rows.length === 0);

// 找已有词频表：覆盖关掉时会写成 _2、_3，得认出来并取序号最大的
eq('默认文件名序号为 1', O.csvIndexFor('paper_wordfreq.csv', 'paper', '_wordfreq'), 1);
eq('带序号的文件', O.csvIndexFor('paper_wordfreq_3.csv', 'paper', '_wordfreq'), 3);
eq('两位数序号', O.csvIndexFor('paper_wordfreq_12.csv', 'paper', '_wordfreq'), 12);
eq('别的 PDF 名不算', O.csvIndexFor('other_wordfreq.csv', 'paper', '_wordfreq'), null);
eq('别的后缀不算', O.csvIndexFor('paper_notes.csv', 'paper', '_wordfreq'), null);
eq('不是 csv 不算', O.csvIndexFor('paper_wordfreq.txt', 'paper', '_wordfreq'), null);
eq('中间段奇怪的不算', O.csvIndexFor('paper_wordfreq_x.csv', 'paper', '_wordfreq'), null);
eq('空后缀也能认', O.csvIndexFor('paper_2.csv', 'paper', ''), 2);
eq('前缀对上但后面接内容的不算',
  O.csvIndexFor('paper_wordfreq_backup.csv', 'paper', '_wordfreq'), null);

// 往返：拿真实语料跑一遍，写出 CSV 再读回来，词与次数必须对得上。
// 这条守住的是「已有词频表就直接显示」那条路——读回来的数据要和重新算的一致。
const roundTripPath = path.join(testdataDir, 'english-short.txt');
if (fs.existsSync(roundTripPath)) {
  const realText = fs.readFileSync(roundTripPath, 'utf8');
  const st = F.run(realText, {});
  const written = F.buildCsv(st.rows, {
    source: 'x.pdf',
    total_words: st.totalTokens,
    unique_words: st.uniqueWords,
  }, {});
  const back = F.parseCsv(written);
  eq('往返后行数一致', back.rows.length, st.rows.length);
  eq('往返后第一个词一致', back.rows[0].word, st.rows[0].word);
  eq('往返后第一个词的次数一致', back.rows[0].count, st.rows[0].count);
  eq('往返后最后一个词一致',
    back.rows[back.rows.length - 1].word, st.rows[st.rows.length - 1].word);
  eq('往返后全文词次一致', Number(back.meta['全文词次']), st.totalTokens);
  const withForms = st.rows.filter((r) => r.forms);
  if (withForms.length) {
    const target = withForms[0];
    const got = back.rows.filter((r) => r.word === target.word)[0];
    eq('往返后 forms 明细一致', got.forms, target.forms);
  }
}

// ── 3. 语言判定：构造样本 ──────────────────────────────
const SAMPLE_EN = `
The question of how listeners parse harmonic structure has been addressed in a number of
studies over the past thirty years. It is generally agreed that the perceptual system does
not treat every acoustic event as equally informative, and that the listener instead relies
on a set of learned regularities that are specific to the style at hand. What is less clear
is whether those regularities are represented as abstract rules or as a large set of stored
exemplars, and how the two possibilities might be distinguished by experiment. In this
paper we report four experiments that were designed to test the predictions of the exemplar
account against those of the rule based account. The results of the first two experiments
are consistent with both accounts, but the third and fourth experiments show a pattern of
responses that the rule based account does not predict. We argue that the evidence as a
whole favours a hybrid model in which abstraction and storage both play a role. It should be
noted that this conclusion depends on assumptions about the listener that we discuss below.
`;

const SAMPLE_FR = `
La question de savoir comment les auditeurs perçoivent la structure harmonique a été abordée
dans un certain nombre d'études au cours des trente dernières années. Il est généralement
admis que le système perceptif ne traite pas chaque événement acoustique comme également
informatif, et que l'auditeur s'appuie plutôt sur un ensemble de régularités apprises qui
sont propres au style considéré. Ce qui est moins clair, c'est de savoir si ces régularités
sont représentées sous forme de règles abstraites ou sous forme d'un grand ensemble
d'exemplaires stockés, et comment les deux possibilités pourraient être distinguées par
l'expérience. Dans cet article, nous rapportons quatre expériences qui ont été conçues pour
tester les prédictions du modèle par exemplaires contre celles du modèle fondé sur des
règles. Les résultats des deux premières expériences sont compatibles avec les deux
modèles, mais les troisième et quatrième expériences montrent un schéma de réponses que le
modèle fondé sur des règles ne prédit pas. Nous soutenons que l'ensemble des données
favorise un modèle hybride dans lequel l'abstraction et le stockage jouent tous deux un rôle.
`;

const SAMPLE_DE = `
Die Frage, wie Hörer harmonische Strukturen wahrnehmen, ist in den vergangenen dreißig
Jahren in einer Reihe von Studien untersucht worden. Es ist allgemein anerkannt, dass das
Wahrnehmungssystem nicht jedes akustische Ereignis als gleich informativ behandelt, und dass
sich der Hörer stattdessen auf eine Menge gelernter Regelmäßigkeiten stützt, die für den
jeweiligen Stil charakteristisch sind. Weniger klar ist, ob diese Regelmäßigkeiten als
abstrakte Regeln oder als eine große Menge gespeicherter Exemplare repräsentiert werden und
wie die beiden Möglichkeiten experimentell unterschieden werden könnten. In diesem Beitrag
berichten wir über vier Experimente, die entwickelt wurden, um die Vorhersagen des
Exemplaransatzes gegen die des regelbasierten Ansatzes zu prüfen. Die Ergebnisse der ersten
beiden Experimente sind mit beiden Ansätzen vereinbar, aber das dritte und das vierte
Experiment zeigen ein Antwortmuster, das der regelbasierte Ansatz nicht vorhersagt. Wir
argumentieren, dass die Gesamtheit der Befunde für ein hybrides Modell spricht, in dem
Abstraktion und Speicherung beide eine Rolle spielen und das im Folgenden erläutert wird.
`;

const SAMPLE_ZH = `
本文讨论听众如何理解音乐中的和声结构这一问题。过去三十年里，已有若干研究涉及此问题。
学界普遍认为，知觉系统不会把每一个声学事件都当作同等重要的信息，听众依赖的是一套
习得的、与具体风格相关的规律。目前尚不清楚的是，这些规律究竟以抽象规则的形式表征，
还是以大量储存的样例的形式表征，以及如何通过实验区分这两种可能。本文报告四项实验，
用以检验样例模型的预测与规则模型的预测。前两项实验的结果与两种模型都相容，但第三项
和第四项实验呈现出的反应模式，是规则模型无法预测的。我们认为，全部证据更支持一种混合
模型，其中抽象与储存都发挥作用。需要指出的是，这一结论依赖于我们对听众所作的假设。
`;

const EN_OPTS = { minTokens: 60 };

const en = L.detect(SAMPLE_EN, EN_OPTS);
check('英语样本判为英文', en.isEnglish, en.reason + ' / ' + L.summarize(en));
check('英语功能词命中率在合理区间', en.report.englishShare > 0.3 && en.report.englishShare < 0.55,
  String(en.report.englishShare));

const fr = L.detect(SAMPLE_FR, EN_OPTS);
check('法语样本被拒绝', !fr.isEnglish, L.summarize(fr));
check('法语样本的次高语言是法语', fr.report.runnerUpCode === 'fr', String(fr.report.runnerUpCode));

const de = L.detect(SAMPLE_DE, EN_OPTS);
check('德语样本被拒绝', !de.isEnglish, L.summarize(de));
check('德语样本的次高语言是德语', de.report.runnerUpCode === 'de', String(de.report.runnerUpCode));

const zh = L.detect(SAMPLE_ZH, EN_OPTS);
check('中文样本被拒绝', !zh.isEnglish);
check('中文样本走的是书写系统这一层', zh.code === 'script', zh.code);
check('中文样本报出 CJK', zh.report.dominantScript === 'CJK', String(zh.report.dominantScript));

const shortOne = L.detect('The cat sat.', EN_OPTS);
check('文本太短时不判定', shortOne.code === 'too-short', shortOne.code);
check('空文本有专门的状态', L.detect('', EN_OPTS).code === 'empty');

// 中文文献里带英文摘要，不该因为摘要就被判成英文
const zhWithAbstract = SAMPLE_ZH + SAMPLE_ZH + '\n' + SAMPLE_EN.slice(0, 400);
check('中文正文配英文摘要仍判为非英文', !L.detect(zhWithAbstract, EN_OPTS).isEnglish,
  L.summarize(L.detect(zhWithAbstract, EN_OPTS)));

// 英语文献里夹一段外文引文，不该被误拒
const enWithQuote = SAMPLE_EN + SAMPLE_EN + '\n' + SAMPLE_FR.slice(0, 300);
check('英语正文夹外文引文仍判为英文', L.detect(enWithQuote, EN_OPTS).isEnglish,
  L.summarize(L.detect(enWithQuote, EN_OPTS)));

// ── 4. 真实语料 ────────────────────────────────────────
const corpora = [
  { file: 'english-short.txt', expect: true },
  { file: 'english-medium.txt', expect: true },
  { file: 'english-long.txt', expect: true },
  { file: 'chinese.txt', expect: false },
  { file: 'no-text.txt', expect: false },
  { file: 'latin-other.txt', expect: false },
];

const found = [];
console.log('\n真实语料的判定数值（阈值：英语命中率 ≥ 20%，领先次高 ≥ 1.3 倍，非拉丁 ≤ 2%）');
console.log('文件'.padEnd(22) + '字符'.padStart(9) + '词数'.padStart(9)
  + '非拉丁'.padStart(9) + '变音符'.padStart(9) + '英语'.padStart(8)
  + '次高'.padStart(16) + '倍数'.padStart(8) + '  判定');

for (const corpus of corpora) {
  const full = path.join(testdataDir, corpus.file);
  if (!fs.existsSync(full)) {
    continue;
  }
  found.push(corpus.file);
  const text = fs.readFileSync(full, 'utf8');
  const t0 = Date.now();
  const result = L.detect(text, {});
  const elapsed = Date.now() - t0;
  const r = result.report;
  const pct = (v) => (v * 100).toFixed(2) + '%';

  console.log(
    corpus.file.padEnd(22)
    + String(r.textChars).padStart(9)
    + String(r.tokens).padStart(9)
    + pct(r.nonLatinShare).padStart(9)
    + pct(r.diacriticShare).padStart(9)
    + pct(r.englishShare).padStart(8)
    + ((r.runnerUpCode || '-') + ' ' + pct(r.runnerUpShare)).padStart(16)
    + (r.runnerUpShare > 0 ? r.margin.toFixed(2) : 'inf').padStart(8)
    + '  ' + result.code + '（' + elapsed + ' ms）'
  );

  check(`${corpus.file} 判定为${corpus.expect ? '英文' : '非英文'}`,
    result.isEnglish === corpus.expect, result.reason);

  // 长文本顺带测一下整本统计的耗时，以及「忽略只出现一次的词」的效果
  if (corpus.file === 'english-long.txt') {
    const t1 = Date.now();
    const stats = F.run(text, {});
    const cost = Date.now() - t1;
    console.log(`  └ 整本统计：${stats.totalTokens} 词次，去重 ${stats.uniqueWords} 个，耗时 ${cost} ms`);
    console.log(`  └ 最高频：${F.topWords(stats.rows, 15)}`);
    check('长文本统计耗时在 5 秒内', cost < 5000, cost + ' ms');
    check('长文本统计出的词次大于 10000', stats.totalTokens > 10000, String(stats.totalTokens));

    const filtered = F.run(text, { skipSingles: true });
    console.log(`  └ 忽略只出现一次的词后：去重 ${filtered.uniqueWords} 个（原 ${stats.uniqueWords} 个），`
      + `表中词次 ${filtered.listedTokens}（原 ${stats.listedTokens}）`);
    check('忽略单次词后条目变少但全文词次不变',
      filtered.uniqueWords < stats.uniqueWords && filtered.totalTokens === stats.totalTokens,
      `${filtered.uniqueWords} vs ${stats.uniqueWords}`);
    check('忽略单次词后表里每个词都至少出现两次',
      filtered.rows.every((r) => r.count > 1), String(filtered.rows.find((r) => r.count <= 1)?.word));
  }
}

if (!found.length) {
  console.log('\n（testdata/ 下没有语料，真实数据相关的检查已跳过）');
}

// ── 分部词频：结果文件名与页码范围 ─────────────────────
// 「查询分部」靠文件名列出历史结果，解析错了列表就是空的，值得单独测。

const P = W.partsPane;
check('分部词频区块命名空间建立', !!P);
if (P) {
  const one = P.parsePartName('paper_wordfreq_pages_12-34_20261017-173005.csv', 'paper');
  eq('从文件名解出页码范围', one && [one.from, one.to], [12, 34]);
  eq('从文件名解出统计时间', one && one.stamp, '2026-10-17 17:30:05');
  eq('别的 CSV 不算分部结果', P.parsePartName('paper_wordfreq.csv', 'paper'), null);
  eq('别篇文献的分部结果不算',
    P.parsePartName('other_wordfreq_pages_1-2_20261017-173005.csv', 'paper'), null);
  const dup = P.parsePartName('paper_wordfreq_pages_1-2_20261017-173005_2.csv', 'paper');
  eq('同一秒重名的 _2 后缀也能解析', dup && [dup.from, dup.to], [1, 2]);
  // 只差后缀字母的 PDF 名不能被认成同一篇（paper 与 paper2）
  eq('PDF 名相近但不相同不算',
    P.parsePartName('paper2_wordfreq_pages_1-2_20261017-173005.csv', 'paper'), null);

  const csvRange = W.wordfreq.buildCsv([], { page_range: '12-34' }, { bom: false });
  check('CSV 元信息里有页码范围', csvRange.includes('# 页码范围,12-34'), csvRange);
  eq('读回来的页码范围', W.wordfreq.parseCsv(csvRange).meta['页码范围'], '12-34');

  // ── EPUB 分部：百分比区间 ──────────────────────────
  // EPUB 没有页码，按字符百分比切；文件名前缀、范围解析、校验、切片都在这里测。
  eq('页范围文件解析出类型', one && one.kind, 'pages');

  const pctName = P.partFileName('book', 'pct', 10, 20, '20261017-173005');
  eq('百分比文件名带 _wordfreq_pct_ 前缀',
    pctName, 'book_wordfreq_pct_10-20_20261017-173005.csv');
  eq('百分比文件名保留小数',
    P.partFileName('book', 'pct', 10.5, 20.25, '20261017-173005'),
    'book_wordfreq_pct_10.5-20.25_20261017-173005.csv');
  eq('页范围文件名保持不变',
    P.partFileName('book', 'pages', 12, 34, '20261017-173005'),
    'book_wordfreq_pages_12-34_20261017-173005.csv');

  const pctParsed = P.parsePartName(pctName, 'book');
  eq('百分比文件名解出类型与范围',
    pctParsed && [pctParsed.kind, pctParsed.from, pctParsed.to], ['pct', 10, 20]);
  eq('百分比文件名解出统计时间', pctParsed && pctParsed.stamp, '2026-10-17 17:30:05');

  // 两类文件名互不误认：页码文件仍算 pages，百分比文件仍算 pct
  const pageLike = P.parsePartName('book_wordfreq_pages_10-20_20261017-173005.csv', 'book');
  eq('页范围文件不会被当成百分比', pageLike && pageLike.kind, 'pages');
  const pctLike = P.parsePartName('book_wordfreq_pct_10-20_20261017-173005.csv', 'book');
  eq('百分比文件不会被当成页范围', pctLike && pctLike.kind, 'pct');
  eq('别篇的百分比结果不算',
    P.parsePartName('other_wordfreq_pct_10-20_20261017-173005.csv', 'book'), null);
  const pctDec = P.parsePartName('book_wordfreq_pct_10.5-20.25_20261017-173005.csv', 'book');
  eq('百分比文件名允许小数范围', pctDec && [pctDec.from, pctDec.to], [10.5, 20.25]);

  eq('百分比显示去掉多余小数',
    [P.formatPercent(10), P.formatPercent(10.5), P.formatPercent(0)],
    ['10', '10.5', '0']);
  eq('百分比输入接受首尾空格与小数', P.parsePercent(' 12.5 '), 12.5);
  eq('空百分比无效', Number.isNaN(P.parsePercent('')), true);

  const okRange = P.checkPercentRange('0', '100');
  eq('0%-100% 合法', [okRange.ok, okRange.from, okRange.to], [true, 0, 100]);
  const sameRange = P.checkPercentRange('20', '20');
  check('起始等于结束被拒绝', sameRange.ok === false && sameRange.message.length > 0,
    sameRange.message);
  const overRange = P.checkPercentRange('10', '100.5');
  check('结束超过 100 被拒绝', overRange.ok === false && overRange.message.length > 0,
    overRange.message);
  const negRange = P.checkPercentRange(-1, 10);
  check('起始小于 0 被拒绝', negRange.ok === false && negRange.message.length > 0,
    negRange.message);
  const badRange = P.checkPercentRange('abc', '20');
  check('非数字百分比被拒绝', badRange.ok === false && badRange.message.length > 0,
    badRange.message);

  // 右键「填写当前位置」：页码换算成百分比
  eq('第 0 页换算成 0%', P.percentOfIndex(0, 300), 0);
  eq('第 150 页换算成 50%', P.percentOfIndex(150, 300), 50);
  eq('最后一页换算成 99.7%（保留一位小数）', P.percentOfIndex(299, 300), 99.7);
  eq('总页数缺失时返回 null', P.percentOfIndex(5, 0), null);
  eq('页码为负时返回 null', P.percentOfIndex(-1, 300), null);
  eq('超出总页数时截到 100%', P.percentOfIndex(400, 300), 100);

  // 按视口里看到的文字定位（EPUB 没有可靠页数时走这条路）
  eq('位置换百分比保留一位小数', P.percentFromOffset(500, 4000), 12.5);
  eq('位置为负返回 null', P.percentFromOffset(-1, 4000), null);
  eq('全文为空返回 null', P.percentFromOffset(10, 0), null);
  const longText = 'Alice was beginning to get very tired of sitting by her sister '
    + 'on the bank, and of having nothing to do. '.repeat(20)
    + 'So she was considering in her own mind whether the pleasure of making a '
    + 'daisy-chain would be worth the trouble.';
  const chunk = 'whether the pleasure of making a daisy-chain would be worth the trouble.';
  const foundPct = P.percentOfChunkInText(chunk, longText);
  check('视口文字能在全文里定位到靠后的位置', foundPct !== null && foundPct > 80,
    '得到 ' + foundPct);
  eq('空白不一致也能定位（DOM 与缓存文本的空白不同）',
    P.percentOfChunkInText('whether   the pleasure\nof making a daisy-chain', longText),
    foundPct);
  eq('定位不到返回 null', P.percentOfChunkInText('this sentence is not in the text at all', longText), null);
  eq('片段太短不硬猜', P.percentOfChunkInText('Alice', longText), null);
  eq('折叠后只留字母数字（去空白、标点、软连字符）',
    P.foldForSearch('  Well—be\u00ADginning, “tired”! '), 'wellbeginningtired');
  check('缓存文本多了软连字符也能定位',
    P.percentOfChunkInText(chunk, longText.replace('daisy-chain', 'daisy\u00ADchain')) !== null,
    '软连字符干扰');

  // 阅读器界面上显示的页码（EPUB 里由阅读器按窗口大小与字号自己分）
  const label1 = P.parsePageLabel('12 / 340');
  eq('读「12 / 340」得当前 12 共 340', [label1.index, label1.total], [12, 340]);
  const label2 = P.parsePageLabel('  7／9 ');
  eq('全角斜杠与空格也能读', [label2.index, label2.total], [7, 9]);
  eq('页码超出总页数不认', P.parsePageLabel('40 / 20'), null);
  eq('非页码文字不认', P.parsePageLabel('12 of 340'), null);
  eq('空文字不认', P.parsePageLabel(''), null);
  eq('第 12 页（共 340）折算 3.2%', P.percentOfIndex(11, 340), 3.2);

  // 阅读器自己上报的视图统计（EPUB 每次翻页都会更新 pageIndex / pagesCount）
  eq('统计里第 0 页共 340 页得 0%', P.percentOfStats({ pageIndex: 0, pagesCount: 340 }), 0);
  eq('统计里第 170 页共 340 页得 50%', P.percentOfStats({ pageIndex: 170, pagesCount: 340 }), 50);
  eq('统计缺 pagesCount 返回 null', P.percentOfStats({ pageIndex: 5 }), null);
  eq('统计缺 pageIndex 返回 null', P.percentOfStats({ pagesCount: 5 }), null);
  eq('统计为空返回 null', P.percentOfStats({}), null);

  // 同一个探针在全文里出现多次时，按页码先验挑最近的那一处
  const twiceText = 'alpha bravo charlie delta alpha bravo charlie delta';
  eq('没给先验时取第一处', P.nearestOccurrence(twiceText, 'bravo', null), 6);
  eq('先验靠后就取靠后的那一处', P.nearestOccurrence(twiceText, 'bravo', 80), 32);
  eq('先验靠前就取靠前的那一处', P.nearestOccurrence(twiceText, 'bravo', 10), 6);
  eq('先验靠后时 delta 取后一处', P.nearestOccurrence(twiceText, 'delta', 90), 46);
  eq('先验靠前时 delta 取前一处', P.nearestOccurrence(twiceText, 'delta', 10), 20);
  eq('找不到时返回 -1', P.nearestOccurrence(twiceText, 'zulu', 50), -1);

  const sliceAll = P.sliceByPercent('abcdefghij', 0, 100);
  eq('0%-100% 切出整段文本',
    [sliceAll.start, sliceAll.end, sliceAll.text], [0, 10, 'abcdefghij']);
  const sliceBounds = P.sliceByPercent('abcdefghij', 10, 20);
  eq('10%-20% 起点向下取整、终点向上取整',
    [sliceBounds.start, sliceBounds.end, sliceBounds.text], [1, 2, 'b']);
  const sliceTail = P.sliceByPercent('abcdefg', 50, 100);
  eq('到 100% 时切到最后一个字符',
    [sliceTail.start, sliceTail.end, sliceTail.text], [3, 7, 'defg']);
  const sliceShort = P.sliceByPercent('abc', 50, 100);
  eq('短文本上百分比区间仍能切出内容',
    [sliceShort.start, sliceShort.end, sliceShort.text], [1, 3, 'bc']);
  const sliceEmpty = P.sliceByPercent('', 10, 20);
  eq('空文本切出空串', [sliceEmpty.start, sliceEmpty.end, sliceEmpty.text], [0, 0, '']);

  const pctCsv = W.wordfreq.buildCsv(
    [{ word: 'the', count: 3, share: 0.5, forms: '' }],
    { range: '10%-20%（按字符比例）', total_words: 3, unique_words: 1 },
    { bom: false });
  check('CSV 元信息里有百分比范围',
    pctCsv.includes('# 范围,10%-20%（按字符比例）'), pctCsv);
  const pctBack = P.outcomeFromCsv(W.wordfreq.parseCsv(pctCsv), 'x.csv', 0, 0, 'pct');
  eq('百分比 CSV 读回范围',
    [pctBack.kind, pctBack.from, pctBack.to], ['pct', 10, 20]);
  const pageBack = P.outcomeFromCsv(W.wordfreq.parseCsv(csvRange), 'x.csv', 0, 0, 'pages');
  eq('页范围 CSV 仍按页码范围读回',
    [pageBack.kind, pageBack.from, pageBack.to], ['pages', 12, 34]);
}

// ── 最短词长的口径换算 ────────────────────────────────
{
  eq('设置 0 表示全部计入', W.minLengthFromPref(0), 1);
  eq('设置 1 表示只排除单字母词', W.minLengthFromPref(1), 2);
  eq('设置 3 表示排除三个字母以内的词', W.minLengthFromPref(3), 4);
  eq('设置带小数的按四舍五入', W.minLengthFromPref('2.6'), 4);
  eq('设置是负数时当作 0', W.minLengthFromPref(-5), 1);
  eq('设置不是数字时当作 0', W.minLengthFromPref('abc'), 1);

  // 迁移：旧口径「短于 N 不计入」→ 新口径「≤ N 不计入」，同一效果要减一
  prefStore.clear();
  prefStore.set('extensions.englishAssistant.wordfreq.minWordLength', 3);
  eq('旧值 3 迁移后变成 2', W.migrateMinWordLength(), true);
  eq('迁移写回的首选项值是 2',
    prefStore.get('extensions.englishAssistant.wordfreq.minWordLength'), 2);
  eq('迁移打上标记', prefStore.get('extensions.englishAssistant.wordfreq.minWordLengthV2'), true);
  eq('第二次调用不再迁移', W.migrateMinWordLength(), false);
  prefStore.clear();
  prefStore.set('extensions.englishAssistant.wordfreq.minWordLength', 1);
  prefStore.set('extensions.englishAssistant.wordfreq.minWordLengthV2', false);
  eq('旧值 1 迁移后变成 0', W.migrateMinWordLength(), true);
  eq('迁移结果落在 0', prefStore.get('extensions.englishAssistant.wordfreq.minWordLength'), 0);
  prefStore.clear();
}
// ── 配置备份（纯函数） ─────────────────────────────────
{
  const B = W.backup;
  check('备份模块存在', !!B);

  const picked = B.pickPrefs({
    'extensions.englishAssistant.translate.model': 'deepseek-chat',
    'extensions.englishAssistant.wordfreq.minWordLength': 2,
    'extensions.other.key': 'x',
    'browser.startup.page': 3,
  });
  eq('只留下本插件的键', Object.keys(picked).sort(), [
    'extensions.englishAssistant.translate.model',
    'extensions.englishAssistant.wordfreq.minWordLength',
  ]);
  eq('不混进别人的键', picked['extensions.other.key'], undefined);

  const built = B.buildBackup(
    {
      'extensions.englishAssistant.translate.model': 'deepseek-chat',
      'extensions.englishAssistant.wordfreq.userHiddenWords': '["the","and"]',
    },
    { exportedAt: '2026-10-31T10:00:00.000Z', pluginVersion: '1.16.0' });
  eq('导出带格式标记', built.format, 'english-assistant-config');
  eq('导出带版本号', built.version, 1);
  eq('导出记下时间与插件版本',
    [built.exportedAt, built.pluginVersion], ['2026-10-31T10:00:00.000Z', '1.16.0']);
  eq('导出项数', Object.keys(built.prefs).length, 2);

  const roundTrip = B.parseBackup(JSON.stringify(built));
  eq('导出再解析能还原设置', roundTrip.prefs['extensions.englishAssistant.translate.model'],
    'deepseek-chat');

  let badJson = '';
  try {
    B.parseBackup('{ not json');
  }
  catch (e) {
    badJson = e.message;
  }
  check('坏 JSON 报中文原因', /JSON/.test(badJson), badJson);

  let badFormat = '';
  try {
    B.parseBackup(JSON.stringify({ format: 'something-else', prefs: {} }));
  }
  catch (e) {
    badFormat = e.message;
  }
  check('别的格式被拒绝', /英文助手/.test(badFormat), badFormat);

  let noPrefs = '';
  try {
    B.parseBackup(JSON.stringify({ format: 'english-assistant-config' }));
  }
  catch (e) {
    noPrefs = e.message;
  }
  check('缺 prefs 被拒绝', /设置项/.test(noPrefs), noPrefs);

  eq('整数按四舍五入转换', B.coerceValue('int', '19.6'), 20);
  eq('整数遇到非数字返回 null', B.coerceValue('int', 'abc'), null);
  eq('布尔认 true 字符串', B.coerceValue('bool', 'true'), true);
  eq('布尔认 0 为假', B.coerceValue('bool', 0), false);
  eq('字符串转成字符串', B.coerceValue('string', 42), '42');
  eq('字符串遇到 null 变空串', B.coerceValue('string', null), '');

  const info = B.summarize(JSON.parse(JSON.stringify(built)));
  eq('摘要统计设置项数', info.count, 2);
  eq('摘要数出名单里的词数', info.words, 2);
  eq('摘要说明有没有 API Key', info.hasKey, false);

  const withKey = B.summarize({
    prefs: { 'extensions.englishAssistant.translate.apiKey': 'sk-xxx' },
  });
  eq('有 Key 时摘要标记出来', withKey.hasKey, true);

  eq('默认文件名带日期时间', B.fileNameFor(new Date(2026, 9, 31, 8, 5, 9)),
    'english-assistant-config-20261031-080509.json');
}
// ── 输出 ───────────────────────────────────────────────
console.log('');
console.log(`通过 ${passed} 项。`);
if (failures.length) {
  console.error(`失败 ${failures.length} 项：`);
  for (const f of failures) {
    console.error('  ✗ ' + f);
  }
  process.exit(1);
}
