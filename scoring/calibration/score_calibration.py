#!/usr/bin/env python3
"""
Calibration scoring script: scores essays from calibration/essays/ using
modified prompts from calibration/prompts/, then compares results against
actual exam scores embedded in each essay JSON.

Key differences from score.py:
  1. Uses calibration/prompts/ (modified prompts)
  2. Uses round() instead of ceil() for score scaling (reduces systematic inflation)
  3. Prints a final comparison table: AI score vs actual score per essay
  4. Retries ALL non-200 status codes (including 400) with backoff
  5. Partial failures are clearly marked; essays with any failed dimension
     are excluded from MAE so the metric stays honest
"""
import argparse
import json
import asyncio
import aiohttp
from pathlib import Path

CALIB_DIR = Path(__file__).parent
ESSAYS_DIR = CALIB_DIR / "essays"
PROMPTS_DIR = CALIB_DIR / "prompts"
RESULTS_DIR = CALIB_DIR / "results"

# Require the same prompts to exist as in production
REQUIRED_PROMPT_KEYS = {
    "topic_adherence_and_task",
    "thesis_and_theme",
    "evidence_and_material",
    "logic_and_structure",
    "language_and_expression",
}

# Read .env from project root (two levels up: calibration/ -> scoring/ -> essay-library/)
ENV_PATH = CALIB_DIR.parent.parent / ".env"
env_vars: dict[str, str] = {}
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip().strip('"')

DEEPSEEK_API_KEY = env_vars.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
# Read MODEL from score.py so the two scripts stay in sync automatically
_SCORE_PY = CALIB_DIR.parent / "score.py"
MODEL = "deepseek-flash"  # fallback
for _line in _SCORE_PY.read_text(encoding="utf-8").splitlines():
    if _line.strip().startswith("MODEL"):
        MODEL = _line.split("=", 1)[1].strip().strip('"').strip("'")
        break

# No concurrency limit — all requests fire simultaneously

DIMENSIONS: dict[str, str] = {
    "topic_adherence_and_task": "审题扣题与任务完成",
    "thesis_and_theme": "论点与立意",
    "evidence_and_material": "论据与素材",
    "logic_and_structure": "逻辑与结构",
    "language_and_expression": "语言与表达",
}

DIMENSION_MAX: dict[str, int] = {
    "topic_adherence_and_task": 12,
    "thesis_and_theme": 13,
    "evidence_and_material": 12,
    "logic_and_structure": 15,
    "language_and_expression": 8,
}


# ---------------------------------------------------------------------------
# Startup assertions
# ---------------------------------------------------------------------------

def check_prerequisites() -> None:
    """Fail fast with clear messages if any required file is missing."""
    assert DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY not found in .env"

    manifest = ESSAYS_DIR / "_manifest.json"
    assert manifest.exists(), f"Manifest not found: {manifest}"

    entries = json.loads(manifest.read_text(encoding="utf-8"))
    assert entries, "Manifest is empty"

    # Verify every essay JSON has the same fields as production score.py expects
    required_essay_fields = {"id", "studentName", "rawText", "topicTitle", "topicRequirements"}
    for entry in entries:
        path = ESSAYS_DIR / entry["file"]
        assert path.exists(), f"Essay file missing: {path}"
        essay = json.loads(path.read_text(encoding="utf-8"))
        missing = required_essay_fields - essay.keys()
        assert not missing, (
            f"Essay {entry['file']} is missing fields {missing}. "
            "The user message template requires topicTitle + topicRequirements."
        )
        assert essay.get("topicTitle"), f"topicTitle is empty in {entry['file']}"
        assert essay.get("topicRequirements"), f"topicRequirements is empty in {entry['file']}"

    for dim_key in REQUIRED_PROMPT_KEYS:
        p = PROMPTS_DIR / f"{dim_key}.md"
        assert p.exists(), f"Prompt file missing: {p}"


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_essays() -> list[dict]:
    manifest = json.loads((ESSAYS_DIR / "_manifest.json").read_text(encoding="utf-8"))
    return [
        json.loads((ESSAYS_DIR / entry["file"]).read_text(encoding="utf-8"))
        for entry in manifest
    ]


def load_prompt(dim_key: str) -> str:
    return (PROMPTS_DIR / f"{dim_key}.md").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# User message — identical format to production score.py
# ---------------------------------------------------------------------------

