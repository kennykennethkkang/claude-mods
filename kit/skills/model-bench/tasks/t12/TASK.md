Implement `next(expr, from)` in src/cron.ts (TypeScript, Node 24, no build step). It returns the first time strictly after `from` that matches the cron expression, as a new Date with seconds and milliseconds at zero, or `null` when the expression can never match. Everything is UTC. Do not mutate `from`.

Expression rules (classic Vixie cron):

- Five fields separated by any run of spaces or tabs: minute (0-59), hour (0-23), day of month (1-31), month (1-12 or JAN-DEC), day of week (0-7 or SUN-SAT, where both 0 and 7 mean Sunday). Names are case-insensitive and allowed anywhere a number is, including in ranges.
- Each field is a comma list of items. An item is `*`, a value `n`, a range `a-b`, or any of those followed by `/step`. `*/s` steps from the field minimum; `a-b/s` steps from a up to b; `n/s` steps from n up to the field maximum.
- Day of month and day of week: if either field starts with `*`, a day must match both fields. If neither starts with `*`, a day matches when it matches either one. So `0 0 13 * FRI` fires on every 13th and on every Friday, while `0 0 */2 * FRI` fires only on Fridays with an odd day of month.
- Macros: `@yearly` and `@annually` (0 0 1 1 *), `@monthly` (0 0 1 * *), `@weekly` (0 0 * * 0), `@daily` and `@midnight` (0 0 * * *), `@hourly` (0 * * * *), case-insensitive.
- Invalid input throws a `RangeError`: wrong field count, unknown names or macros, values out of range, a range whose start is after its end (no wrap-around), a step of 0, empty list items, anything that is not one of the forms above.

`npm test` (that is `node --test`) runs the tests in cron.test.ts. Do not add dependencies.
