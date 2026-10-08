import sys, os, glob
from PIL import Image, ImageDraw
# usage: sheet.py outdir prefix out.png [crop x0 y0 x1 y1 fractions] [cols]
d, pre, out = sys.argv[1], sys.argv[2], sys.argv[3]
crop = [float(x) for x in sys.argv[4].split(',')] if len(sys.argv) > 4 else [0, 0, 1, 1]
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 8
fs = sorted(glob.glob(os.path.join(d, pre + '-*.jpg')))
ims = []
for f in fs:
    im = Image.open(f); w, h = im.size
    im = im.crop((int(crop[0]*w), int(crop[1]*h), int(crop[2]*w), int(crop[3]*h)))
    lab = os.path.basename(f)[:-4]
    ImageDraw.Draw(im).text((4, 4), lab, fill=(255, 255, 0))
    ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
sh = Image.new('RGB', (w * cols, h * rows))
for i, im in enumerate(ims): sh.paste(im, ((i % cols) * w, (i // cols) * h))
sh.save(out); print(out, sh.size, len(ims))
