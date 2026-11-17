Build the library lending service described in SPEC.md, in full: the `lend` package (importable as `from lend import Library`) and its CLI (`python3 -m lend`). `lend/errors.py` and `lend/clock.py` are given; keep them and their names. Everything else is missing.

Python 3, standard library only. No dependencies. SPEC.md is the contract: every rule, ordering, format and edge case in it is tested, including how features interact (holds with renewals, fines with renewals, migration with search, several processes on one file).

test_lend.py has a few starter tests. Repo convention: tests use unittest, run with `python3 -m unittest`. Add your own tests as you go.
