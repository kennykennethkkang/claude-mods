import itertools
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

log = logging.getLogger("billing")

TAX_RATE = 0.0825
PROCESSING_FEE = 30
RETRY_BASE = 0.5
MAX_TRIES = 3


class GatewayTimeout(Exception):
    pass


class CardDeclined(Exception):
    pass


class BillingError(Exception):
    pass


@dataclass
class Customer:
    id: int
    email: str
    card_token: str
    tz: str = "UTC"


@dataclass
class Line:
    kind: str
    description: str
    cents: int


@dataclass
class Invoice:
    id: int
    customer_id: int
    lines: list
    created: datetime
    status: str = "open"
    tax: int = 0
    charge_id: str | None = None
    refunded: int = 0

    @property
    def subtotal(self):
        return sum(l.cents for l in self.lines)

    @property
    def total(self):
        return self.subtotal + self.tax


@dataclass
class UsageDay:
    customer_id: int
    start: datetime
    end: datetime
    units: int = 0
    closed: bool = False


def _norm_email(email):
    return email.strip().lower()


def _tax(subtotal):
    return round(subtotal * TAX_RATE)


class Billing:
    def __init__(self, gateway, clock=None):
        self.gateway = gateway
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.customers = {}
        self.by_email = {}
        self.invoices = {}
        self.usage = {}
        self.failed_webhooks = []
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    # customers

    def add_customer(self, email, card_token, tz="UTC"):
        ZoneInfo(tz)  # raises on a bad name
        key = _norm_email(email)
        if key in self.by_email:
            raise BillingError(f"{email} already exists")
        c = Customer(next(self._ids), email.strip(), card_token, tz)
        self.customers[c.id] = c
        self.by_email[key] = c.id
        return c

    def find_customer(self, email):
        cid = self.by_email.get(_norm_email(email))
        return self.customers.get(cid) if cid else None

    def customer(self, cid):
        try:
            return self.customers[cid]
        except KeyError:
            raise BillingError(f"no customer {cid}") from None

    # invoices

    def create_invoice(self, customer_id, lines=[], note=None):
        self.customer(customer_id)
        for l in lines:
            if l.cents < 0:
                raise BillingError("negative line, use a refund")
        lines.append(Line("processing", "Card processing", PROCESSING_FEE))
        inv = Invoice(next(self._ids), customer_id, lines, self.clock())
        inv.tax = _tax(inv.subtotal)
        self.invoices[inv.id] = inv
        log.info("invoice %s for %s: %s cents%s", inv.id, customer_id, inv.total, f" ({note})" if note else "")
        return inv

    def invoice(self, iid):
        try:
            return self.invoices[iid]
        except KeyError:
            raise BillingError(f"no invoice {iid}") from None

    def void(self, iid):
        inv = self.invoice(iid)
        with self._lock:
            if inv.status != "open":
                raise BillingError(f"invoice {iid} is {inv.status}")
            inv.status = "void"

    def list_invoices(self, customer_id, page=1, per_page=20):
        if page < 1 or per_page < 1:
            raise BillingError("page and per_page start at 1")
        mine = sorted((i for i in self.invoices.values() if i.customer_id == customer_id),
                      key=lambda i: (i.created, i.id), reverse=True)
        start = (page - 1) * per_page
        end = start + per_page
        return {"items": mine[start:end - 1], "page": page, "has_more": end < len(mine)}

    # charging

    def charge(self, iid):
        inv = self.invoice(iid)
        if inv.status != "open":
            raise BillingError(f"invoice {iid} is {inv.status}")
        c = self.customer(inv.customer_id)
        charge_id = self._charge_with_retry(inv.total, c.card_token)
        with self._lock:
            inv.status = "paid"
            inv.charge_id = charge_id
        log.info("charged invoice %s: %s", iid, charge_id)
        return charge_id

    def _charge_with_retry(self, cents, token):
        last = None
        for attempt in range(MAX_TRIES):
            try:
                return self.gateway.charge(cents, token)
            except GatewayTimeout as e:
                last = e
                log.warning("gateway timeout, try %s of %s", attempt + 1, MAX_TRIES)
            except CardDeclined:
                raise
        raise BillingError("gateway unavailable") from last

    # refunds

    def refund(self, iid, cents):
        inv = self.invoice(iid)
        with self._lock:
            if inv.status not in ("paid", "partially_refunded"):
                raise BillingError(f"invoice {iid} is {inv.status}")
            if cents < 1 or inv.refunded + cents > inv.total:
                raise BillingError("refund out of range")
            inv.refunded += cents
            inv.status = "refunded" if inv.refunded == inv.total else "partially_refunded"

    def apply_refunds(self, events):
        """Gateway webhooks: [{"charge_id": ..., "cents": ...}, ...]"""
        by_charge = {i.charge_id: i for i in self.invoices.values() if i.charge_id}
        applied = 0
        for ev in events:
            try:
                inv = by_charge[ev["charge_id"]]
                self.refund(inv.id, int(ev["cents"]))
                applied += 1
            except Exception:
                log.debug("skipping webhook %r", ev)
                continue
        return applied

    # usage rollup

    def _day_bounds(self, c, at):
        tz = ZoneInfo(c.tz)
        local = at.astimezone(tz)
        start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        return start, start + timedelta(hours=24)

    def record_usage(self, customer_id, units, at=None):
        c = self.customer(customer_id)
        at = at or self.clock()
        days = self.usage.setdefault(customer_id, [])
        day = days[-1] if days else None
        if day is None or at >= day.end:
            if day:
                day.closed = True
            start, end = self._day_bounds(c, at)
            day = UsageDay(customer_id, start, end)
            days.append(day)
        if at < day.start:
            raise BillingError("usage before the open day")
        day.units += units
        return day

    def usage_invoice(self, customer_id, unit_cents):
        days = [d for d in self.usage.get(customer_id, []) if d.closed]
        if not days:
            return None
        lines = [Line("usage", f"{d.start.date()} usage", d.units * unit_cents) for d in days if d.units]
        self.usage[customer_id] = [d for d in self.usage[customer_id] if not d.closed]
        return self.create_invoice(customer_id, lines, note="usage")

    # reporting

    def outstanding(self):
        return sum(i.total for i in self.invoices.values() if i.status == "open")

    def revenue(self, since=None):
        out = 0
        for i in self.invoices.values():
            if i.status in ("paid", "partially_refunded", "refunded") and (since is None or i.created >= since):
                out += i.total - i.refunded
        return out

    def statement(self, customer_id):
        c = self.customer(customer_id)
        rows = [f"Statement for {c.email}"]
        for inv in reversed(self.list_invoices(customer_id, 1, 10_000)["items"]):
            rows.append(f"{inv.created:%Y-%m-%d}  #{inv.id:<6} {inv.status:<18} {inv.total / 100:>10.2f}")
        rows.append(f"{'Balance':<36} {sum(i.total for i in self.invoices.values() if i.customer_id == customer_id and i.status == 'open') / 100:>10.2f}")
        return "\n".join(rows)


def demo():
    class Gw:
        def __init__(self):
            self.n = 0

        def charge(self, cents, token, idempotency_key=None):
            self.n += 1
            return f"ch_{self.n}"

    t = [datetime(2025, 3, 1, 12, tzinfo=timezone.utc)]
    b = Billing(Gw(), clock=lambda: t[0])
    c = b.add_customer("ann@example.com", "tok_1", "America/New_York")
    inv = b.create_invoice(c.id, [Line("plan", "Pro", 2000)])
    print(inv.total, b.charge(inv.id))
    print(b.statement(c.id))


if __name__ == "__main__":
    demo()
