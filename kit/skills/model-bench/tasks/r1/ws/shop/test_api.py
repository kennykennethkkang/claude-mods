import unittest
from shop.repo import Repo
from shop.service import ItemService
from shop.api import handle


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.repo.add("apple", 1.0, 10, ["fruit"])
        self.repo.add("bread", 2.5, 5, ["bakery"])
        self.svc = ItemService(self.repo)

    def test_get_one(self):
        r = handle(self.svc, "GET", "/items/1")
        self.assertEqual(r["status"], 200)
        self.assertEqual(r["body"]["name"], "apple")

    def test_missing(self):
        self.assertEqual(handle(self.svc, "GET", "/items/99")["status"], 404)
        self.assertEqual(handle(self.svc, "GET", "/items/x")["status"], 404)

    def test_method(self):
        self.assertEqual(handle(self.svc, "POST", "/items")["status"], 405)


if __name__ == "__main__":
    unittest.main()
