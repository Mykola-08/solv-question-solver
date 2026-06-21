#!/usr/bin/env python3
# Generates minimalist rounded-square PNG icons with an S/check mark. Pure stdlib.
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT, exist_ok=True)

BLUE = (0, 112, 224)
BLUE_DARK = (0, 72, 170)
WHITE = (255, 255, 255)
INK = (10, 24, 46)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_alpha(x, y, n, r):
    cx = min(max(x, r), n - r)
    cy = min(max(y, r), n - r)
    d = math.hypot(x - cx, y - cy)
    return max(0.0, min(1.0, r - d + 0.5))


def distance_to_segment(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length_sq = vx * vx + vy * vy
    t = 0 if length_sq == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / length_sq))
    qx, qy = ax + t * vx, ay + t * vy
    return math.hypot(px - qx, py - qy)


def mark_alpha(x, y, n):
    # A compact S-shaped check: legible at 16px, still brand-like at 128px.
    pts = [
        (0.64, 0.27),
        (0.43, 0.27),
        (0.34, 0.41),
        (0.54, 0.52),
        (0.66, 0.62),
        (0.42, 0.75),
        (0.31, 0.64),
    ]
    px, py = x / n, y / n
    stroke = 0.092
    aa = 1.2 / n
    d = min(distance_to_segment(px, py, *pts[i], *pts[i + 1]) for i in range(len(pts) - 1))
    return max(0.0, min(1.0, (stroke - d) / aa))


def make(n):
    radius = n * 0.26
    rows = bytearray()
    for y in range(n):
        rows.append(0)
        for x in range(n):
            bg_t = (x * 0.35 + y * 0.65) / max(1, n - 1)
            base = lerp(BLUE, BLUE_DARK, bg_t)
            lift = max(0.0, 1.0 - math.hypot((x / n) - 0.28, (y / n) - 0.18) / 0.72)
            base = lerp(base, (52, 151, 244), lift * 0.22)
            mark = mark_alpha(x + 0.5, y + 0.5, n)
            color = lerp(base, WHITE, mark)
            # A small dark pin inside the lower curve helps the mark hold at 16px.
            pin = max(0.0, 1.0 - math.hypot((x / n) - 0.61, (y / n) - 0.64) / 0.075)
            color = lerp(color, INK, min(pin * 0.14, 0.14) * mark)
            alpha = int(255 * rounded_alpha(x + 0.5, y + 0.5, n, radius))
            rows += bytes((color[0], color[1], color[2], alpha))
    return rows


def write_png(path, n):
    raw = make(n)

    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


for size in (16, 48, 128):
    write_png(os.path.join(OUT, f"icon{size}.png"), size)
    print("wrote", f"icons/icon{size}.png")
