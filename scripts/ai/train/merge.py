"""Merge a LoRA adapter into the bf16 base and save a plain HF model (for eval and GGUF export).
    .cache/ft-venv/bin/python scripts/ai/train/merge.py --base Qwen/Qwen3-1.7B --adapter .cache/runs/q17/adapter --out .cache/runs/q17/merged
"""
import argparse, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel
ap = argparse.ArgumentParser(); ap.add_argument('--base', required=True); ap.add_argument('--adapter', required=True); ap.add_argument('--out', required=True)
a = ap.parse_args()
m = AutoModelForCausalLM.from_pretrained(a.base, torch_dtype=torch.bfloat16, device_map={'': 'cpu'})
m = PeftModel.from_pretrained(m, a.adapter).merge_and_unload()
m.save_pretrained(a.out, safe_serialization=True)
AutoTokenizer.from_pretrained(a.base).save_pretrained(a.out)
print('merged ->', a.out)
