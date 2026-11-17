import { test } from "node:test";
import assert from "node:assert/strict";
import { next } from "./src/cron.ts";

const at = (s: string) => new Date(s + "Z");
const iso = (d: Date | null) => d && d.toISOString().slice(0, 16);
const n = (e: string, f: string) => iso(next(e, at(f)));

test("strictly after, seconds dropped", () => {
  assert.equal(n("0 10 * * *", "2025-03-10T10:00"), "2025-03-11T10:00");
  const d = next("* * * * *", new Date("2025-03-10T10:00:59.999Z"))!;
  assert.equal(d.toISOString(), "2025-03-10T10:01:00.000Z");
});

test("does not mutate from", () => {
  const f = at("2025-03-10T10:00");
  const d = next("0 0 1 1 *", f);
  assert.equal(f.toISOString(), "2025-03-10T10:00:00.000Z");
  assert.notEqual(d, f);
});

test("year rollover", () => {
  assert.equal(n("0 0 1 1 *", "2025-12-31T23:59"), "2026-01-01T00:00");
  assert.equal(n("59 23 31 12 *", "2025-12-31T23:59"), "2026-12-31T23:59");
});

test("dom 31 skips short months", () => {
  assert.equal(n("0 12 31 * *", "2025-04-01T00:00"), "2025-05-31T12:00");
  assert.equal(n("0 0 31 * *", "2025-05-31T00:00"), "2025-07-31T00:00");
});

test("feb 29 waits for a leap year, 2100 is not one", () => {
  assert.equal(n("0 0 29 2 *", "2025-01-01T00:00"), "2028-02-29T00:00");
  assert.equal(n("0 0 29 2 *", "2097-03-01T00:00"), "2104-02-29T00:00");
});

test("impossible schedule returns null", () => {
  assert.equal(next("0 0 30 2 *", at("2025-01-01T00:00")), null);
  assert.equal(next("0 0 31 4,6,9,11 *", at("2025-01-01T00:00")), null);
});

test("dom and dow both restricted: either matches", () => {
  // 2025-06-13 is a Friday; 2025-06-06 is a Friday
  assert.equal(n("0 0 13 * FRI", "2025-06-01T00:00"), "2025-06-06T00:00");
  assert.equal(n("0 0 13 * FRI", "2025-06-10T00:00"), "2025-06-13T00:00");
  assert.equal(n("0 0 1 * MON", "2025-06-24T00:00"), "2025-06-30T00:00");
});

test("dom starting with * means both must match", () => {
  // Fridays on odd days: 2025-06-06 even, 2025-06-13 odd
  assert.equal(n("0 0 */2 * FRI", "2025-06-01T00:00"), "2025-06-13T00:00");
});

test("dow starting with * means both must match", () => {
  // 2025-06-15 is a Sunday; */2 on dow = 0,2,4,6 so Sun/Tue/Thu/Sat; 15th of a month on one of those
  assert.equal(n("0 0 15 * */2", "2025-06-01T00:00"), "2025-06-15T00:00");
  // 2025-07-15 is Tuesday, 2025-08-15 Friday, 2025-09-15 Monday, 2025-10-15 Wednesday, 2025-11-15 Saturday
  assert.equal(n("0 0 15 * */2", "2025-06-16T00:00"), "2025-07-15T00:00");
  assert.equal(n("0 0 15 * */2", "2025-07-16T00:00"), "2025-11-15T00:00");
});

test("7 is Sunday, also in ranges", () => {
  // 2025-06-14 Sat, 15 Sun
  assert.equal(n("0 0 * * 7", "2025-06-12T00:00"), "2025-06-15T00:00");
  assert.equal(n("0 0 * * 6-7", "2025-06-14T00:00"), "2025-06-15T00:00");
  assert.equal(n("0 0 * * 5-7", "2025-06-15T00:00"), "2025-06-20T00:00");
});

