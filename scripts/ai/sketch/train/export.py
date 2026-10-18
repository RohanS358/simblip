"""Export a trained SketchNet for the browser, and write the golden test vectors.

    D:\\simblip-ml\\venv\\Scripts\\python.exe scripts\\ai\\sketch\\train\\export.py ^
        --run D:\\simblip-ml\\runs\\sketchnet-v1 --data D:\\simblip-ml\\data\\synthetic-s1 ^
        --shards data\\sketch\\synthetic --name sketchnet-v1

Writes, into public/models/:
  <name>.bin    all weights, float32 little-endian, BatchNorm folded into the
                convolutions and the calibration temperature folded into the
                class head (so the browser's softmax is already calibrated)
  <name>.json   manifest: tensor table, labels, preprocess version, metrics
  <name>.onnx   the same network for interchange / cross-checking
and lib/sketch/golden/<name>.golden.json: real strokes with the logits Python
computed for them, which lib/sketch/sketchnet.test.mjs reproduces in TypeScript.
"""
import argparse
import gzip
import hashlib
import json
import os
import shutil

import numpy as np
import torch
from torch import nn

from model import SketchNet

p = argparse.ArgumentParser()
p.add_argument('--run', required=True)
p.add_argument('--data', required=True)
p.add_argument('--shards', required=True)
p.add_argument('--name', default='sketchnet-v1')
p.add_argument('--out', default='public/models')
p.add_argument('--golden', default='lib/sketch/golden')
a = p.parse_args()

ck = torch.load(os.path.join(a.run, 'model.pt'), map_location='cpu')
meta = json.load(open(os.path.join(a.data, 'meta.json')))
labels, T = ck['labels'], ck['temperature']
model = SketchNet(len(labels))
model.load_state_dict(ck['state'])
model.eval()

# ── fold BatchNorm into the convolutions; fold 1/T into the class head ─────
tensors = []


def add(name, t):
    tensors.append((name, t.detach().cpu().numpy().astype(np.float32)))


for i, b in enumerate(model.blocks):
    scale = b.bn.weight / torch.sqrt(b.bn.running_var + b.bn.eps)
    add(f'conv{i}.w', b.conv.weight * scale[:, None, None, None])
    add(f'conv{i}.b', b.bn.bias - b.bn.running_mean * scale)
add('gru.w_ih', model.gru.weight_ih_l0)  # rows: reset, update, new
add('gru.w_hh', model.gru.weight_hh_l0)
add('gru.b_ih', model.gru.bias_ih_l0)
add('gru.b_hh', model.gru.bias_hh_l0)
add('trunk.w', model.trunk.weight)
add('trunk.b', model.trunk.bias)
add('cls.w', model.cls.weight / T)
add('cls.b', model.cls.bias / T)
add('pose.w', model.pose.weight)
add('pose.b', model.pose.bias)

os.makedirs(a.out, exist_ok=True)
blob = b''.join(t.tobytes() for _, t in tensors)
table, off = [], 0
for name, t in tensors:
    table.append({'name': name, 'shape': list(t.shape), 'offset': off})
    off += t.size
with open(os.path.join(a.out, f'{a.name}.bin'), 'wb') as f:
    f.write(blob)
report = json.load(open(os.path.join(a.run, 'report.json')))
manifest = {
    'name': a.name,
    'preprocessVersion': meta['preprocessVersion'],
    'classListVersion': meta['classListVersion'],
    'labels': labels,
    'poses': meta['poses'],
    'arch': {'channels': list(SketchNet.CHANNELS), 'hidden': SketchNet.HIDDEN, 'trunk': SketchNet.TRUNK},
    'temperature': T,
    'temperatureBakedIntoClassHead': True,
    'sha256': hashlib.sha256(blob).hexdigest(),
    'bytes': len(blob),
    'parameters': report['parameters'],
    'tensors': table,
    'trainedOn': {'groups': ['synthetic'], 'counts': meta['counts'], 'sources': meta['sources']},
    'evidence': {
        'synthetic': {k: report['results']['synthetic'][k] for k in ('n', 'top1', 'top3', 'ece', 'pose_acc', 'unknown_precision', 'unknown_recall')},
        'real': None,
        'note': 'Measured on generated (synthetic) writers only. No real-world accuracy has been measured.',
    },
}
json.dump(manifest, open(os.path.join(a.out, f'{a.name}.json'), 'w'), indent=2)
print(f"weights: {len(blob)} bytes ({report['parameters']} parameters)  sha256 {manifest['sha256'][:12]}")


