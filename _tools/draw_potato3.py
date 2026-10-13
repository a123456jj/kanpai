# -*- coding: utf-8 -*-
"""
🥔 土豆 v3 —— 轮廓 + 明暗都用代码算，不再手摆
════════════════════════════════════════════════════════════
v2 的问题：明暗是我一格一格手摆的 → 左上到中间是一条直斜线，
          看起来像"切开的球"，没有土豆那种圆润的体积感

v3 的做法：
  ① 轮廓：用参数方程生成不规则椭圆（带凹凸和"腰"）
  ② 明暗：按每格到**光源点**的距离分档 → 自然形成球面光照
     光源放在左上方偏外（不是正中心），这样高光在左上、暗部在右下
  ③ 加一点"环境光遮蔽"：贴近轮廓边缘的格子压暗一档
  ④ 芽眼：程序撒点 + 每个芽眼周围压暗一圈
  ⑤ 顶上一个绿芽
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from pixelart import ascii_to_pixelart, upscale_pixelart, make_card_preview  # noqa

# ══════════════════════════════════════════════════════════════
#  调色板（土豆土系，13 档明暗 + 绿芽）
# ══════════════════════════════════════════════════════════════
INK = (0x2E, 0x1C, 0x14)   # 描边
RAMP = [                    # 由亮 → 暗的 9 档主体过渡
    (0xF6, 0xEA, 0xD2),    # 0 最亮（高光核心）
    (0xE4, 0xCB, 0xA6),    # 1
    (0xD2, 0xB2, 0x88),    # 2
    (0xC0, 0x9C, 0x70),    # 3
    (0xAD, 0x84, 0x5A),    # 4
    (0x99, 0x71, 0x4C),    # 5
    (0x86, 0x5F, 0x3E),    # 6
    (0x72, 0x50, 0x34),    # 7
    (0x5C, 0x40, 0x29),    # 8 最暗
]
EYE_OUT = (0x6B, 0x47, 0x2E)   # 芽眼外圈
EYE_IN = (0x3A, 0x22, 0x18)    # 芽眼中心
SPROUT = (0x84, 0xB8, 0x54)    # 芽
SPROUT_HI = (0xB0, 0xDA, 0x7E)  # 芽高光

PAL = [INK] + list(RAMP) + [EYE_OUT, EYE_IN, SPROUT, SPROUT_HI]
# 下标核对：0=描边 · 1~9=明暗 9 档 · 10=芽眼外圈 · 11=芽眼中心 · 12=芽 · 13=芽高光
#            （PAL 总共 14 个元素，合法下标 0~13）
IDX_INK = 0
IDX_RAMP0 = 1
IDX_EYE_OUT = 1 + len(RAMP)        # 10
IDX_EYE_IN = 2 + len(RAMP)         # 11
IDX_SPROUT = 3 + len(RAMP)         # 12
IDX_SPROUT_HI = 4 + len(RAMP)      # 13
assert IDX_SPROUT_HI == len(PAL) - 1, "调色板下标对不上"

W, H = 32, 26


def potato_mask(w, h):
    """不规则椭圆轮廓（土豆是歪的：左边鼓、右下收、顶部略平）"""
    cx, cy = w / 2, h / 2 + 0.6
    rx, ry = w / 2 - 1.6, h / 2 - 2.4
    m = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            # 基础椭圆
            r = math.sqrt(dx * dx + dy * dy)
            # 加凹凸：低频正弦扰动（让边缘歪歪扭扭，像真土豆）
            ang = math.atan2(dy, dx)
            wob = (0.055 * math.sin(ang * 3 + 0.8)
                   + 0.035 * math.sin(ang * 5 - 1.9)
                   + 0.022 * math.sin(ang * 7 + 2.6))
            # 右侧稍微收一点（不对称）
            wob += 0.05 * max(0.0, dx)
            # 顶部压平一点
            wob -= 0.04 * max(0.0, -dy) ** 2 if dy < 0 else 0.0
            if r < 1.0 + wob:
                m[y, x] = True
    return m


def shade(mask, w, h):
    """按到光源的距离算明暗（自然球面光照）"""
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return {}
    # 光源：左上偏外（这样高光落在左上一小块，不是整个左上角）
    lx = xs.min() + (xs.max() - xs.min()) * 0.28
    ly = ys.min() + (ys.max() - ys.min()) * 0.24

    # 距离场（整张 2D，方便后面按 mask 取值）
    Y, X = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.sqrt((X - lx) ** 2 + (Y - ly) ** 2)
    dmax = dist[mask].max() if dist[mask].size else 1.0
    t2d = dist / (dmax if dmax > 0 else 1.0)

    # 环境光遮蔽：数 8 邻居里有几个实心（1=内部，越小越靠边）
    nb = np.zeros((h, w), dtype=np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nb[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)] += \
                mask[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
    depth = nb / 8.0
    ao = (1.0 - depth) * 0.42

    tv = np.clip(t2d * 1.06 + ao, 0, 1)
    bands = np.clip((tv * len(RAMP)).astype(int), 0, len(RAMP) - 1)
    out = {}
    for y in range(h):
        for x in range(w):
            if mask[y, x]:
                out[(y, x)] = int(bands[y, x])
    return out


def add_eyes(grid, mask, w, h, seed=7):
    """撒芽眼：位置分散（不用均匀网格），每个芽眼中心深、外圈稍深"""
    rng = np.random.default_rng(seed)
    ys, xs = np.nonzero(mask)
    cx, cy = xs.mean(), ys.mean()
    placed = []
    tries = 0
    want = 8
    while len(placed) < want and tries < 4000:
        tries += 1
        i = rng.integers(0, len(xs))
        x, y = int(xs[i]), int(ys[i])
        # 芽眼要离边远一点（不能贴在轮廓上）
        if not (2 <= x < w - 2 and 2 <= y < h - 2):
            continue
        if not all(mask[y + dy, x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
            continue
        # 芽眼之间别太近
        if any((x - px) ** 2 + (y - py) ** 2 < 46 for (px, py) in placed):
            continue
        # 别都堆在中间 —— 让它们散到外圈一些
        placed.append((x, y))

    for (x, y) in placed:
        grid[y][x] = IDX_EYE_IN
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx]:
                    if grid[yy][xx] != IDX_EYE_IN:
                        grid[yy][xx] = IDX_EYE_OUT
    return placed


def add_sprout(grid, mask, w, h):
    """顶上冒一个小绿芽"""
    ys, xs = np.nonzero(mask)
    x = int(xs[ys == ys.min()].mean())
    y0 = int(ys.min())
    if y0 - 3 < 0:
        return
    grid[y0 - 1][x] = IDX_SPROUT
    grid[y0 - 2][x] = IDX_SPROUT_HI
    grid[y0 - 3][x] = IDX_SPROUT
    if x + 1 < w:
        grid[y0 - 2][x + 1] = IDX_SPROUT
        grid[y0 - 3][x + 1] = IDX_SPROUT_HI
    if x - 1 >= 0:
        grid[y0 - 2][x - 1] = IDX_SPROUT


def build():
    mask = potato_mask(W, H)
    bands = shade(mask, W, H)
    grid = [[-1] * W for _ in range(H)]
    for (y, x), b in bands.items():
        grid[y][x] = IDX_RAMP0 + b
    add_eyes(grid, mask, W, H)
    add_sprout(grid, mask, W, H)

    # 生成 ASCII（用于 ascii_to_pixelart）—— 用十进制下标太长，直接建图更快
    arr = np.zeros((H, W, 4), dtype=np.uint8)
    for y in range(H):
        for x in range(W):
            i = grid[y][x]
            if i < 0:
                continue
            c = PAL[i]
            arr[y, x] = [c[0], c[1], c[2], 255]
    # 描边：透明格且邻居有实心
    solid = arr[:, :, 3] > 0
    for y in range(H):
        for x in range(W):
            if solid[y, x]:
                continue
            n = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < H and 0 <= xx < W and solid[yy, xx]:
                        n += 1
            if n >= 2:
                arr[y, x] = [INK[0], INK[1], INK[2], 255]
    from PIL import Image
    return Image.fromarray(arr, "RGBA")


def main():
    out = r"C:\Users\a\Documents\deepseek-harness\default-workspace\game\images\_pixeltest"
    os.makedirs(out, exist_ok=True)
    art = build()
    print("  尺寸: %s" % (art.size,))
    a = np.asarray(art)
    used = sorted(set(tuple(a[y, x, :3]) for y in range(a.shape[0])
                      for x in range(a.shape[1]) if a[y, x, 3] > 0))
    print("  用到 %d 种颜色" % len(used))
    big = upscale_pixelart(art, 10)
    big.save(os.path.join(out, "potato_big.png"))
    art.save(os.path.join(out, "potato.png"))
    print("  原始: %d 字节" % os.path.getsize(os.path.join(out, "potato.png")))
    card = make_card_preview(art, "土豆", 1, PAL, scale=2)
    card.save(os.path.join(out, "potato_card.png"))
    print("  卡牌预览: %dx%d" % card.size)


if __name__ == "__main__":
    main()
