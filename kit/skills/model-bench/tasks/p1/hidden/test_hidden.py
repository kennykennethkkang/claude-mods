import json
import os
import subprocess
import sys
import tempfile
import textwrap
import threading
import unittest
from unittest import mock

from lend import Library, KINDS
from lend.clock import FakeClock
from lend.errors import (ValidationError, NotFound, Conflict, LimitReached,
                         Unavailable, Blocked, SchemaError, LendError)

HERE = os.path.dirname(os.path.abspath(__file__))
T0 = "2026-01-05T10:00:00Z"


def base(**kw):
    c = kw.pop("clock", None) or FakeClock(T0)
    b = Library(clock=c, **kw)
    b.add_member("m1", "Ann")
    b.add_member("m2", "Bo")
    b.add_item("b1", "Dune", "Frank Herbert")
    b.add_copy("b1", "c1")
    return b, c


def tmpdb(t):
    d = tempfile.TemporaryDirectory()
    t.addCleanup(d.cleanup)
    return d.name, os.path.join(d.name, "db.json")


class Validation(unittest.TestCase):
    def test_member_rules(self):
        b, c = base()
        for bad in ["", "a b", "x" * 33, "é1", None]:
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                b.add_member(bad, "Name")
        with self.assertRaises(ValidationError):
            b.add_member("m9", "   ")
        with self.assertRaises(ValidationError):
            b.add_member("m9", "N", max_loans=True)
        with self.assertRaises(ValidationError):
            b.add_member("m9", "N", max_loans=0)
        with self.assertRaises(Conflict):
            b.add_member("m1", "Again")
        self.assertEqual(b.add_member("A-_9" + "x" * 28, "N")["id"], "A-_9" + "x" * 28)

    def test_member_dict(self):
        b, c = base()
        self.assertEqual(b.add_member("m3", "  Cy  ", max_loans=2),
                         {"id": "m3", "name": "Cy", "max_loans": 2, "active": True,
                          "balance_cents": 0, "open_loans": 0})
        with self.assertRaises(NotFound):
            b.member("nobody")

    def test_item_rules(self):
        b, c = base()
        with self.assertRaises(ValidationError):
            b.add_item("v1", "T", "A", kind="vhs")
        for y in [True, 999, 10000, "1965", 1965.0]:
            with self.subTest(year=y), self.assertRaises(ValidationError):
                b.add_item("y1", "T", "A", year=y)
        with self.assertRaises(ValidationError):
            b.add_item("y1", " ", "A")
        with self.assertRaises(ValidationError):
            b.add_item("y1", "T", "")
        with self.assertRaises(Conflict):
            b.add_item("b1", "T", "A")
        it = b.add_item("f1", " Foundation ", "Isaac Asimov", kind="dvd", year=1951,
                        tags=[" SciFi", "scifi", "", "Classic", "  "])
        self.assertEqual(it, {"id": "f1", "title": "Foundation", "author": "Isaac Asimov",
                              "kind": "dvd", "year": 1951, "tags": ["scifi", "classic"],
                              "copies": 0, "available": 0})

    def test_copy_rules(self):
        b, c = base()
        b.add_item("b2", "Emma", "Jane Austen")
        with self.assertRaises(Conflict):
            b.add_copy("b2", "c1")
        with self.assertRaises(NotFound):
            b.add_copy("zz", "c9")
        with self.assertRaises(ValidationError):
            b.add_copy("b2", "bad code")
        self.assertEqual(b.add_copy("b2", "c2"), "c2")
        self.assertEqual(b.item("b2")["copies"], 1)

    def test_kinds_table(self):
        self.assertEqual(KINDS["book"], {"loan_days": 21, "max_renewals": 2,
                                         "daily_fine_cents": 25, "max_fine_cents": 1000})
        self.assertEqual(KINDS["dvd"]["max_fine_cents"], 500)
        self.assertEqual(KINDS["magazine"]["max_renewals"], 0)

    def test_bad_tz(self):
        with self.assertRaises(ValidationError):
            Library(clock=FakeClock(T0), tz="Mars/Olympus")

    def test_errors_are_lend_errors(self):
        for e in [ValidationError, NotFound, Conflict, LimitReached, Unavailable, Blocked, SchemaError]:
            self.assertTrue(issubclass(e, LendError))


class Checkout(unittest.TestCase):
    def test_loan_dict(self):
        b, c = base()
        self.assertEqual(b.checkout("m1", "b1"),
                         {"id": "L1", "member": "m1", "item": "b1", "barcode": "c1",
                          "start": "2026-01-05T10:00:00Z", "due": "2026-01-26",
                          "renewals": 0, "returned": None, "fine_cents": 0})
        self.assertEqual(b.member("m1")["open_loans"], 1)

    def test_smallest_barcode_string_order(self):
        b, c = base()
        b.add_item("b2", "Emma", "Jane Austen")
        for bc in ["c9", "c10", "c2"]:
            b.add_copy("b2", bc)
        self.assertEqual(b.checkout("m1", "b2")["barcode"], "c10")
        self.assertEqual(b.checkout("m2", "b2")["barcode"], "c2")

    def test_not_found(self):
        b, c = base()
        with self.assertRaises(NotFound):
            b.checkout("m1", "zz")
        with self.assertRaises(NotFound):
            b.checkout("zz", "b1")

    def test_conflict_before_limit(self):
        b, c = base()
        b.add_member("m3", "Cy", max_loans=1)
        b.add_copy("b1", "c2")
        b.add_item("b2", "Emma", "Jane Austen")
        b.add_copy("b2", "e1")
        b.checkout("m3", "b1")
        with self.assertRaises(Conflict):
            b.checkout("m3", "b1")
        with self.assertRaises(LimitReached):
            b.checkout("m3", "b2")

    def test_limit_before_unavailable(self):
        b, c = base()
        b.add_member("m3", "Cy", max_loans=1)
        b.add_item("b2", "Emma", "Jane Austen")
        b.checkout("m3", "b1")
        with self.assertRaises(LimitReached):
            b.checkout("m3", "b2")
        with self.assertRaises(Unavailable):
            b.checkout("m1", "b2")

    def test_inactive_blocked_before_unavailable(self):
        b, c = base()
        b.add_member("m3", "Cy")
        b.deactivate_member("m3")
        b.checkout("m1", "b1")
        with self.assertRaises(Blocked):
            b.checkout("m3", "b1")

    def test_due_uses_local_date(self):
        c = FakeClock("2026-01-01T03:00:00Z")  # 2025-12-31 22:00 in New York
        b, _ = base(clock=c, tz="America/New_York")
        self.assertEqual(b.checkout("m1", "b1")["due"], "2026-01-21")
        b2, _ = base(clock=FakeClock("2026-01-01T03:00:00Z"))
        self.assertEqual(b2.checkout("m1", "b1")["due"], "2026-01-22")

    def test_balance_at_threshold_blocks(self):
        b, c = base()
        b.add_item("b2", "Emma", "Jane Austen")
        b.add_copy("b2", "e1")
        b.checkout("m1", "b1")
        c.set("2026-03-20T10:00:00Z")
        self.assertEqual(b.return_copy("c1")["fine_cents"], 1000)
        with self.assertRaises(Blocked):
            b.checkout("m1", "b2")
        with self.assertRaises(Blocked):
            b.place_hold("m1", "b2")
        self.assertEqual(b.pay("m1", 1), 999)
        self.assertEqual(b.checkout("m1", "b2")["barcode"], "e1")

    def test_block_threshold_setting(self):
        b, c = base(block_cents=50)
        b.add_item("b2", "Emma", "Jane Austen")
        b.add_copy("b2", "e1")
        b.checkout("m1", "b1")
        c.set("2026-01-31T10:00:00Z")
        b.return_copy("c1")  # 75
        with self.assertRaises(Blocked):
            b.checkout("m1", "b2")


