/**
 * 把 addon/ 目录打包成可安装的 .xpi。
 *
 * 用 Node 内置模块手写 zip，不依赖任何第三方包：
 * 这样打包结果里不会混进目录条目或反斜杠路径，也省掉了装依赖这一步。
 *
 * 用法：npm run build
 */

import { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const addonDir = path.join(projectRoot, 'addon');
const distDir = path.join(projectRoot, 'dist');

// ── CRC32 ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

// ── 收集文件 ────────────────────────────────────────────
function collectFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, rel));
    }
    else if (entry.isFile()) {
      out.push({ rel, full });
    }
  }
  return out;
}

// ── ZIP 写入 ────────────────────────────────────────────
function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const { time, day } = dosDateTime(now);

  for (const file of files) {
    const nameBuf = Buffer.from(file.rel, 'utf8');
    const raw = fs.readFileSync(file.full);
    const deflated = deflateRawSync(raw, { level: 9 });
    // 压缩后反而更大时直接存储
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // 文件名按 UTF-8 解释
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(day, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(day, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// ── 主流程 ──────────────────────────────────────────────
function main() {
  const manifestPath = path.join(addonDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`找不到 ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pluginID = manifest.applications?.zotero?.id;
  if (!pluginID) {
    console.error('manifest.json 里缺少 applications.zotero.id');
    process.exit(1);
  }

  const files = collectFiles(addonDir);
  const zip = buildZip(files);

  fs.mkdirSync(distDir, { recursive: true });
  // 只保留固定名字这一份：每次打包覆盖，目录里始终只有一个安装文件。
  // 要回到旧版本，用 git 的标签重新打包，不再堆版本化存档。
  const outPath = path.join(distDir, 'english-assistant.xpi');
  fs.writeFileSync(outPath, zip);

  console.log(`插件 ID：${pluginID}`);
  console.log(`版本：${manifest.version}`);
  console.log(`打入 ${files.length} 个文件，共 ${(zip.length / 1024).toFixed(1)} KB`);
  console.log(`输出：${outPath}`);

  // 顺手检查界面需要的资源是否齐全，缺了会在运行时才报错
  const required = [
    'manifest.json',
    'bootstrap.js',
    'prefs.js',
    'chrome/content/preferences.xhtml',
      'chrome/content/scripts/main.js',
    'chrome/content/styles/panel.css',
    'locale/en-US/english-assistant.ftl',
    'chrome/content/scripts/translate/main.js',
    'chrome/content/scripts/wordfreq/main.js',
  ];
  const packed = new Set(files.map((f) => f.rel));
  const missing = required.filter((rel) => !packed.has(rel));
  if (missing.length) {
    console.error('缺少必需文件：' + missing.join(', '));
    process.exit(1);
  }
}

main();
