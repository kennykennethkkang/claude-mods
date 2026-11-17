import unittest
from tix.api import BoxOffice
from tix.clock import FakeClock
from tix.errors import SoldOut


def office():
    b = BoxOffice(FakeClock())
    b.add_section("floor", 10, 2500)
    return b


class Basics(unittest.TestCase):
    def test_buy(self):
        b = office()
        oid = b.create_order("floor", 2)
        o = b.checkout(oid)
        self.assertEqual((o["status"], o["total"]), ("paid", 5300))
        self.assertEqual(b.available("floor"), 8)

    def test_hold_blocks(self):
        b = office()
        b.create_order("floor", 9)
        with self.assertRaises(SoldOut):
            b.create_order("floor", 2)

    def test_promo(self):
        b = office()
        b.add_promo("TENOFF", amount=1000)
        oid = b.create_order("floor", 1)
        self.assertEqual(b.apply_promo(oid, "tenoff")["total"], 1650)
        b.checkout(oid)
        self.assertEqual(b.promo_uses("TENOFF"), 1)

    def test_refund(self):
        b = office()
        oid = b.create_order("floor", 2)
        b.checkout(oid)
        self.assertEqual(b.refund(oid, 1), 2650)
        self.assertEqual(b.available("floor"), 9)


if __name__ == "__main__":
    unittest.main()