class Renew(unittest.TestCase):
    def test_from_old_due(self):
        b, c = base()
        loan = b.checkout("m1", "b1")
        c.advance(days=10)
        r = b.renew(loan["id"])
        self.assertEqual((r["due"], r["renewals"]), ("2026-02-16", 1))

    def test_waiting_hold_blocks(self):
        b, c = base()
        loan = b.checkout("m1", "b1")
        b.place_hold("m2", "b1")
        with self.assertRaises(Unavailable):
            b.renew(loan["id"])

    def test_ready_hold_elsewhere_does_not_block(self):
        b, c = base()
        b.add_member("m3", "Cy")
        b.add_copy("b1", "c2")
        loan = b.checkout("m1", "b1")
        b.checkout("m3", "b1")
        h = b.place_hold("m2", "b1")
        with self.assertRaises(Unavailable):
            b.renew(loan["id"])
        b.return_copy("c2")
        self.assertEqual(b.hold(h["id"])["barcode"], "c2")
        self.assertEqual(b.renew(loan["id"])["due"], "2026-02-16")

    def test_grace_window(self):
        for day, ok in [("2026-01-28", True), ("2026-01-29", False)]:
            with self.subTest(day=day):
                b, c = base()
                loan = b.checkout("m1", "b1")
                c.set(day + "T10:00:00Z")
                if ok:
                    self.assertEqual(b.renew(loan["id"])["due"], "2026-02-16")
                else:
                    with self.assertRaises(Blocked):
                        b.renew(loan["id"])

    def test_returned_and_unknown(self):
        b, c = base()
        loan = b.checkout("m1", "b1")
        b.return_copy("c1")
        with self.assertRaises(Conflict):
            b.renew(loan["id"])
        with self.assertRaises(NotFound):
            b.renew("L99")

    def test_magazine_limit_before_hold(self):
        b, c = base()
        b.add_item("g1", "Wired", "Various", kind="magazine")
        b.add_copy("g1", "w1")
        loan = b.checkout("m1", "g1")
        self.assertEqual(loan["due"], "2026-01-12")
        b.place_hold("m2", "g1")
        with self.assertRaises(LimitReached):
            b.renew(loan["id"])

    def test_balance_blocks_renew(self):
        b, c = base()
        for i in (1, 2):
            b.add_item(f"d{i}", f"Film {i}", "Dir", kind="dvd")
            b.add_copy(f"d{i}", f"dv{i}")
            b.checkout("m1", f"d{i}")
        c.set("2026-02-20T10:00:00Z")
        loan = b.checkout("m1", "b1")
        self.assertEqual(loan["due"], "2026-03-13")
        self.assertEqual(b.return_copy("dv1")["fine_cents"], 500)
        b.return_copy("dv2")
        self.assertEqual(b.member("m1")["balance_cents"], 1000)
        with self.assertRaises(Blocked):
            b.renew(loan["id"])
        b.pay("m1", 1)
        self.assertEqual(b.renew(loan["id"])["due"], "2026-04-03")


