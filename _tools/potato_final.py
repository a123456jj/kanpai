# -*- coding: utf-8 -*-
"""
🥔 土豆 —— 最终产物
  ① 卡牌成品预览（像素画放大到合适大小）
  ② "土豆地雷"变体（加引线 + 火花）—— 游戏里那张牌用
  ③ 游戏内实际尺寸对比（16/24/32/48 px 各来一个，看哪个清楚）
"""
import os
import sys
import importlib.util

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw
from pixelart import upscale_pixelart  # noqa

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = r"C:\Users\a\Documents\deepseek-harness\default-workspace\game\images\_pixeltest"

# 载入 v3 的绘制逻辑
spec = importlib.util.spec_from_file_location("dp3", os.path.join(HERE, "draw_potato3.py"))
dp3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dp3)

PAL = dp3.PAL
art = dp3.build()
W, H = art.size
print("  土豆: %dx%d" % (W, H))


# ══════════════════════════════════════════════════════════════
#  ① 卡牌成品（像素画放大 4 倍，占满画框）
# ══════════════════════════════════════════════════════════════
def make_card(pixel_art, name, cost, pal, scale=2, wire=False):
    CW, CH = 210 * scale, 290 * scale
    card = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    ink = pal[0]
    paper = (0xFC, 0xF6, 0xEA)
    band = (0xC9, 0x9B, 0x6C)

    r = 16 * scale
    d.rounded_rectangle([0, 0, CW - 1, CH - 1], radius=r, fill=paper, outline=ink, width=3 * scale)
    # 顶部色带
    d.rounded_rectangle([0, 0, CW - 1, 50 * scale], radius=r, fill=band, outline=ink, width=3 * scale)
    d.rectangle([0, 34 * scale, CW - 1, 50 * scale], fill=band)
    # 费用圆
    cxx, cyy, rr = 30 * scale, 30 * scale, 20 * scale
    d.ellipse([cxx - rr, cyy - rr, cxx + rr, cyy + rr], fill=paper, outline=ink, width=3 * scale)

    # 画框
    fr = [20 * scale, 62 * scale, CW - 20 * scale, CH - 78 * scale]
    d.rounded_rectangle(fr, radius=9 * scale, fill=(0xFF, 0xFD, 0xF8), outline=ink, width=3 * scale)

    # 像素画：放大到填满画框
    fw, fh = fr[2] - fr[0] - 18 * scale, fr[3] - fr[1] - 18 * scale
    k = max(1, min(fw // pixel_art.width, fh // pixel_art.height))
    big = upscale_pixelart(pixel_art, k)
    card.alpha_composite(big, (fr[0] + (fr[2] - fr[0] - big.width) // 2,
                               fr[1] + (fr[3] - fr[1] - big.height) // 2))
    return card


c1 = make_card(art, "土豆", 1, PAL, scale=2)
c1.save(os.path.join(OUT, "card_potato.png"))
print("  卡牌成品: %dx%d" % c1.size)

# ══════════════════════════════════════════════════════════════
#  ② 土豆地雷变体（加引线 + 火花）
# ══════════════════════════════════════════════════════════════
arr = np.array(art)
H2, W2 = arr.shape[0], arr.shape[1]
pad = 8
big = np.zeros((H2 + pad, W2 + 2 * pad, 4), dtype=np.uint8)
big[pad:pad + H2, pad:pad + W2] = arr
mine = Image.fromarray(big, "RGBA")
d = ImageDraw.Draw(mine)
ink = PAL[0]
spark = (0xF7, 0xD1, 0x54)
spark_hi = (0xFF, 0xF3, 0xC4)
metal = (0x8A, 0x8A, 0x92)
metal_d = (0x55, 0x55, 0x5E)

# 引线：从土豆顶部往上两格，然后向右弯
top_x = pad + W2 // 2
top_y = pad - 1
for i in range(1, 4):
    d.point((top_x, top_y - i), fill=metal_d)
d.point((top_x + 1, top_y - 4), fill=metal)
d.point((top_x + 2, top_y - 5), fill=metal)
d.point((top_x + 3, top_y - 5), fill=metal_d)
# 火花（四角星）
sx, sy = top_x + 4, top_y - 6
d.point((sx, sy), fill=spark_hi)
for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
    d.point((sx + dx, sy + dy), fill=spark)
for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
    d.point((sx + dx, sy + dy), fill=spark)
mine.save(os.path.join(OUT, "potato_mine.png"))
upscale_pixelart(mine, 9).save(os.path.join(OUT, "potato_mine_big.png"))
print("  土豆地雷: %s" % (mine.size,))

c2 = make_card(mine, "土豆地雷", 1, PAL, scale=2, wire=True)
c2.save(os.path.join(OUT, "card_mine.png"))
print("  地雷卡牌: %dx%d" % c2.size)

# ══════════════════════════════════════════════════════════════
#  ③ 游戏内实际尺寸对比（横向铺开，用 NEAREST 放大 6 倍展示）
# ══════════════════════════════════════════════════════════════
K = 6
sizes = [16, 20, 24, 32, 40]
tiles = []
for s in sizes:
    t = art.resize((s, s), Image.NEAREST)
    tiles.append(upscale_pixelart(t, K))
gap = 12
tw = sum(t.width for t in tiles) + gap * (len(tiles) - 1)
th = max(t.height for t in tiles)
row = Image.new("RGBA", (tw, th), (0xF7, 0xF5, 0xFB, 255))
x = 0
for t in tiles:
    row.alpha_composite(t, (x, (th - t.height) // 2))
    x += t.width + gap
row.save(os.path.join(OUT, "potato_sizes.png"))
print("  尺寸对比: %dx%d（原尺寸 %s）" % (row.width, row.height, sizes))
print("  完成")
