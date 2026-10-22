#!/usr/bin/env bash
# One-time setup for the neural voice (Kokoro-82M, ~350 MB, runs on CPU). Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 -m venv .cache/tts-venv
.cache/tts-venv/bin/pip install -q kokoro-onnx soundfile
mkdir -p .cache/tts
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  [ -f ".cache/tts/$f" ] || curl -L --fail -o ".cache/tts/$f" "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$f"
done
echo "Done. Start it with: npm run ai-tts"
