import unittest
from tix.api import BoxOffice
from tix.clock import FakeClock
from tix.errors import SoldOut, PromoError, OrderError


def office(cap=10, price=1000):
    c = FakeClock()
    b = BoxOffice(c)
    b.add_section("hall", cap, price)
    return b, c


class Holds(unittest.TestCase):
    def test_expired_hold_checks_out_when_seats_free(self):
        b, c = office()
        oid = b.create_order("hall", 3)
        c.advance(700)
        self.assertEqual(b.checkout(oid)["status"], "paid")
        self.assertEqual(b.available("hall"), 7)

    def test_expired_hold_seats_gone(self):
        b, c = office(cap=4)
        o1 = b.create_order("hall", 3)
        c.advance(700)
        o2 = b.create_order("hall", 3)
        b.checkout(o2)
        with self.assertRaises(SoldOut):
            b.checkout(o1)
        self.assertEqual(b.order(o1)["status"], "pending")
        self.assertEqual(b.available("hall"), 1)

    def test_live_hold_takes_last_seats(self):
        b, c = office(cap=4)
        oid = b.create_order("hall", 4)
        c.advance(599)
        self.assertEqual(b.checkout(oid)["status"], "paid")
        self.assertEqual(b.available("hall"), 0)


class Promos(unittest.TestCase):
    def test_cap_rechecked_at_checkout(self):
        b, _ = office()
        b.add_promo("ONE", percent=20, max_uses=1)
        o1 = b.create_order("hall", 1)
        o2 = b.create_order("hall", 1)
        b.apply_promo(o1, "ONE")
        b.apply_promo(o2, "ONE")
        b.checkout(o1)
        with self.assertRaises(PromoError):
            b.checkout(o2)
        self.assertEqual(b.promo_uses("ONE"), 1)
        self.assertEqual(b.order(o2)["status"], "pending")
        self.assertEqual(b.available("hall"), 8)

    def test_abandoned_order_uses_nothing(self):
        b, _ = office()
        b.add_promo("ONE", amount=100, max_uses=1)
        o1 = b.create_order("hall", 1)
        b.apply_promo(o1, "ONE")
        b.cancel(o1)
        o2 = b.create_order("hall", 1)
        b.apply_promo(o2, "ONE")
        self.assertEqual(b.promo_uses("ONE"), 0)
        b.checkout(o2)
        self.assertEqual(b.promo_uses("ONE"), 1)
        with self.assertRaises(PromoError):
            b.apply_promo(b.create_order("hall", 1), "ONE")


class Money(unittest.TestCase):
    def test_percent_rounds_half_up(self):
        b, _ = office(price=1250)
        b.add_promo("P13", percent=13)
        oid = b.create_order("hall", 1)
        self.assertEqual(b.apply_promo(oid, "P13")["discount"], 163)
        b2, _ = office(price=1005)
        b2.add_promo("HALF", percent=50)
        oid = b2.create_order("hall", 1)
        self.assertEqual(b2.apply_promo(oid, "HALF")["discount"], 503)

    def test_amount_capped_at_subtotal(self):
        b, _ = office(price=500)
        b.add_promo("BIG", amount=10000)
        oid = b.create_order("hall", 1)
        o = b.apply_promo(oid, "BIG")
        self.assertEqual((o["discount"], o["total"]), (500, 150))

    def test_refunds_one_by_one_sum_to_total(self):
        b, _ = office()
        b.add_promo("C1", amount=1)
        oid = b.create_order("hall", 3)
        b.apply_promo(oid, "C1")
        total = b.checkout(oid)["total"]
        self.assertEqual(total, 3449)
        got = [b.refund(oid, 1) for _ in range(3)]
        self.assertEqual(got, [1150, 1150, 1149])
        self.assertEqual(sum(got), total)

    def test_refund_two_then_one(self):
        b, _ = office()
        b.add_promo("C1", amount=1)
        oid = b.create_order("hall", 3)
        b.apply_promo(oid, "C1")
        b.checkout(oid)
        self.assertEqual(b.refund(oid, 2), 2300)
        self.assertEqual(b.refund(oid, 1), 1149)
        self.assertEqual(b.order(oid)["status"], "cancelled")


class Cancel(unittest.TestCase):
    def test_cancel_after_partial_refund(self):
        b, _ = office()
        oid = b.create_order("hall", 3)
        b.checkout(oid)
        b.refund(oid, 1)
        self.assertEqual(b.cancel(oid), 2300)
        self.assertEqual(b.available("hall"), 10)

    def test_cancel_twice(self):
        b, _ = office()
        oid = b.create_order("hall", 2)
        b.checkout(oid)
        b.create_order("hall", 8)
        self.assertEqual(b.cancel(oid), 2300)
        self.assertEqual(b.cancel(oid), 0)
        self.assertEqual(b.available("hall"), 2)

    def test_cancel_after_full_refund(self):
        b, _ = office()
        oid = b.create_order("hall", 2)
        b.checkout(oid)
        b.refund(oid, 2)
        self.assertEqual(b.cancel(oid), 0)
        self.assertEqual(b.available("hall"), 10)
        with self.assertRaises(OrderError):
            b.refund(oid, 1)

    def test_sales_net(self):
        b, _ = office()
        b.add_promo("C1", amount=1)
        o1 = b.create_order("hall", 3)
        b.apply_promo(o1, "C1")
        b.checkout(o1)
        for _ in range(3):
            b.refund(o1, 1)
        b.cancel(o1)
        o2 = b.create_order("hall", 2)
        b.checkout(o2)
        r = b.sales()["hall"]
        self.assertEqual((r["sold"], r["gross"], r["refunded"], r["net"]), (2, 3449 + 2300, 3449, 2300))


class Group(unittest.TestCase):
    def test_group_discount(self):
        b, _ = office(cap=20)
        o = b.order(b.create_order("hall", 8))
        self.assertEqual((o["discount"], o["total"]), (800, 8400))
        self.assertEqual(b.order(b.create_order("hall", 7))["discount"], 0)

    def test_group_rounds_half_up(self):
        b, _ = office(cap=20, price=1255)
        o = b.order(b.create_order("hall", 9))
        self.assertEqual(o["discount"], 1130)

    def test_smaller_promo_ignored(self):
        b, _ = office(cap=20)
        b.add_promo("P5", percent=5, max_uses=1)
        oid = b.create_order("hall", 8)
        o = b.apply_promo(oid, "P5")
        self.assertEqual((o["discount"], o["promo"]), (800, None))
        b.checkout(oid)
        self.assertEqual(b.promo_uses("P5"), 0)

    def test_bigger_promo_wins(self):
        b, _ = office(cap=20)
        b.add_promo("P20", percent=20)
        oid = b.create_order("hall", 8)
        o = b.apply_promo(oid, "P20")
        self.assertEqual((o["discount"], o["promo"], o["total"]), (1600, "P20", 7600))
        b.checkout(oid)
        self.assertEqual(b.promo_uses("P20"), 1)


if __name__ == "__main__":
    unittest.main()
