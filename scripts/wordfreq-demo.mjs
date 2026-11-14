/**
 * 端到端仿真：拿 testdata/ 里的真实全文缓存，走一遍插件在 Zotero 里会走的
 * 同一套纯逻辑（语言判定 → 切词 → 计数 → 生成 CSV），把 CSV 写到
 * docs/sample-output/ 下。
 *
 * 它替代不了在 Zotero 里的实测，但能证明「同样一份文本进来，出去的 CSV 长什么样」，
 * 也能提前看出排版、编码、排序有没有问题。
 *
 * 用法：
 *   node scripts/demo.mjs                    # 跑全部语料
 *   node scripts/demo.mjs english-long.txt   # 只跑一个
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const scriptDir = path.join(projectRoot, 'addon', 'chrome', 'content', 'scripts', 'wordfreq');
const testdataDir = path.join(projectRoot, 'testdata');
const outDir = path.join(projectRoot, 'docs', 'sample-output');

// 与 main.js 里的默认设置保持一致
const TOKEN_OPTS = {
  mergeCase: true,
  splitHyphen: true,
  joinLineBreakHyphen: true,
  minLength: 1,
  includeStopwords: true,
  topN: 0,
};
const LANG_OPTS = {
  minTokens: 300,
  minEnglishPercent: 20,
  marginPercent: 130,
  maxNonLatinPercent: 2,
};

function createSandbox() {
  const prefStore = new Map();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    PathUtils: {
      join: (...parts) => path.win32.join(...parts),
      parent: (p) => path.win32.dirname(p),
    },
    Zotero: {
      debug: () => {},
      logError: () => {},
      Prefs: {
        get: (key) => prefStore.get(key),
        set: (key, value) => { prefStore.set(key, value); },
      },
    },
  };
  vm.createContext(sandbox);
  for (const file of ['langdata.js', 'userlist.js', 'lemma.js', 'langdetect.js',
    'tokenizer.js', 'wordfreq.js', 'output.js', 'main.js']) {
    vm.runInContext(
      fs.readFileSync(path.join(scriptDir, file), 'utf8'),
      sandbox,
      { filename: file }
    );
  }
  return sandbox.WordFreq;
}

function pad(s, n) {
  s = String(s);
  // 中文字符按两个字宽算，凑出来的表格才不会歪
  let width = 0;
  for (const ch of s) {
    width += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return s + ' '.repeat(Math.max(0, n - width));
}

function timestamp() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const W = createSandbox();

const only = process.argv[2];
const files = fs.readdirSync(testdataDir)
  .filter((f) => f.endsWith('.txt') && !f.startsWith('_'))
  .filter((f) => !only || f === only)
  .sort();

if (!files.length) {
  console.error(only ? `testdata/${only} 不存在` : 'testdata/ 下没有语料');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

console.log('语料'.padEnd(22) + '判定'.padEnd(12) + '词形'.padStart(8)
  + '词元'.padStart(8) + '词次'.padStart(9) + '  输出');

for (const file of files) {
  const full = path.join(testdataDir, file);
  const text = fs.readFileSync(full, 'utf8');

  const lang = W.langdetect.detect(text, LANG_OPTS);
  const stem = file.replace(/\.txt$/, '');

  if (!lang.isEnglish) {
    // 走插件的拒绝分支：不产出 CSV，只给理由
    console.log(pad(file, 22) + pad(lang.code, 12) + '—'.padStart(9)
      + '—'.padStart(9) + '  拒绝：' + lang.reason);
    fs.writeFileSync(
      path.join(outDir, `${stem}.rejected.txt`),
      `语料：${file}\n判定：${lang.code}\n理由：${lang.reason}\n\n`
      + W.langdetect.summarize(lang) + '\n',
      'utf8'
    );
    continue;
  }

  const stats = W.wordfreq.run(text, TOKEN_OPTS);
  // 不做归并时的词形数，用来说明合并掉了多少
  const plainUnique = W.tokenizer.count(text, TOKEN_OPTS).unique;
  const csv = W.wordfreq.buildCsv(stats.rows, {
    // 假装这份缓存来自库里的 PDF，好让元信息行贴近真实输出
    source: `${stem}.pdf`,
    generated: timestamp(),
    total_words: stats.totalTokens,
    listed_words: stats.listedTokens,
    unique_words: stats.uniqueWords,
    lemma: stats.lemmatized
      ? '已开启，' + stats.mergedForms + ' 个词条由多个词形合并而来'
      : '已关闭',
    language: lang.reason,
    text_source: '取自 Zotero 全文缓存',
    note: '',
  }, { bom: true });

  const outPath = path.join(outDir, `${stem}_wordfreq.csv`);
  fs.writeFileSync(outPath, csv, 'utf8');

  console.log(pad(file, 22) + pad('english', 12)
    + String(plainUnique).padStart(8)
    + String(stats.uniqueWords).padStart(8)
    + String(stats.totalTokens).padStart(9)
    + '  ' + path.relative(projectRoot, outPath));
  console.log('  ' + pad('', 20) + '高频：' + W.wordfreq.topWords(stats.rows, 12));
  const merged = stats.rows.filter((r) => r.forms).slice(0, 6);
  console.log('  ' + pad('', 20) + '合并示例：'
    + merged.map((r) => `${r.word}(${r.forms})`).join('  '));

  // 条目窗格里实际显示的样子：滤掉自定义名单里的词后分页。
  // 这里假装用户已经把下面两个词加进了名单，用来演示效果。
  W.userlist.clear();
  W.userlist.add('mager');
  W.userlist.add('musik');
  const filtered = W.wordfreq.filterForDisplay(stats.rows, {
    hideCustom: true,
    customWords: W.userlist.set(),
  });
  const paged = W.wordfreq.page(filtered.rows, 10, 0);
  console.log('  ' + pad('', 20) + '侧边栏第 1 页（名单 ' + W.userlist.count()
    + ' 个词，滤掉 ' + filtered.hiddenCustom + ' 个，'
    + '剩 ' + filtered.rows.length + ' 个词元 / ' + paged.totalPages + ' 页）：');
  console.log('  ' + pad('', 22) + paged.rows
    .map((r, i) => (i + 1) + '.' + r.word + '(' + r.count + ')').join('  '));
}

console.log('');
console.log(`输出目录：${outDir}`);
