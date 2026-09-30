#!/usr/bin/env python3
"""
Batch scoring script for essays using 4 scoring agents.
Calls DeepSeek API with each scoring prompt for each essay.
"""
import json
import os
import sys
import time
import asyncio
import aiohttp
from pathlib import Path
from collections import defaultdict

# --- Configuration ---
SCORING_DIR = Path(__file__).parent
ESSAYS_DIR = SCORING_DIR / "essays"
PROMPTS_DIR = SCORING_DIR / "prompts"
RESULTS_DIR = SCORING_DIR / "results"

# Read .env manually
ENV_PATH = SCORING_DIR.parent / ".env"
env_vars = {}
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip().strip('"')

DEEPSEEK_API_KEY = env_vars.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-flash"

# Concurrency control
MAX_CONCURRENT = 5
semaphore = None

# Scoring dimensions（与 Next 应用 SCORING_DIMENSIONS 一致）
DIMENSIONS = {
    "topic_adherence_and_task": "审题扣题与任务完成",
    "thesis_and_theme": "论点与立意",
    "evidence_and_material": "论据与素材",
    "logic_and_structure": "逻辑与结构",
    "language_and_expression": "语言与表达",
}

DIMENSION_MAX = {
    "topic_adherence_and_task": 12,
    "thesis_and_theme": 13,
    "evidence_and_material": 12,
    "logic_and_structure": 15,
    "language_and_expression": 8,
}


def load_prompt(dim_key: str) -> str:
    path = PROMPTS_DIR / f"{dim_key}.md"
    return path.read_text(encoding="utf-8")


def load_essays() -> list[dict]:
    manifest_path = ESSAYS_DIR / "_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    essays = []
    for entry in manifest:
        essay_path = ESSAYS_DIR / entry["file"]
        essay = json.loads(essay_path.read_text(encoding="utf-8"))
        essays.append(essay)
    return essays


def build_user_message(essay: dict) -> str:
    parts = []
    if essay.get("topicTitle") and essay.get("topicRequirements"):
        parts.append(f"## 作文题目：{essay['topicTitle']}\n\n### 题目要求：\n{essay['topicRequirements']}")
    parts.append(f"## 学生作文：\n\n{essay['rawText']}")
    return "\n\n".join(parts)


async def call_deepseek(session: aiohttp.ClientSession, system_prompt: str, user_message: str) -> dict:
    """Call DeepSeek API and return parsed JSON response."""
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
    }

    async with semaphore:
        for attempt in range(3):
            try:
                async with session.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                    if resp.status == 429:
                        wait = 2 ** (attempt + 1)
                        print(f"  Rate limited, waiting {wait}s...")
                        await asyncio.sleep(wait)
                        continue
                    if resp.status != 200:
                        err = await resp.text()
                        print(f"  API error {resp.status}: {err[:200]}")
                        return {"score": -1, "brief": f"API error {resp.status}"}
                    data = await resp.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    return json.loads(content)
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                print(f"  Parse error: {e}, raw: {content[:200] if 'content' in dir() else 'N/A'}")
                return {"score": -1, "brief": f"Parse error: {e}"}
            except Exception as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                    continue
                print(f"  Request error: {e}")
                return {"score": -1, "brief": f"Request error: {e}"}
    return {"score": -1, "brief": "Max retries exceeded"}


async def score_essay(session: aiohttp.ClientSession, essay: dict, dim_key: str, prompt: str) -> dict:
    """Score a single essay on a single dimension."""
    user_msg = build_user_message(essay)
    result = await call_deepseek(session, prompt, user_msg)
    raw_score = result.get("score", -1)
    dim_max = DIMENSION_MAX[dim_key]
    # Prompt asks model for 0-100; stored score = round(raw × dimMax/100), clamped to [0, dimMax]
    if isinstance(raw_score, (int, float)) and raw_score >= 0:
        weighted = round(raw_score * (dim_max / 100))
        stored_score = max(0, min(dim_max, weighted))
    else:
        stored_score = -1
    base = {
        "essay_id": essay["id"],
        "student": essay.get("studentName", ""),
        "topic": essay.get("topicTitle", ""),
        "dimension": dim_key,
        "dimension_cn": DIMENSIONS[dim_key],
        "raw_score": raw_score,
        "score": stored_score,
        "brief": result.get("brief", ""),
    }
    for k, v in result.items():
        if k not in ("score", "brief"):
            base[k] = v
    return base


async def run_scoring(dimension_filter=None):
    """Run scoring for all essays across all (or filtered) dimensions."""
    global semaphore
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    essays = load_essays()
    print(f"Loaded {len(essays)} essays")

    dims_to_score = {}
    for k, v in DIMENSIONS.items():
        if dimension_filter and k != dimension_filter:
            continue
        dims_to_score[k] = load_prompt(k)
    print(f"Scoring dimensions: {list(dims_to_score.keys())}")

    RESULTS_DIR.mkdir(exist_ok=True)

    async with aiohttp.ClientSession() as session:
        for dim_key, prompt in dims_to_score.items():
            print(f"\n{'='*60}")
            print(f"Scoring dimension: {DIMENSIONS[dim_key]} ({dim_key})")
            print(f"{'='*60}")

            tasks = []
            for essay in essays:
                tasks.append(score_essay(session, essay, dim_key, prompt))

            results = []
            # Process in batches for progress tracking
            batch_size = MAX_CONCURRENT * 2
            for i in range(0, len(tasks), batch_size):
                batch = tasks[i:i + batch_size]
                batch_results = await asyncio.gather(*batch)
                results.extend(batch_results)
                done = min(i + batch_size, len(tasks))
                scores = [
                    r["score"]
                    for r in batch_results
                    if isinstance(r.get("score"), (int, float)) and r["score"] >= 0
                ]
                avg = sum(scores) / len(scores) if scores else 0
                print(f"  Progress: {done}/{len(tasks)} | Batch avg: {avg:.1f}")

            # Save results
            result_path = RESULTS_DIR / f"{dim_key}.json"
            with open(result_path, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)

            # Print distribution summary（加权后最终分，0～该维满分）
            dim_max = DIMENSION_MAX[dim_key]
            valid_scores = [
                r["score"]
                for r in results
                if isinstance(r.get("score"), (int, float)) and 0 <= r["score"] <= dim_max
            ]
            if valid_scores:
                dist = defaultdict(int)
                for s in valid_scores:
                    dist[int(s)] += 1
                print(f"\n  Distribution for {DIMENSIONS[dim_key]} (0–{dim_max}, weighted):")
                for score_val in range(0, dim_max + 1):
                    count = dist.get(score_val, 0)
                    bar = "█" * min(count, 40)
                    print(f"    {score_val:2d}: {bar} ({count})")
                avg = sum(valid_scores) / len(valid_scores)
                std = (sum((s - avg) ** 2 for s in valid_scores) / len(valid_scores)) ** 0.5
                print(f"  Mean: {avg:.2f}, Std: {std:.2f}, N: {len(valid_scores)}")
                errors = len(results) - len(valid_scores)
                if errors:
                    print(f"  Out of range or missing: {errors}")

    print(f"\nResults saved to {RESULTS_DIR}/")


def main():
    dim_filter = sys.argv[1] if len(sys.argv) > 1 else None
    if dim_filter and dim_filter not in DIMENSIONS:
        print(f"Unknown dimension: {dim_filter}")
        print(f"Available: {list(DIMENSIONS.keys())}")
        sys.exit(1)
    asyncio.run(run_scoring(dim_filter))


if __name__ == "__main__":
    main()
