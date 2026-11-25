"""
Soak: 1000 users held for over an hour, to catch slow degradation (memory,
connection pools, growing collections) and to exercise the 50-minute ID token
refresh. 70 minutes. Use with: .\run.ps1 -Profile soak
"""

from _stages import StagedShape


class SoakProfile(StagedShape):
    stages = [
        (70 * 60, 1000, 10),   # ramp in 100 s, then hold
    ]
