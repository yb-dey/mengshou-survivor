#!/usr/bin/env python3
# 云端出图（在 GitHub Actions 的 CPU runner 上跑）：参考图 img2img。
#   · 参考图：_art/ref/*.png（拿游戏里现有的贴图当参考 ⇒ 这是"保角色一致性"的关键输入）
#   · 提示词：_art/prompt.txt（每行一个任务："输出名 | 提示词 | strength"，# 开头为注释）
#   · 产物：_art/out/<输出名>.png + _art/log/<输出名>.json（记录模型/参数/耗时，便于复现）
# 模型选 sd-turbo：1–4 步即可出图，权重大小适中（约 2.5GB），CPU 上可跑；HF_ENDPOINT 走 hf-mirror。
import json
import os
import time
from pathlib import Path

import torch
from PIL import Image
from diffusers import AutoPipelineForImage2Image

ROOT = Path(__file__).resolve().parent
REF_DIR = ROOT / "ref"
OUT_DIR = ROOT / "out"
LOG_DIR = ROOT / "log"
OUT_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

MODEL = os.environ.get("ART_MODEL", "stabilityai/sd-turbo")
STEPS = int(os.environ.get("ART_STEPS", "4"))
SIZE = int(os.environ.get("ART_SIZE", "512"))


def load_tasks():
    f = ROOT / "prompt.txt"
    if not f.exists():
        return []
    tasks = []
    # utf-8-sig：吃掉 PowerShell `Set-Content -Encoding UTF8` 写出的 BOM。
    # 本轮实测事故：带 BOM 时首行是 "\ufeff# …"，startswith("#") 判不出来 ⇒ 注释被当任务解析
    # ⇒ `float('strength')` 直接崩（错因来自工作流自留档 _art/log/run.txt）。
    for line in f.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 2:
            continue
        name, prompt = parts[0].lstrip("\ufeff").strip(), parts[1]
        # 防御式解析：任何一个字段不合法就跳过该行并打印，而不是整条流水线崩掉。
        try:
            strength = float(parts[2]) if len(parts) > 2 and parts[2] else 0.55
            guidance = float(parts[3]) if len(parts) > 3 and parts[3] else 0.0
        except ValueError:
            print(f"⚠ 跳过无法解析的行: {line[:70]}")
            continue
        ref = parts[4] if len(parts) > 4 and parts[4] else "hero.png"
        tasks.append({"name": name, "prompt": prompt, "strength": strength,
                      "guidance": guidance, "ref": ref})
    return tasks


def main():
    tasks = load_tasks()
    print(f"任务数 {len(tasks)} · 模型 {MODEL} · steps {STEPS} · size {SIZE}", flush=True)
    if not tasks:
        print("prompt.txt 里没有有效任务，退出。")
        return

    t0 = time.time()
    pipe = AutoPipelineForImage2Image.from_pretrained(MODEL, torch_dtype=torch.float32,
                                                     safety_checker=None, requires_safety_checker=False)
    # 【第 105 轮】SDXL-turbo 首次运行崩在 `cannot reshape tensor of 0 elements into shape [0, -1, 1, 512]`
    #   —— CPU 管道上的典型显存/注意力形状问题。按官方建议开注意力分片 + VAE 分片（对 sd-turbo 无副作用）。
    for _fn in ("enable_attention_slicing", "enable_vae_slicing", "enable_vae_tiling"):
        try:
            getattr(pipe, _fn)()
            print(f"已启用 {_fn}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"跳过 {_fn}: {e}", flush=True)
    pipe.set_progress_bar_config(disable=False)
    print(f"模型加载完成 {time.time() - t0:.1f}s", flush=True)

    for t in tasks:
        ref_path = REF_DIR / t["ref"]
        if not ref_path.exists():
            cands = sorted(REF_DIR.glob("*.png"))
            if not cands:
                print(f"✗ 找不到参考图 {ref_path}，且 ref/ 为空 ⇒ 跳过 {t['name']}")
                continue
            ref_path = cands[0]
        img = Image.open(ref_path).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        ts = time.time()
        out = pipe(prompt=t["prompt"], image=img, strength=t["strength"],
                   guidance_scale=t["guidance"], num_inference_steps=STEPS).images[0]
        out_path = OUT_DIR / f"{t['name']}.png"
        out.save(out_path)
        meta = {"name": t["name"], "model": MODEL, "prompt": t["prompt"],
                "negative": "", "strength": t["strength"], "guidance": t["guidance"],
                "steps": STEPS, "size": SIZE, "ref": ref_path.name,
                "seconds": round(time.time() - ts, 1)}
        (LOG_DIR / f"{t['name']}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"✓ {t['name']} → {out_path.name}  {meta['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
