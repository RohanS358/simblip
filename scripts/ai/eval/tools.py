"""Tool-choice eval on the held-out rows (.cache/data4/eval-tools.jsonl).
    .cache/ft-venv/bin/python scripts/ai/eval/tools.py --model .cache/runs/lite/merged [--data .cache/data4/eval-tools.jsonl]
Reports: schema-valid %, correct-tool %, correct-args %. The prompt is built exactly as the runtime builds it
(chat template with the offered tools, thinking off); the reference is the row's assistant turn.
"""
import argparse, json, re, time, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
ap = argparse.ArgumentParser(); ap.add_argument('--model', required=True); ap.add_argument('--data', default='.cache/data4/eval-tools.jsonl')
ap.add_argument('--out', default='')
a = ap.parse_args()
tok = AutoTokenizer.from_pretrained(a.model)
m = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16, device_map={'': 0}).eval()
rows = [json.loads(l) for l in open(a.data)]
call = re.compile(r'<tool_call>\s*(\{.*?\})\s*</tool_call>', re.S)
def parse(t):
    mm = call.search(t)
    if not mm: return None
    try: return json.loads(mm.group(1))
    except Exception: return None
valid = tool_ok = args_ok = 0; t0 = time.time(); toks = 0; fails = []
for r in rows:
    p = tok.apply_chat_template(r['messages'][:2], tools=r['tools'], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    enc = tok(p, return_tensors='pt', add_special_tokens=False).to(0)
    with torch.no_grad(): g = m.generate(**enc, max_new_tokens=160, do_sample=False)
    new = g[0][enc['input_ids'].shape[1]:]; toks += len(new)
    got, want = parse(tok.decode(new, skip_special_tokens=False)), parse(r['messages'][2]['content'])
    valid += got is not None
    ok_t = got is not None and got.get('name') == want['name']; tool_ok += ok_t
    ok_a = ok_t and got.get('arguments') == want['arguments']; args_ok += ok_a
    if not ok_a: fails.append({'user': r['messages'][1]['content'][-80:], 'want': want, 'got': got})
n = len(rows)
rep = {'n': n, 'schema_valid': valid / n, 'tool_correct': tool_ok / n, 'args_correct': args_ok / n, 'tok_per_s': toks / (time.time() - t0)}
print(json.dumps(rep)); [print('FAIL', json.dumps(f)) for f in fails[:8]]
if a.out: json.dump({**rep, 'fails': fails}, open(a.out, 'w'), indent=1)
