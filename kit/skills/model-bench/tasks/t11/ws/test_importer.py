import os, tempfile, unittest
from importer import import_rows


class T(unittest.TestCase):
    def test_simple(self):
        p = os.path.join(tempfile.mkdtemp(), "a.csv")
        open(p, "w").write("id,name\n1,ann\n2,bob\n")
        self.assertEqual(import_rows(p), [{"id": "1", "name": "ann"}, {"id": "2", "name": "bob"}])


if __name__ == "__main__":
    unittest.main()
