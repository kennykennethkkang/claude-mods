#!/usr/bin/env python3
"""Checks for draft.py's echo and quote gate. run: python3 test_draft.py"""
import os, sys, unittest

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from draft import problems  # noqa: E402

SRC = {"notes.md": "Release 2.1 adds dark mode.\nFixes the login loop."}


class Gate(unittest.TestCase):
    def test_good_reply_passes(self):
        r = {"sources": ["notes.md"], "quotes": ["adds dark mode", "Fixes the login loop."], "draft": "x"}
        self.assertEqual(problems(r, SRC), [])

    def test_wrong_source_echo_fails(self):
        r = {"sources": ["other.md"], "quotes": ["adds dark mode"], "draft": "x"}
        self.assertTrue(problems(r, SRC))

    def test_made_up_quote_fails(self):
        r = {"sources": ["notes.md"], "quotes": ["adds light mode"], "draft": "x"}
        self.assertIn("quote not in source", problems(r, SRC)[0])

    def test_no_quotes_or_empty_draft_fails(self):
        self.assertTrue(problems({"sources": ["notes.md"], "quotes": [], "draft": "x"}, SRC))
        self.assertEqual(problems({"draft": " "}, {}), ["empty draft"])

    def test_no_sources_only_needs_a_draft(self):
        self.assertEqual(problems({"draft": "scaffold"}, {}), [])


if __name__ == "__main__":
    unittest.main()
