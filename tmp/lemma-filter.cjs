const fs = require('fs'), vm = require('vm'), path = require('path');
const base = 'addon/chrome/content/scripts/wordfreq';
const ctx = { console, JSON, Math, Set, Map, Array, Object, String, RegExp, Number };
vm.createContext(ctx);
for (const f of ['langdata.js', 'lemma.js', 'defaults.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), ctx, { filename: f });
}
const W = ctx.WordFreq;
const list = W.defaultUserList.slice();
const vocab = new Set(list);
const keep = [], drop = [];
for (const w of list) {
  const lem = String(W.lemma.of(w, vocab, { possessive: true }) || '').toLowerCase();
  if (lem === w.toLowerCase()) keep.push(w); else drop.push(w + '→' + lem);
}
console.log('原', list.length, '保留', keep.length, '去掉', drop.length);
console.log('去掉的：', drop.join(', '));
fs.writeFileSync('tmp/default-lemma-result.json', JSON.stringify({ keep, drop }, null, 0));