test("names case-insensitive in lists and ranges", () => {
  assert.equal(n("0 0 1 jan,Jul *", "2025-02-01T00:00"), "2025-07-01T00:00");
  assert.equal(n("0 0 1 oct-DEC *", "2025-02-01T00:00"), "2025-10-01T00:00");
  assert.equal(n("0 0 * * sun", "2025-06-12T00:00"), "2025-06-15T00:00");
});

test("n/step runs to the field max", () => {
  assert.equal(n("5/20 * * * *", "2025-06-01T10:30"), "2025-06-01T10:45");
  assert.equal(n("5/20 * * * *", "2025-06-01T10:46"), "2025-06-01T11:05");
});

test("range with step", () => {
  assert.equal(n("10-50/15 * * * *", "2025-06-01T10:26"), "2025-06-01T10:40");
  assert.equal(n("10-50/15 * * * *", "2025-06-01T10:41"), "2025-06-01T11:10");
});

test("hour step wraps to next day", () => {
  assert.equal(n("0 */7 * * *", "2025-06-01T21:00"), "2025-06-02T00:00");
});

test("step bigger than the field", () => {
  assert.equal(n("*/90 * * * *", "2025-06-01T10:00"), "2025-06-01T11:00");
});

test("mixed list", () => {
  assert.equal(n("0 1,5-6,22/1 * * *", "2025-06-01T06:00"), "2025-06-01T22:00");
  assert.equal(n("0 1,5-6,22/1 * * *", "2025-06-01T23:00"), "2025-06-02T01:00");
});

test("tabs and repeated spaces", () => {
  assert.equal(n("  30\t 9  * *\t*  ", "2025-06-01T10:00"), "2025-06-02T09:30");
});

test("macros", () => {
  assert.equal(n("@hourly", "2025-06-01T10:00"), "2025-06-01T11:00");
  assert.equal(n("@Daily", "2025-06-01T10:00"), "2025-06-02T00:00");
  assert.equal(n("@weekly", "2025-06-01T10:00"), "2025-06-08T00:00");
  assert.equal(n("@monthly", "2025-06-01T10:00"), "2025-07-01T00:00");
  assert.equal(n("@annually", "2025-06-01T10:00"), "2026-01-01T00:00");
  assert.equal(n("@midnight", "2025-06-01T00:00"), "2025-06-02T00:00");
});

test("month rollover keeps the right day", () => {
  // dom 1-3 in Feb, from Jan 31 late
  assert.equal(n("15 4 1-3 2 *", "2025-01-31T23:59"), "2025-02-01T04:15");
  assert.equal(n("0 0 30 * *", "2025-01-30T00:00"), "2025-03-30T00:00");
});

test("invalid field counts and values throw RangeError", () => {
  for (const e of ["* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * 32 * *",
    "* * * 13 *", "* * * 0 *", "* * * * 8"]) {
    assert.throws(() => next(e, at("2025-01-01T00:00")), RangeError, e);
  }
});

test("bad syntax throws RangeError", () => {
  for (const e of ["*/0 * * * *", "1,,2 * * * *", "22-2 * * * *", "* * * * FRY", "* * * FOO *",
    "@reboot", "a * * * *", "-5 * * * *", "1-2-3 * * * *", "1/ * * * *", "* * * * MON-SUN/x", "", "1.5 * * * *"]) {
    assert.throws(() => next(e, at("2025-01-01T00:00")), RangeError, JSON.stringify(e));
  }
});

test("name not valid in the wrong field", () => {
  assert.throws(() => next("* * * MON *", at("2025-01-01T00:00")), RangeError);
  assert.throws(() => next("* * * * JAN", at("2025-01-01T00:00")), RangeError);
});

test("weekday range across a month and year end", () => {
  // 2025-12-31 is a Wednesday; next MON-FRI 08:00 after Fri 2026-01-02 09:00 is Mon 2026-01-05
  assert.equal(n("0 8 * * MON-FRI", "2025-12-31T09:00"), "2026-01-01T08:00");
  assert.equal(n("0 8 * * MON-FRI", "2026-01-02T09:00"), "2026-01-05T08:00");
});