class Fines(unittest.TestCase):
    def test_within_grace_free(self):
        b, c = base()
        b.checkout("m1", "b1")
        c.set("2026-01-28T10:00:00Z")
        self.assertEqual(b.return_copy("c1")["fine_cents"], 0)

    def test_dvd_cap(self):
        b, c = base()
        b.add_item("d1", "Film", "Dir", kind="dvd")
        b.add_copy("d1", "dv1")
        self.assertEqual(b.checkout("m1", "d1")["due"], "2026-01-12")
        c.set("2026-01-17T10:00:00Z")  # 5 late, 3 chargeable
        self.assertEqual(b.return_copy("dv1")["fine_cents"], 300)
        b.checkout("m2", "d1")
        c.set("2026-02-20T10:00:00Z")
        self.assertEqual(b.return_copy("dv1")["fine_cents"], 500)

    def test_cap_across_renewals(self):
        b, c = base()
        loan = b.checkout("m1", "b1")
        b.renew(loan["id"])
        self.assertEqual(b.renew(loan["id"])["due"], "2026-03-09")
        c.set("2026-03-14T10:00:00Z")
        self.assertEqual(b.return_copy("c1")["fine_cents"], 75)
        loan = b.checkout("m2", "b1")  # due 2026-04-04
        b.renew(loan["id"])
        b.renew(loan["id"])
        c.set("2026-09-01T10:00:00Z")
        r = b.return_copy("c1")
        self.assertEqual((r["fine_cents"], r["renewals"]), (1000, 2))
        self.assertEqual(b.member("m2")["balance_cents"], 1000)

    def test_fine_local_date(self):
        c = FakeClock("2026-01-05T15:00:00Z")
        b, _ = base(clock=c, tz="America/New_York")
        b.checkout("m1", "b1")
        c.set("2026-01-30T03:00:00Z")  # Jan 29 22:00 local, 3 late
        r = b.return_copy("c1")
        self.assertEqual(r["fine_cents"], 25)
        self.assertEqual(r["returned"], "2026-01-30T03:00:00Z")

    def test_grace_setting(self):
        b, c = base(grace_days=0)
        b.checkout("m1", "b1")
        c.set("2026-01-27T10:00:00Z")
        self.assertEqual(b.return_copy("c1")["fine_cents"], 25)

    def test_return_errors(self):
        b, c = base()
        with self.assertRaises(NotFound):
            b.return_copy("nope")
        with self.assertRaises(Conflict):
            b.return_copy("c1")

    def test_pay_rules(self):
        b, c = base()
        b.checkout("m1", "b1")
        c.set("2026-01-31T10:00:00Z")
        b.return_copy("c1")
        for bad in [0, -5, 76, True, 1.0, "10"]:
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                b.pay("m1", bad)
        self.assertEqual(b.pay("m1", 25), 50)
        self.assertEqual(b.pay("m1", 50), 0)
        with self.assertRaises(NotFound):
            b.pay("zz", 1)

    def test_overdue_order_and_amounts(self):
        b, c = base()
        b.add_member("m9", "Many", max_loans=20)
        for i in range(11):
            b.add_item(f"k{i}", f"T{i}", "A")
            b.add_copy(f"k{i}", f"x{i}")
            b.checkout("m9", f"k{i}")
        c.set("2026-01-10T10:00:00Z")
        b.add_item("d1", "Film", "Dir", kind="dvd")
        b.add_copy("d1", "dv1")
        b.checkout("m9", "d1")  # L12, due 2026-01-17
        c.set("2026-01-26T10:00:00Z")
        self.assertEqual([x["id"] for x in b.overdue()], ["L12"])
        c.set("2026-01-29T10:00:00Z")
        od = b.overdue()
        self.assertEqual([x["id"] for x in od], ["L12"] + [f"L{i}" for i in range(1, 12)])
        self.assertEqual((od[0]["days_late"], od[0]["fine_cents"]), (12, 500))
        self.assertEqual((od[1]["days_late"], od[1]["fine_cents"]), (3, 25))
        self.assertIsNone(od[1]["returned"])
        b.return_copy("x0")
        self.assertNotIn("L1", [x["id"] for x in b.overdue()])

    def test_loans_listing(self):
        b, c = base()
        b.add_member("m9", "Many", max_loans=20)
        for i in range(11):
            b.add_item(f"k{i}", f"T{i}", "A")
            b.add_copy(f"k{i}", f"x{i}")
            b.checkout("m9", f"k{i}")
        b.return_copy("x1")
        self.assertEqual([x["id"] for x in b.loans()], ["L1"] + [f"L{i}" for i in range(3, 12)])
        self.assertEqual([x["id"] for x in b.loans(open_only=False)][:3], ["L1", "L2", "L3"])
        self.assertEqual(len(b.loans(member_id="m1")), 0)
        self.assertEqual(len(b.loans(member_id="m9", open_only=False)), 11)


