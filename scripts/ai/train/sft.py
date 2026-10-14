"""QLoRA fine-tune of a small Qwen3 on SimScript (scripts/ai/data → .cache/data*/train.jsonl).

    .cache/ft-venv/bin/python scripts/ai/train/sft.py --base Qwen/Qwen3-1.7B --data .cache/data1 --out .cache/runs/q17

One model, trained to write SimScript from a ONE-LINE system prompt (the language
lives in the weights). Loss is on the assistant's tokens only. The prompt is built
exactly the way the on-device runtime builds it — chat template, thinking OFF —
so what is trained is what is served.
"""
import argparse, json, math, os, random, time
import torch
from torch.utils.data import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, Trainer, TrainingArguments
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='Qwen/Qwen3-1.7B')
ap.add_argument('--data', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--epochs', type=float, default=2)
ap.add_argument('--lr', type=float, default=2e-4)
ap.add_argument('--rank', type=int, default=32)
ap.add_argument('--max-len', type=int, default=1400)
ap.add_argument('--bs', type=int, default=4)
ap.add_argument('--accum', type=int, default=4)
ap.add_argument('--limit', type=int, default=0, help='train on only the first N rows (smoke test)')
ap.add_argument('--max-steps', type=int, default=-1)
a = ap.parse_args()

tok = AutoTokenizer.from_pretrained(a.base)
tok.padding_side = 'right'
if tok.pad_token is None:
    tok.pad_token = tok.eos_token

def encode(row):
    msgs = row['messages']
    prompt = tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    completion = msgs[2]['content'] + '<|im_end|>\n'
    p = tok(prompt, add_special_tokens=False)['input_ids']
    c = tok(completion, add_special_tokens=False)['input_ids']
    ids = (p + c)[: a.max_len]
    labels = ([-100] * len(p) + c)[: a.max_len]
    return {'input_ids': ids, 'labels': labels}

rows = [json.loads(l) for l in open(f'{a.data}/train.jsonl')]
if a.limit:
    rows = rows[: a.limit]
random.Random(0).shuffle(rows)
data = [encode(r) for r in rows]
print(f'{len(data)} examples; mean {sum(len(d["input_ids"]) for d in data)/len(data):.0f} tokens; prompt+completion; max {max(len(d["input_ids"]) for d in data)}')
print('--- sample ---'); print(tok.decode(data[0]['input_ids'])[:700]); print('--------------')

class DS(Dataset):
    def __len__(self): return len(data)
    def __getitem__(self, i): return data[i]

def collate(batch):
    n = max(len(b['input_ids']) for b in batch)
    ids = torch.full((len(batch), n), tok.pad_token_id)
    lab = torch.full((len(batch), n), -100)
    att = torch.zeros((len(batch), n), dtype=torch.long)
    for i, b in enumerate(batch):
        k = len(b['input_ids'])
        ids[i, :k] = torch.tensor(b['input_ids']); lab[i, :k] = torch.tensor(b['labels']); att[i, :k] = 1
    return {'input_ids': ids, 'labels': lab, 'attention_mask': att}

bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
model = AutoModelForCausalLM.from_pretrained(a.base, quantization_config=bnb, torch_dtype=torch.bfloat16, device_map={'': 0})
model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
model = get_peft_model(model, LoraConfig(r=a.rank, lora_alpha=a.rank * 2, lora_dropout=0.05, task_type='CAUSAL_LM',
                                         target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj']))
model.print_trainable_parameters()

args = TrainingArguments(
    output_dir=a.out, per_device_train_batch_size=a.bs, gradient_accumulation_steps=a.accum,
    num_train_epochs=a.epochs, max_steps=a.max_steps, learning_rate=a.lr, lr_scheduler_type='cosine', warmup_steps=20,
    bf16=True, logging_steps=10, save_strategy='epoch', save_total_limit=2, report_to=[], remove_unused_columns=False,
    gradient_checkpointing=True, optim='paged_adamw_8bit', dataloader_num_workers=0,
)
t0 = time.time()
Trainer(model=model, args=args, train_dataset=DS(), data_collator=collate).train()
model.save_pretrained(f'{a.out}/adapter')
tok.save_pretrained(f'{a.out}/adapter')
print(f'done in {(time.time()-t0)/60:.1f} min -> {a.out}/adapter')
