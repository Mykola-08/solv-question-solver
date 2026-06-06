#!/usr/bin/env python3
# Generates rounded-square gradient PNG icons with a "spark" glyph. Pure stdlib.
import struct, zlib, os, math

OUT = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT, exist_ok=True)

# gradient endpoints (top-left -> bottom-right)
C1 = (108, 140, 255)   # #6c8cff
C2 = (155, 108, 255)   # #9b6cff

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def rounded_alpha(x, y, n, r):
    # anti-aliased rounded-rect coverage at pixel (x,y) for size n, radius r
    cx = min(max(x, r), n - r)
    cy = min(max(y, r), n - r)
    d = math.hypot(x - cx, y - cy)
    return max(0.0, min(1.0, r - d + 0.5))

def spark(x, y, n):
    # a 4-point sparkle near center; returns 0..1 intensity of white overlay
    cx = cy = (n - 1) / 2
    dx = (x - cx) / (n * 0.5)
    dy = (y - cy) / (n * 0.5)
    # 4-point star: |dx|^p + |dy|^p small along axes
    ax, ay = abs(dx), abs(dy)
    val = (ax ** 0.55 + ay ** 0.55)
    edge = 0.42
    return max(0.0, min(1.0, (edge - val) / 0.10))

def make(n):
    r = n * 0.22
    rows = bytearray()
    for y in range(n):
        rows.append(0)  # filter byte
        for x in range(n):
            t = (x + y) / (2 * (n - 1)) if n > 1 else 0
            base = lerp(C1, C2, t)
            s = spark(x, y, n)
            col = lerp(base, (255, 255, 255), 0.85 * s)
            a = int(255 * rounded_alpha(x + 0.5, y + 0.5, n, r))
            rows += bytes((col[0], col[1], col[2], a))
    return rows

def write_png(path, n):
    raw = make(n)
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

for size in (16, 48, 128):
    write_png(os.path.join(OUT, f"icon{size}.png"), size)
    print("wrote", f"icons/icon{size}.png")
