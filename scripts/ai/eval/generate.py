"""Generate SimScript for a prompt file with a (merged) model, greedy, thinking off.
    .cache/ft-venv/bin/python scripts/ai/eval/generate.py --model .cache/runs/q17/merged --prompts .cache/data1/eval.jsonl --out .cache/runs/q17/eval-out.jsonl [--system short|full]
Prompts file rows: {messages:[system,user,assistant]} (the assistant turn is the reference and is ignored) or {prompt}.
"""
import argparse, json, time, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
ap = argparse.ArgumentParser(); ap.add_argument('--model', required=True); ap.add_argument('--prompts', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--max-new', type=int, default=900); ap.add_argument('--bs', type=int, default=8); ap.add_argument('--limit', type=int, default=0)
ap.add_argument('--system', default='You write SimScript for SIMBLIP. Reply with SimScript code only.')
ap.add_argument('--system-file', default='')
a = ap.parse_args()
if a.system_file: a.system = open(a.system_file).read()
tok = AutoTokenizer.from_pretrained(a.model); tok.padding_side = 'left'
if tok.pad_token is None: tok.pad_token = tok.eos_token
m = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16, device_map={'': 0}).eval()
rows = [json.loads(l) for l in open(a.prompts)]
if a.limit: rows = rows[: a.limit]
def user_of(r): return r['messages'][1]['content'] if 'messages' in r else r['prompt']
out = open(a.out, 'w'); t0 = time.time(); toks = 0
for i in range(0, len(rows), a.bs):
    batch = rows[i : i + a.bs]
    texts = [tok.apply_chat_template([{'role': 'system', 'content': a.system}, {'role': 'user', 'content': user_of(r)}], tokenize=False, add_generation_prompt=True, enable_thinking=False) for r in batch]
    enc = tok(texts, return_tensors='pt', padding=True, add_special_tokens=False).to(0)
    with torch.no_grad():
        g = m.generate(**enc, max_new_tokens=a.max_new, do_sample=False, pad_token_id=tok.pad_token_id)
    for r, seq in zip(batch, g):
        new = seq[enc['input_ids'].shape[1]:]; toks += int((new != tok.pad_token_id).sum())
        out.write(json.dumps({'prompt': user_of(r), 'recipe': r.get('recipe'), 'script': tok.decode(new, skip_special_tokens=True).strip()}) + '\n')
    out.flush(); print(f'{min(i + a.bs, len(rows))}/{len(rows)}  {toks / (time.time() - t0):.0f} tok/s', flush=True)