class Holds(unittest.TestCase):
    def test_queue_order(self):
        b, c = base()
        for m in ["m3", "m4", "m5"]:
            b.add_member(m, m.upper())
        b.checkout("m1", "b1")
        b.place_hold("m2", "b1")
        c.advance(hours=1)
        b.place_hold("m3", "b1", priority=True)
        b.place_hold("m4", "b1")
        c.advance(hours=1)
        b.place_hold("m5", "b1", priority=True)
        q = b.queue("b1")
        self.assertEqual([(h["member"], h["position"]) for h in q],
                         [("m3", 1), ("m5", 2), ("m2", 3), ("m4", 4)])
        self.assertEqual(q[0]["id"], "H2")
        with self.assertRaises(NotFound):
            b.queue("zz")

    def test_hold_dict_and_ready_at_once(self):
        b, c = base()
        h = b.place_hold("m2", "b1")
        self.assertEqual(h, {"id": "H1", "member": "m2", "item": "b1", "priority": False,
                             "placed": T0, "status": "ready", "barcode": "c1",
                             "ready_until": "2026-01-08"})
        self.assertEqual(b.item("b1")["available"], 0)
        with self.assertRaises(Unavailable):
            b.checkout("m1", "b1")
        self.assertEqual(b.queue("b1"), [])

    def test_waiting_hold_dict(self):
        b, c = base()
        b.checkout("m1", "b1")
        h = b.place_hold("m2", "b1", priority=True)
        self.assertEqual((h["status"], h["barcode"], h["ready_until"], h["priority"]),
                         ("waiting", None, None, True))

    def test_place_rules(self):
        b, c = base()
        b.checkout("m1", "b1")
        with self.assertRaises(Conflict):
            b.place_hold("m1", "b1")
        h = b.place_hold("m2", "b1")
        with self.assertRaises(Conflict):
            b.place_hold("m2", "b1")
        with self.assertRaises(NotFound):
            b.place_hold("m2", "zz")
        b.add_member("m3", "Cy")
        b.deactivate_member("m3")
        with self.assertRaises(Blocked):
            b.place_hold("m3", "b1")
        self.assertEqual(b.cancel_hold(h["id"])["status"], "cancelled")
        self.assertEqual(b.place_hold("m2", "b1")["id"], "H2")

    def test_expiry_and_handoff(self):
        b, c = base()
        b.add_member("m3", "Cy")
        b.checkout("m1", "b1")
        h1 = b.place_hold("m2", "b1")
        h2 = b.place_hold("m3", "b1")
        b.return_copy("c1")
        self.assertEqual(b.hold(h1["id"])["ready_until"], "2026-01-08")
        c.set("2026-01-08T23:00:00Z")
        self.assertEqual(b.hold(h1["id"])["status"], "ready")
        c.set("2026-01-09T10:00:00Z")
        x = b.hold(h1["id"])
        self.assertEqual((x["status"], x["barcode"]), ("expired", "c1"))
        y = b.hold(h2["id"])
        self.assertEqual((y["status"], y["ready_until"]), ("ready", "2026-01-12"))
        with self.assertRaises(Unavailable):
            b.checkout("m2", "b1")

    def test_expiry_audit_before_own_entry(self):
        b, c = base()
        b.add_member("m3", "Cy")
        b.checkout("m1", "b1")
        b.place_hold("m2", "b1")
        b.place_hold("m3", "b1")
        b.return_copy("c1")
        c.set("2026-01-09T10:00:00Z")
        b.add_member("m9", "Late")
        tail = [(e["action"], e["ref"]) for e in b.audit()[-3:]]
        self.assertEqual(tail, [("hold_expired", "H1"), ("hold_ready", "H2"), ("add_member", "m9")])
        self.assertEqual(b.audit()[-1]["at"], "2026-01-09T10:00:00Z")

    def test_expiry_local_date(self):
        c = FakeClock("2026-01-05T15:00:00Z")
        b, _ = base(clock=c, tz="America/New_York")
        h = b.place_hold("m2", "b1")
        self.assertEqual(h["ready_until"], "2026-01-08")
        c.set("2026-01-09T03:00:00Z")  # Jan 8 22:00 local
        self.assertEqual(b.item("b1")["available"], 0)
        c.set("2026-01-09T05:30:00Z")  # Jan 9 00:30 local
        self.assertEqual(b.item("b1")["available"], 1)
        self.assertEqual(b.hold(h["id"])["status"], "expired")

    def test_hold_days_setting(self):
        b, c = base(hold_days=1)
        self.assertEqual(b.place_hold("m2", "b1")["ready_until"], "2026-01-06")

    def test_cancel(self):
        b, c = base()
        b.add_member("m3", "Cy")
        b.checkout("m1", "b1")
        h1 = b.place_hold("m2", "b1")
        h2 = b.place_hold("m3", "b1")
        b.return_copy("c1")
        b.cancel_hold(h1["id"])
        self.assertEqual(b.hold(h2["id"])["status"], "ready")
        with self.assertRaises(Conflict):
            b.cancel_hold(h1["id"])
        with self.assertRaises(NotFound):
            b.cancel_hold("H99")
        b.checkout("m3", "b1")
        self.assertEqual(b.hold(h2["id"])["status"], "fulfilled")
        with self.assertRaises(Conflict):
            b.cancel_hold(h2["id"])

    def test_deactivate(self):
        b, c = base()
        b.add_member("m3", "Cy")
        b.checkout("m1", "b1")
        with self.assertRaises(Conflict):
            b.deactivate_member("m1")
        h1 = b.place_hold("m2", "b1")
        h2 = b.place_hold("m3", "b1")
        b.return_copy("c1")
        n = len(b.audit())
        b.deactivate_member("m2")
        self.assertEqual(b.hold(h1["id"])["status"], "cancelled")
        self.assertEqual(b.hold(h2["id"])["status"], "ready")
        self.assertFalse(b.member("m2")["active"])
        self.assertEqual([(e["action"], e["ref"]) for e in b.audit()[n:]],
                         [("deactivate_member", "m2"), ("hold_ready", "H2")])
        with self.assertRaises(Conflict):
            b.deactivate_member("m2")

    def test_new_copy_feeds_queue(self):
        b, c = base()
        b.checkout("m1", "b1")
        h = b.place_hold("m2", "b1")
        b.add_copy("b1", "c7")
        x = b.hold(h["id"])
        self.assertEqual((x["status"], x["barcode"]), ("ready", "c7"))
        self.assertEqual(b.audit()[-1]["action"], "hold_ready")
        self.assertEqual(b.audit()[-2]["action"], "add_copy")

    def test_checkout_uses_reserved_copy(self):
        b, c = base()
        b.add_member("m3", "Cy")
        b.add_item("b2", "Emma", "Jane Austen")
        b.add_copy("b2", "c5")
        b.checkout("m1", "b2")
        h = b.place_hold("m2", "b2")
        b.return_copy("c5")
        b.add_copy("b2", "c0")
        self.assertEqual(b.item("b2")["available"], 1)
        n = len(b.audit())
        self.assertEqual(b.checkout("m2", "b2")["barcode"], "c5")
        self.assertEqual([e["action"] for e in b.audit()[n:]], ["checkout"])
        x = b.hold(h["id"])
        self.assertEqual((x["status"], x["barcode"], x["ready_until"]), ("fulfilled", "c5", "2026-01-08"))
        self.assertEqual(b.checkout("m3", "b2")["barcode"], "c0")

    def test_ready_hold_respects_loan_limit(self):
        b, c = base()
        b.add_member("m3", "Cy", max_loans=1)
        b.add_item("b2", "Emma", "Jane Austen")
        b.add_copy("b2", "e1")
        b.place_hold("m3", "b1")
        b.checkout("m3", "b2")
        with self.assertRaises(LimitReached):
            b.checkout("m3", "b1")