def build_user_message(essay: dict) -> str:
    """
    Builds the user message exactly as production score.py does.
    Always includes topic title + requirements when present.
    """
    parts: list[str] = []
    if essay.get("topicTitle") and essay.get("topicRequirements"):
        parts.append(
            f"## 作文题目：{essay['topicTitle']}\n\n"
            f"### 题目要求：\n{essay['topicRequirements']}"
        )
    parts.append(f"## 学生作文：\n\n{essay['rawText']}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# API call — retries ALL non-200 statuses, not just 429
# ---------------------------------------------------------------------------

async def call_deepseek(
    session: aiohttp.ClientSession,
    system_prompt: str,
    user_message: str,
    label: str = "",
) -> dict:
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

    # First attempt fires immediately (no delay) so all concurrent requests
    # start at the same time. Only failed requests are retried (once, after 3s).
    for attempt in range(2):
        if attempt > 0:
            await asyncio.sleep(3)
        try:
            async with session.post(
                DEEPSEEK_URL,
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    return json.loads(content)
                err_text = await resp.text()
                err = f"HTTP {resp.status}: {err_text[:120]}"
                print(f"    [{label}] attempt {attempt+1} failed: {err[:80]}")
        except Exception as e:  # noqa: BLE001
            print(f"    [{label}] attempt {attempt+1} exception: {type(e).__name__}: {e}")
    return {"score": -1, "brief": "FAILED after 2 attempts"}


# ---------------------------------------------------------------------------
# Score a single essay on a single dimension
# ---------------------------------------------------------------------------

async def score_essay(
    session: aiohttp.ClientSession,
    essay: dict,
    dim_key: str,
    prompt: str,
) -> dict:
    label = f"{essay.get('studentName', '?')} / {dim_key}"
    user_msg = build_user_message(essay)
    result = await call_deepseek(session, prompt, user_msg, label=label)

    raw_score = result.get("score", -1)
    dim_max = DIMENSION_MAX[dim_key]

    # AI now returns 0-100; scale to dim_max with round().
    # 100-point input gives finer resolution and much smaller rounding error
    # vs the old 10-point input (e.g. 0-100→12: error ≤0.06pts; 0-10→12: error ≤0.6pts).
    if isinstance(raw_score, (int, float)) and 0 <= raw_score <= 100:
        stored_score = max(0, min(dim_max, round(raw_score * dim_max / 100)))
    else:
        stored_score = -1

    record: dict = {
        "essay_id": essay["id"],
        "student": essay.get("studentName", ""),
        "actual_score": essay.get("actualScore"),
        "topic": essay.get("topicTitle", ""),
        "dimension": dim_key,
        "dimension_cn": DIMENSIONS[dim_key],
        "raw_score": raw_score,
        "score": stored_score,
        "brief": result.get("brief") or "",
    }
    for k, v in result.items():
        if k not in ("score", "brief"):
            record[k] = v
    return record


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

async def run_scoring(
    student_filter: set = None,
    dim_filter: set = None,
) -> None:
    check_prerequisites()
    all_essays = load_essays()

    essays = [
        e for e in all_essays
        if student_filter is None or e.get("studentName") in student_filter
    ]
    dims_to_run = {
        k: v for k, v in DIMENSIONS.items()
        if dim_filter is None or k in dim_filter
    }

    if not essays:
        print(f"No essays matched filter: {student_filter}")
        return
    if not dims_to_run:
        print(f"No dimensions matched filter: {dim_filter}")
        return

    print(f"Model  : {MODEL}")
    print(f"Essays : {len(essays)}" + (f"  (filtered from {len(all_essays)})" if student_filter else ""))
    print(f"Dims   : {len(dims_to_run)}" + (f"  {list(dims_to_run.keys())}" if dim_filter else ""))
    for e in essays:
        print(f"  {e['studentName']} (actual={e.get('actualScore')}, "
              f"topic='{e.get('topicTitle', '')[:12]}')")

    # essay_id → {"essay": …, "scores": {dim_key: score}}
    # Include ALL essays (not just filtered) so the summary table is always complete
    all_results: dict[str, dict] = {
        e["id"]: {"essay": e, "scores": {}} for e in all_essays
    }

    RESULTS_DIR.mkdir(exist_ok=True)
    prompts = {dim_key: load_prompt(dim_key) for dim_key in dims_to_run}

    n_req = len(essays) * len(dims_to_run)
    print(f"\nFiring {n_req} requests concurrently…")
    async with aiohttp.ClientSession() as session:
        tasks = [
            score_essay(session, e, dim_key, prompts[dim_key])
            for dim_key in dims_to_run
            for e in essays
        ]
        all_records = await asyncio.gather(*tasks)

    # Collate results; merge with any existing results from prior partial runs
    dim_records: dict[str, list] = {k: [] for k in dims_to_run}
    for r in all_records:
        dim_records[r["dimension"]].append(r)
        if r["score"] >= 0:
            all_results[r["essay_id"]]["scores"][r["dimension"]] = r["score"]

    # For dimensions NOT in this run, load existing results to complete the table
    for dim_key in DIMENSIONS:
        if dim_key in dims_to_run:
            continue
        result_path = RESULTS_DIR / f"{dim_key}.json"
        if result_path.exists():
            for r in json.loads(result_path.read_text(encoding="utf-8")):
                eid = r.get("essay_id")
                if eid in all_results and r.get("score", -1) >= 0:
                    all_results[eid]["scores"].setdefault(dim_key, r["score"])

    for dim_key, dim_cn in dims_to_run.items():
        print(f"\n{'='*60}\n{dim_cn} ({dim_key})\n{'='*60}")
        for r in sorted(dim_records[dim_key], key=lambda x: x["student"]):
            ok = r["score"] >= 0
            status = f"{r['score']}/{DIMENSION_MAX[dim_key]}" if ok else "FAILED"
            raw_display = r["raw_score"] if r["raw_score"] is not None else "?"
            print(
                f"  {r['student']:<6}: raw={str(raw_display):>4} → {status:<6} "
                f"({r['brief'][:45]})"
            )
        # Merge into existing results file (update rows for tested essays, keep others)
        result_path = RESULTS_DIR / f"{dim_key}.json"
        existing = {}
        if result_path.exists():
            for row in json.loads(result_path.read_text(encoding="utf-8")):
                existing[row["essay_id"]] = row
        for r in dim_records[dim_key]:
            existing[r["essay_id"]] = r
        result_path.write_text(
            json.dumps(list(existing.values()), ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # ------------------------------------------------------------------
    # Final comparison table
    # ------------------------------------------------------------------
    dim_keys = list(DIMENSIONS.keys())
    col_w = 7

    print(f"\n{'='*78}")
    print(f"CALIBRATION RESULTS (model={MODEL})")
    print(f"{'='*78}")
    hdr_dims = "".join(f"{k[:5]:>{col_w}}" for k in dim_keys)
    print(f"{'学生':<8} {'实考':>4} {'AI总':>5} {'差':>4}  {hdr_dims}")
    print("-" * 78)

    errors: list[int] = []
    for essay_id, data in sorted(
        all_results.items(),
        key=lambda x: x[1]["essay"].get("actualScore") or 0,
    ):
        essay = data["essay"]
        scores = data["scores"]
        actual = essay.get("actualScore", "?")

        # Check for partial failure
        failed_dims = [k for k in dim_keys if scores.get(k) is None]
        if failed_dims:
            dim_cells = "".join(
                f"{'✗':>{col_w}}" if k in failed_dims else f"{scores[k]:>{col_w}}"
                for k in dim_keys
            )
            print(f"{essay['studentName']:<8} {actual:>4} {'N/A':>5} {'?':>4}  {dim_cells}  ← INCOMPLETE")
            continue

        total = sum(scores[k] for k in dim_keys)
        diff = total - actual if isinstance(actual, int) else None
        diff_str = f"{diff:+d}" if diff is not None else "?"
        dim_cells = "".join(f"{scores[k]:>{col_w}}" for k in dim_keys)
        print(f"{essay['studentName']:<8} {actual:>4} {total:>5} {diff_str:>4}  {dim_cells}")
        if diff is not None:
            errors.append(abs(diff))

    print()
    if errors:
        mae = sum(errors) / len(errors)
        print(f"MAE  (完整样本, n={len(errors)}): {mae:.1f} 分")
    print(f"Results → {RESULTS_DIR}/")


def parse_args():
    p = argparse.ArgumentParser(
        description="Calibration scorer. Without flags, runs all essays × all dimensions.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    p.add_argument(
        "--students", "-s",
        metavar="NAME[,NAME…]",
        help="Comma-separated student names to test, e.g. 张三,李四",
    )
    p.add_argument(
        "--dims", "-d",
        metavar="DIM[,DIM…]",
        help=(
            "Comma-separated dimension keys to test.\n"
            "Available: " + ", ".join(DIMENSIONS.keys())
        ),
    )
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()

    student_filter = set(args.students.split(",")) if args.students else None
    dim_filter = set(args.dims.split(",")) if args.dims else None

    if dim_filter:
        bad = dim_filter - set(DIMENSIONS)
        if bad:
            print(f"Unknown dimensions: {bad}\nAvailable: {list(DIMENSIONS.keys())}")
            raise SystemExit(1)

    asyncio.run(run_scoring(student_filter=student_filter, dim_filter=dim_filter))
