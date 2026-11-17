Add pagination and filtering to `GET /items` in the shop package (shop/api.py routes, shop/service.py has the logic, shop/repo.py stores items).

Query params (all values arrive as strings in the `query` dict):
- `limit`: int 1..100, default 20.
- `cursor`: opaque string taken from a previous response's `next_cursor`.
- `tag`: only items that have this tag.
- `min_price` / `max_price`: inclusive bounds, numbers.
- `q`: case-insensitive substring match on name.

Response body: `{"items": [...], "next_cursor": <str or None>}`. Items stay sorted by (created, id). `next_cursor` is None when there are no more matching items after this page. Paging must be stable: walking pages with the same filters returns every matching item exactly once even if new items are added to the repo between page requests (new items may or may not appear, but nothing is skipped or repeated). Any invalid param value (bad int, limit out of range, non-number price, min_price > max_price, a cursor that was not produced by the API, unknown param name) returns status 400 with `{"error": "<message>"}`. Existing behavior of the other routes must not change.

Repo convention: tests use unittest, run with `python3 -m unittest`. Do not add dependencies.
