# -*- coding: utf-8 -*-
"""
把你的手绘原稿做成"能直接进游戏的卡牌图案"，并出几个预览
  ① 统一规格：96×96 透明底（卡牌画框用）
  ② 缩到游戏实际尺寸看效果（手牌里大概 56~70px）
  ③ 做成一张预览页用的对比图（等比放大，便于看细节）
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

GAME = r"C:\Users\a\Documents\deepseek-harness\default-workspace\game"
SRC = os.path.join(GAME, "images", "user", "西瓜_原稿.png")
OUT = os.path.join(GAME, "images", "user", "_out")
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert("RGBA")


def content_box(img, alpha_min=20, pad_ratio=0.07):
    a = np.asarray(img)
    ys, xs = np.nonzero(a[:, :, 3] > alpha_min)
    if len(xs) == 0:
        return (0, 0, img.width, img.height)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    side = int(max(x1 - x0, y1 - y0) * (1 + pad_ratio * 2))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    x0 = int(round(cx - side / 2)); y0 = int(round(cy - side / 2))
    return (x0, y0, x0 + side, y0 + side)


def to_canvas(img, canvas, pad_ratio=0.10):
    c = img.crop(content_box(img))
    inner = canvas * (1 - pad_ratio * 2)
    w, h = c.size
    k = inner / max(w, h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    # 放大时先 LANCZOS 再轻微锐化，边缘更"干净"但不糊
    s = c.resize((nw, nh), Image.LANCZOS)
    if k > 1.05:
        s = s.filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=2))
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(s, ((canvas - nw) // 2, (canvas - nh) // 2))
    return out


# 游戏里用的规格
for size in (96, 64, 48):
    art = to_canvas(im, size)
    p = os.path.join(OUT, "西瓜_%d.png" % size)
    art.save(p)
    print("  %s  %s  %d 字节" % (os.path.basename(p), art.size, os.path.getsize(p)))

# ── 卡牌预览（原图 + 成品）──
INK = (36, 26, 44)
PAPER = (252, 246, 234)
SAND = (228, 203, 166)


def make_card(art96, name, cost, scale=2):
    W, H = 116 * scale, 160 * scale
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=7 * scale, fill=PAPER, outline=INK, width=2 * scale)
    # 画框
    fr = [8 * scale, 8 * scale, W - 8 * scale, 8 * scale + 92 * scale]
    d.rounded_rectangle(fr, radius=4 * scale, fill=(255, 253, 249), outline=(210, 200, 186), width=1 * scale)
    a = art96.resize((int(art96.width * (92 * scale / 96)), int(art96.height * (92 * scale / 96))), Image.LANCZOS)
    card.alpha_composite(a, (fr[0], fr[1]))
    # 名字
    d.rectangle([2 * scale, H - 46 * scale, W - 2 * scale, H - 2 * scale], fill=SAND)
    d.line([2 * scale, H - 46 * scale, W - 2 * scale, H - 46 * scale], fill=INK, width=2 * scale)
    # 费用角标
    d.rounded_rectangle([4 * scale, 4 * scale, 26 * scale, 26 * scale], radius=3 * scale,
                        fill=(58, 110, 168), outline=INK, width=2 * scale)
    return card


art96 = to_canvas(im, 96)
card = make_card(art96, "西瓜", 5, scale=3)
card.save(os.path.join(OUT, "卡牌预览.png"))
print("  卡牌预览: %s" % (card.size,))

# ── 等比放大的对比（都放大到同样高度，方便看细节差异）──
K = 4
small = to_canvas(im, 24).resize((24 * K, 24 * K), Image.LANCZOS)   # 极小尺寸
mid = to_canvas(im, 48).resize((48 * K, 48 * K), Image.LANCZOS)
big = to_canvas(im, 96)                                            # 原尺寸
big2 = big.resize((96 * 2, 96 * 2), Image.LANCZOS)

tiles = []
orig = im.crop(content_box(im))
orig = orig.resize((int(orig.width * (192 / orig.height)), 192), Image.LANCZOS)
tiles.append(("原稿", orig))

# 游戏实际显示尺寸（手牌里）
hand = to_canvas(im, 60)
tiles.append(("手牌实际 60px", hand))

tiles.append(("24px", small))
tiles.append(("48px", mid))
tiles.append(("96px 放大2倍", big2))

GAP = 14
H0 = 200
W0 = sum(max(t.width, 40) for _, t in tiles) + GAP * (len(tiles) - 1)
row = Image.new("RGBA", (W0, H0 + 26), (250, 248, 244, 255))
d = ImageDraw.Draw(row)
x = 0
for name, t in tiles:
    tw = max(t.width, 40)
    row.alpha_composite(t, (x + (tw - t.width) // 2, (H0 - t.height) // 2))
    d.text((x + 3, H0 + 5), name, fill=(110, 100, 120))
    x += tw + GAP
p = os.path.join(OUT, "尺寸对比.png")
row.save(p)
print("  尺寸对比: %s" % (p,))
