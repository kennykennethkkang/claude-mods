import unittest
from shop.repo import Repo
from shop.service import ItemService
from shop.api import handle


def mk():
    repo = Repo()
    for n in range(1, 31):
        repo.add(f"Item{n:02d}", float(n), created=n % 7, tags=["even"] if n % 2 == 0 else ["odd"])
    return repo, ItemService(repo)


def walk(svc, **q):
    out, cur = [], None
    for _ in range(100):
        qq = dict(q)
        if cur: qq["cursor"] = cur
        r = handle(svc, "GET", "/items", qq)
        assert r["status"] == 200, r
        out += r["body"]["items"]; cur = r["body"]["next_cursor"]
        if cur is None: return out
    raise AssertionError("no end")


class Hidden(unittest.TestCase):
    def test_default_limit_and_order(self):
        repo, svc = mk()
        b = handle(svc, "GET", "/items")["body"]
        self.assertEqual(len(b["items"]), 20); self.assertIsNotNone(b["next_cursor"])
        keys = [(i["created"], i["id"]) for i in b["items"]]
        self.assertEqual(keys, sorted(keys))

    def test_walk_all(self):
        repo, svc = mk()
        got = walk(svc, limit="7")
        self.assertEqual(sorted(i["id"] for i in got), list(range(1, 31)))
        self.assertEqual(len(got), 30)

    def test_exact_last_page(self):
        repo, svc = mk()
        b = handle(svc, "GET", "/items", {"limit": "30"})["body"]
        self.assertEqual(len(b["items"]), 30); self.assertIsNone(b["next_cursor"])

    def test_stable_under_inserts(self):
        repo, svc = mk()
        r = handle(svc, "GET", "/items", {"limit": "10"})["body"]
        seen = [i["id"] for i in r["items"]]
        repo.add("early", 0.5, created=-1); repo.add("mid", 0.5, created=3)
        cur = r["next_cursor"]
        while cur:
            r = handle(svc, "GET", "/items", {"limit": "10", "cursor": cur})["body"]
            seen += [i["id"] for i in r["items"]]; cur = r["next_cursor"]
        self.assertEqual(len(seen), len(set(seen)))
        self.assertTrue(set(range(1, 31)) <= set(seen))

    def test_filters(self):
        repo, svc = mk()
        got = walk(svc, tag="even", min_price="10", max_price="20", limit="2")
        self.assertEqual(sorted(i["id"] for i in got), [10, 12, 14, 16, 18, 20])
        got = walk(svc, q="item0")
        self.assertEqual(sorted(i["id"] for i in got), list(range(1, 10)))
        got = walk(svc, q="ITEM3")
        self.assertEqual([i["id"] for i in got], [30])
        self.assertEqual(walk(svc, tag="nope"), [])

    def test_bad_params(self):
        repo, svc = mk()
        for q in [{"limit": "0"}, {"limit": "101"}, {"limit": "abc"}, {"limit": "2.5"},
                  {"min_price": "x"}, {"min_price": "5", "max_price": "1"},
                  {"cursor": "garbage"}, {"sort": "name"}]:
            r = handle(svc, "GET", "/items", q)
            self.assertEqual(r["status"], 400, q); self.assertIn("error", r["body"])

    def test_other_routes(self):
        repo, svc = mk()
        self.assertEqual(handle(svc, "GET", "/items/3")["body"]["id"], 3)
        self.assertEqual(handle(svc, "GET", "/items/999")["status"], 404)
        self.assertEqual(handle(svc, "PUT", "/items")["status"], 405)


if __name__ == "__main__":
    unittest.main()
