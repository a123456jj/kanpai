# -*- coding: utf-8 -*-
"""
像素画工具箱（pixelart.py）
════════════════════════════════════════════════════════════
能做的事：
  ① 把任意图片 → 统一风格的像素画（缩格 + 限定调色板 + 可选描边）
  ② 用一个词/一张草图 → 生成像素画（走 ASCII 网格，我来"画"）

为什么"像素化"这条路比找素材好：
  · 风格 100% 统一（同一套调色板 + 同一套网格规则）
  · 无水印、可商用（原图转出来的，版权跟原图走；纯生成的没有版权问题）
  · 60 张牌一次全转完，参数还能精确控制
  · 尺寸极小（24×24 的 PNG 只有几百字节）

用法（命令行）：
  python pixelart.py in.png out.png --size 24 --palette cards
  python pixelart.py in.png out.png --size 32 --outline --scale 8
  python pixelart.py --list-palettes
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

# ══════════════════════════════════════════════════════════════
#  调色板：像素画最关键的"风格来源"就是这一组颜色
#    原则：6~8 色够用；每色之间明度拉开；不要用纯黑纯白
# ══════════════════════════════════════════════════════════════
PALETTES = {
    # 卡牌通用（暖彩，高饱和但压了暗部）
    "cards": [
        (0x2B, 0x1E, 0x2E),  # 墨（描边/暗部）
        (0x6B, 0x4A, 0x3A),  # 棕（木头/皮革）
        (0xD9, 0x4B, 0x3B),  # 红（攻击/危险）
        (0xF2, 0x8C, 0x3C),  # 橙（火/能量）
        (0xF7, 0xD1, 0x54),  # 黄（光/金）
        (0x7A, 0xC7, 0x4F),  # 绿（自然/治疗）
        (0x4E, 0x9A, 0xD9),  # 蓝（水/冰/魔法）
        (0x9B, 0x5D, 0xE5),  # 紫（诅咒/神秘）
        (0xF2, 0xE8, 0xD8),  # 米白（高光）
    ],
    # 夜空（冷色，低饱和，做背景/星空）
    "night": [
        (0x0B, 0x0E, 0x22), (0x1B, 0x22, 0x45), (0x2E, 0x3A, 0x6B),
        (0x4A, 0x5A, 0x9E), (0x7B, 0x8C, 0xC9), (0xB8, 0xC4, 0xE8),
        (0xE8, 0xDF, 0xF7), (0xFF, 0xE9, 0xB8),
    ],
    # 单色（做"印刷风"或"暗黑风"）
    "mono": [
        (0x14, 0x14, 0x16), (0x2E, 0x2E, 0x33), (0x4A, 0x4A, 0x52),
        (0x6E, 0x6E, 0x78), (0x96, 0x96, 0xA0), (0xC2, 0xC2, 0xCA),
        (0xE4, 0xE4, 0xE8), (0xFA, 0xFA, 0xFC),
    ],
    # 甜点/可爱（高明度，粉黄）
    "sweet": [
        (0x5A, 0x3A, 0x4A), (0xC9, 0x6B, 0x8E), (0xF2, 0x9E, 0xB8),
        (0xFF, 0xC9, 0xD9), (0xFF, 0xE3, 0xC4), (0xF7, 0xD1, 0x54),
        (0x9B, 0xE0, 0xC4), (0xFF, 0xFA, 0xF2),
    ],
}


def hex_of(c):
    return "#%02X%02X%02X" % (int(c[0]), int(c[1]), int(c[2]))


# ══════════════════════════════════════════════════════════════
#  ① 图片 → 像素画
# ══════════════════════════════════════════════════════════════
def quantize_to_palette(arr, palette):
    """把 (H,W,3) 的浮点图，每像素映射到调色板里最近的颜色"""
    pal = np.array(palette, dtype=np.float32)
    h, w, _ = arr.shape
    flat = arr.reshape(-1, 3)
    # 距离平方（够用，省算力）
    d = ((flat[:, None, :] - pal[None, :, :]) ** 2).sum(axis=2)
    idx = d.argmin(axis=1)
    return pal[idx].reshape(h, w, 3), idx.reshape(h, w)


def detect_background_colors(rgb, band=14, cover=0.92):
    """
    从图片四边的窄带里统计主色 → 判定哪些颜色是"背景"
    ⚠️ 关键：素材图常常是 RGB（没有 alpha），棋盘格透明底是**真实像素**，
       而且棋盘有两张灰（例如 232 和 248）。只采样"四角那一个色"是抠不干净的
       （实测：只抠掉浅灰，深灰格子被当成内容，变成一堆黑线）
    所以：取边缘带 → 颜色量化统计 → 累加到 cover 比例的都算背景
    """
    h, w, _ = rgb.shape
    b = min(band, h // 6, w // 6)
    edge = np.concatenate([
        rgb[:b, :].reshape(-1, 3), rgb[-b:, :].reshape(-1, 3),
        rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3),
    ], axis=0).astype(np.int16)
    q = (edge // 8) * 8
    uniq, counts = np.unique(q, axis=0, return_counts=True)
    order = np.argsort(-counts)
    total = counts.sum()
    out, acc = [], 0
    for i in order:
        out.append(uniq[i].astype(np.float32))
        acc += counts[i]
        if acc / total >= cover:
            break
    return out


def flood_bg_mask(rgb, bgs, tol=34, kill_neutral_light=True):
    """
    从画面四边往里"洪水填充"，只把**和边缘连通**的背景色算背景。
    ⚠️ 为什么不能直接"颜色接近背景就删"：
       内容里本来就有深色/浅色像素（比如西瓜皮的深绿、高光的白），
       一刀切会把内容也抠出洞。洪水填充只吃"从外面能走到的"背景。
    kill_neutral_light: 素材网站的半透明水印是中性浅灰，也一起吃掉
    """
    h, w, _ = rgb.shape
    # 是否"像背景"
    d = np.full((h, w), 1e9, dtype=np.float32)
    for c in bgs:
        dd = np.sqrt(((rgb - c[None, None, :]) ** 2).sum(axis=2))
        d = np.minimum(d, dd)
    like_bg = d < tol
    if kill_neutral_light:
        mx = rgb.max(axis=2); mn = rgb.min(axis=2)
        like_bg |= ((mx - mn) < 20) & (mn > 150)

    # BFS：从四边所有"像背景"的像素出发
    from collections import deque
    out = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if like_bg[y, x] and not out[y, x]:
                out[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if like_bg[y, x] and not out[y, x]:
                out[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and like_bg[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True; q.append((ny, nx))
    return out


def image_to_pixelart(src, size=24, palette=None, outline=False,
                      remove_bg=True, bg_tol=34, saturate=1.15, contrast=1.08,
                      keep_aspect=True, kill_watermark=True):
    """
    src            : PIL.Image
    size           : 像素画最长边有多少个"像素格"
    palette        : 颜色列表
    outline        : 是否给不透明区域加 1px 描边
    remove_bg      : 是否把背景（边缘主色）变透明
    kill_watermark : 是否把"中性浅灰"也当背景（去掉素材网站的半透明水印）
    """
    palette = palette or PALETTES["cards"]
    im = src.convert("RGBA")
    W, H = im.size

    # 目标格子数
    if keep_aspect:
        if W >= H:
            gw, gh = size, max(1, round(size * H / W))
        else:
            gw, gh = max(1, round(size * W / H)), size
    else:
        gw = gh = size

    # ── 抠背景 ──
    if remove_bg:
        arr = np.asarray(im)
        a0 = arr[:, :, 3].astype(np.float32)
        if a0.min() > 200:       # 整张都不透明 → 才需要按颜色抠
            rgb0 = arr[:, :, :3].astype(np.float32)
            bgs = detect_background_colors(rgb0)
            # 洪水填充：只删"从边缘能走到"的背景
            is_bg = flood_bg_mask(rgb0, bgs, tol=bg_tol,
                                  kill_neutral_light=kill_watermark)
            im.putalpha(Image.fromarray(np.where(is_bg, 0, 255).astype(np.uint8)))

    # ── 缩小到格子尺寸（BOX = 每格取平均，最接近像素画的取样）──
    small = im.resize((gw, gh), Image.BOX)
    rgb_small = np.asarray(small.convert("RGB")).astype(np.float32)
    a_small = np.asarray(small)[:, :, 3].astype(np.float32) / 255.0

    # 边缘格子如果大半是透明 → 整格透明（去掉毛边）
    a_small = np.where(a_small < 0.36, 0.0, np.minimum(1.0, a_small * 1.35))

    # ── 饱和度 / 对比度 ──
    if saturate != 1.0 or contrast != 1.0:
        mx = rgb_small.max(axis=2, keepdims=True)
        mn = rgb_small.min(axis=2, keepdims=True)
        lum = (mx + mn) / 2
        rgb_small = np.clip(lum + (rgb_small - lum) * saturate, 0, 255)
        rgb_small = np.clip((rgb_small - 128) * contrast + 128, 0, 255)

    # ── 映射到调色板 ──
    q, idx = quantize_to_palette(rgb_small, palette)

    # ── 描边：只在"有 2 个以上实心邻居"的位置描 ──
    #    ⚠️ 直接用"实心区的边界"会把孤立的残渣像素（水印没抠干净留下的灰点）
    #       也描成一圈黑，看起来像脏了。所以要求它至少挨着 2 个实心格
    if outline:
        solid = a_small > 0.5
        nb = np.zeros(solid.shape, dtype=np.int16)
        nb[1:, :] += solid[:-1, :]
        nb[:-1, :] += solid[1:, :]
        nb[:, 1:] += solid[:, :-1]
        nb[:, :-1] += solid[:, 1:]
        # 本身透明、但周围有 >=2 个实心 → 这才是真正的"轮廓"
        edge = (~solid) & (nb >= 2)
        dark = np.array(palette[0], dtype=np.float32)
        q = np.where(edge[..., None], dark[None, None, :], q)
        a_small = np.where(edge, 1.0, a_small)

    out = np.dstack([q, a_small * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), (gw, gh)


def upscale_pixelart(img, scale=8, method="nearest"):
    """把像素画放大（NEAREST → 保持硬边，不会糊）"""
    w, h = img.size
    return img.resize((w * scale, h * scale), Image.NEAREST)


# ══════════════════════════════════════════════════════════════
#  ② 用 ASCII 网格"画"像素画（一个词 → 我来画）
#     字符 → 调色板下标
#     '.' 或 ' ' = 透明
# ══════════════════════════════════════════════════════════════
def ascii_to_pixelart(rows, palette, scale=1, charmap=None):
    """
    用字符网格"画"像素画。
      charmap 给了就用它把字符映射到调色板下标（推荐 —— 可以用有含义的字母）
      没给就按 36 进制解析字符（0-9 a-z）当地板下标
    '.' / ' ' / '_' = 透明
    """
    h = len(rows)
    w = max((len(r) for r in rows), default=0)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    for y, row in enumerate(rows):
        for x in range(w):
            ch = row[x] if x < len(row) else "."
            if ch in (".", " ", "_"):
                continue
            if charmap is not None:
                if ch not in charmap:
                    continue
                i = charmap[ch]
            else:
                try:
                    i = int(ch, 36)
                except ValueError:
                    continue
            if i < 0 or i >= len(palette):
                continue
            c = palette[i]
            out[y, x] = [c[0], c[1], c[2], 255]
    img = Image.fromarray(out, "RGBA")
    if scale > 1:
        img = upscale_pixelart(img, scale)
    return img


# ══════════════════════════════════════════════════════════════
#  ③ 拼一张"牌面预览"（像素画 + 卡框，看看放进游戏什么样）
# ══════════════════════════════════════════════════════════════
def make_card_preview(art, name, cost, palette, card_w=200, card_h=276, scale=1):
    """把像素画放进一张卡牌，看整体效果"""
    S = card_w * scale
    H = card_h * scale
    card = Image.new("RGBA", (S, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)

    ink = palette[0]
    paper = (0xFA, 0xF4, 0xE8)
    band = palette[3]

    # 卡体
    r = 14 * scale
    d.rounded_rectangle([0, 0, S - 1, H - 1], radius=r, fill=paper, outline=ink, width=3 * scale)
    # 顶部色带（按费用深浅）
    d.rounded_rectangle([0, 0, S - 1, 46 * scale], radius=r, fill=band, outline=ink, width=3 * scale)
    d.rectangle([0, 30 * scale, S - 1, 46 * scale], fill=band)

    # 费用圆
    cx, cy, rr = 28 * scale, 28 * scale, 19 * scale
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=paper, outline=ink, width=3 * scale)

    # 像素画（居中放进画框）
    frame = [22 * scale, 60 * scale, S - 22 * scale, H - 74 * scale]
    fw = frame[2] - frame[0]
    fh = frame[3] - frame[1]
    d.rounded_rectangle(frame, radius=8 * scale, fill=(0xFF, 0xFD, 0xF6), outline=ink, width=3 * scale)

    a = art.copy()
    a.thumbnail((fw - 16 * scale, fh - 16 * scale), Image.NEAREST)
    card.alpha_composite(a, (frame[0] + (fw - a.width) // 2, frame[1] + (fh - a.height) // 2))

    # 名字条
    d.rounded_rectangle([16 * scale, H - 60 * scale, S - 16 * scale, H - 14 * scale],
                        radius=9 * scale, fill=(0xF0, 0xE4, 0xCC), outline=ink, width=3 * scale)
    return card


# ══════════════════════════════════════════════════════════════
#  命令行
# ══════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser(description="像素画工具箱")
    ap.add_argument("src", nargs="?", help="输入图片")
    ap.add_argument("dst", nargs="?", help="输出图片")
    ap.add_argument("--size", type=int, default=24, help="最长边有多少像素格（默认 24）")
    ap.add_argument("--palette", default="cards", help="调色板：cards/night/mono/sweet")
    ap.add_argument("--outline", action="store_true", help="加 1px 描边")
    ap.add_argument("--scale", type=int, default=8, help="放大倍数（默认 8）")
    ap.add_argument("--keep-bg", action="store_true", help="不要抠背景")
    ap.add_argument("--saturate", type=float, default=1.15)
    ap.add_argument("--contrast", type=float, default=1.08)
    ap.add_argument("--list-palettes", action="store_true")
    a = ap.parse_args()

    if a.list_palettes:
        for k, v in PALETTES.items():
            print("%-8s %d 色: %s" % (k, len(v), " ".join(hex_of(c) for c in v)))
        return

    if not a.src or not a.dst:
        ap.print_help()
        return

    pal = PALETTES.get(a.palette, PALETTES["cards"])
    src = Image.open(a.src)
    art, grid = image_to_pixelart(src, size=a.size, palette=pal,
                                  outline=a.outline, remove_bg=not a.keep_bg,
                                  saturate=a.saturate, contrast=a.contrast)
    big = upscale_pixelart(art, a.scale)
    big.save(a.dst)
    print("格子 %dx%d → 输出 %dx%d → %s" % (grid[0], grid[1], big.width, big.height, a.dst))
    # 顺便存一份小图（游戏里用这个）
    small_path = os.path.splitext(a.dst)[0] + "_small.png"
    art.save(small_path)
    print("原始小图（游戏用）: %s" % small_path)


if __name__ == "__main__":
    main()
