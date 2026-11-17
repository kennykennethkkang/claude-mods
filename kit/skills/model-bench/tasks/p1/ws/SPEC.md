# lend: library lending service

Python 3, standard library only. Package `lend/` plus a CLI (`python3 -m lend`).
`lend/errors.py` and `lend/clock.py` are given; keep their names. Everything else is yours.
Money is always integer cents. Dates are ISO strings.

## 1. Library object

```python
from lend import Library
lib = Library(path=None, clock=None, tz="UTC", grace_days=2, block_cents=1000, hold_days=3)
```

- `path`: JSON file to persist to, or `None` for memory only. If the file exists it is loaded.
- `clock`: object with `now()` returning an aware `datetime`. Default `SystemClock()`.
- `tz`: IANA zone name (`zoneinfo`). Unknown zone: `ValidationError`. All calendar dates
  (start, due, return, ready_until, overdue) are dates in this zone. Timestamps are stored and
  returned in UTC as `YYYY-MM-DDTHH:MM:SSZ` (seconds, no fraction).
- "Today" means the local date of `clock.now()` in `tz`.

Errors (all in `lend.errors`, all subclasses of `LendError`): `ValidationError`, `NotFound`,
`Conflict`, `LimitReached`, `Unavailable`, `Blocked`, `SchemaError`.

A call that raises leaves no trace: no state change, no audit entry, file untouched.

## 2. Item kinds

| kind     | loan_days | max_renewals | daily_fine_cents | max_fine_cents |
|----------|-----------|--------------|------------------|----------------|
| book     | 21        | 2            | 25               | 1000           |
| dvd      | 7         | 1            | 100              | 500            |
| magazine | 7         | 0            | 10               | 200            |

Expose this table as `lend.KINDS`, a dict of kind name to dict with those four keys.

## 3. Members

- `add_member(member_id, name, max_loans=5)` returns the member dict.
  `member_id` must match `[A-Za-z0-9_-]{1,32}`, `name` must be a non-empty string after strip
  (stored stripped), `max_loans` an int (not bool) >= 1. Otherwise `ValidationError`.
  Duplicate id: `Conflict`.
- `member(member_id)` returns `{"id", "name", "max_loans", "active", "balance_cents", "open_loans"}`
  (`open_loans` is a count). Unknown: `NotFound`.
- `deactivate_member(member_id)`: `Conflict` if the member has open loans or is already inactive.
  Otherwise sets `active` false and cancels all their waiting and ready holds (a cancelled ready
  hold frees its copy, see section 6).
- `pay(member_id, cents)`: `cents` must be an int (not bool), > 0 and <= balance, else
  `ValidationError`. Returns the new balance.

A member is **blocked** if inactive or if `balance_cents >= block_cents`.

## 4. Items and copies

- `add_item(item_id, title, author, kind="book", year=None, tags=())` returns the item dict.
  Same id rule as members. `title` and `author` non-empty after strip (stored stripped).
  `kind` must be in `KINDS`. `year` is `None` or an int (not bool) in 1000..9999.
  `tags`: strings, each stripped and lowercased; empty ones dropped; duplicates dropped keeping
  first order. Bad input: `ValidationError`. Duplicate id: `Conflict`.
- `add_copy(item_id, barcode)`: barcode matches the id rule and is unique across all items
  (`Conflict`). Unknown item: `NotFound`. Returns the barcode. A new copy is free, so it may
  go straight to a waiting hold (section 6).
- `item(item_id)` returns `{"id", "title", "author", "kind", "year", "tags", "copies", "available"}`.
  `copies` is the copy count; `available` counts copies not on loan and not reserved by a ready hold.

## 5. Loans

Loan ids are `L1`, `L2`, ... in creation order, never reused (they survive reopening).
Loan dict: `{"id", "member", "item", "barcode", "start", "due", "renewals", "returned", "fine_cents"}`.
`start` and `returned` are UTC timestamps (`returned` is `None` while open), `due` is a local date,
`fine_cents` is 0 until return.

`checkout(member_id, item_id)` checks in this order and raises the first that applies:
1. unknown member or item: `NotFound`
2. member blocked: `Blocked`
3. member already has an open loan of this item: `Conflict`
4. open loans >= `max_loans`: `LimitReached`
5. no copy for them: `Unavailable`

