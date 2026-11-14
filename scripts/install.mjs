/**
 * 把打包好的 .xpi 准备成「可以直接装」的状态，并在文件管理器里选中它。
 *
 * 产物只有一份，固定叫 dist/english-assistant.xpi，每次打包覆盖。
 * 要回到旧版本，用 git 标签重新打包，不保留版本化存档。
 *
 * 为什么不复制进 Zotero 的扩展目录（旧版脚本做的事）：
 * Zotero 默认 extensions.startupScanScopes = 0，放进 <profile>/extensions/ 的 XPI
 * 不会被扫描安装，重启也看不到；它默认 extensions.autoDisableScopes = 15，就算把
 * 扫描打开，旁加载进来的插件也是禁用状态，还得手动启用一次。真正可用的安装入口
 * 只有插件窗口里的「Install Plugin From File…」和把文件拖进插件窗口两条路，
 * 所以这个脚本只负责把文件摆好、把位置打开到眼前。
 *
 * 用法：npm run install
 *       npm run install -- --no-open    只准备文件，不打开文件管理器
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const addonDir = path.join(projectRoot, 'addon');
const distDir = path.join(projectRoot, 'dist');

const noOpen = process.argv.includes('--no-open');

/** 在系统文件管理器里选中该文件。失败不影响主流程，路径照样打印出来。 */
function reveal(target) {
  const dir = path.dirname(target);
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'explorer.exe';
    args = ['/select,' + target];
  }
  else if (process.platform === 'darwin') {
    cmd = 'open';
    args = ['-R', target];
  }
  else {
    cmd = 'xdg-open';
    args = [dir];
  }

  try {
    // detached + stdio ignore：不等它的输出，也不受它的退出码影响
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  }
  catch (e) {
    return false;
  }
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(addonDir, 'manifest.json'), 'utf8'));
  const version = manifest.version;

  // 打包产物只有这一份，固定名字，每次 build 覆盖
  const xpi = path.join(distDir, 'english-assistant.xpi');

  if (!fs.existsSync(xpi)) {
    console.error(`找不到 ${xpi}`);
    console.error('先打包：npm run build（想一条命令走完就用 npm run release）');
    process.exit(1);
  }

  console.log(`版本：${version}`);
  console.log(`安装用文件：${xpi}`);

  if (noOpen) {
    console.log('（--no-open：没有打开文件管理器）');
  }
  else if (reveal(xpi)) {
    console.log('已在文件管理器里选中该文件。');
  }
  else {
    console.log('没能自动打开文件管理器，按上面的路径自己找一下。');
  }

  console.log('');
  console.log('接下来在 Zotero 里：工具 → 插件 → 齿轮 → Install Plugin From File…');
  console.log('选中上面那个 english-assistant.xpi，然后重启 Zotero。');
}

main();
