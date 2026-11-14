/**
 * 词形归并审查：拿真实语料跑一遍归并，把结果摊开看。
 *
 * 规则归并一定会出错，光看代码看不出来，得看它在真文本上切出了什么。
 * 这个脚本打印三样东西：
 *   1. 归并前后的词形数 / 词元数
 *   2. 合并得最多的那些词条（按合并进去的词次排序）
 *   3. 可疑原形：文档里从没以原形出现过、又不是不规则表里的条目。
 *      这一类是规则推出来的，正确的多（created → create），
 *      但切错的（walked → walke）也全在这里，重点看这一份。
 *
 * 用法：node scripts/lemma-audit.mjs [语料文件名]
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const scriptDir = path.join(projectRoot, 'addon', 'chrome', 'content', 'scripts', 'wordfreq');
const testdataDir = path.join(projectRoot, 'testdata');

function createSandbox() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    PathUtils: {
      join: (...parts) => path.win32.join(...parts),
      parent: (p) => path.win32.dirname(p),
    },
    Zotero: { debug: () => {}, logError: () => {}, Prefs: { get: () => undefined, set: () => {} } },
  };
  vm.createContext(sandbox);
  for (const file of ['langdata.js', 'lemma.js', 'tokenizer.js', 'wordfreq.js', 'langdetect.js']) {
    vm.runInContext(fs.readFileSync(path.join(scriptDir, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.WordFreq;
}

const W = createSandbox();
const TOKEN_OPTS = { mergeCase: true, splitHyphen: true, joinLineBreakHyphen: true, minLength: 1 };

const wanted = process.argv[2];
const files = fs.readdirSync(testdataDir)
  .filter((f) => f.endsWith('.txt') && !f.startsWith('_'))
  .filter((f) => !wanted || f === wanted)
  .sort();

for (const file of files) {
  const text = fs.readFileSync(path.join(testdataDir, file), 'utf8');

  // 不做归并
  const plain = W.tokenizer.count(text, TOKEN_OPTS);
  // 做归并
  const stats = W.wordfreq.run(text, TOKEN_OPTS);

  // 重新跑一次拿 formMap：run() 里没把它带出来，这里单独算
  const vocab = new Set();
  for (const t of W.tokenizer.tokens(text, TOKEN_OPTS)) {
    vocab.add(t);
  }
  const merged = W.tokenizer.count(text, Object.assign({}, TOKEN_OPTS, {
    lemmaFn: (word, v, cap) => W.lemma.of(word, v, { possessive: true, capitalized: cap }),
  }));

  console.log('='.repeat(78));
  console.log(`${file}`);
  console.log(`  词次 ${plain.total}　词形去重 ${plain.unique} → 词元去重 ${stats.uniqueWords}`
    + `（减少 ${(100 * (1 - stats.uniqueWords / plain.unique)).toFixed(1)}%）`);

  // 合并明细：按「被并掉的词次」排序
  const merges = [];
  merged.forms.forEach((formMap, lemma) => {
    if (formMap.size < 2) {
      return;
    }
    let extra = 0;
    const parts = [];
    const sorted = [...formMap.entries()].sort((a, b) => b[1] - a[1]);
    for (const [form, count] of sorted) {
      parts.push(`${form}:${count}`);
      if (form !== lemma) {
        extra += count;
      }
    }
    merges.push({ lemma, parts: parts.join('  '), extra, total: [...formMap.values()].reduce((a, b) => a + b, 0) });
  });
  merges.sort((a, b) => b.extra - a.extra);

  console.log(`\n  ── 合并最多的 45 条 ──`);
  for (const m of merges.slice(0, 45)) {
    console.log(`  ${String(m.total).padStart(6)}  ${m.lemma.padEnd(16)} ${m.parts}`);
  }

  // 可疑原形：原形本身没在文档里出现过，且不是不规则表 / 禁剥表里的
  const irregular = W.lemma.IRREGULAR;
  const suspicious = [];
  merged.forms.forEach((formMap, lemma) => {
    if (vocab.has(lemma) || irregular[lemma]) {
      return;
    }
    const total = [...formMap.values()].reduce((a, b) => a + b, 0);
    suspicious.push({ lemma, total, forms: [...formMap.keys()].join(' ') });
  });
  suspicious.sort((a, b) => b.total - a.total);

  console.log(`\n  ── 可疑原形（原形没在正文里出现过，${suspicious.length} 个）──`);
  for (const s of suspicious.slice(0, 60)) {
    console.log(`  ${String(s.total).padStart(6)}  ${s.lemma.padEnd(16)} ← ${s.forms}`);
  }

  // 机器判定：最可能切错的词元。
  // 筛法是：这个词元没在正文里出现过、不在不规则表里、也不在 -e 动词原形表里，
  // 而它名下的词形全都以 -ed / -ing 结尾。这一类全靠规则推出来，
  // 正确的（publish ← publishing published）和切错的（invok ← invoked）都在里面，
  // 所以把原形表补全就能把这个列表清空——这是最省事的收敛方式。
  const ruleOnly = [];
  merged.forms.forEach((formMap, lemma) => {
    if (vocab.has(lemma) || irregular[lemma] || W.lemma.KNOWN_BASES.has(lemma)) {
      return;
    }
    const forms = [...formMap.keys()];
    if (!forms.length || !forms.every((f) => /(?:ed|ing)$/.test(f))) {
      return;
    }
    const total = [...formMap.values()].reduce((a, b) => a + b, 0);
    ruleOnly.push({ lemma, total, forms: forms.join(' ') });
  });
  ruleOnly.sort((a, b) => b.total - a.total);

  console.log(`\n  ── 纯靠规则推出的词元（${ruleOnly.length} 个，看有没有切错的）──`);
  for (const o of ruleOnly.slice(0, 40)) {
    console.log(`  ${String(o.total).padStart(6)}  ${o.lemma.padEnd(16)} ← ${o.forms}`);
  }
  console.log('');
}