If the member has a ready hold on the item, the loan uses that hold's copy and the hold becomes
`fulfilled`. Otherwise it uses the free copy (not on loan, not reserved) with the smallest barcode
in plain string order. A copy reserved for someone else's ready hold is never used.
`due` = today + `loan_days`.

`renew(loan_id)`, checks in order:
1. unknown loan: `NotFound`
2. already returned: `Conflict`
3. member blocked: `Blocked`
4. overdue by more than `grace_days` (today - due > grace_days): `Blocked`
5. `renewals >= max_renewals`: `LimitReached`
6. the item has any waiting hold: `Unavailable`

New `due` = old `due` + `loan_days` (counted from the old due date, not from today).
`renewals` goes up by one. Returns the loan.

`return_copy(barcode)`: unknown barcode `NotFound`; copy not on loan `Conflict`.
Sets `returned`, computes the fine, adds it to the member's balance, returns the loan.
The copy is then free (section 6).

### Fines

`days_late = today - due` in days (0 if not positive).
`chargeable = max(0, days_late - grace_days)`.
`fine = min(chargeable * daily_fine_cents, max_fine_cents)` using the item's kind.
The cap is per loan, so renewals never reset or multiply it.

`overdue()` returns open loans with `today > due`, each the loan dict plus `"days_late"` and
`"fine_cents"` (the fine if returned today), sorted by `due` then by loan number (L2 before L10).

`loans(member_id=None, open_only=True)` lists loan dicts sorted by loan number.

## 6. Holds

Hold ids are `H1`, `H2`, ... Hold dict:
`{"id", "member", "item", "priority", "placed", "status", "barcode", "ready_until"}`.
`status` is one of `waiting`, `ready`, `fulfilled`, `cancelled`, `expired`.
`barcode` and `ready_until` (a local date) are set while `ready` and kept afterwards; `None` before.

`place_hold(member_id, item_id, priority=False)`, checks in order:
1. unknown member or item: `NotFound`
2. member blocked: `Blocked`
3. member has an open loan of the item, or a waiting or ready hold on it: `Conflict`

Queue order for an item's waiting holds: priority holds first, then earlier `placed`, then lower
hold number.

**Assignment.** Whenever a copy becomes free (new copy, return, ready hold cancelled or expired)
or a hold is placed, each free copy of that item (smallest barcode first) goes to the first
waiting hold in the queue: the hold becomes `ready`, gets the barcode, and
`ready_until = today + hold_days`. A hold placed while a free copy exists is ready at once.
So a free copy and a waiting hold on the same item never exist together.

