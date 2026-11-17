def pct_of(cents, pct):
    """pct percent of cents, rounded half up to the cent."""
    return round(cents * pct / 100)


def fmt(cents):
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}${cents // 100:,}.{cents % 100:02d}"
