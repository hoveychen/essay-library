#!/usr/bin/env python3
"""
Analyze score distributions for normality and discrimination.
"""
import json
import sys
from pathlib import Path
from collections import defaultdict
import math

RESULTS_DIR = Path(__file__).parent / "results"

DIMENSIONS = {
    "thesis_and_theme": "论点与立意",
    "evidence_and_material": "论据与素材",
    "logic_and_structure": "逻辑与结构",
    "language_and_expression": "语言与表达",
    "topic_adherence_and_task": "审题扣题与任务完成",
}


def load_scores(dim_key: str) -> list[int]:
    path = RESULTS_DIR / f"{dim_key}.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [r["score"] for r in data if r["score"] > 0]


def compute_stats(scores: list[int]) -> dict:
    n = len(scores)
    if n == 0:
        return {}
    mean = sum(scores) / n
    variance = sum((s - mean) ** 2 for s in scores) / n
    std = variance ** 0.5

    # Skewness (measure of asymmetry)
    if std > 0:
        skewness = sum((s - mean) ** 3 for s in scores) / (n * std ** 3)
    else:
        skewness = 0

    # Kurtosis (measure of tail heaviness, normal = 3)
    if std > 0:
        kurtosis = sum((s - mean) ** 4 for s in scores) / (n * std ** 4)
    else:
        kurtosis = 0

    # Distribution
    dist = defaultdict(int)
    for s in scores:
        dist[s] += 1

    # Concentration ratio: % of scores in ±1 of median
    median = sorted(scores)[n // 2]
    concentrated = sum(1 for s in scores if abs(s - median) <= 1)
    concentration = concentrated / n

    # Range usage: how many of the 10 possible scores are used
    range_usage = len(set(scores)) / 10

    return {
        "n": n,
        "mean": mean,
        "std": std,
        "min": min(scores),
        "max": max(scores),
        "median": median,
        "skewness": skewness,
        "kurtosis": kurtosis,
        "concentration": concentration,
        "range_usage": range_usage,
        "distribution": dict(sorted(dist.items())),
    }


def assess_quality(stats: dict) -> tuple[str, list[str]]:
    """Assess distribution quality. Returns (verdict, issues)."""
    issues = []

    if stats["std"] < 1.2:
        issues.append(f"标准差过低({stats['std']:.2f})，区分度不足，分数过于集中")
    if stats["concentration"] > 0.7:
        issues.append(f"集中度过高({stats['concentration']:.0%})，70%以上分数集中在中位数±1范围")
    if abs(stats["skewness"]) > 1.0:
        direction = "偏高" if stats["skewness"] < -1 else "偏低"
        issues.append(f"偏度过大({stats['skewness']:.2f})，分数整体{direction}")
    if stats["kurtosis"] > 5:
        issues.append(f"峰度过高({stats['kurtosis']:.2f})，分数过于尖峰集中")
    if stats["range_usage"] < 0.5:
        issues.append(f"分数范围利用率低({stats['range_usage']:.0%})，仅使用了{int(stats['range_usage']*10)}个分值")
    if stats["max"] - stats["min"] < 4:
        issues.append(f"极差过小({stats['max'] - stats['min']})，高低分差距不够")

    if not issues:
        return "PASS", []
    elif len(issues) <= 1 and stats["std"] >= 1.0:
        return "MARGINAL", issues
    else:
        return "FAIL", issues


def main():
    print("=" * 70)
    print("高考作文评分分布分析报告")
    print("=" * 70)

    all_pass = True
    for dim_key, dim_cn in DIMENSIONS.items():
        scores = load_scores(dim_key)
        if not scores:
            print(f"\n{dim_cn}: 无数据")
            continue

        stats = compute_stats(scores)
        verdict, issues = assess_quality(stats)

        print(f"\n{'─'*60}")
        print(f"维度: {dim_cn} ({dim_key})")
        print(f"{'─'*60}")
        print(f"  样本数: {stats['n']}")
        print(f"  均值: {stats['mean']:.2f}  标准差: {stats['std']:.2f}")
        print(f"  最小: {stats['min']}  最大: {stats['max']}  中位数: {stats['median']}")
        print(f"  偏度: {stats['skewness']:.2f}  峰度: {stats['kurtosis']:.2f}")
        print(f"  集中度(±1): {stats['concentration']:.0%}  分值利用率: {stats['range_usage']:.0%}")
        print(f"\n  分布:")
        for score_val in range(1, 11):
            count = stats["distribution"].get(score_val, 0)
            pct = count / stats["n"] * 100
            bar = "█" * count + "░" * (max(stats["distribution"].values()) - count) if count else ""
            print(f"    {score_val:2d}: {bar:30s} {count:3d} ({pct:4.1f}%)")

        status_icon = {"PASS": "✓", "MARGINAL": "~", "FAIL": "✗"}[verdict]
        print(f"\n  评估: [{status_icon}] {verdict}")
        if issues:
            for issue in issues:
                print(f"    - {issue}")
            all_pass = False

    print(f"\n{'='*70}")
    if all_pass:
        print("所有维度分布合格，Prompt无需调整。")
    else:
        print("存在分布不合格的维度，需要调整对应Prompt以提高区分度。")
    print(f"{'='*70}")

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
