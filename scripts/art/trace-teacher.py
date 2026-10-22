"""Trace the teacher reference illustration into layered SVG paths (components/workspace/teacher-art.ts).

    python3 -m venv .venv && .venv/bin/pip install numpy pillow opencv-python-headless potracer
    .venv/bin/python scripts/art/trace-teacher.py path/to/reference.png

Writes teacher-art.ts and parts.json next to the current directory. The reference image is not part of the repo.
"""
import sys
import numpy as np, cv2, potrace, json
from PIL import Image

im = np.array(Image.open(sys.argv[1] if len(sys.argv) > 1 else 'ref.png').convert('RGB'))
H, W = im.shape[:2]
PAL = {
 'bg': (248,248,248), 'skin': (247,178,137), 'neckShade': (229,131,84), 'pink': (238,173,213), 'pinkShade': (208,128,176),
 'navy': (18,61,130), 'navyDark': (9,46,91), 'hair': (20,20,20), 'book': (19,41,54), 'bookDark': (8,24,32),
 'bookEdge': (200,200,200), 'frame': (60,46,40), 'collar': (251,255,255),
}
names = list(PAL); cols = np.array([PAL[n] for n in names])
d = ((im[:, :, None, :].astype(int) - cols[None, None]) ** 2).sum(-1)
lab = cv2.medianBlur(d.argmin(-1).astype(np.uint8), 3).astype(int)
L = lambda n: lab == names.index(n)
yy, xx = np.mgrid[0:H, 0:W]

