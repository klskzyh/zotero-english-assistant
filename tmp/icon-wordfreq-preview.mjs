/**
 * 生成词频区块图标的候选对照页：三个图形 × 三种颜色，按 Zotero 侧栏的真实尺寸排。
 *
 * 只用于本地挑选，不进插件。
 * 用法：node tmp/icon-wordfreq-preview.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lucide 的路径，viewBox 都是 0 0 24 24
const GLYPHS = [
  {
    key: 'rank',
    name: 'A · 降序条形 + 箭头（frequency ranking）',
    note: '最贴「按词次排出的表」，与翻译的图标区分度最高',
    d: 'm3 16l4 4l4-4m-4 4V4m4 0h10M11 8h7m-7 4h4',
  },
  {
    key: 'list',
    name: 'B · 带序号的列表（list-ordered）',
    note: '直接指向 CSV 里那张 rank 表',
    d: 'M11 5h10m-10 7h10m-10 7h10M4 4h1v5M4 9h2m.5 11H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02',
  },
  {
    key: 'case',
    name: 'C · Aa（case-sensitive）',
    note: '偏「词形」而不是「频次」，和统计的语义离得远一些',
    d: 'm2 16l4.039-9.69a.5.5 0 0 1 .923 0L11 16M3.304 13h6.392',
    extra: '<circle cx="18.5" cy="12.5" r="3.5"/>',
  },
];

const COLORS = [
  { key: 'green', name: 'Zotero 绿 #39bf68', value: '#39bf68' },
  { key: 'orange', name: 'Zotero 橙 #ff794c', value: '#ff794c' },
  { key: 'gray', name: '跟随主题的灰', value: null },
];

function svg(glyph, color) {
  const stroke = color ? `stroke="${color}"` : 'stroke="currentColor"';
  const light = !color ? 'color:#6a6a6a;' : '';
  const dark = !color ? 'color:#b0b0b0;' : '';
  return { light, dark, body: `<path fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="${glyph.d}"/>${glyph.extra || ''}` };
}

const rows = [];
for (const g of GLYPHS) {
  for (const c of COLORS) {
    const s = svg(g, c.value);
    rows.push(`
      <tr>
        <td class="label">${g.name.split(' · ')[0]} · ${c.name}</td>
        <td><div class="rail light"><div class="btn" style="${s.light}"><svg viewBox="0 0 24 24" width="20" height="20">${s.body}</svg></div></div></td>
        <td><div class="rail dark"><div class="btn" style="${s.dark}"><svg viewBox="0 0 24 24" width="20" height="20">${s.body}</svg></div></div></td>
      </tr>`);
  }
}

const translateIcon = `<path fill="none" stroke="#4072e5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m5 8 6 6"/><path fill="none" stroke="#4072e5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m4 14 6-6 2-3"/><path fill="none" stroke="#4072e5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2 5h12"/><path fill="none" stroke="#4072e5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 2h1"/><path fill="none" stroke="#4072e5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m22 22-5-10-5 10"/><path fill="none" stroke="#4072e5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M14 18h6"/>`;

const oldIcon = `<rect x="2" y="2.4" width="10.2" height="7.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.9 6.1h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="7.8" y="10.1" width="10.2" height="7.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.7 13.8h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>词频区块图标候选</title>
<style>
  body { font: 13px/1.6 "Segoe UI", system-ui, sans-serif; margin: 0; padding: 20px 24px; background: #fff; color: #222; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .note { color: #666; margin: 0 0 14px; }
  table { border-collapse: collapse; }
  td { padding: 4px 12px 4px 0; vertical-align: middle; }
  .label { font-size: 12px; color: #444; width: 240px; }
  .rail { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 8px; }
  .rail.light { background: #f4f4f5; }
  .rail.dark { background: #2b2b2d; }
  .btn { width: 28px; height: 28px; padding: 4px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
  .sep td { padding-top: 12px; }
  .typo { font-size: 11px; color: #999; }
</style>
</head>
<body>
<h1>词频区块图标候选</h1>
<p class="note">每格是按 Zotero 侧栏真实尺寸（28×28 按钮、4px 内边距）渲染的。前九行是三个图形配三种颜色，后两行是对照：翻译区块现在那个蓝图标、词频区块现在用的灰方框。</p>
<table>
  ${rows.join('')}
  <tr class="sep"><td class="label">对照 · 翻译区块（已定：蓝 #4072e5）</td>
    <td><div class="rail light"><div class="btn"><svg viewBox="0 0 24 24" width="20" height="20">${translateIcon}</svg></div></div></td>
    <td><div class="rail dark"><div class="btn"><svg viewBox="0 0 24 24" width="20" height="20">${translateIcon}</svg></div></div></td></tr>
  <tr><td class="label">对照 · 词频区块现状（灰方框）</td>
    <td><div class="rail light"><div class="btn" style="color:#6a6a6a"><svg viewBox="0 0 24 24" width="20" height="20">${oldIcon}</svg></div></div></td>
    <td><div class="rail dark"><div class="btn" style="color:#b0b0b0"><svg viewBox="0 0 24 24" width="20" height="20">${oldIcon}</svg></div></div></td></tr>
</table>
<p class="typo">左边一列是图形说明，中间浅色主题，右边深色主题。</p>
</body>
</html>
`;

const out = path.join(__dirname, 'icon-wordfreq.html');
fs.writeFileSync(out, html);
console.log('已生成 ' + out);
