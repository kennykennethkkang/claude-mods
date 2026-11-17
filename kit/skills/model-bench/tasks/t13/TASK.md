Reports from the box office about tix/ (Python 3, stdlib only). README.md has the rules the app and finance rely on.

1. "We oversold the balcony on Saturday. More people had tickets than there are seats."
2. "LAUNCH20 is capped at 50 uses and the dashboard shows 53."
3. "Finance says the numbers are off by a cent here and there, and a fully refunded order does not net to zero."
4. "After some cancellations the hall showed more free seats than it has."

Feature: group discount. An order of `GROUP_MIN` (8) or more tickets gets `GROUP_PCT` (10) percent off the subtotal, rounded like other percent discounts. It never stacks with a promo code: the bigger discount wins. When the group discount is at least as big as the promo's, applying the code leaves the order as it is (its `promo` stays `None`) and no use of the code is consumed.

Put `GROUP_MIN` and `GROUP_PCT` in tix/orders.py next to `FEE_CENTS`. Keep the `BoxOffice` API as it is.

Repo convention: tests use unittest, run with `python3 -m unittest`. Do not add dependencies.
