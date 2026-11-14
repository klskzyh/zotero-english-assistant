"""生成插件图标（favicon-48.png / favicon-96.png）。

用法：python scripts/make-icons.py
需要 Pillow。

图形与侧栏图标（addon/chrome/content/icons/section-20.svg）一致：Lucide 的 languages，
白色描边压在圆角蓝底上。底色 #4072e5 就是 Zotero 的 accent-blue，和侧栏描边色相同。
坐标按 SVG 的 24 单位 viewBox 写，缩放和平移在下面统一处理。
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "addon" / "chrome" / "content" / "icons"

BASE = 96          # 设计基准尺寸
SS = 4             # 超采样倍数，画完再缩回去，边缘才不会有锯齿
BG = (64, 114, 229, 255)   # #4072e5
FG = (255, 255, 255, 255)
RADIUS = 22        # 圆角半径（按 BASE 计）
SCALE = 3.0        # viewBox 单位 → 像素
OFFSET = 12.0      # 图形在画布里的偏移
STROKE = 2.0       # 与 SVG 的 stroke-width 一致（viewBox 单位）

# Lucide languages 的路径，按折线拆开；改图形时两边一起改
SEGMENTS = [
    [(5, 8), (11, 14)],
    [(4, 14), (10, 8), (12, 5)],
    [(2, 5), (14, 5)],
    [(7, 2), (8, 2)],
    [(22, 22), (17, 12), (12, 22)],
    [(14, 18), (20, 18)],
]


def draw_icon() -> Image.Image:
    big = BASE * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * SS, fill=BG)

    width = STROKE * SCALE * SS
    r = width / 2

    def px(x, y):
        return (OFFSET * SS + x * SCALE * SS, OFFSET * SS + y * SCALE * SS)

    for seg in SEGMENTS:
        pts = [px(x, y) for x, y in seg]
        d.line(pts, fill=FG, width=round(width), joint="curve")
        # Pillow 不管线头，自己补两个圆点当圆头
        for x, y in (pts[0], pts[-1]):
            d.ellipse([x - r, y - r, x + r, y + r], fill=FG)

    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    base = draw_icon()
    for size in (48, 96):
        path = OUT_DIR / f"favicon-{size}.png"
        base.resize((size, size), Image.LANCZOS).save(path)
        print(f"写入 {path}")


if __name__ == "__main__":
    main()
