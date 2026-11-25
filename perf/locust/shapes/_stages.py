"""Shared stage runner for the load profiles in this folder."""

from locust import LoadTestShape


class StagedShape(LoadTestShape):
    """
    Runs `stages` in order: each is (end_at_seconds, users, spawn_rate).
    The test stops after the last stage.
    """

    abstract = True
    stages = []

    def tick(self):
        run_time = self.get_run_time()
        for end_at, users, spawn_rate in self.stages:
            if run_time < end_at:
                return users, spawn_rate
        return None
