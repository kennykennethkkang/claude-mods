from datetime import datetime, timedelta, timezone


def parse_utc(s):
    """'2026-01-05T10:00:00Z' -> aware UTC datetime."""
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


class SystemClock:
    def now(self):
        return datetime.now(timezone.utc).replace(microsecond=0)


class FakeClock:
    def __init__(self, start="2026-01-05T10:00:00Z"):
        self.t = parse_utc(start) if isinstance(start, str) else start

    def now(self):
        return self.t

    def advance(self, days=0, hours=0, seconds=0):
        self.t += timedelta(days=days, hours=hours, seconds=seconds)

    def set(self, s):
        self.t = parse_utc(s)
