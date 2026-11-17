from collections import defaultdict

from .models import PAID, CANCELLED
from .money import fmt


def sales_report(svc):
    """Per section: seats sold now, gross taken, refunded, net. Cents."""
    rows = defaultdict(lambda: {"sold": 0, "gross": 0, "refunded": 0, "net": 0, "orders": 0})
    for name, s in svc.inv.sections.items():
        rows[name]["sold"] = s.sold
    for o in svc.orders.values():
        if o.status not in (PAID, CANCELLED) or not any(h[0] == "paid" for h in o.history):
            continue
        r = rows[o.section]
        r["orders"] += 1
        r["gross"] += o.total
        r["refunded"] += o.refunded_cents
    for r in rows.values():
        r["net"] = r["gross"] - r["refunded"]
    return dict(rows)


def render(report):
    out = []
    for name in sorted(report):
        r = report[name]
        out.append(f"{name:<12} {r['sold']:>5} sold  {r['orders']:>4} orders  net {fmt(r['net'])}")
    total = sum(r["net"] for r in report.values())
    out.append(f"{'TOTAL':<12} net {fmt(total)}")
    return "\n".join(out)
