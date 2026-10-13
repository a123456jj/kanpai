# -*- coding: utf-8 -*-
"""
🎨 卡牌图案绘制系统
════════════════════════════════════════════════════════════
风格定位（对齐用户手绘稿）：
  · 平涂色块（不用渐变）
  · 深色描边（统一宽度）
  · 简洁几何形状，一眼认出
  · 3~5 个颜色
  但在用户手绘的基础上补齐：
  · 线条画准（用超采样 + 抗锯齿，边缘平滑不毛）
  · 比例调好（主体占画布 65~75%）
  · 加一点明暗（只用"亮一档 + 暗一档"，不做渐变）
  · 每个形状有轻微不规则（避免"数学味"）

技术：内部用 4 倍超采样绘制 → LANCZOS 缩小 → 边缘自然平滑
      描边用"先画放大的深色轮廓，再盖上本体"实现，不用滤镜
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ══════════════════════════════════════════════════════════════
#  调色板 —— 基于用户手绘稿的真色，扩到"每个色相 3 档（暗/中/亮）"
#    这样既有统一体系，又够画明暗
# ══════════════════════════════════════════════════════════════
C = {
    "ink":      (36, 26, 44),

    # 红（瓤 / 攻击 / 危险）
    "red_d":    (176, 32, 40),
    "red":      (237, 28, 36),      # 用户原稿的红
    "red_l":    (255, 92, 92),

    # 绿（皮 / 治愈 / 自然）
    "green_d":  (26, 122, 58),
    "green":    (34, 177, 76),      # 用户原稿的绿
    "green_l":  (108, 214, 132),

    # 深绿（西瓜皮外圈）
    "rind_d":   (18, 104, 52),
    "rind":     (46, 148, 74),

    # 黄（光 / 火花 / 能量）
    "yel_d":    (204, 150, 20),
    "yel":      (247, 209, 84),
    "yel_l":    (255, 240, 178),

    # 蓝（水 / 冰 / 防具）
    "blu_d":    (32, 74, 128),
    "blu":      (58, 110, 168),
    "blu_l":    (128, 180, 226),

    # 棕（土 / 木）
    "brn_d":    (74, 48, 30),
    "brn":      (150, 104, 66),
    "brn_l":    (196, 152, 106),

    # 紫（毒 / 诅咒）
    "pur_d":    (78, 42, 118),
    "pur":      (138, 84, 190),
    "pur_l":    (188, 148, 232),

    # 米白 / 金属
    "paper":    (250, 246, 236),
    "white":    (255, 255, 255),
    "gray":     (150, 150, 158),
    "gray_d":   (92, 92, 100),
    "black":    (30, 26, 34),
}

S = 4                 # 超采样倍数
CANVAS = 96           # 输出画布
INK_W = 5             # 描边宽度（内部坐标，会被 4 除）


def new_layer(px=CANVAS * S):
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def rot(pts, cx, cy, deg):
    """把点集绕 (cx,cy) 旋转 deg 度"""
    r = math.radians(deg)
    co, si = math.cos(r), math.sin(r)
    out = []
    for (x, y) in pts:
        dx, dy = x - cx, y - cy
        out.append((cx + dx * co - dy * si, cy + dx * si + dy * co))
    return out


def poly(d, pts, fill, outline=None, width=0, rot_deg=0, cx=0, cy=0):
    if rot_deg:
        pts = rot(pts, cx, cy, rot_deg)
    d.polygon(pts, fill=fill, outline=outline, width=width)
    return pts


def ellipse(d, box, fill, outline=None, width=0, rot_deg=0, cx=0, cy=0):
    if not rot_deg:
        d.ellipse(box, fill=fill, outline=outline, width=width)
        return
    # 旋转椭圆：用多边形近似
    x0, y0, x1, y1 = box
    ccx, ccy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    pts = [(ccx + math.cos(a) * rx, ccy + math.sin(a) * ry)
           for a in [i * math.pi / 24 for i in range(48)]]
    pts = rot(pts, cx or ccx, cy or ccy, rot_deg)
    d.polygon(pts, fill=fill, outline=outline, width=width)


def outline_pass(img, w=INK_W, color=None):
    """
    描边：把"不透明区域"外扩 w 像素，填深色，再盖回原图。
    （不用 MaxFilter —— 那个会把颜色也扩出去，边缘会脏）
    """
    a = img.split()[3]
    grown = a.filter(ImageFilter.MaxFilter(w * 2 + 1))
    ring = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ring.putalpha(grown)
    c = color or C["ink"]
    ring = Image.new("RGBA", img.size, c + (0,))
    ring.putalpha(grown)
    out = Image.alpha_composite(ring, img)
    return out


def finish(img, canvas=CANVAS, pad=0.09, tighten=True, sharpen=True):
    """缩小 + 裁到内容(正方形) + 居中到画布"""
    small = img.resize((canvas * 3, canvas * 3), Image.LANCZOS)
    if sharpen:
        small = small.filter(ImageFilter.UnsharpMask(radius=2.2, percent=48, threshold=2))
    if tighten:
        a = np.asarray(small)
        ys, xs = np.nonzero(a[:, :, 3] > 16)
        if len(xs):
            x0, x1 = int(xs.min()), int(xs.max()) + 1
            y0, y1 = int(ys.min()), int(ys.max()) + 1
            side = int(max(x1 - x0, y1 - y0) * (1 + pad * 2))
            ccx, ccy = (x0 + x1) / 2, (y0 + y1) / 2
            x0 = int(ccx - side / 2); y0 = int(ccy - side / 2)
            small = small.crop((x0, y0, x0 + side, y0 + side))
    small = small.resize((canvas, canvas), Image.LANCZOS)
    return small