# background = near-white connected to the border, with a wall under the collar's top edge
white = (im.min(-1) > 238).astype(np.uint8)
wall = white.copy(); wall[197:199, 150:291] = 0
ff = wall.copy(); mask = np.zeros((H+2, W+2), np.uint8)
for pt in [(0,0),(W-1,0),(0,H-1),(W-1,H-1),(W//2,0),(5,H//2)]:
    if ff[pt[1], pt[0]] == 1: cv2.floodFill(ff, mask, pt, 2)
bg = (ff == 2) | ((white == 1) & (wall == 0))
figure = ~bg
collar = white.astype(bool) & ~bg & (yy >= 199) & (yy <= 252) & (xx >= 150) & (xx <= 290)

# --- face zone: eyes, brows, mouth are painted by code, so they are erased from the traced art
lens = [(208.7, 129.8), (251.5, 131.0)]
dl = lambda c: np.hypot(xx - c[0], yy - c[1])
zone = (xx >= 196) & (xx <= 278) & (yy >= 113) & (yy <= 163)
lab_skin = lab.copy()
inner = (dl(lens[0]) < 10.8) | (dl(lens[1]) < 10.8)
ring = ((dl(lens[0]) >= 10.8) & (dl(lens[0]) <= 19)) | ((dl(lens[1]) >= 10.8) & (dl(lens[1]) <= 19))
bridge = (xx >= 222) & (xx <= 240) & (yy >= 124) & (yy <= 134)
temple = (xx >= 176) & (xx <= 199) & (yy >= 114) & (yy <= 130)
nose = (xx >= 222) & (xx <= 240) & (yy >= 133) & (yy <= 152)
S = names.index('skin'); FR = names.index('frame'); SS = names.index('neckShade')
keep_frame = (ring | bridge | temple)
frame_m = L('frame') & keep_frame & ~inner & (yy < 160)
# anything in the zone that is not hair-above-bangs, frame ring or the nose becomes plain skin
ear_zone = (xx < 196)
face_fix = zone & ~ear_zone & figure & (im.min(-1) < 235)
neck_skin = ((L('skin') & (yy > 150) & (yy < 240) & (xx >= 186) & (xx <= 246)) | ((yy >= 150) & (yy <= 166) & (xx >= 192) & (xx <= 236)))
shade_keep = L('neckShade') & nose & ~inner
skin_m = (L('skin') & (yy <= 174) & ~(neck_skin & (yy >= 160) & (yy <= 240))) | (face_fix & ~frame_m & ~shade_keep)
# hair: the bangs end around y=113 on the right; keep hair above, and the left lock beside the ear
dark = im.max(-1) < 125
hair_m = (dark & figure & (yy < 124) & ~(frame_m | (zone & (yy >= 114) & ~ear_zone)))
nose_m = L('neckShade') & nose & ~inner & (yy < 160)
ear_m = L('neckShade') & (xx < 186) & (yy < 160)
neck_shade_m = L('neckShade') & ((yy >= 163) | ((xx >= 186) & (yy >= 140))) & (xx >= 176) & (xx <= 252)

def dil(m, n=1):
    return cv2.dilate(m.astype(np.uint8), np.ones((2*n+1, 2*n+1), np.uint8)).astype(bool) if n else m

legs = L('skin') & (yy >= 546)
skirt = (L('navy') | L('navyDark')) & (yy >= 350)
torso_sil = figure & (yy >= 199) & (yy <= 362) & (xx >= 90) & (xx <= 312) & ~skirt & ~legs
book_sil = L('book') | L('bookDark') | L('bookEdge')
spine = np.zeros((H, W), np.uint8); cv2.fillPoly(spine, [np.array([(261,237),(309,230),(309,292),(262,359)])], 1)
book_full = book_sil | spine.astype(bool)
neck_skin = ((L('skin') & (yy > 150) & (yy < 240) & (xx >= 186) & (xx <= 246)) | ((yy >= 150) & (yy <= 166) & (xx >= 192) & (xx <= 236)))
arm_l = L('skin') & (yy >= 236) & (xx < 262) & ~neck_skin
arm_r = L('skin') & (yy >= 225) & (xx >= 262)
leg_sk = legs
shade_pink = L('pinkShade')

def trace(m, name, fill, n=0, turd=14, tol=0.35):
    # smooth the pixel staircase and drop specks left by anti-aliased edges
    m = cv2.GaussianBlur(np.asarray(m, dtype=np.float32), (5, 5), 1.1) > 0.5
    bm = potrace.Bitmap(~m)
    pl = bm.trace(turdsize=turd, alphamax=1.0, opticurve=True, opttolerance=tol)
    out = []
    for c in pl:
        s = c.start_point
        d = f"M{s.x:.1f},{s.y:.1f}"
        for seg in c.segments:
            if seg.is_corner:
                d += f"L{seg.c.x:.1f},{seg.c.y:.1f}L{seg.end_point.x:.1f},{seg.end_point.y:.1f}"
            else:
                d += f"C{seg.c1.x:.1f},{seg.c1.y:.1f} {seg.c2.x:.1f},{seg.c2.y:.1f} {seg.end_point.x:.1f},{seg.end_point.y:.1f}"
        out.append(d + "Z")
    return {'id': name, 'fill': fill, 'd': ''.join(out)}

hexc = lambda n: '#%02X%02X%02X' % PAL[n]
parts = {}
parts['legs'] = [trace(dil(leg_sk, 1), 'legs', hexc('skin'))]
parts['skirt'] = [trace(dil(skirt, 1), 'skirt', hexc('navy')), trace(L('navyDark'), 'skirtDark', hexc('navyDark'))]
parts['torso'] = [trace(dil(torso_sil, 1), 'torso', hexc('pink')), trace(shade_pink, 'torsoShade', hexc('pinkShade')),
                  trace(collar, 'collar', '#FFFFFF'), trace(dil(neck_skin | dil(neck_shade_m, 1), 0), 'neck', hexc('skin')), trace(neck_shade_m, 'neckShade', hexc('neckShade'))]
parts['book'] = [trace(dil(book_full, 1), 'book', hexc('book')), trace(L('bookDark') | spine.astype(bool), 'bookSpine', hexc('bookDark')), trace(L('bookEdge'), 'bookEdge', hexc('bookEdge'))]
parts['armL'] = [trace(dil(arm_l, 1), 'armL', hexc('skin'))]
parts['armRest'] = [trace(dil(arm_r, 1), 'armRest', hexc('skin'))]
parts['head'] = [trace(dil(hair_m, 1), 'hair', hexc('hair')), trace(dil(skin_m, 1), 'face', hexc('skin')),
                 trace(ear_m, 'ear', hexc('neckShade')), trace(nose_m, 'nose', hexc('neckShade')), trace(frame_m, 'glasses', '#3C2E28', turd=4)]
json.dump(parts, open('parts.json', 'w'))
import sys
ts = ["// GENERATED by scripts/art/trace-teacher.py from the teacher reference illustration — do not edit by hand.",
      "// Each layer is the reference traced into flat SVG paths (viewBox 0 0 420 741), split into the parts that move",
      "// independently. Eyes, brows and the mouth are NOT here: they are painted by code (teacher.tsx) so they can emote.",
      "export interface ArtPath { id: string; fill: string; d: string }",
      "export const ART: Record<'legs' | 'skirt' | 'torso' | 'book' | 'armL' | 'armRest' | 'head', ArtPath[]> = " + json.dumps(parts, indent=1) + "\n"]
open('teacher-art.ts', 'w').write('\n'.join(ts))
print({k: sum(len(p['d']) for p in v) for k, v in parts.items()})

# preview: HTML of the layers in order, for a pixel diff against the reference
order = ['legs','skirt','torso','book','armL','armRest','head']
svg = ''.join(f'<path fill="{p["fill"]}" fill-rule="evenodd" d="{p["d"]}"/>' for k in order for p in parts[k])
open('preview.html', 'w').write(f'<body style="margin:0;background:#f8f8f8"><svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{svg}</svg></body>')
