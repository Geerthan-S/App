"""
Prints a per-request table (count, errors, p50/p95/p99 latency, throughput)
for one or more JMeter result folders.

    python summarize.py ../results/baseline-10t-emulator-20261010-000300
    python summarize.py ../results/baseline-*        (compare several runs)
"""

import csv
import glob
import sys
from collections import defaultdict
from pathlib import Path


def percentile(sorted_values, p):
    if not sorted_values:
        return 0
    index = min(len(sorted_values) - 1, int(round(p / 100 * (len(sorted_values) - 1))))
    return sorted_values[index]


def summarize(folder):
    rows = list(csv.DictReader(open(Path(folder) / "results.jtl", encoding="utf-8")))
    by_label = defaultdict(list)
    for row in rows:
        by_label[row["label"]].append(row)

    print(f"\n{Path(folder).name}")
    print(f"{'request':48} {'count':>7} {'errors':>7} {'p50 ms':>7} {'p95 ms':>7} {'p99 ms':>7} {'req/s':>7}")
    for label, items in by_label.items():
        elapsed = sorted(int(r["elapsed"]) for r in items)
        errors = sum(r["success"] != "true" for r in items)
        stamps = [int(r["timeStamp"]) for r in items]
        span = max(1, (max(stamps) - min(stamps)) / 1000)
        rate = len(items) / span if len(items) > 1 else 0
        print(f"{label[:48]:48} {len(items):7} {errors:7} {percentile(elapsed, 50):7} "
              f"{percentile(elapsed, 95):7} {percentile(elapsed, 99):7} {rate:7.1f}")


if __name__ == "__main__":
    folders = [f for pattern in sys.argv[1:] for f in sorted(glob.glob(pattern))]
    if not folders:
        sys.exit("usage: python summarize.py <results folder> [...]")
    for folder in folders:
        summarize(folder)
