"""
Spike: a quiet baseline, then 900 extra users arrive within about 20 seconds
(e.g. a push notification about an urgent duty), then back to baseline.
11 minutes. Use with: .\run.ps1 -Profile spike
"""

from _stages import StagedShape


class SpikeProfile(StagedShape):
    stages = [
        (3 * 60, 100, 10),     # 0-3 min: baseline
        (8 * 60, 1000, 50),    # 3-8 min: spike and hold
        (11 * 60, 100, 50),    # 8-11 min: recovery
    ]
