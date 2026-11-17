import time


class Clock:
    """Seconds since epoch. Tests pass a FakeClock."""

    def now(self):
        return time.time()


class FakeClock(Clock):
    def __init__(self, t=1_700_000_000):
        self.t = t

    def now(self):
        return self.t

    def advance(self, secs):
        self.t += secs