class Search(unittest.TestCase):
    def lib(self):
        b = Library(clock=FakeClock(T0))
        b.add_item("s1", "Dune", "Frank Herbert")
        b.add_item("s2", "Dune Messiah", "Frank Herbert")
        b.add_item("s3", "The Duel", "Dunn Smith")
        return b

    def rs(self, r):
        return [(x["id"], x["score"]) for x in r["results"]]

    def test_prefix_scores(self):
        r = self.lib().search("dun")
        self.assertEqual(self.rs(r), [("s1", 3), ("s2", 3), ("s3", 2)])
        self.assertEqual((r["total"], r["page"], r["pages"]), (3, 1, 1))
        self.assertEqual(set(r["results"][0]), {"id", "title", "author", "score"})

    def test_all_tokens_and_bonus(self):
        b = self.lib()
        self.assertEqual(self.rs(b.search("Frank DUNE")), [("s1", 9), ("s2", 9)])
        self.assertEqual(self.rs(b.search("dune messiah")), [("s2", 11)])
        self.assertEqual(self.rs(b.search("dune dune")), [("s1", 6), ("s2", 5)])
        r = b.search("dune zzz")
        self.assertEqual((r["total"], r["pages"], r["results"]), (0, 0, []))

    def test_accents_casefold(self):
        b = Library(clock=FakeClock(T0))
        b.add_item("a1", "Café-Noir", "Zoë Ångström")
        b.add_item("a2", "Straße", "Max Muster")
        self.assertEqual(self.rs(b.search("CAFE noir")), [("a1", 11)])
        self.assertEqual(self.rs(b.search("angstrom")), [("a1", 4)])
        self.assertEqual(self.rs(b.search("zo")), [("a1", 2)])
        self.assertEqual(self.rs(b.search("strasse")), [("a2", 6)])

    def test_tags(self):
        b = Library(clock=FakeClock(T0))
        b.add_item("t1", "Foundation", "Isaac Asimov", tags=["Science Fiction"])
        self.assertEqual(self.rs(b.search("fiction")), [("t1", 2)])
        self.assertEqual(b.search("fic")["total"], 0)
        self.assertEqual(self.rs(b.search("found science")), [("t1", 5)])

    def test_tie_order(self):
        b = Library(clock=FakeClock(T0))
        b.add_item("z1", "Same", "Ann")
        b.add_item("a1", "Same", "Ann")
        b.add_item("x1", "banana Split", "Ann")
        b.add_item("x2", "Apple pie", "Ann")
        self.assertEqual([x["id"] for x in b.search("ann")["results"]], ["x2", "x1", "a1", "z1"])

    def test_pagination(self):
        b = Library(clock=FakeClock(T0))
        for i in range(25, 0, -1):
            b.add_item(f"v{i:02d}", f"Vol {i:02d}", "A")
        r = b.search("vol", page=3, per_page=10)
        self.assertEqual([x["id"] for x in r["results"]], [f"v{i}" for i in range(21, 26)])
        self.assertEqual((r["total"], r["page"], r["pages"]), (25, 3, 3))
        r = b.search("vol", page=4, per_page=10)
        self.assertEqual((r["results"], r["pages"], r["page"]), ([], 3, 4))
        self.assertEqual(len(b.search("vol")["results"]), 10)

    def test_bad_args(self):
        b = self.lib()
        for kw in [dict(page=0), dict(per_page=0), dict(per_page=101), dict(page=True), dict(page="1")]:
            with self.subTest(kw=kw), self.assertRaises(ValidationError):
                b.search("dune", **kw)
        with self.assertRaises(ValidationError):
            b.search("  --- ")

    def test_filters(self):
        b, c = base()
        b.add_item("d1", "Dune", "David Lynch", kind="dvd")
        self.assertEqual([x["id"] for x in b.search("dune", kind="dvd")["results"]], ["d1"])
        self.assertEqual([x["id"] for x in b.search("dune", available_only=True)["results"]], ["b1"])
        b.checkout("m1", "b1")
        self.assertEqual(b.search("dune", available_only=True)["total"], 0)


