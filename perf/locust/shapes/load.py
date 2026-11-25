"""
Load: step up to 1000 users and hold each level, to see where latency starts
to climb. 30 minutes. Use with: .\run.ps1 -Profile load
"""

from _stages import StagedShape


class LoadProfile(StagedShape):
    stages = [
        (5 * 60, 100, 10),     # 0-5 min: 100 users
        (15 * 60, 500, 10),    # 5-15 min: 500 users
        (30 * 60, 1000, 20),   # 15-30 min: 1000 users
    ]
