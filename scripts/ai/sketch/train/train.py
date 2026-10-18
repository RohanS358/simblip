"""Train SketchNet on exported tensors and write an honest report.

    D:\\simblip-ml\\venv\\Scripts\\python.exe scripts\\ai\\sketch\\train\\train.py ^
        --data D:\\simblip-ml\\data\\synthetic-s1 --run D:\\simblip-ml\\runs\\sketchnet-v1

Every number in the report is tagged with the data group it was measured on.
"synthetic" means generated hands; it is NOT a real-world result. A "real"
section appears only if real samples are present in the val/test split.
"""
import argparse
import sys
import json
import os
import time

import numpy as np
import torch
from torch import nn

from model import SketchNet

# labels can contain non-ASCII (the ohm sign); a Windows console would crash printing them
sys.stdout.reconfigure(encoding='utf-8')

p = argparse.ArgumentParser()
p.add_argument('--data', required=True)
p.add_argument('--run', required=True)
p.add_argument('--epochs', type=int, default=30)
p.add_argument('--batch', type=int, default=512)
p.add_argument('--lr', type=float, default=2e-3)
p.add_argument('--seed', type=int, default=1)
a = p.parse_args()
torch.manual_seed(a.seed)
np.random.seed(a.seed)
os.makedirs(a.run, exist_ok=True)
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
meta = json.load(open(os.path.join(a.data, 'meta.json'), encoding='utf-8'))
labels, groups = meta['labels'], meta['groups']
UNK = labels.index('unknown')


def load(split):
    n = meta['counts'][split]

    def d(ext, dt, *shape):
        return np.fromfile(os.path.join(a.data, f'{split}.{ext}'), dtype=dt).reshape(n, *shape)

    pose = d('pose.u8', np.uint8).astype(np.int64)
    pose[pose == 255] = -100  # ignore_index: 'unknown' has no pose
    return dict(
        img=torch.from_numpy(d('img.u8', np.uint8, 2, 32, 32)).to(dev),
        seq=torch.from_numpy(d('seq.f32', np.float32, 64, 4)).to(dev),
        cls=torch.from_numpy(d('cls.u8', np.uint8).astype(np.int64)).to(dev),
        pose=torch.from_numpy(pose).to(dev),
        devc=torch.from_numpy(d('dev.u8', np.uint8).astype(np.int64)).to(dev),
        grp=torch.from_numpy(d('grp.u8', np.uint8).astype(np.int64)).to(dev),
    )


train, val, test = load('train'), load('val'), load('test')
print(f"data: train {len(train['cls'])}  val {len(val['cls'])}  test {len(test['cls'])}  device {dev}")

