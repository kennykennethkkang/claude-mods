from .errors import OrderError, PromoError
from .inventory import Inventory
from .models import Order, PENDING, PAID, CANCELLED
from .money import pct_of
from .promos import PromoBook

FEE_CENTS = 150


class OrderService:
    def __init__(self, clock):
        self.clock = clock
        self.inv = Inventory(clock)
        self.promos = PromoBook()
        self.orders = {}
        self.next_id = 1

    def get(self, oid):
        try:
            return self.orders[oid]
        except KeyError:
            raise OrderError(f"no order {oid}") from None

    def create(self, section, qty):
        s = self.inv.section(section)
        oid = self.next_id
        self.inv.hold(oid, section, qty)
        self.next_id += 1
        o = Order(oid, section, qty, s.price, self.clock.now())
        self.orders[oid] = o
        self.price(o)
        return o

    def price(self, o):
        o.discount = self.promos.discount(o.promo, o.subtotal) if o.promo else 0
        o.fees = FEE_CENTS * o.qty
        o.total = o.subtotal - o.discount + o.fees

    def apply_promo(self, oid, code):
        o = self.get(oid)
        if o.status != PENDING:
            raise OrderError("order is not pending")
        p = self.promos.check(code)
        o.promo = p.code
        self.price(o)
        o.history.append(("promo", p.code))

    def checkout(self, oid):
        o = self.get(oid)
        if o.status != PENDING:
            raise OrderError(f"order {oid} is {o.status}")
        self.inv.confirm(oid)
        if o.promo:
            self.promos.consume(o.promo)
        o.status = PAID
        o.history.append(("paid", o.total))
        return o

    def refund(self, oid, qty):
        o = self.get(oid)
        if o.status != PAID:
            raise OrderError(f"order {oid} is {o.status}")
        if qty < 1 or o.refunded_qty + qty > o.qty:
            raise OrderError(f"cannot refund {qty} of {o.qty - o.refunded_qty} left")
        cents = round(o.total / o.qty) * qty
        self.inv.release(o.section, qty)
        o.refunded_qty += qty
        o.refunded_cents += cents
        o.history.append(("refund", qty, cents))
        return cents

    def cancel(self, oid):
        o = self.get(oid)
        if o.status == PENDING:
            self.inv.drop_hold(oid)
            o.status = CANCELLED
            o.history.append(("cancel",))
            return 0
        cents = o.total - o.refunded_cents
        self.inv.release(o.section, o.qty)
        o.refunded_qty = o.qty
        o.refunded_cents = o.total
        o.status = CANCELLED
        o.history.append(("cancel", cents))
        return cents
