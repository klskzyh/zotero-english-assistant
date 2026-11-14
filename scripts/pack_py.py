"""用 Python 标准库打一个对照用的 .xpi。

存在的意义：手写的 Node 打包器产出的包被 Zotero 判成损坏，
这份用 zipfile 生成，结构和已装好的参考插件一致（Unix 生成标识、带目录条目、DEFLATE）。
两份包内容完全相同，只有打包方式不同，用来区分「是打包问题还是清单问题」。

用法：python scripts/pack_py.py
"""

import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADDON = ROOT / "addon"
DIST = ROOT / "dist"


def collect(root: Path):
    """按 sorted 顺序返回 (相对路径, 绝对路径) 与目录列表。"""
    files = []
    dirs = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if path.is_dir():
            dirs.append(rel)
        else:
            files.append((rel, path))
    return dirs, files


def pack(out_path: Path) -> None:
    dirs, files = collect(ADDON)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel_dir in dirs:
            info = zipfile.ZipInfo(rel_dir + "/")
            info.create_system = 3
            info.external_attr = (0o40755 << 16) | 0x10
            z.writestr(info, b"")
        for rel, full in files:
            info = zipfile.ZipInfo(rel)
            info.create_system = 3
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, full.read_bytes())
    print(f"写入 {out_path}  ({out_path.stat().st_size} 字节, {len(files)} 个文件, {len(dirs)} 个目录条目)")


def main() -> None:
    DIST.mkdir(exist_ok=True)
    pack(DIST / "deepseek-translate-0.1.0-py.xpi")
    shutil.copyfile(
        DIST / "deepseek-translate-0.1.0-py.xpi",
        DIST / "deepseek-translate-0.1.0-py.zip",
    )


if __name__ == "__main__":
    sys.exit(main())