class Persistence(unittest.TestCase):
    def test_reopen_keeps_everything(self):
        d, p = tmpdb(self)
        b, c = base(path=p)
        b.add_member("m3", "Cy")
        b.checkout("m1", "b1")
        b.place_hold("m2", "b1")
        c.set("2026-01-31T10:00:00Z")
        b.return_copy("c1")
        with open(p) as f:
            self.assertEqual(json.load(f)["schema"], 2)
        r = Library(path=p, clock=c)
        self.assertEqual(r.member("m1")["balance_cents"], 75)
        self.assertEqual(r.hold("H1")["status"], "ready")
        self.assertEqual(r.place_hold("m3", "b1")["id"], "H2")
        self.assertEqual(r.checkout("m2", "b1")["id"], "L2")
        self.assertEqual([e["seq"] for e in r.audit()], list(range(1, len(r.audit()) + 1)))
        self.assertEqual(r.search("herbert")["results"][0]["id"], "b1")

    def test_failed_call_leaves_file(self):
        d, p = tmpdb(self)
        b, c = base(path=p)
        b.checkout("m1", "b1")
        before = open(p, "rb").read()
        n = len(b.audit())
        with self.assertRaises(Unavailable):
            b.checkout("m2", "b1")
        with self.assertRaises(ValidationError):
            b.add_item("x1", "T", "A", year=5)
        self.assertEqual(open(p, "rb").read(), before)
        self.assertEqual(len(b.audit()), n)

    def test_write_failure_rolls_back(self):
        d, p = tmpdb(self)
        b, c = base(path=p)
        before = open(p, "rb").read()
        with mock.patch("os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                b.add_member("m9", "Nine")
            with self.assertRaises(OSError):
                b.checkout("m1", "b1")
        self.assertEqual(open(p, "rb").read(), before)
        with self.assertRaises(NotFound):
            b.member("m9")
        self.assertEqual(b.item("b1")["available"], 1)
        self.assertEqual(b.audit()[-1]["action"], "add_copy")
        self.assertFalse([f for f in os.listdir(d) if f.endswith(".tmp")])
        self.assertEqual(b.checkout("m1", "b1")["id"], "L1")

    def test_only_expected_files(self):
        d, p = tmpdb(self)
        b, c = base(path=p)
        b.checkout("m1", "b1")
        b.search("dune")
        self.assertEqual(sorted(os.listdir(d)), ["db.json", "db.json.lock"])

    def test_bad_files(self):
        d, p = tmpdb(self)
        for body in ["{not json", "[1, 2]", '{"schema": 3}', '{"members": {}}', '"x"']:
            with self.subTest(body=body):
                with open(p, "w") as f:
                    f.write(body)
                with self.assertRaises(SchemaError):
                    Library(path=p, clock=FakeClock(T0))

    def test_expiry_on_read_is_saved(self):
        d, p = tmpdb(self)
        b, c = base(path=p)
        b.place_hold("m2", "b1")
        c.set("2026-01-10T10:00:00Z")
        self.assertEqual(b.hold("H1")["status"], "expired")
        with open(p) as f:
            self.assertIn("hold_expired", f.read())
        r = Library(path=p, clock=FakeClock("2026-01-05T10:00:00Z"))
        self.assertEqual(r.hold("H1")["status"], "expired")
        self.assertEqual(r.audit(action="hold_expired")[0]["ref"], "H1")


V1 = {"version": 1,
      "members": {"m1": {"name": "Ann", "fines": "1.50"}, "m2": {"name": "Bo", "fines": "0.5"},
                  "m3": {"name": "Cy", "fines": "2"}},
      "books": [{"id": "b1", "title": "Dune", "author": "Frank Herbert", "copies": ["c1", "c2"]},
                {"id": "b2", "title": "Children of Dune", "author": "Frank Herbert", "copies": ["c3"]}],
      "loans": [{"barcode": "c1", "member": "m1", "out": "2026-01-02", "due": "2026-01-23"},
                {"barcode": "c3", "member": "m2", "out": "2026-01-03", "due": "2026-01-24"}]}


class Migration(unittest.TestCase):
    def open(self, data=V1, tz="America/New_York"):
        d, p = tmpdb(self)
        raw = json.dumps(data).encode()
        with open(p, "wb") as f:
            f.write(raw)
        c = FakeClock(T0)
        return Library(path=p, clock=c, tz=tz), c, d, p, raw

    def test_migrates(self):
        b, c, d, p, raw = self.open()
        self.assertEqual([b.member(m)["balance_cents"] for m in ["m1", "m2", "m3"]], [150, 50, 200])
        self.assertEqual(b.member("m1")["max_loans"], 5)
        self.assertEqual(b.loans(), [
            {"id": "L1", "member": "m1", "item": "b1", "barcode": "c1", "start": "2026-01-02T05:00:00Z",
             "due": "2026-01-23", "renewals": 0, "returned": None, "fine_cents": 0},
            {"id": "L2", "member": "m2", "item": "b2", "barcode": "c3", "start": "2026-01-03T05:00:00Z",
             "due": "2026-01-24", "renewals": 0, "returned": None, "fine_cents": 0}])
        it = b.item("b1")
        self.assertEqual((it["kind"], it["year"], it["tags"], it["copies"], it["available"]),
                         ("book", None, [], 2, 1))
        self.assertEqual(b.audit(), [{"seq": 1, "at": T0, "action": "migrate", "ref": "v1"}])
        self.assertEqual(open(p + ".v1.bak", "rb").read(), raw)
        with open(p) as f:
            self.assertEqual(json.load(f)["schema"], 2)
        self.assertEqual(sorted(os.listdir(d)), ["db.json", "db.json.lock", "db.json.v1.bak"])

    def test_then_checkout_and_renew(self):
        b, c, d, p, raw = self.open()
        loan = b.checkout("m3", "b1")
        self.assertEqual((loan["id"], loan["barcode"]), ("L3", "c2"))
        self.assertEqual(b.renew("L1")["due"], "2026-02-13")
        r = Library(path=p, clock=c, tz="America/New_York")
        self.assertEqual(r.loans()[0]["renewals"], 1)
        self.assertEqual(len(r.audit(action="migrate")), 1)

    def test_then_fine(self):
        b, c, d, p, raw = self.open()
        c.set("2026-01-30T17:00:00Z")
        self.assertEqual(b.return_copy("c1")["fine_cents"], 125)
        self.assertEqual(b.member("m1")["balance_cents"], 275)

    def test_then_search(self):
        b, c, d, p, raw = self.open()
        r = b.search("dune")
        self.assertEqual([(x["id"], x["score"]) for x in r["results"]], [("b1", 6), ("b2", 5)])
        self.assertEqual(b.search("dune", available_only=True)["total"], 1)

    def test_schema_key_one(self):
        data = dict(V1)
        del data["version"]
        data["schema"] = 1
        b, c, d, p, raw = self.open(data)
        self.assertEqual(b.member("m3")["balance_cents"], 200)

    def test_bad_v1(self):
        for fines in ["1.505", "-1", "abc", ""]:
            data = json.loads(json.dumps(V1))
            data["members"]["m1"]["fines"] = fines
            with self.subTest(fines=fines), self.assertRaises(SchemaError):
                self.open(data)
        data = json.loads(json.dumps(V1))
        data["loans"][0]["barcode"] = "c99"
        with self.assertRaises(SchemaError):
            self.open(data)
        data = json.loads(json.dumps(V1))
        data["loans"][0]["member"] = "m99"
        with self.assertRaises(SchemaError):
            self.open(data)


class Audit(unittest.TestCase):
    def test_sequence(self):
        b, c = base()
        b.checkout("m1", "b1")
        b.place_hold("m2", "b1")
        c.advance(days=1)
        b.return_copy("c1")
        self.assertEqual(b.audit(), [
            {"seq": 1, "at": T0, "action": "add_member", "ref": "m1"},
            {"seq": 2, "at": T0, "action": "add_member", "ref": "m2"},
            {"seq": 3, "at": T0, "action": "add_item", "ref": "b1"},
            {"seq": 4, "at": T0, "action": "add_copy", "ref": "c1"},
            {"seq": 5, "at": T0, "action": "checkout", "ref": "L1"},
            {"seq": 6, "at": T0, "action": "place_hold", "ref": "H1"},
            {"seq": 7, "at": "2026-01-06T10:00:00Z", "action": "return", "ref": "L1"},
            {"seq": 8, "at": "2026-01-06T10:00:00Z", "action": "hold_ready", "ref": "H1"}])

    def test_filter_and_others(self):
        b, c = base()
        loan = b.checkout("m1", "b1")
        b.renew(loan["id"])
        h = b.place_hold("m2", "b1")
        b.cancel_hold(h["id"])
        c.set("2026-04-01T10:00:00Z")
        b.return_copy("c1")
        b.pay("m1", 10)
        self.assertEqual([e["ref"] for e in b.audit(action="add_member")], ["m1", "m2"])
        self.assertEqual([(e["action"], e["ref"]) for e in b.audit()[4:]],
                         [("checkout", "L1"), ("renew", "L1"), ("place_hold", "H1"),
                          ("cancel_hold", "H1"), ("return", "L1"), ("pay", "m1")])
        self.assertEqual(b.audit(action="nothing"), [])

    def test_failures_not_logged(self):
        b, c = base()
        n = len(b.audit())
        for f in [lambda: b.add_member("m1", "X"), lambda: b.checkout("zz", "b1"),
                  lambda: b.return_copy("c1"), lambda: b.pay("m1", 5)]:
            with self.assertRaises(LendError):
                f()
        self.assertEqual(len(b.audit()), n)


class Reports(unittest.TestCase):
    def test_loans_csv(self):
        clock = FakeClock(T0)
        b = Library(clock=clock)
        b.add_member("m1", 'Ann "The Reader", Jr.')
        b.add_member("m2", "-Bob")
        b.add_item("b1", "=SUM(A1)", "X")
        b.add_item("b2", "Plain\nText", "Y")
        b.add_copy("b1", "c1")
        b.add_copy("b2", "c2")
        b.checkout("m1", "b1")
        b.checkout("m2", "b2")
        clock.set("2026-01-31T10:00:00Z")
        b.return_copy("c1")
        self.assertEqual(b.report_csv("loans"),
                         "loan_id,member_id,member_name,item_id,title,barcode,start,due,returned,fine_cents\r\n"
                         'L1,m1,"Ann ""The Reader"", Jr.",b1,\'=SUM(A1),c1,2026-01-05,2026-01-26,2026-01-31,75\r\n'
                         'L2,m2,\'-Bob,b2,"Plain\nText",c2,2026-01-05,2026-01-26,,0\r\n')

    def test_loans_csv_order_and_local_dates(self):
        clock = FakeClock("2026-01-01T03:00:00Z")
        b = Library(clock=clock, tz="America/New_York")
        b.add_member("m9", "Many", max_loans=20)
        for i in range(11):
            b.add_item(f"k{i}", f"T{i}", "A")
            b.add_copy(f"k{i}", f"x{i}")
            b.checkout("m9", f"k{i}")
        rows = b.report_csv("loans").split("\r\n")
        self.assertEqual([r.split(",")[0] for r in rows[1:-1]], [f"L{i}" for i in range(1, 12)])
        self.assertEqual(rows[1].split(",")[6:8], ["2025-12-31", "2026-01-21"])

    def test_members_csv(self):
        b, c = base()
        b.add_member("m3", "@Cy")
        b.add_member("M0", "Zed")
        b.deactivate_member("m3")
        b.checkout("m2", "b1")
        self.assertEqual(b.report_csv("members"),
                         "member_id,name,active,open_loans,balance_cents\r\n"
                         "M0,Zed,yes,0,0\r\n"
                         "m1,Ann,yes,0,0\r\n"
                         "m2,Bo,yes,1,0\r\n"
                         "m3,'@Cy,no,0,0\r\n")
        with self.assertRaises(ValidationError):
            b.report_csv("holds")

    def test_stats(self):
        b, c = base()
        b.add_item("b2", "Emma", "Jane Austen")
        b.add_copy("b2", "e1")
        b.add_copy("b2", "e2")
        b.checkout("m1", "b1")
        b.place_hold("m2", "b1")
        self.assertEqual(b.stats(), {"members": 2, "items": 2, "copies": 3, "on_loan": 1, "overdue": 0,
                                     "holds_waiting": 1, "holds_ready": 0, "fines_outstanding_cents": 0})
        c.set("2026-01-31T10:00:00Z")
        self.assertEqual(b.stats()["overdue"], 1)
        b.return_copy("c1")
        s = b.stats()
        self.assertEqual((s["on_loan"], s["overdue"], s["holds_waiting"], s["holds_ready"],
                          s["fines_outstanding_cents"]), (0, 0, 0, 1, 75))


WORKER = textwrap.dedent("""
    import sys
    sys.path.insert(0, sys.argv[1])
    from lend import Library
    from lend.clock import FakeClock
    from lend.errors import Unavailable
    p, mode, tag = sys.argv[2], sys.argv[3], sys.argv[4]
    b = Library(path=p, clock=FakeClock("2026-01-05T10:00:00Z"))
    ok = 0
    for i in range(30 if mode == "add" else 10):
        if mode == "add":
            b.add_member(f"{tag}{i}", "N")
            ok += 1
        else:
            try:
                b.checkout(f"{tag}{i}", "b1")
                ok += 1
            except Unavailable:
                pass
    print(ok)
""")


class Concurrency(unittest.TestCase):
    def procs(self, d, p, mode, tags):
        w = os.path.join(d, "worker.py")
        with open(w, "w") as f:
            f.write(WORKER)
        ps = [subprocess.Popen([sys.executable, w, HERE, p, mode, t], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True) for t in tags]
        outs = [x.communicate(timeout=120) for x in ps]
        for x, (o, e) in zip(ps, outs):
            self.assertEqual(x.returncode, 0, e)
        os.remove(w)
        return [int(o) for o, e in outs]

    def test_threads(self):
        d, p = tmpdb(self)
        b = Library(path=p, clock=FakeClock(T0))

        def work(t):
            for i in range(25):
                b.add_member(f"t{t}x{i}", "N")
        ts = [threading.Thread(target=work, args=(t,)) for t in range(8)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(b.stats()["members"], 200)
        self.assertEqual([e["seq"] for e in b.audit()], list(range(1, 201)))
        self.assertEqual(Library(path=p, clock=FakeClock(T0)).stats()["members"], 200)

    def test_two_instances_one_file(self):
        d, p = tmpdb(self)
        c = FakeClock(T0)
        a = Library(path=p, clock=c)
        z = Library(path=p, clock=c)
        a.add_member("x", "X")
        z.add_member("y", "Y")
        self.assertEqual(a.member("y")["name"], "Y")
        z.add_item("b1", "Dune", "Frank Herbert")
        a.add_copy("b1", "c1")
        self.assertEqual(z.item("b1")["copies"], 1)
        a.checkout("x", "b1")
        with self.assertRaises(Unavailable):
            z.checkout("y", "b1")
        self.assertEqual([e["seq"] for e in z.audit()], [1, 2, 3, 4, 5])

    def test_processes_no_lost_update(self):
        d, p = tmpdb(self)
        Library(path=p, clock=FakeClock(T0))
        self.assertEqual(self.procs(d, p, "add", ["p", "q"]), [30, 30])
        b = Library(path=p, clock=FakeClock(T0))
        self.assertEqual(b.stats()["members"], 60)
        self.assertEqual([e["seq"] for e in b.audit()], list(range(1, 61)))

    def test_processes_share_copies(self):
        d, p = tmpdb(self)
        b = Library(path=p, clock=FakeClock(T0))
        b.add_item("b1", "Dune", "Frank Herbert")
        for i in range(5):
            b.add_copy("b1", f"c{i}")
        for t in "pq":
            for i in range(10):
                b.add_member(f"{t}{i}", "N")
        self.assertEqual(sum(self.procs(d, p, "loan", ["p", "q"])), 5)
        r = Library(path=p, clock=FakeClock(T0))
        loans = r.loans()
        self.assertEqual(len(loans), 5)
        self.assertEqual(sorted(x["barcode"] for x in loans), [f"c{i}" for i in range(5)])
        self.assertEqual(sorted(x["id"] for x in loans), [f"L{i}" for i in range(1, 6)])


class Cli(unittest.TestCase):
    def run_cli(self, p, *args, now=T0, tz=None):
        env = dict(os.environ, LEND_NOW=now)
        cmd = [sys.executable, "-m", "lend", "--db", p] + (["--tz", tz] if tz else []) + list(args)
        return subprocess.run(cmd, cwd=HERE, env=env, capture_output=True, timeout=60)

    def ok(self, p, *args, **kw):
        r = self.run_cli(p, *args, **kw)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_basic_flow(self):
        d, p = tmpdb(self)
        self.assertEqual(self.ok(p, "add-member", "m1", "Ann"),
                         (json.dumps({"id": "m1", "name": "Ann", "max_loans": 5, "active": True,
                                      "balance_cents": 0, "open_loans": 0}, sort_keys=True) + "\n").encode())
        it = json.loads(self.ok(p, "add-item", "b1", "Dune", "Frank Herbert", "--year", "1965",
                                "--tag", "SciFi", "--tag", "Classic"))
        self.assertEqual((it["year"], it["tags"], it["kind"]), (1965, ["scifi", "classic"], "book"))
        self.assertEqual(self.ok(p, "add-copy", "b1", "c1"), b'"c1"\n')
        loan = json.loads(self.ok(p, "checkout", "m1", "b1"))
        self.assertEqual((loan["id"], loan["due"], loan["start"]), ("L1", "2026-01-26", T0))
        self.assertEqual(json.loads(self.ok(p, "renew", "L1"))["due"], "2026-02-16")
        r = json.loads(self.ok(p, "return", "c1", now="2026-02-21T10:00:00Z"))
        self.assertEqual(r["fine_cents"], 75)

    def test_errors_and_usage(self):
        d, p = tmpdb(self)
        self.ok(p, "add-member", "m1", "Ann")
        self.ok(p, "add-member", "m2", "Bo")
        self.ok(p, "add-item", "b1", "Dune", "Frank Herbert")
        r = self.run_cli(p, "checkout", "m1", "b1")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout, b"")
        self.assertTrue(r.stderr.startswith(b"error: Unavailable: "), r.stderr)
        r = self.run_cli(p, "add-member", "m1", "Again")
        self.assertTrue(r.stderr.startswith(b"error: Conflict: "), r.stderr)
        self.assertEqual(self.run_cli(p, "frobnicate").returncode, 2)
        self.assertEqual(self.run_cli(p, "add-member", "m3", "Cy", "--max-loans", "lots").returncode, 2)

    def test_hold_search_report_stats(self):
        d, p = tmpdb(self)
        self.ok(p, "add-member", "m1", "Ann", "--max-loans", "2")
        self.ok(p, "add-member", "m2", "@Bob")
        self.ok(p, "add-item", "b1", "Dune", "Frank Herbert")
        self.ok(p, "add-item", "d1", "Dune", "David Lynch", "--kind", "dvd")
        self.ok(p, "add-copy", "b1", "c1")
        self.ok(p, "checkout", "m1", "b1")
        h = json.loads(self.ok(p, "hold", "m2", "b1", "--priority"))
        self.assertEqual((h["status"], h["priority"]), ("waiting", True))
        s = json.loads(self.ok(p, "search", "frank", "dune", "--per-page", "1"))
        self.assertEqual((s["total"], s["pages"], s["results"][0]["id"]), (1, 1, "b1"))
        s = json.loads(self.ok(p, "search", "dune", "--page", "2", "--per-page", "1"))
        self.assertEqual(s["results"][0]["id"], "d1")
        lib = Library(path=p, clock=FakeClock(T0))
        self.assertEqual(self.ok(p, "report", "members"), lib.report_csv("members").encode())
        self.assertIn(b"'@Bob", self.ok(p, "report", "members"))
        self.assertEqual(self.ok(p, "stats"), (json.dumps(lib.stats(), sort_keys=True) + "\n").encode())
        self.assertEqual(self.run_cli(p, "report", "nope").returncode, 1)

    def test_tz_flag(self):
        d, p = tmpdb(self)
        self.ok(p, "add-member", "m1", "Ann")
        self.ok(p, "add-item", "b1", "Dune", "Frank Herbert")
        self.ok(p, "add-copy", "b1", "c1")
        loan = json.loads(self.ok(p, "checkout", "m1", "b1", now="2026-01-01T03:00:00Z", tz="America/New_York"))
        self.assertEqual(loan["due"], "2026-01-21")


if __name__ == "__main__":
    unittest.main()
