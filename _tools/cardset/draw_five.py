# -*- coding: utf-8 -*-
"""
🎨 画 5 张卡牌图案
  西瓜 · 土豆地雷 · 一拳 · 飞轮 · 毒鸡汤
  （五个类别各一张：回复 / 控制 / 攻击 / 防御 / 状态）
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from artkit import C, S, CANVAS, INK_W, new_layer, poly, ellipse, outline_pass, finish, rot

GAME = r"C:\Users\a\Documents\deepseek-harness\default-workspace\game"
OUT = os.path.join(GAME, "images", "cards")
os.makedirs(OUT, exist_ok=True)
P = CANVAS * S


# ══════════════════════════════════════════════════════════════
#  ① 西瓜（回复）—— 半月形，平边朝上（跟用户原稿一致）
# ══════════════════════════════════════════════════════════════
def draw_watermelon():
    """
    严格照用户原稿：
      平边在上、弧朝下（pieslice 0→180 —— 已实测确认这是"凸起在下"）
      红瓤在【上】（贴平边那侧），绿皮在【下】（弧形那侧），黑籽在红瓤里
    实现方式：先整块画绿（外皮），再把红瓤"往下挪一点 + 缩小一点"盖上去，
             这样红瓤上缘贴着平边、下缘露出绿皮 → 和你原稿一样
    """
    img, d = new_layer()
    cx, cy, R = P * 0.50, P * 0.44, P * 0.40

    # 外皮（最底下一层）
    d.pieslice([cx - R, cy - R, cx + R, cy + R], 0, 180, fill=C["rind_d"])
    d.pieslice([cx - R * 0.955, cy - R * 0.955, cx + R * 0.955, cy + R * 0.955],
               0, 180, fill=C["green"])

    # 红瓤：往下挪 + 缩小 → 上缘与平边齐、下方留出绿边
    fr = R * 0.845
    off = P * 0.018
    d.pieslice([cx - fr, cy - fr + off, cx + fr, cy + fr + off], 0, 180, fill=C["red"])
    # 红瓤左上高光
    hl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(hl).pieslice([cx - fr, cy - fr + off, cx + fr, cy + fr + off],
                                0, 180, fill=C["red_l"])
    cut = Image.new("L", img.size, 255)
    ImageDraw.Draw(cut).polygon([(cx - R, cy - R), (cx + R * 0.10, cy - R),
                                 (cx - R, cy + R)], fill=0)
    hl.putalpha(Image.composite(hl.split()[3], Image.new("L", img.size, 0), cut))
    hl.putalpha(hl.split()[3].point(lambda v: int(v * 0.55)))
    img.alpha_composite(hl)

    # 籽：三颗，在红瓤上半（平边下面一点）
    for (fx, rr) in [(-0.30, 0.048), (0.02, 0.052), (0.33, 0.048)]:
        sx = cx + fr * fx
        sy = cy + off + fr * 0.30
        sr = P * rr
        d.ellipse([sx - sr * 0.78, sy - sr, sx + sr * 0.78, sy + sr], fill=C["black"])

    # 顶上一个小梗（加一点细节，原稿只有红线，我换成小梗）
    d.line([(cx + R * 0.30, cy - P * 0.004), (cx + R * 0.34, cy - P * 0.072)],
           fill=C["brn_d"], width=int(P * 0.024), joint="curve")

    img = outline_pass(img, INK_W)
    return finish(img)


# ══════════════════════════════════════════════════════════════
#  ② 土豆地雷（控制）—— 不规则土豆 + 引线 + 火花
# ══════════════════════════════════════════════════════════════
def potato_pts(cx, cy, rx, ry, seed=3, n=72, wob=0.06):
    rng = np.random.default_rng(seed)
    a1, a2, a3 = rng.uniform(0, 6.28, 3)
    pts = []
    for i in range(n):
        a = i / n * 2 * math.pi
        r = 1.0 + wob * math.sin(3 * a + a1) + wob * 0.55 * math.sin(5 * a + a2) \
            + wob * 0.3 * math.sin(7 * a + a3)
        # 右边收一点、顶部略平 → 像真土豆而不是球
        r += 0.05 * max(0.0, math.cos(a))
        r -= 0.04 * max(0.0, -math.sin(a)) ** 2
        pts.append((cx + math.cos(a) * rx * r, cy + math.sin(a) * ry * r))
    return pts


def draw_potato_mine():
    """
    ⚠️ 修正：上一次"暗部"用错了遮罩方向（把暗色画到了亮部位置），
       高光又太白太大（像一块云）。这次：
       · 暗部 = 本体形状 → 往右下挪 → 只保留本体以外的部分当"投影"
       · 高光 = 小而偏左上，透明度降到 0.22，用 brn_l 而不是米白
    """
    img, d = new_layer()
    cx, cy = P * 0.50, P * 0.60
    rx, ry = P * 0.335, P * 0.255

    body = potato_pts(cx, cy, rx, ry, seed=11)
    poly(d, body, C["brn_l"])

    # 暗部：本体往右下偏移，只保留"落在本体内部"的部分
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon(body, fill=255)
    dark = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(dark).polygon([(x + P * 0.030, y + P * 0.026) for (x, y) in body],
                                 fill=C["brn"])
    dark.putalpha(Image.composite(dark.split()[3], Image.new("L", img.size, 0), mask))
    img.alpha_composite(dark)

    # 高光：小 + 淡（上一版像"发霉"，这次缩到 rx*0.20 且透明度降到 0.55）
    hl2 = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(hl2).polygon(
        potato_pts(cx - rx * 0.36, cy - ry * 0.38, rx * 0.20, ry * 0.145, seed=5),
        fill=(206, 170, 124))
    hl2.putalpha(hl2.split()[3].point(lambda v: int(v * 0.55)))
    img.alpha_composite(hl2)

    # 芽眼：7 个分散
    rng = np.random.default_rng(23)
    placed = []
    for _ in range(500):
        if len(placed) >= 7:
            break
        a = rng.uniform(0, 6.28); r = rng.uniform(0.28, 0.82)
        x = cx + math.cos(a) * rx * r
        y = cy + math.sin(a) * ry * r
        if any((x - px) ** 2 + (y - py) ** 2 < (P * 0.058) ** 2 for px, py in placed):
            continue
        placed.append((x, y))
    for (x, y) in placed:
        r0 = P * 0.020
        d.ellipse([x - r0, y - r0 * 0.86, x + r0, y + r0 * 0.86], fill=C["brn_d"])

    # 引线（加粗，不然缩到 96 会看不见）
    top = min(body, key=lambda p: p[1])
    d.line([(top[0], top[1] + P * 0.020), (top[0] + P * 0.030, top[1] - P * 0.075),
            (top[0] + P * 0.115, top[1] - P * 0.105)],
           fill=C["gray_d"], width=int(P * 0.026), joint="curve")
    d.line([(top[0] + P * 0.014, top[1] - P * 0.010), (top[0] + P * 0.034, top[1] - P * 0.062)],
           fill=C["gray"], width=int(P * 0.011))

    # 火花（放大一点）
    sx, sy = top[0] + P * 0.145, top[1] - P * 0.135
    for (rr, col) in [(P * 0.070, C["yel"]), (P * 0.038, C["yel_l"])]:
        poly(d, [(sx, sy - rr), (sx + rr * 0.26, sy - rr * 0.26), (sx + rr, sy),
                 (sx + rr * 0.26, sy + rr * 0.26), (sx, sy + rr),
                 (sx - rr * 0.26, sy + rr * 0.26), (sx - rr, sy),
                 (sx - rr * 0.26, sy - rr * 0.26)], col)

    img = outline_pass(img, INK_W)
    return finish(img)


# ══════════════════════════════════════════════════════════════
#  ③ 一拳（攻击）—— 朝向观众的拳头 + 冲击线
# ══════════════════════════════════════════════════════════════
def draw_punch():
    """
    ⚠️ 前两版都读不出"拳头"（一版像砖头、一版像木板）。
       这一版换思路：**正面视角的握拳（像 emoji 👊 的正面）**，结构最容易被认出：
         · 四根手指在上方，四块并排的竖圆角块（指节朝上）
         · 拳体在下方，一整块
         · 大拇指横跨在拳体正面偏下
         · 手腕在最下面，窄一点
         · 左侧四条冲击线
       关键是"四块手指 + 指缝清楚"，这是"拳头"能被认出的唯一特征。
    """
    img, d = new_layer()
    cx = P * 0.52

    # 手腕（最下面，窄）
    d.rounded_rectangle([cx - P * 0.155, P * 0.72, cx + P * 0.155, P * 0.90],
                        radius=int(P * 0.05), fill=C["brn"])

    # 拳体（中间，宽扁）
    d.rounded_rectangle([cx - P * 0.315, P * 0.42, cx + P * 0.315, P * 0.76],
                        radius=int(P * 0.10), fill=C["brn_l"])

    # 四根手指（上方，四块竖着的圆角块）
    #   ⚠️ 手指太长会读成"手掌/击掌"，必须短而宽才是"握拳"
    fw = 0.150          # 每根宽（加宽）
    gapw = 0.014        # 缝宽（收窄）
    total = 4 * fw + 3 * gapw
    x0 = cx - P * total / 2
    heights = [0.155, 0.185, 0.178, 0.140]      # 手指只露出一点点（握起来的状态）
    for i, h in enumerate(heights):
        left = x0 + P * (i * (fw + gapw))
        right = left + P * fw
        top = P * (0.42 - h)
        d.rounded_rectangle([left, top, right, P * 0.52],
                            radius=int(P * 0.062), fill=C["brn_l"])
        # 每根手指上的高光
        hl = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(hl).rounded_rectangle(
            [left + P * 0.024, top + P * 0.018, right - P * 0.050, top + P * 0.055],
            radius=int(P * 0.026), fill=(214, 176, 128))
        hl.putalpha(hl.split()[3].point(lambda v: int(v * 0.78)))
        img.alpha_composite(hl)

    # 指根褶（拳体上沿的一条暗线，把手指和拳体分开）
    d.line([(cx - P * 0.30, P * 0.475), (cx + P * 0.30, P * 0.475)],
           fill=C["brn"], width=int(P * 0.017))

    # 大拇指：横跨拳体正面偏下
    d.rounded_rectangle([cx - P * 0.30, P * 0.585, cx + P * 0.10, P * 0.715],
                        radius=int(P * 0.062), fill=C["brn"])
    hl2 = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(hl2).rounded_rectangle([cx - P * 0.275, P * 0.605, cx + P * 0.055, P * 0.650],
                                          radius=int(P * 0.034), fill=(214, 176, 128))
    hl2.putalpha(hl2.split()[3].point(lambda v: int(v * 0.8)))
    img.alpha_composite(hl2)

    # 手腕褶
    d.line([(cx - P * 0.115, P * 0.79), (cx + P * 0.115, P * 0.79)],
           fill=C["brn_d"], width=int(P * 0.012))

    # 冲击线（左侧四条）
    for (y0, y1, w, col) in [(0.20, 0.29, 0.019, C["yel"]), (0.42, 0.50, 0.015, C["yel_l"]),
                             (0.60, 0.69, 0.019, C["yel"]), (0.79, 0.87, 0.014, C["yel_l"])]:
        d.line([(P * 0.045, P * y0), (P * 0.145, P * y1)], fill=col, width=int(P * w))

    img = outline_pass(img, INK_W)
    return finish(img)


# ══════════════════════════════════════════════════════════════
#  ④ 飞轮（防御）—— 旋转的金属轮 + 速度弧线
# ══════════════════════════════════════════════════════════════
def draw_flywheel():
    img, d = new_layer()
    cx, cy, R = P * 0.50, P * 0.50, P * 0.38

    # 外圈
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=C["gray"])
    d.ellipse([cx - R * 0.90, cy - R * 0.90, cx + R * 0.90, cy + R * 0.90], fill=C["blu_l"])
    d.ellipse([cx - R * 0.82, cy - R * 0.82, cx + R * 0.82, cy + R * 0.82], fill=C["paper"])

    # 辐条（6 根，斜着，像在转）
    for k in range(6):
        a = k * math.pi / 3 + 0.26
        x1 = cx + math.cos(a) * R * 0.20
        y1 = cy + math.sin(a) * R * 0.20
        x2 = cx + math.cos(a) * R * 0.78
        y2 = cy + math.sin(a) * R * 0.78
        d.line([(x1, y1), (x2, y2)], fill=C["blu"], width=int(R * 0.13))
    # 每根辐条上一点高光（让它有厚度）
    for k in range(6):
        a = k * math.pi / 3 + 0.26
        x1 = cx + math.cos(a) * R * 0.28
        y1 = cy + math.sin(a) * R * 0.28
        x2 = cx + math.cos(a) * R * 0.62
        y2 = cy + math.sin(a) * R * 0.62
        d.line([(x1 - R * 0.03, y1 - R * 0.03), (x2 - R * 0.03, y2 - R * 0.03)],
               fill=C["blu_l"], width=int(R * 0.045))

    # 轴心
    d.ellipse([cx - R * 0.20, cy - R * 0.20, cx + R * 0.20, cy + R * 0.20], fill=C["blu_d"])
    d.ellipse([cx - R * 0.12, cy - R * 0.12, cx + R * 0.12, cy + R * 0.12], fill=C["gray"])
    d.ellipse([cx - R * 0.05, cy - R * 0.05, cx + R * 0.05, cy + R * 0.05], fill=C["paper"])

    # 外圈高光（左上弧）
    d.arc([cx - R * 0.96, cy - R * 0.96, cx + R * 0.96, cy + R * 0.96],
          200, 300, fill=C["paper"], width=int(R * 0.10))

    # 速度弧线（外侧三道，往外挪远一点、细一点 → 图更干净）
    for (rr, a0, a1, w) in [(1.14, 150, 240, 0.030), (1.25, 140, 220, 0.024), (1.36, 132, 205, 0.018)]:
        d.arc([cx - R * rr, cy - R * rr, cx + R * rr, cy + R * rr],
              a0, a1, fill=C["blu_l"], width=int(R * w))

    img = outline_pass(img, INK_W)
    return finish(img)


# ══════════════════════════════════════════════════════════════
#  ⑤ 毒鸡汤（状态）—— 一碗汤 + 鸡腿 + 毒泡 + 骷髅标
# ══════════════════════════════════════════════════════════════
def draw_poison_soup():
    img, d = new_layer()
    cx = P * 0.50
    bowl_top, bowl_bot, bw = P * 0.52, P * 0.80, P * 0.30

    # 碗身（上宽下窄的梯形 + 圆底）
    poly(d, [(cx - bw, bowl_top), (cx + bw, bowl_top),
             (cx + bw * 0.72, bowl_bot), (cx - bw * 0.72, bowl_bot)], C["paper"])
    ellipse(d, [cx - bw * 0.74, bowl_bot - P * 0.05, cx + bw * 0.74, bowl_bot + P * 0.05], C["paper"])
    # 碗身底色暗部（下半部分）
    poly(d, [(cx - bw * 0.98, bowl_top + P * 0.09), (cx + bw * 0.98, bowl_top + P * 0.09),
             (cx + bw * 0.72, bowl_bot), (cx - bw * 0.72, bowl_bot)], C["gray"])
    # 碗口（椭圆）
    ellipse(d, [cx - bw, bowl_top - P * 0.075, cx + bw, bowl_top + P * 0.075], C["paper"])
    # 汤面（毒紫）
    ellipse(d, [cx - bw * 0.90, bowl_top - P * 0.055, cx + bw * 0.90, bowl_top + P * 0.055],
            C["pur"])

    # 汤面气泡
    for (fx, fy, rr) in [(-0.42, 0.008, 0.030), (0.10, -0.022, 0.038), (0.52, 0.012, 0.026)]:
        sx, sy, sr = cx + bw * fx, bowl_top + P * fy, P * rr
        d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=C["pur_l"])
        d.ellipse([sx - sr * 0.45, sy - sr * 0.55, sx + sr * 0.15, sy - sr * 0.05], fill=C["paper"])

    # 鸡腿（斜插在汤里）
    lx, ly = cx + P * 0.02, bowl_top - P * 0.20
    ellipse(d, [lx - P * 0.115, ly - P * 0.085, lx + P * 0.115, ly + P * 0.085],
            C["brn"], rot_deg=-26, cx=lx, cy=ly)
    hl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([lx - P * 0.08, ly - P * 0.062, lx + P * 0.03, ly - P * 0.005],
                               fill=C["brn_l"])
    hl.putalpha(hl.split()[3].point(lambda v: int(v * 0.85)))
    img.alpha_composite(hl)
    # 骨头
    bx, by = lx + P * 0.155, ly - P * 0.075
    d.line([(lx + P * 0.03, ly - P * 0.02), (bx, by)], fill=C["paper"], width=int(P * 0.038))
    d.ellipse([bx - P * 0.032, by - P * 0.032, bx + P * 0.032, by + P * 0.032], fill=C["paper"])

    # 碗上的骷髅标（提示"有毒"）
    kx, ky, kr = cx, bowl_bot - P * 0.115, P * 0.052
    d.ellipse([kx - kr, ky - kr, kx + kr, ky + kr], fill=C["black"])
    d.rectangle([kx - kr * 0.46, ky + kr * 0.42, kx + kr * 0.46, ky + kr * 1.32], fill=C["black"])
    for ex in (-0.40, 0.40):
        d.ellipse([kx + kr * ex - kr * 0.22, ky - kr * 0.30,
                   kx + kr * ex + kr * 0.22, ky + kr * 0.14], fill=C["paper"])
    for i in range(3):
        d.line([(kx - kr * 0.30 + i * kr * 0.30, ky + kr * 0.42),
                (kx - kr * 0.30 + i * kr * 0.30, ky + kr * 1.32)], fill=C["paper"],
               width=int(P * 0.008))

    # 冒出来的毒气（三个小圆点往上）
    for (fx, fy, rr, al) in [(-0.24, -0.30, 0.036, .55), (0.02, -0.38, 0.028, .45),
                             (0.26, -0.28, 0.032, .5)]:
        sx, sy, sr = cx + P * fx, bowl_top + P * fy, P * rr
        gas = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(gas).ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=C["pur_l"])
        gas.putalpha(gas.split()[3].point(lambda v: int(v * al)))
        img.alpha_composite(gas)

    img = outline_pass(img, INK_W)
    return finish(img)


# ══════════════════════════════════════════════════════════════
CARDS = [
    ("西瓜",     draw_watermelon),
    ("土豆地雷", draw_potato_mine),
    ("一拳",     draw_punch),
    ("飞轮",     draw_flywheel),
    ("毒鸡汤",   draw_poison_soup),
]


def main():
    results = []
    for name, fn in CARDS:
        art = fn()
        p = os.path.join(OUT, name + ".png")
        art.save(p)
        results.append((name, art))
        print("  %-6s %s  %d 字节" % (name, art.size, os.path.getsize(p)))

    # 拼一张总览（放大 3 倍看细节 + 1 倍看实际）
    K = 3
    gap = 16
    tiles = []
    for name, art in results:
        big = art.resize((CANVAS * K, CANVAS * K), Image.LANCZOS)
        tiles.append((name, big, art))
    W = len(tiles) * CANVAS * K + gap * (len(tiles) - 1)
    row = Image.new("RGBA", (W, CANVAS * K + 26), (250, 248, 244, 255))
    x = 0
    for name, big, _ in tiles:
        row.alpha_composite(big, (x, 0))
        x += CANVAS * K + gap
    row.save(os.path.join(OUT, "_总览.png"))
    print("  总览: %s (%dx%d)" % (os.path.join(OUT, "_总览.png"), row.width, row.height))

    # 实际尺寸对比（手牌里的大小）
    W2 = len(tiles) * 72 + gap * (len(tiles) - 1)
    row2 = Image.new("RGBA", (W2, 78), (250, 248, 244, 255))
    x = 0
    for name, _, art in tiles:
        s = art.resize((72, 72), Image.LANCZOS)
        row2.alpha_composite(s, (x, 3))
        x += 72 + gap
    row2.save(os.path.join(OUT, "_实际尺寸.png"))
    print("  实际尺寸: %s" % (os.path.join(OUT, "_实际尺寸.png"),))


if __name__ == "__main__":
    main()
