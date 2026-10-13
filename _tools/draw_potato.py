# -*- coding: utf-8 -*-
"""
🥔 土豆 v2 —— 用代码画的像素画
════════════════════════════════════════════════════════════
v1 的问题（我看了渲染结果）：
  ① 轮廓是正圆 → 像鸡蛋不像土豆
  ② 只用到 4 种颜色 → 没有立体感
  ③ 没有芽眼 → 认不出是土豆

v2 的修法：
  ① 轮廓故意做歪：左边鼓、右下收、顶上有个小凹、底部有"腰"
  ② 五档明暗：最亮(7) → 亮(8) → 主体(d) → 暗(9) → 深(e) → 描边(g)
     光源左上 → 左上最亮，右下最深
  ③ 6 个芽眼（深棕 + 更深中心），位置按真实土豆：散布不是均匀
  ④ 顶部一个绿芽
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from pixelart import ascii_to_pixelart, upscale_pixelart, make_card_preview  # noqa

# ══════════════════════════════════════════════════════════════
#  调色板（12 色，棕土系，别太饱和 —— 太鲜会像面包）
# ══════════════════════════════════════════════════════════════
PAL = [
    (0x33, 0x1F, 0x16),   # 0 g 描边（最暗）
    (0x4E, 0x30, 0x21),   # 1 e 深棕（右下暗部）
    (0x66, 0x41, 0x2B),   # 2 3 芽眼
    (0x3D, 0x25, 0x1A),   # 3 5 芽眼中心（比描边略亮，有层次）
    (0x9C, 0x6E, 0x48),   # 4 d 主体
    (0x38, 0x22, 0x18),   # 5 备用最暗
    (0xA8, 0x78, 0x50),   # 6 芽眼色（中棕）
    (0xF2, 0xE4, 0xCB),   # 7 最亮（左上高光）
    (0xC7, 0x9B, 0x6C),   # 8 亮部
    (0x84, 0x5A, 0x3A),   # 9 暗部
    (0x7C, 0xB0, 0x4E),   # 10 绿芽
    (0xA8, 0xD0, 0x78),   # 11 绿芽高光
]

CHAR2IDX = {
    "g": 0,   # 描边
    "e": 1,   # 深棕（右下暗部）
    "3": 2,   # 芽眼
    "5": 3,   # 芽眼中心
    "d": 4,   # 主体
    "6": 6,   # 芽眼色
    "7": 7,   # 最亮
    "8": 8,   # 亮部
    "9": 9,   # 暗部
    "a": 10,  # 绿芽
    "b": 11,  # 绿芽亮
}

# ══════════════════════════════════════════════════════════════
#  网格 28 宽 × 26 高
#    轮廓故意做歪：左边鼓起、右上收窄、顶部一个小凹、底部有腰
#    光源左上 → 7 在最左上，e 在右下
# ══════════════════════════════════════════════════════════════
POTATO = [
    "............................",
    "..............aa............",
    ".............agba...........",
    "...........ggggggg..........",
    "........ggg7778888ggg.......",
    "......gg77777888888dddgg....",
    ".....g77777788888888d9ddg...",
    "....g7777778888888888d99ddg.",
    "...g7777738888888888888d99dg",
    "..g777777788888888888888d9dg",
    ".g7777777788888888888888d9ddg",
    ".g7777777888888888888888d9ddg",
    "g7777777788888858888888d99ddg",
    "g7777777788888888888888d99ddg",
    "g7777777888888888888228d99deg",
    "g777777788888888888888d999deg",
    "g777777788888888888888d999deg",
    ".g7777788888888888888d999deg.",
    ".g777788888888888888d9999eeg.",
    "..g7778888888888888d999eegg..",
    "..gg788888888888888d99eegg...",
    "...gg8888888888888d99eegg....",
    "....ggg8888888888d99egg......",
    "......ggggg8888ggggggg.......",
    "..........ggggggg............",
    "............................",
]

# 手动补芽眼（在主体上点几个 3/5，位置不对就在生成后看出来）
#   土豆的芽眼分布：不是均匀网格，要"斜着散开"
EYES = [
    (7, 12, "3"), (8, 13, "5"),      # 左上芽眼
    (17, 12, "3"),                    # 中上
    (11, 16, "3"), (12, 17, "5"),    # 中间偏左
    (20, 15, "3"),                    # 右中
    (15, 19, "3"), (16, 20, "5"),    # 下部
    (9, 20, "3"),                     # 左下
]


def build():
    rows = [list(r) for r in POTATO]
    w = max(len(r) for r in rows)
    for r in rows:
        while len(r) < w:
            r.append(".")
    for (x, y, ch) in EYES:
        if 0 <= y < len(rows) and 0 <= x < w:
            rows[y][x] = ch
    return ["".join(r) for r in rows]


def main():
    out = r"C:\Users\a\Documents\deepseek-harness\default-workspace\game\images\_pixeltest"
    os.makedirs(out, exist_ok=True)

    rows = build()
    widths = set(len(r) for r in rows)
    print("  网格: %d 行 × %s 宽" % (len(rows), sorted(widths)))

    art = ascii_to_pixelart(rows, PAL, scale=1, charmap=CHAR2IDX)
    print("  尺寸: %s" % (art.size,))

    a = np.asarray(art)
    used = sorted(set(tuple(a[y, x, :3]) for y in range(a.shape[0])
                      for x in range(a.shape[1]) if a[y, x, 3] > 0))
    print("  用到 %d 种颜色" % len(used))
    for c in used:
        print("    #%02X%02X%02X" % c)

    big = upscale_pixelart(art, 10)
    big.save(os.path.join(out, "potato_big.png"))
    art.save(os.path.join(out, "potato.png"))
    print("  原始: %d 字节" % os.path.getsize(os.path.join(out, "potato.png")))

    card = make_card_preview(upscale_pixelart(art, 1), "土豆", 1, PAL, scale=2)
    card.save(os.path.join(out, "potato_card.png"))
    print("  卡牌预览: %dx%d" % card.size)


if __name__ == "__main__":
    main()
