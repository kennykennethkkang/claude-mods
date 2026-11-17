import { test } from "node:test";
import assert from "node:assert/strict";
import { next } from "./src/cron.ts";

const at = (s: string) => new Date(s + "Z");
const iso = (d: Date | null) => d && d.toISOString().slice(0, 16);

test("every minute", () => {
  assert.equal(iso(next("* * * * *", at("2025-03-10T10:00"))), "2025-03-10T10:01");
});

test("fixed time tomorrow", () => {
  assert.equal(iso(next("30 9 * * *", at("2025-03-10T10:00"))), "2025-03-11T09:30");
});

test("weekdays", () => {
  // 2025-03-14 is a Friday
  assert.equal(iso(next("0 8 * * MON-FRI", at("2025-03-14T09:00"))), "2025-03-17T08:00");
});

test("step", () => {
  assert.equal(iso(next("*/15 * * * *", at("2025-03-10T10:07"))), "2025-03-10T10:15");
});
