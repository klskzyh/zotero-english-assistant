/**
 * 生成图标预览页：把真实的 SVG 文件按 Zotero 的实际尺寸和位置摆出来，
 * 旁边放 Zotero 自带的同尺寸图标做对照（Zotero 把自带「信息」区块的图标渲染成 #4072e5）。
 *
 * 只用于本地核对，不进插件。
 * 浏览器不认 context-fill（那是 Firefox 的 CSS 上下文填充），Zotero 自带图标预览时替换成 currentColor。
 *
 * 用法：node tmp/preview-icons.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const icons = path.join(root, 'addon', 'chrome', 'content', 'icons');
const zoteroSrc = path.join(__dirname, 'zotero-src');

function inline(file) {
  let svg = fs.readFileSync(file, 'utf8');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '').trim();
  svg = svg.replace(/context-fill/g, 'currentColor');
  // 内联时丢掉 width/height，由 CSS 控制
  svg = svg.replace(/(<svg[^>]*?)\swidth="\d+"\sheight="\d+"/, '$1');
  return svg;
}

const oldIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1.6" y="1.9" width="8.2" height="6" rx="1.6"/><path d="M3.9 4.9h3.6"/><rect x="6.2" y="8.1" width="8.2" height="6" rx="1.6"/><path d="M8.5 11.1h3.6"/></svg>`;

const new20 = inline(path.join(icons, 'section-20.svg'));
const new16 = inline(path.join(icons, 'section-16.svg'));
const nativeInfo = inline(path.join(zoteroSrc, 'info.svg'));
const native16 = inline(path.join(zoteroSrc, 'abstract.svg'));

// [svg, 颜色]；Zotero 自带图标的颜色取自 Zotero 自己的样式表
const railItems = [
  [nativeInfo, '#4072e5'],
  [new20, null],
  [oldIcon, null],
];

const rail = (theme) => `
  <div class="rail ${theme}">
    ${railItems.map(([svg, color]) => `<div class="btn"${color ? ` style="color:${color}"` : ''}>${svg}</div>`).join('')}
  </div>`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>图标核对</title>
<style>
  body { font: 14px/1.6 "Segoe UI", system-ui, sans-serif; margin: 0; padding: 22px 26px; background: #fff; color: #222; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .note { color: #666; margin: 0 0 16px; font-size: 13px; }
  .rail { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; width: 46px; align-items: center; }
  .rail.light { background: #f4f4f5; }
  .rail.dark  { background: #2b2b2d; }
  .btn { width: 28px; height: 28px; padding: 4px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border-radius: 5px; }
  .btn svg { width: 20px; height: 20px; display: block; }
  .row { display: flex; gap: 34px; align-items: flex-start; }
  .cap { font-size: 11px; color: #888; text-align: center; margin: 6px 0 10px; }
  .heads { display: flex; gap: 10px; }
  .heads .cell { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; }
  .heads .cell svg { width: 16px; height: 16px; display: block; }
</style>
</head>
<body>
<h1>图标核对</h1>
<p class="note">侧栏一列从上到下：Zotero 自带的 info（Zotero 渲染成蓝色 #4072e5）、本插件新的蓝色 languages、换掉之前的图形。20px 是右侧边栏尺寸，16px 是区块标题前的尺寸。</p>

<div class="row">
  <div>
    <div class="cap">浅色主题 · 侧栏 28px 按钮</div>
    ${rail('light')}
  </div>
  <div>
    <div class="cap">深色主题 · 侧栏 28px 按钮</div>
    ${rail('dark')}
  </div>
  <div>
    <div class="cap">16px 区块标题图标</div>
    <div class="rail light" style="flex-direction: row; width: auto;">
      <div class="heads">
        <div class="cell" style="color:#4072e5">${native16}</div>
        <div class="cell">${new16}</div>
        <div class="cell" style="color:#6a6a6a">${oldIcon}</div>
      </div>
    </div>
    <div class="cap" style="width: 150px;">Zotero 自带 · 新的 · 旧的</div>
  </div>
</div>
</body>
</html>
`;

const out = path.join(__dirname, 'icon-final.html');
fs.writeFileSync(out, html);
console.log('已生成 ' + out);
