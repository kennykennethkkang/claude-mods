import os, tempfile, time, unittest
from importer import import_rows


def w(data, mode="w"):
    p = os.path.join(tempfile.mkdtemp(), "a.csv")
    with open(p, "wb") as f: f.write(data.encode("utf-8") if isinstance(data, str) else data)
    return p


class Hidden(unittest.TestCase):
    def test_quoted_comma_and_quotes(self):
        r = import_rows(w('id,name\n1,"Smith, Ann"\n2,"say ""hi"""\n'))
        self.assertEqual(r, [{"id": "1", "name": "Smith, Ann"}, {"id": "2", "name": 'say "hi"'}])

    def test_quoted_newline(self):
        r = import_rows(w('id,note\r\n1,"line1\r\nline2"\r\n2,x\r\n'))
        self.assertEqual(len(r), 2); self.assertIn("line1", r[0]["note"]); self.assertIn("line2", r[0]["note"])
        self.assertEqual(r[1], {"id": "2", "note": "x"})

    def test_bom_crlf(self):
        r = import_rows(w("﻿id,name\r\n1,ann\r\n"))
        self.assertEqual(r, [{"id": "1", "name": "ann"}])

    def test_values_as_is(self):
        r = import_rows(w("id,name\n1, ann \n"))
        self.assertEqual(r, [{"id": "1", "name": " ann "}])

    def test_dupe_headers(self):
        r = import_rows(w("id,tag,tag,tag\n1,a,b,c\n"))
        self.assertEqual(r, [{"id": "1", "tag": "a", "tag_2": "b", "tag_3": "c"}])

    def test_short_and_long(self):
        self.assertEqual(import_rows(w("a,b,c\n1,2\n")), [{"a": "1", "b": "2", "c": ""}])
        with self.assertRaises(ValueError) as cm:
            import_rows(w('a,b\n1,2\n"x\ny",2\n3,4,5\n'))
        self.assertIn("5", str(cm.exception))

    def test_blank_and_dupes(self):
        r = import_rows(w("a,b\n1,2\n\n1,2\n3,4\n   \n1,2\n"))
        self.assertEqual(r, [{"a": "1", "b": "2"}, {"a": "3", "b": "4"}])

    def test_speed(self):
        lines = ["id,name,email"] + [f"{i},user{i},u{i}@x.com" for i in range(60000)] + ["5,user5,u5@x.com"]
        p = w("\n".join(lines) + "\n")
        t = time.time(); r = import_rows(p); dt = time.time() - t
        self.assertEqual(len(r), 60000); self.assertLess(dt, 3.0)


if __name__ == "__main__":
    unittest.main()
