/**
 * 静态自查：语法、界面文案、必需文件。
 *
 * Zotero 插件的报错都藏在「帮助 → 调试输出」里，改动之后跑一遍这个脚本，
 * 能挡掉大部分「装上去什么都不显示」的低级问题。
 *
 * 用法：npm run check
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const addonDir = path.join(projectRoot, 'addon');

const problems = [];
const notes = [];

function collect(dir, ext, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collect(full, ext, rel));
    }
    else if (entry.isFile() && entry.name.endsWith(ext)) {
      out.push({ rel, full });
    }
  }
  return out;
}

// ── 1. JavaScript 语法 ──────────────────────────────────
const scriptFiles = collect(path.join(addonDir, 'chrome', 'content', 'scripts'), '.js');
for (const file of scriptFiles) {
  const source = fs.readFileSync(file.full, 'utf8');
  try {
    // 插件脚本按传统脚本加载，不是模块，所以用 Script 而不是 SourceTextModule
    new vm.Script(source, { filename: file.rel });
  }
  catch (e) {
    problems.push(`${file.rel} 语法错误：${e.message}`);
  }
}

// ── 2. 界面文案：脚本里引用的 l10n id 必须在 ftl 里有定义 ──
const ftlIds = new Set();
for (const ftl of collect(path.join(addonDir, 'locale'), '.ftl')) {
  const text = fs.readFileSync(ftl.full, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*=/);
    if (m) {
      ftlIds.add(m[1]);
    }
  }
}
notes.push(`界面文案条目：${ftlIds.size} 条`);

const usedIds = new Set();
for (const file of scriptFiles) {
  const text = fs.readFileSync(file.full, 'utf8');
  for (const m of text.matchAll(/l10nID:\s*'([^']+)'/g)) {
    usedIds.add(m[1]);
  }
}
for (const id of usedIds) {
  if (!ftlIds.has(id)) {
    problems.push(`脚本引用的界面文案 "${id}" 在所有 .ftl 里都没有定义，面板标题会显示为空`);
  }
}

// ── 3. 必需文件 ────────────────────────────────────────
const required = [
  'manifest.json',
  'bootstrap.js',
  'prefs.js',
  'chrome/content/preferences.xhtml',
  'chrome/content/scripts/main.js',
  'chrome/content/scripts/translate/main.js',
  'chrome/content/scripts/wordfreq/main.js',
  'chrome/content/styles/panel.css',
];
for (const rel of required) {
  if (!fs.existsSync(path.join(addonDir, rel))) {
    problems.push(`缺少必需文件 ${rel}`);
  }
}

// ── 4. bootstrap 加载顺序与实际文件对得上 ────────────────
const bootstrap = fs.readFileSync(path.join(addonDir, 'bootstrap.js'), 'utf8');
const listMatch = bootstrap.match(/var SCRIPTS = \[([\s\S]*?)\];/);
if (!listMatch) {
  problems.push('bootstrap.js 里找不到 SCRIPTS 列表');
}
else {
  const listed = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const name of listed) {
    if (!fs.existsSync(path.join(addonDir, 'chrome', 'content', 'scripts', name))) {
      problems.push(`bootstrap.js 要加载 ${name}，但文件不存在`);
    }
  }
  // 脚本现在分在 translate/ 与 wordfreq/ 两个子目录下，所以按相对路径比，
  // 不能按文件名比——两个子系统各有一个 main.js
  const onDisk = scriptFiles.map((f) => f.rel);
  for (const name of onDisk) {
    if (!listed.includes(name)) {
      problems.push(`scripts/${name} 没有被 bootstrap.js 加载`);
    }
  }
  notes.push(`脚本加载顺序：${listed.join(' → ')}`);
}

// ── 5. 首选项：界面绑定的键必须在 prefs.js 里有默认值 ────
const prefsJs = fs.readFileSync(path.join(addonDir, 'prefs.js'), 'utf8');
const declaredPrefs = new Set(
  [...prefsJs.matchAll(/pref\(\s*"([^"]+)"/g)].map((m) => m[1])
);
// 绑定分散在多个面板片段里（翻译一个、词频一个），每个都要扫
const contentDir = path.join(addonDir, 'chrome', 'content');
const xhtmlNames = fs.readdirSync(contentDir).filter((name) => name.endsWith('.xhtml'));
const boundPrefs = [];
for (const name of xhtmlNames) {
  const text = fs.readFileSync(path.join(contentDir, name), 'utf8');
  for (const m of text.matchAll(/preference="([^"]+)"/g)) {
    boundPrefs.push(m[1]);
  }
}
const prefsXhtml = xhtmlNames
  .map((name) => fs.readFileSync(path.join(contentDir, name), 'utf8'))
  .join('\n');
for (const key of boundPrefs) {
  if (!declaredPrefs.has(key)) {
    problems.push(`首选项面板绑定了 ${key}，但 prefs.js 里没有它的默认值，这一项会显示为空`);
  }
}
notes.push(`首选项绑定：${boundPrefs.length} 项`);

// 输入控件必须用 html:input。XUL 的 textbox 在 Zotero 7 之后已移除，
// 写了不会渲染，界面上只会剩下标签。
// 只禁已确认移除的控件：menulist / checkbox / radiogroup 在 Zotero 10 仍可用，
// Zotero 自己的首选项面板就在用它们。
for (const banned of ['textbox']) {
  const re = new RegExp(`<${banned}[\\s/>]`, 'i');
  if (re.test(prefsXhtml)) {
    problems.push(`preferences.xhtml 里用了 <${banned}>，这个控件在新版 Zotero 里不会被渲染，换成 <html:input>`);
  }
}

// ── 5b. 片段必须是良构 XML，Zotero 用严格 XML 解析器读它 ──
function checkXmlBalance(source, label) {
  const stripped = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const tags = stripped.match(/<[^>]+>/g) || [];
  const stack = [];
  for (const tag of tags) {
    if (/^<\//.test(tag)) {
      const name = tag.slice(2, -1).trim();
      const open = stack.pop();
      if (open !== name) {
        problems.push(`${label} 标签不匹配：</${name}> 对应的是 <${open || '空'}>`);
        return;
      }
    }
    else if (/\/>$/.test(tag)) {
      // 自闭合，不需要配对
    }
    else {
      const name = tag.slice(1).split(/[\s/>]/)[0];
      // 未声明前缀的 html: 由 Zotero 注入，这里只比对名字
      stack.push(name);
    }
  }
  if (stack.length) {
    problems.push(`${label} 有未闭合的标签：${stack.join(', ')}`);
  }
}
/* XML 注释里不能出现连续两个减号，也不能以减号结尾。
 * 写错整份文件就不是良构 XML，Zotero 直接不渲染，界面上一点提示都没有：
 * SVG 图标变成一片空白，首选项片段整个不显示。CSS 变量名正好以连续两个减号开头，
 * 所以在注释里提变量名时要把减号拆开写。 */
