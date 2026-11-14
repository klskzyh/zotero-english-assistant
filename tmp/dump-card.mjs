// 临时脚本：把结果卡片渲染成静态 HTML，直接在浏览器里看排版，不用装插件。
// 用法：node tmp/dump-card.mjs  然后打开 tmp/panel-preview.html
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const addonScripts = path.join(root, 'addon', 'chrome', 'content', 'scripts', 'translate');

// ── 假 DOM ───────────────────────────────────────────────
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
  replaceChildren() { this.children = []; }
}

function serialize(el) {
  const cls = el.attrs.class ? ` class="${el.attrs.class}"` : '';
  if (!el.children.length) {
    const text = escape(el._text);
    return text ? `<${el.tagName}${cls}>${text}</${el.tagName}>` : `<${el.tagName}${cls}></${el.tagName}>`;
  }
  return `<${el.tagName}${cls}>${el.children.map(serialize).join('')}</${el.tagName}>`;
}

function escape(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// ── 加载插件脚本 ─────────────────────────────────────────
const sandbox = {
  console,
  Zotero: {
    debug: () => {},
    logError: (e) => console.error(e),
    Prefs: { get: () => undefined, set: () => {} },
    Utilities: { randomString: (n) => 'x'.repeat(n), Internal: {} },
    ItemTypes: { getLocalizedName: () => '' },
  },
  Promise, Map, Set, Date, JSON, Math, RegExp, Error,
  parseInt, parseFloat, isNaN, String, Number, Array, Object,
};
vm.createContext(sandbox);
for (const f of ['config.js', 'context.js', 'prompts.js', 'render.js']) {
  vm.runInContext(fs.readFileSync(path.join(addonScripts, f), 'utf8'), sandbox, { filename: f });
}
const D = sandbox.DeepSeekTranslate;
const doc = { createElementNS: (ns, tag) => new El(tag), createElement: (tag) => new El(tag) };

// ── 三个样本 ─────────────────────────────────────────────
const at = new Date(2026, 9, 16, 20, 30, 0);
const cases = [
  {
    label: '单词，选中内容与词条相同（不重复显示原文）',
    entry: {
      id: 'a', at, text: 'knob', pageLabel: '第 3 页',
      count: { count: 47, from: '词频表' },
      model: 'deepseek-chat', usage: { total_tokens: 1580 },
      contextNote: '已定位原文上下文',
      contextText: 'The panel is covered with ⟦knob⟧, switches, and buttons.',
      data: {
        type: 'word',
        headword: 'knob',
        pronunciation: '/nɒb/',
        form: {
          surface: 'knob',
          lemma: 'knob',
          features: '单数',
          relation: '与词元相同',
          correction: '',
        },
        senses: [
          { pos: 'n.', meaning: '旋钮；圆形把手', register: '通用；电子乐器/设备' },
          { pos: 'n.', meaning: '（门、抽屉的）球形把手', register: '通用' },
        ],
        inContext: {
          gloss: 'n. 旋钮',
          note: '文中指合成器面板上那些用来连续调节音量、频率、包络的旋转控件',
          sentence: 'The panel is covered with knobs, sliders, switches, and buttons.',
          sentenceTranslation: '面板上布满了旋钮、推子、开关和按钮。',
          targetTerm: '旋钮',
        },
        examples: [
          {
            source: 'Turning the cutoff knob sweeps the filter\'s corner frequency in real time.',
            translation: '转动截止频率旋钮，可以实时扫过滤波器的转折频率。',
          },
          {
            source: 'She turned the knob on the oven to 200 degrees.',
            translation: '她把烤箱的旋钮拧到 200 度。',
          },
        ],
        explanation: '在电子乐器语境中，knob 专指面板上的旋转式电位器控件。常见搭配：turn a knob、knob twiddling。',
        etymology: '中古英语 knobbe，原指「圆块、瘤状突起」，与中古低地德语 knobbe 同源。',
      },
    },
  },
  {
    label: '单词，选中是屈折形式（保留原文行）',
    entry: {
      id: 'b', at, text: 'sliders', pageLabel: '第 3 页',
      count: { count: 8, from: '全文统计' },
      model: 'deepseek-chat', usage: { total_tokens: 1420 },
      contextNote: '已定位原文上下文',
      data: {
        type: 'word',
        headword: 'slider',
        pronunciation: '/ˈslaɪdə(r)/',
        form: {
          surface: 'sliders',
          lemma: 'slider',
          features: '复数',
          relation: '屈折：slider 加复数词尾 -s',
          correction: '',
        },
        senses: [{ pos: 'n.', meaning: '推子；滑动控制器', register: '电子乐器' }],
        inContext: {
          gloss: 'n. 推子',
          note: '文中指调音台上用于线性调节通道音量的那排推子',
          sentence: 'The panel is covered with knobs, sliders, switches, and buttons.',
          sentenceTranslation: '面板上布满了旋钮、推子、开关和按钮。',
          targetTerm: '推子',
        },
        examples: [
          { source: 'Push the sliders up to raise the channel level.', translation: '把推子推上去以提高通道电平。' },
          { source: 'Drag the slider to set the font size.', translation: '拖动滑块设置字号。' },
        ],
        explanation: '与 knob 的区别在于运动方式：slider 线性滑动，knob 旋转。',
        etymology: '源自动词 slide。',
      },
    },
  },
  {
    label: '句子，只给译文',
    entry: {
      id: 'c', at, text: 'The panel is covered with sliders, switches, and buttons.', pageLabel: '第 3 页',
      model: 'deepseek-chat', usage: { total_tokens: 980 },
      contextNote: '已定位原文上下文',
      data: {
        type: 'sentence',
        translation: '面板上布满了推子、开关和按钮。',
      },
    },
  },
  {
    label: '母语幼儿模式：词条 + 两到三段简单英文',
    entry: {
      id: 'd', at, text: 'observance', pageLabel: '第 21 页',
      count: { count: 12, from: '词频表' },
      model: 'deepseek-chat', usage: { total_tokens: 640 },
      contextNote: '已定位原文上下文',
      data: {
        type: 'word',
        headword: 'observance',
        pronunciation: '/əbˈzɜːvəns/',
        kidParagraphs: [
          'An observance is **a custom** people follow. It is like a special way to do something ✅',
          'In this sentence, people sing and read in a big old building. They do this again and again. That is their ==observance== 🌰',
          'You can say: the school has a small observance every Monday morning 😊',
        ],
      },
    },
  },
];

// 可选：node tmp/dump-card.mjs 3 只渲第 4 张卡（按数组下标）
const only = process.argv[2];
const picked = (only === undefined || only === '')
  ? cases
  : cases.filter((c, i) => String(i) === String(only));

const cards = picked.map((c) => {
  const html = D.render.entryCard(doc, c.entry, { onCopy: () => {}, onDelete: () => {} });
  return `<section><h2>${escape(c.label)}</h2><div class="ds-entry">${serialize(html).replace(/^<div class="ds-entry">|<\/div>$/g, '')}</div></section>`;
});

const cssHref = path.relative(here, path.join(root, 'addon', 'chrome', 'content', 'styles', 'panel.css')).replace(/\\/g, '/');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DeepSeek Translate 面板预览</title>
<link rel="stylesheet" href="${cssHref}">
<style>
  :root {
    --fill-secondary: #6b6b6b;
    --fill-quinary: rgba(0, 0, 0, 0.04);
    --color-border: rgba(0, 0, 0, 0.15);
    --color-accent: #2b7cd3;
    --color-red: #cc3333;
    --material-background: #fff;
  }
  body {
    margin: 0;
    padding: 20px;
    background: #f4f4f4;
    font: 13px/1.6 system-ui, "Segoe UI", sans-serif;
    color: #1a1a1a;
  }
  .wrap { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  section { width: 320px; }
  h2 { font-size: 12px; color: #666; font-weight: 500; margin: 0 0 8px; }
  .ds-entry { background: #fff; }
</style>
</head>
<body>
<div class="wrap">
${cards.join('\n')}
</div>
</body>
</html>
`;

const out = path.join(here, 'panel-preview.html');
fs.writeFileSync(out, html);
console.log('写入 ' + out);
console.log('用浏览器打开即可查看排版。宽度设成 320px，接近 Zotero 条目面板的实际宽度。');
