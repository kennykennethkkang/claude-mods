Planted bugs in importer.py measured against README.md (count one only when the report names the cause):

1. No CSV quoting: `split(",")` breaks fields quoted because they hold commas, and doubled quotes inside a field are not unescaped.
2. Quoted line breaks: reading line by line splits a quoted field that contains a newline into separate rows.
3. Encoding and BOM: the file is opened without `encoding="utf-8-sig"` (or equivalent), so a UTF-8 BOM ends up in the first header name, and the platform default encoding is used.
4. Values not kept as is: `line.strip()` strips leading and trailing whitespace from the first and last values (only the line ending should go).
5. Wrong row length handling: rows whose field count differs from the header are silently dropped; short rows should be padded with empty strings and long rows should raise `ValueError` naming the starting line number.
6. Repeated header names are not renamed to `name_2`, `name_3`, so `dict(zip(...))` collapses them and loses values.
7. Slow duplicate check: `row not in rows` scans the whole list for every row (quadratic on big exports); a set of seen tuples is needed.

A false positive is a reported problem that is not real and not a genuine defect against README.md.