function checkXmlComments(source, label) {
  for (const m of source.matchAll(/<!--([\s\S]*?)-->/g)) {
    const body = m[1];
    if (body.includes('--') || body.endsWith('-')) {
      problems.push(`${label} 的注释里有连续两个减号或以减号结尾，XML 不允许，整份文件会渲染不出来`);
      return;
    }
  }
}

/* 属性值里的 & 和 < 必须写成实体，漏了同样会让整份文件解析失败。 */
function checkXmlAttributes(source, label) {
  for (const m of source.matchAll(/<[^>]+>/g)) {
    for (const a of m[0].matchAll(/="([^"]*)"/g)) {
      const value = a[1];
      if (/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/.test(value)) {
        problems.push(`${label} 的属性值里有没转义的 &，要写成 &amp;`);
        return;
      }
      if (value.includes('<')) {
        problems.push(`${label} 的属性值里有没转义的 <，要写成 &lt;`);
        return;
      }
    }
  }
}

function checkMarkup(source, label) {
  checkXmlComments(source, label);
  checkXmlBalance(source, label);
  checkXmlAttributes(source, label);
}

checkMarkup(prefsXhtml, 'preferences.xhtml');

for (const file of fs.readdirSync(path.join(addonDir, 'chrome', 'content'))) {
  if (file.endsWith('.xhtml')) {
    checkMarkup(
      fs.readFileSync(path.join(addonDir, 'chrome', 'content', file), 'utf8'),
      file
    );
  }
}

// SVG 图标走同一套严格 XML 解析，写坏的表现是图标空白
const svgFiles = collect(addonDir, '.svg');
for (const file of svgFiles) {
  checkMarkup(fs.readFileSync(file.full, 'utf8'), file.rel);
}
notes.push(`SVG 图标：${svgFiles.length} 个，已做 XML 良构检查`);

