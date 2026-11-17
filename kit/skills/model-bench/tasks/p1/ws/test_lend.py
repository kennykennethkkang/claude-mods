import os
import tempfile
import unittest

from lend import Library
from lend.clock import FakeClock
from lend.errors import Unavailable, LimitReached


def lib(**kw):
    c = FakeClock("2026-01-05T10:00:00Z")
    b = Library(clock=c, **kw)
    b.add_member("m1", "Ann")
    b.add_member("m2", "Bo")
    b.add_item("b1", "Dune", "Frank Herbert")
    b.add_copy("b1", "c1")
    return b, c


class Starter(unittest.TestCase):
    def test_checkout_due_date(self):
        b, c = lib()
        loan = b.checkout("m1", "b1")
        self.assertEqual(loan["id"], "L1")
        self.assertEqual(loan["due"], "2026-01-26")
        self.assertEqual(b.item("b1")["available"], 0)

    def test_no_copy_left(self):
        b, c = lib()
        b.checkout("m1", "b1")
        with self.assertRaises(Unavailable):
            b.checkout("m2", "b1")

    def test_late_return_fine(self):
        b, c = lib()
        b.checkout("m1", "b1")
        c.set("2026-01-31T10:00:00Z")  # 5 days late, 2 grace
        self.assertEqual(b.return_copy("c1")["fine_cents"], 75)
        self.assertEqual(b.member("m1")["balance_cents"], 75)

    def test_hold_gets_returned_copy(self):
        b, c = lib()
        b.checkout("m1", "b1")
        h = b.place_hold("m2", "b1")
        self.assertEqual(h["status"], "waiting")
        b.return_copy("c1")
        self.assertEqual(b.hold(h["id"])["status"], "ready")
        self.assertEqual(b.checkout("m2", "b1")["barcode"], "c1")

    def test_renew_limit(self):
        b, c = lib()
        loan = b.checkout("m1", "b1")
        b.renew(loan["id"])
        self.assertEqual(b.renew(loan["id"])["due"], "2026-03-09")
        with self.assertRaises(LimitReached):
            b.renew(loan["id"])

    def test_search(self):
        b, c = lib()
        b.add_item("b2", "Dune Messiah", "Frank Herbert")
        r = b.search("dune")
        self.assertEqual([x["id"] for x in r["results"]], ["b1", "b2"])

    def test_reopen(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "db.json")
            b, c = lib(path=p)
            b.checkout("m1", "b1")
            again = Library(path=p, clock=c)
            self.assertEqual(again.loans()[0]["barcode"], "c1")


if __name__ == "__main__":
    unittest.main()