model = SketchNet(len(labels)).to(dev)
n_params = sum(x.numel() for x in model.parameters())
print('parameters:', n_params)
opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-2)
steps = a.epochs * ((len(train['cls']) + a.batch - 1) // a.batch)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps, pct_start=0.15)
ce = nn.CrossEntropyLoss(label_smoothing=0.05)
ce_pose = nn.CrossEntropyLoss(ignore_index=-100)


@torch.no_grad()
def logits_of(d, bs=4096):
    model.eval()
    cl, po = [], []
    for i in range(0, len(d['cls']), bs):
        c, q = model(d['img'][i:i + bs].float() / 255, d['seq'][i:i + bs])
        cl.append(c)
        po.append(q)
    return torch.cat(cl), torch.cat(po)


best, best_state = -1.0, None
t0 = time.time()
for ep in range(a.epochs):
    model.train()
    perm = torch.randperm(len(train['cls']), device=dev)
    tot = 0.0
    for i in range(0, len(perm), a.batch):
        ix = perm[i:i + a.batch]
        c, q = model(train['img'][ix].float() / 255, train['seq'][ix])
        loss = ce(c, train['cls'][ix])
        if (train['pose'][ix] != -100).any():
            loss = loss + 0.5 * ce_pose(q, train['pose'][ix])
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        sched.step()
        tot += loss.item() * len(ix)
    vc, _ = logits_of(val)
    acc = (vc.argmax(1) == val['cls']).float().mean().item()
    if acc > best:
        best, best_state = acc, {k: v.clone() for k, v in model.state_dict().items()}
    print(f"epoch {ep + 1:2d}/{a.epochs}  loss {tot / len(perm):.4f}  val top-1 {100 * acc:.2f}%  ({time.time() - t0:.0f}s)")
model.load_state_dict(best_state)

# Calibration: one temperature, fit on VALIDATION logits and never on test.
vc, _ = logits_of(val)
logT = torch.zeros(1, device=dev, requires_grad=True)
lbfgs = torch.optim.LBFGS([logT], lr=0.1, max_iter=100)
nll = nn.CrossEntropyLoss()


def closure():
    lbfgs.zero_grad()
    loss = nll(vc / logT.exp(), val['cls'])
    loss.backward()
    return loss


lbfgs.step(closure)
T = float(logT.exp().item())
print(f'temperature T = {T:.3f}')


def ece(prob, y, bins=15):
    conf, pred = prob.max(1)
    ok = (pred == y).float()
    e = 0.0
    for lo in np.linspace(0, 1, bins, endpoint=False):
        m = (conf > lo) & (conf <= lo + 1 / bins)
        if m.any():
            e += m.float().mean().item() * abs(ok[m].mean().item() - conf[m].mean().item())
    return e


def evaluate(d, mask, temp):
    tc, tp = logits_of(d)
    idx = mask.nonzero().squeeze(1)
    if len(idx) == 0:
        return None
    c, q, y, yp = tc[idx], tp[idx], d['cls'][idx], d['pose'][idx]
    prob = torch.softmax(c / temp, 1)
    pred = prob.argmax(1)
    top3 = (prob.topk(3, 1).indices == y[:, None]).any(1).float().mean().item()
    per = {}
    for k, name in enumerate(labels):
        m = y == k
        if m.any():
            per[name] = round((pred[m] == k).float().mean().item(), 4)
    conf = {}
    for i in (pred != y).nonzero().squeeze(1).tolist():
        key = f'{labels[y[i]]} -> {labels[pred[i]]}'
        conf[key] = conf.get(key, 0) + 1
    pm = yp != -100
    pose_acc = (q[pm].argmax(1) == yp[pm]).float().mean().item() if pm.any() else None
    unk_true, unk_pred = y == UNK, pred == UNK
    by_dev = {}
    for di, dn in enumerate(meta['devices']):
        m = d['devc'][idx] == di
        if m.any():
            by_dev[dn] = round((pred[m] == y[m]).float().mean().item(), 4)
    return {
        'n': int(len(idx)),
        'top1': round((pred == y).float().mean().item(), 4),
        'top3': round(top3, 4),
        'ece': round(ece(prob, y), 4),
        'pose_acc': None if pose_acc is None else round(pose_acc, 4),
        'unknown_precision': round((unk_true & unk_pred).sum().item() / max(unk_pred.sum().item(), 1), 4),
        'unknown_recall': round((unk_true & unk_pred).sum().item() / max(unk_true.sum().item(), 1), 4),
        'per_class_recall': per,
        'by_device_top1': by_dev,
        'top_confusions': dict(sorted(conf.items(), key=lambda kv: -kv[1])[:10]),
    }


report = {'temperature': T, 'epochs': a.epochs, 'best_val_top1': round(best, 4), 'parameters': n_params, 'results': {}}
for gi, g in enumerate(groups):
    r = evaluate(test, test['grp'] == gi, T)
    if g != 'synthetic':  # real data is small: val + test together
        r = r or evaluate(val, val['grp'] == gi, T)
    if r is None:
        continue
    if g == 'synthetic':
        r['ece_uncalibrated'] = round(evaluate(test, test['grp'] == gi, 1.0)['ece'], 4)
    report['results'][g] = r
    tag = 'SYNTHETIC (generated hands; not real-world validation)' if g == 'synthetic' else g.upper()
    print(f"\n[{tag}] n={r['n']}  top-1 {100 * r['top1']:.2f}%  top-3 {100 * r['top3']:.2f}%  ECE {r['ece']}"
          f" (uncalibrated {r.get('ece_uncalibrated')})")
    print(f"  pose {r['pose_acc']}  unknown precision {r['unknown_precision']} recall {r['unknown_recall']}")
    print('  by device:', r['by_device_top1'])
    print('  weakest:', sorted(r['per_class_recall'].items(), key=lambda kv: kv[1])[:6])
    print('  confusions:', r['top_confusions'])
if 'real' not in report['results']:
    print('\n[REAL] no real samples in the val/test splits: no real-world number exists yet.')
    report['results']['real'] = None

torch.save({'state': model.state_dict(), 'labels': labels, 'temperature': T}, os.path.join(a.run, 'model.pt'))
json.dump(report, open(os.path.join(a.run, 'report.json'), 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print('saved', a.run)
