from .clock import Clock
from .money import fmt
from .orders import OrderService
from .report import sales_report


class BoxOffice:
    """What the box office app talks to."""

    def __init__(self, clock=None):
        self.svc = OrderService(clock or Clock())

    def add_section(self, name, capacity, price):
        self.svc.inv.add_section(name, capacity, price)

    def add_promo(self, code, percent=None, amount=None, max_uses=None):
        self.svc.promos.add(code, percent, amount, max_uses)

    def available(self, section):
        return self.svc.inv.available(section)

    def promo_uses(self, code):
        return self.svc.promos.get(code).uses

    def create_order(self, section, qty):
        return self.svc.create(section, qty).id

    def apply_promo(self, oid, code):
        self.svc.apply_promo(oid, code)
        return self.order(oid)

    def checkout(self, oid):
        self.svc.checkout(oid)
        return self.order(oid)

    def refund(self, oid, qty):
        return self.svc.refund(oid, qty)

    def cancel(self, oid):
        return self.svc.cancel(oid)

    def sales(self):
        return sales_report(self.svc)

    def order(self, oid):
        o = self.svc.get(oid)
        return {
            "id": o.id, "section": o.section, "qty": o.qty, "status": o.status, "promo": o.promo,
            "subtotal": o.subtotal, "discount": o.discount, "fees": o.fees, "total": o.total,
            "refunded_qty": o.refunded_qty, "refunded": o.refunded_cents,
        }

    def receipt(self, oid):
        o = self.order(oid)
        lines = [f"Order {o['id']}: {o['qty']} x {o['section']}", f"Subtotal {fmt(o['subtotal'])}"]
        if o["discount"]:
            lines.append(f"Discount -{fmt(o['discount'])}" + (f" ({o['promo']})" if o["promo"] else " (group)"))
        lines += [f"Fees {fmt(o['fees'])}", f"Total {fmt(o['total'])}"]
        if o["refunded"]:
            lines.append(f"Refunded {fmt(o['refunded'])}")
        return "\n".join(lines)