// bootstrap 会按序加载的脚本，必须在同一份 prefs.js 命名空间下有对应默认值
// 所有绑定键至少要共用一段前缀（截到最后一个点），免得和别的插件撞车。
// 现在是两个子系统各占一段：extensions.englishAssistant.translate.* 与 .wordfreq.*，
// 所以取的是所有键的最长公共前缀，而不是第一个键的父路径。
function commonPrefix(keys) {
  if (!keys.length) {
    return '';
  }
  let prefix = keys[0];
  for (const key of keys) {
    let i = 0;
    while (i < prefix.length && i < key.length && prefix[i] === key[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
  }
  const cut = prefix.lastIndexOf('.');
  return cut >= 0 ? prefix.slice(0, cut + 1) : '';
}

const branch = commonPrefix(boundPrefs);
for (const key of boundPrefs) {
  if (branch && !key.startsWith(branch)) {
    problems.push(`${key} 不在统一的前缀 ${branch} 下，容易与别的插件冲突`);
  }
}

// ── 6b. 代码里写死的 chrome/content 资源引用都存在 ────────
// 这类引用有两种写法：chrome://<短名>/content/... 和 chrome/content/...（配合 rootURI）。
// 改名或搬文件之后最容易漏的就是它们，表现是首选项面板一片空白、图标不见，
// 界面上一句报错都没有。
const assetFiles = [
  ...scriptFiles,
  ...fs.readdirSync(path.join(addonDir, 'chrome', 'content'))
    .filter((name) => name.endsWith('.xhtml'))
    .map((name) => ({ rel: name, full: path.join(addonDir, 'chrome', 'content', name) })),
];
const assetRefs = new Set();
for (const file of assetFiles) {
  const text = fs.readFileSync(file.full, 'utf8');
  // 只认我们自己的资源写在前面的那个短名：chrome://zotero/content/... 是 Zotero
  // 自己的模块，不该在这里按「我们的文件」去核对
  const re = /(?:chrome:\/\/english-assistant\/content\/|chrome\/content\/)([A-Za-z0-9_./-]+)/g;
  for (const m of text.matchAll(re)) {
    assetRefs.add(m[1]);
  }
}
for (const rel of assetRefs) {
  if (!fs.existsSync(path.join(addonDir, 'chrome', 'content', rel))) {
    problems.push(`代码里引用了 chrome/content/${rel}，但文件不存在（改名或搬动后没同步）`);
  }
}
notes.push(`chrome/content 资源引用：${assetRefs.size} 处，已逐个核对存在`);

// ── 7. manifest ────────────────────────────────────────
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(addonDir, 'manifest.json'), 'utf8'));
  const zotero = manifest.applications?.zotero;
  if (!zotero?.id) {
    problems.push('manifest.json 缺少 applications.zotero.id');
  }
  // Zotero 10 的 ExtensionData.parseManifest() 对 type == "extension" 的清单
  // 硬性要求这三个字段，缺任何一个都会让安装报 ERROR_CORRUPT_FILE
  for (const field of ['id', 'update_url', 'strict_max_version']) {
    if (!zotero?.[field]) {
      problems.push(`manifest.json 缺少 applications.zotero.${field}，Zotero 会拒绝安装`);
    }
  }
  // browser_specific_settings 只认 .gecko 子键，写 .zotero 不会被映射过去
  if (manifest.browser_specific_settings && !manifest.browser_specific_settings.gecko) {
    problems.push('browser_specific_settings 只认 gecko 子键，Zotero 的插件信息必须写在 applications.zotero 里');
  }
  if (manifest.manifest_version !== 2) {
    problems.push(`manifest_version 应为 2，当前是 ${manifest.manifest_version}`);
  }
  const icons = manifest.icons || {};
  for (const [size, rel] of Object.entries(icons)) {
    if (!fs.existsSync(path.join(addonDir, rel))) {
      problems.push(`manifest.json 里 ${size} 的图标 ${rel} 不存在`);
    }
  }
}
catch (e) {
  problems.push('manifest.json 无法解析：' + e.message);
}

// ── 输出 ───────────────────────────────────────────────
for (const note of notes) {
  console.log('· ' + note);
}
if (problems.length) {
  console.error('\n发现 ' + problems.length + ' 个问题：');
  for (const p of problems) {
    console.error('  ✗ ' + p);
  }
  process.exit(1);
}
console.log('\n检查通过。');
