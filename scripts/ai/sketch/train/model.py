"""SketchNet: a tiny CNN on the rendered symbol plus a GRU on the stroke sequence.

Kept deliberately small (~120k parameters, ~0.5 MB as float32): the browser runs
it with a hand-written forward pass (lib/sketch/sketchnet.ts), so every layer
here has to be something that is a dozen lines of TypeScript. Conv -> BatchNorm
-> ReLU -> MaxPool blocks (BatchNorm is folded into the conv at export), a GRU,
a two-layer class head and a linear pose head.
"""
import torch
from torch import nn


class Block(nn.Module):
    def __init__(self, cin, cout):
        super().__init__()
        self.conv = nn.Conv2d(cin, cout, 3, padding=1, bias=False)
        self.bn = nn.BatchNorm2d(cout)

    def forward(self, x):
        return nn.functional.max_pool2d(torch.relu(self.bn(self.conv(x))), 2)


class SketchNet(nn.Module):
    CHANNELS = (2, 16, 32, 64, 96)
    HIDDEN = 64
    TRUNK = 128

    def __init__(self, n_cls, n_pose=4, seq_dim=4):
        super().__init__()
        c = self.CHANNELS
        self.blocks = nn.ModuleList([Block(c[i], c[i + 1]) for i in range(len(c) - 1)])
        self.gru = nn.GRU(input_size=seq_dim, hidden_size=self.HIDDEN, batch_first=True)
        z = c[-1] + self.HIDDEN
        self.trunk = nn.Linear(z, self.TRUNK)
        self.drop = nn.Dropout(0.2)
        self.cls = nn.Linear(self.TRUNK, n_cls)
        self.pose = nn.Linear(z, n_pose)

    def features(self, img, seq):
        x = img
        for b in self.blocks:
            x = b(x)
        a = x.mean(dim=(2, 3))
        _, h = self.gru(seq)
        return torch.cat([a, h[-1]], dim=1)

    def forward(self, img, seq):
        z = self.features(img, seq)
        t = self.drop(torch.relu(self.trunk(z)))
        return self.cls(t), self.pose(z)