**Expiry.** A ready hold expires when `today > ready_until`. Every public method of `Library`,
reads included, first processes expiries as of now: the hold becomes `expired`, its copy is free
and assignment runs (the next hold's `ready_until` counts from today). Expiry is a real change:
it is audited and saved.

- `cancel_hold(hold_id)`: unknown `NotFound`; not waiting or ready `Conflict`. Returns the hold.
- `hold(hold_id)` returns the hold dict. Unknown: `NotFound`.
- `queue(item_id)` returns the waiting holds in queue order, each with `"position"` (1-based).
  Unknown item: `NotFound`.

## 7. Search

`search(query, kind=None, available_only=False, page=1, per_page=10)` returns
`{"total", "page", "pages", "results"}`, `results` being `{"id", "title", "author", "score"}`.

- Normalize text: Unicode NFKD, drop combining marks, casefold, then split on every character
  that is not a letter or digit (`str.isalnum`). So `"Café-Noir"` gives `["cafe", "noir"]`.
- Query tokens are normalized and de-duplicated keeping order. No tokens: `ValidationError`.
  `page` must be an int (not bool) >= 1 and `per_page` an int (not bool) in 1..100, else `ValidationError`.
- Each query token scores the best of: 5 equals a title token; 3 is a strict prefix of a title
  token; 4 equals an author token; 2 is a strict prefix of an author token; 2 equals a token of
  a tag. A token that scores 0 excludes the item. Item score = sum of token scores, plus 1 if the
  query token list equals the title token list.
- `kind` filters by kind; `available_only` keeps items with `available > 0`.
- Sort by score descending, then normalized title (tokens joined by one space), then id.
- `pages = ceil(total / per_page)` (0 when total is 0). A page past the end has empty `results`.

## 8. Persistence

- File format: one JSON object with `"schema": 2` at the top level. The rest of the layout is yours.
- Every successful change is saved before the call returns. Write a temporary file in the same
  directory (name starts with the db file name and ends with `.tmp`), then `os.replace` it over
  the db (call it as `os.replace`). If the write fails, the call raises that `OSError`, the old
  file stays, the temp file is removed and the library state is as before the call.
- After any sequence of successful calls the directory holds only the db file, `<path>.lock`, and
  `<path>.v1.bak` if a migration happened.
- Not JSON, not an object, or a `schema` other than 1 or 2: `SchemaError` when opening.

### Migration from schema 1

A schema 1 file looks like this:

```json
{"version": 1,
 "members": {"m1": {"name": "Ann", "fines": "1.50"}},
 "books": [{"id": "b1", "title": "Dune", "author": "Frank Herbert", "copies": ["c1", "c2"]}],
 "loans": [{"barcode": "c1", "member": "m1", "out": "2026-01-02", "due": "2026-01-23"}]}
```

(`"version": 1` means schema 1; a file with `"schema": 1` counts too.)
- Members: `max_loans` 5, active, `balance_cents` from the dollar string, exactly (`"1.5"` is
  150, `"0"` is 0). A malformed amount, negative amount or more than two decimals: `SchemaError`.
- Books become kind `book`, `year` None, no tags.
- Loans become open loans in file order with ids `L1`, `L2`, ..., `renewals` 0, `due` as given,
  `start` = midnight local time of `out`, as UTC. A loan naming an unknown barcode or member:
  `SchemaError`.
- One audit entry `migrate` with ref `v1`.
- Opening a schema 1 file copies it to `<path>.v1.bak` and writes the schema 2 file at once.

## 9. Concurrency

- One `Library` is safe to use from many threads.
- Several `Library` objects (threads or processes) may share one path. Each call holds an
  exclusive `fcntl.flock` on `<path>.lock` for its whole run and works on the latest state on
  disk, so no update is lost and the rules above (copies, limits, holds) hold across processes.

## 10. Audit log

Every change appends `{"seq", "at", "action", "ref"}`; `seq` runs 1, 2, 3 with no gaps,
`at` is the UTC timestamp. `audit(action=None)` returns entries in seq order, filtered by action.

| action | ref | | action | ref |
|---|---|---|---|---|
| add_member | member id | | pay | member id |
| deactivate_member | member id | | place_hold | hold id |
| add_item | item id | | cancel_hold | hold id |
| add_copy | barcode | | hold_ready | hold id |
| checkout | loan id | | hold_expired | hold id |
| renew | loan id | | migrate | `v1` |
| return | loan id | | | |

Order within one call: the call's own entry first, then `hold_ready` entries it caused.
Expiry entries (and the `hold_ready` they cause) come before the call's own entry.
Cancelling holds from `deactivate_member` logs only `deactivate_member` (plus any `hold_ready`).
Checkout fulfilling a hold logs only `checkout`.

## 11. Reports

`report_csv(name)` returns CSV text (`csv` module defaults: comma, `"` quoting when needed,
`\r\n` line ends), header row first. Unknown name: `ValidationError`.

- `loans`: `loan_id,member_id,member_name,item_id,title,barcode,start,due,returned,fine_cents`,
  every loan sorted by loan number. `start` and `returned` are local dates (`returned` empty while open).
- `members`: `member_id,name,active,open_loans,balance_cents`, sorted by member id; `active` is
  `yes` or `no`.
- Any text cell starting with `=`, `+`, `-` or `@` gets a leading `'` (spreadsheet formula guard).

`stats()` returns `{"members", "items", "copies", "on_loan", "overdue", "holds_waiting",
"holds_ready", "fines_outstanding_cents"}` (counts, and the sum of balances).

## 12. CLI

`python3 -m lend --db PATH [--tz ZONE] COMMAND ...` with commands:

```
add-member ID NAME [--max-loans N]
add-item ID TITLE AUTHOR [--kind K] [--year Y] [--tag T]...
add-copy ITEM BARCODE
checkout MEMBER ITEM
renew LOAN
return BARCODE
hold MEMBER ITEM [--priority]
search WORD... [--page N] [--per-page N]
report NAME
stats
```

- Success: the method's return value as `json.dumps(value, sort_keys=True)` plus newline on
  stdout, exit 0. `report` prints the CSV text as is.
- A `LendError`: `error: <ClassName>: <message>` on stderr, nothing on stdout, exit 1.
- Bad usage (argparse): exit 2.
- The env var `LEND_NOW` (a UTC timestamp like `2026-01-05T10:00:00Z`) fixes the clock.
