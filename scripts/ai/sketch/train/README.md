# SketchNet training environment

Python lives OUTSIDE the repo, on D: (C: is nearly full):

    D:\simblip-ml\venv        virtual environment (torch 2.14 + CUDA 12.6, numpy, onnx, onnxruntime)
    D:\simblip-ml\data        exported tensors (npm run sketch:export)
    D:\simblip-ml\runs        trained checkpoints and reports
    D:\simblip-ml\pip-cache   pip's cache
    D:\simblip-ml\tmp         temp files for installs

Always use the venv's interpreter — `D:\simblip-ml\venv\Scripts\python.exe` — so nothing is
installed to C:. The venv is tied to that path: do not move or rename it (recreate it instead).
When installing more packages, point pip's cache and temp away from C: first:

    $env:TMP='D:\simblip-ml\tmp'; $env:TEMP='D:\simblip-ml\tmp'; $env:PIP_CACHE_DIR='D:\simblip-ml\pip-cache'

## The loop

    npm run sketch:synth  -- --seed 1 --writers 500 --reps 18          # data/sketch/synthetic  (generated hands)
    npm run sketch:export -- --out D:/simblip-ml/data/synthetic-s1      # tensors, via lib/sketch/preprocess.ts
    python scripts/ai/sketch/train/train.py  --data D:/simblip-ml/data/synthetic-s1 --run D:/simblip-ml/runs/sketchnet-v1
    python scripts/ai/sketch/train/export.py --run D:/simblip-ml/runs/sketchnet-v1 --data D:/simblip-ml/data/synthetic-s1 --shards data/sketch/synthetic
    npm run test:ai                                                     # TS forward pass vs PyTorch golden logits

Real samples join by adding their shard directory to `sketch:export --src a,b` — same format,
`source: "real"`. train.py then reports them as a separate `real` section; it never pools.

Preprocessing exists once, in TypeScript (lib/sketch/preprocess.ts). Python only reads the tensors it
produced, so train/serve skew in preprocessing is impossible by construction.