# ── ONNX (interchange + an independent check of the folding) ───────────────
class Deploy(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, img, seq):
        c, q = self.m(img, seq)
        return c / T, q


n_test = meta['counts']['test']
img_all = np.fromfile(os.path.join(a.data, 'test.img.u8'), dtype=np.uint8).reshape(n_test, 2, 32, 32)
seq_all = np.fromfile(os.path.join(a.data, 'test.seq.f32'), dtype=np.float32).reshape(n_test, 64, 4)
bx = torch.from_numpy(img_all[:512]).float() / 255
bs = torch.from_numpy(seq_all[:512])
with torch.no_grad():
    ref_c, ref_p = Deploy(model)(bx, bs)
onnx_path = os.path.join(a.out, f'{a.name}.onnx')
try:
    torch.onnx.export(Deploy(model), (bx[:1], bs[:1]), onnx_path, opset_version=17, dynamo=False,
                      input_names=['img', 'seq'], output_names=['cls', 'pose'],
                      dynamic_axes={'img': {0: 'b'}, 'seq': {0: 'b'}, 'cls': {0: 'b'}, 'pose': {0: 'b'}})
    import onnxruntime as ort
    sess = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    oc, op = sess.run(None, {'img': bx.numpy(), 'seq': bs.numpy()})
    print('onnx vs torch, max |logit diff|:', float(np.abs(oc - ref_c.numpy()).max()), float(np.abs(op - ref_p.numpy()).max()))
    print('onnx size:', os.path.getsize(onnx_path), 'bytes')
except Exception as e:  # the browser path does not depend on ONNX
    print('ONNX export skipped:', repr(e)[:200])

# ── golden vectors: real strokes + what Python computed for them ───────────
# torch.onnx.export restores the wrapper's own train() flag afterwards, which
# recursively flips the real model back to training mode (BatchNorm on batch
# statistics, dropout on). Put it back, or the golden logits are wrong.
model.eval()
os.makedirs(a.golden, exist_ok=True)
want = {}
with gzip.open(os.path.join(a.shards, 'test-0000.jsonl.gz'), 'rt') as f:
    for line_no, line in enumerate(f):
        s = json.loads(line)
        if s['cls'] not in want:
            want[s['cls']] = (line_no, s)
        if len(want) == len(labels):
            break
rows = []
for cls, (i, s) in want.items():
    with torch.no_grad():
        c, q = Deploy(model)(torch.from_numpy(img_all[i:i + 1]).float() / 255, torch.from_numpy(seq_all[i:i + 1]))
    rows.append({
        'cls': cls,
        'strokes': [[[round(x, 1), round(y, 1)] for x, y, _ in st] for st in s['strokes']],
        'img': img_all[i].reshape(-1).tolist(),
        'seq': [round(float(v), 7) for v in seq_all[i].reshape(-1)],
        'cls_logits': [round(float(v), 6) for v in c[0]],
        'pose_logits': [round(float(v), 6) for v in q[0]],
    })
json.dump({'name': a.name, 'labels': labels, 'preprocessVersion': meta['preprocessVersion'], 'samples': rows},
          open(os.path.join(a.golden, f'{a.name}.golden.json'), 'w'), separators=(',', ':'))
print('golden samples:', len(rows))

os.makedirs('docs/ai/reports', exist_ok=True)
shutil.copy(os.path.join(a.run, 'report.json'), f'docs/ai/reports/{a.name}.json')
print('done')
