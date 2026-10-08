# One full stroke cycle, binned by stroke phase: strip.py <shotdir> <seg> <out.png> [n=10] [label]
# Takes the LAST complete cycle in the hold (between two wraps of swimP) and, for n evenly
# spaced phases, the frame nearest each.
import sys, os, glob, re
from PIL import Image, ImageDraw
d, seg, out = sys.argv[1], sys.argv[2], sys.argv[3]
n = int(sys.argv[4]) if len(sys.argv) > 4 else 10
label = sys.argv[5] if len(sys.argv) > 5 else ''
fs = sorted(glob.glob(os.path.join(d, seg + '-*.jpg')))
rows = []
for f in fs:
    m = re.search(r'-(\d+)-p([0-9]*\.?[0-9]+)-v([0-9]*\.?[0-9]+)', os.path.basename(f))
    rows.append((int(m.group(1)), float(m.group(2)), float(m.group(3)), f))
rows.sort()
wraps = [i for i in range(1, len(rows)) if rows[i][1] < rows[i - 1][1] - 0.3]
if len(wraps) >= 2: cyc = rows[wraps[-2]:wraps[-1]]
else:   # a slow stroke may not finish a whole cycle inside the hold: nearest phase over its back 2/3
    print('note: no whole cycle in', seg, '- phases taken from the last 2/3 of the hold')
    cyc = rows[len(rows) // 3:]
pick = []
for k in range(n):
    ph = k / n
    pick.append(min(cyc, key=lambda r: abs(r[1] - ph)))
ims = []
for (i, p, v, f) in pick:
    im = Image.open(f).convert('RGB')
    ImageDraw.Draw(im).text((6, 6), f'{seg} p={p:.2f} {v:.1f}u/s', fill=(255, 255, 0))
    ims.append(im)
w, h = ims[0].size
top = 22 if label else 0
sh = Image.new('RGB', (w * n, h + top), (10, 20, 24))
if label: ImageDraw.Draw(sh).text((8, 5), label, fill=(255, 255, 255))
for k, im in enumerate(ims): sh.paste(im, (k * w, top))
sh.save(out); print(out, sh.size, 'cycle frames', len(cyc))
