# importer

Loads customer exports into dicts for the nightly sync.

Exports come out of Excel and our old PHP admin: UTF-8, sometimes with a BOM, CRLF or LF line endings, fields quoted with double quotes when they contain commas, quotes or line breaks (quotes inside a field are doubled).

Rules the sync depends on:

- One dict per data row, keyed by the header names, in file order.
- Blank lines are skipped.
- Exact duplicate rows (re-exports) are skipped; the first one wins.
- If a header name repeats, the later columns are renamed `name_2`, `name_3`, ...
- Short rows are padded with empty strings. A row with more fields than the header raises `ValueError` naming the line number where that row starts.
- Values are kept as is (no stripping, no type conversion).
