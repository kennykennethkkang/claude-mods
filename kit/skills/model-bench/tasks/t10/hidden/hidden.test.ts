import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, satisfies } from "./src/semver.ts";

test("compare", () => {
  assert.equal(compare("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compare("1.0.0-alpha.1", "1.0.0-alpha"), 1);
  assert.equal(compare("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
  assert.equal(compare("1.0.0-alpha.beta", "1.0.0-alpha.1"), 1);
  assert.equal(compare("1.0.0-alpha.beta", "1.0.0-beta"), -1);
  assert.equal(compare("1.0.0-beta", "1.0.0-alpha.beta"), 1);
  assert.equal(compare("1.0.0-beta", "1.0.0-beta.2"), -1);
  assert.equal(compare("1.0.0-beta.2", "1.0.0-beta"), 1);
  assert.equal(compare("1.0.0-beta.2", "1.0.0-beta.11"), -1);
  assert.equal(compare("1.0.0-beta.11", "1.0.0-beta.2"), 1);
  assert.equal(compare("1.0.0-beta.11", "1.0.0-rc.1"), -1);
  assert.equal(compare("1.0.0-rc.1", "1.0.0-beta.11"), 1);
  assert.equal(compare("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compare("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compare("1.2.3", "1.2.3"), 0);
  assert.equal(compare("1.2.3", "1.2.3"), 0);
  assert.equal(compare("2.0.0", "1.99.99"), 1);
  assert.equal(compare("1.99.99", "2.0.0"), -1);
  assert.equal(compare("1.10.0", "1.9.0"), 1);
  assert.equal(compare("1.9.0", "1.10.0"), -1);
  assert.equal(compare("0.0.1", "0.0.10"), -1);
  assert.equal(compare("0.0.10", "0.0.1"), 1);
  assert.equal(compare("1.0.0-1", "1.0.0-a"), -1);
  assert.equal(compare("1.0.0-a", "1.0.0-1"), 1);
  assert.equal(compare("1.0.0-2", "1.0.0-10"), -1);
  assert.equal(compare("1.0.0-10", "1.0.0-2"), 1);
});

test("plain", () => {
  assert.equal(satisfies("1.2.3", "1.2.3"), true, "1.2.3 in 1.2.3");
  assert.equal(satisfies("1.2.4", "1.2.3"), false, "1.2.4 in 1.2.3");
  assert.equal(satisfies("1.2.3", "=1.2.3"), true, "1.2.3 in =1.2.3");
  assert.equal(satisfies("1.2.3", ">=1.2.3"), true, "1.2.3 in >=1.2.3");
  assert.equal(satisfies("1.2.2", ">= 1.2.3"), false, "1.2.2 in >= 1.2.3");
  assert.equal(satisfies("1.2.3", "<1.2.3"), false, "1.2.3 in <1.2.3");
  assert.equal(satisfies("1.2.3", "<=1.2.3"), true, "1.2.3 in <=1.2.3");
  assert.equal(satisfies("1.2.9", "1.2"), true, "1.2.9 in 1.2");
  assert.equal(satisfies("1.3.0", "1.2.x"), false, "1.3.0 in 1.2.x");
  assert.equal(satisfies("1.9.9", "1.x"), true, "1.9.9 in 1.x");
  assert.equal(satisfies("2.0.0", "1.x"), false, "2.0.0 in 1.x");
  assert.equal(satisfies("5.5.5", "*"), true, "5.5.5 in *");
  assert.equal(satisfies("5.5.5", ""), true, "5.5.5 in ");
  assert.equal(satisfies("5.5.5", "x"), true, "5.5.5 in x");
  assert.equal(satisfies("1.2.9", "1.2.X"), true, "1.2.9 in 1.2.X");
  assert.equal(satisfies("1.2.9", ">1.2"), false, "1.2.9 in >1.2");
  assert.equal(satisfies("1.3.0", ">1.2"), true, "1.3.0 in >1.2");
  assert.equal(satisfies("1.2.9", "<=1.2"), true, "1.2.9 in <=1.2");
  assert.equal(satisfies("1.3.0", "<=1.2"), false, "1.3.0 in <=1.2");
  assert.equal(satisfies("1.1.9", "<1.2"), true, "1.1.9 in <1.2");
  assert.equal(satisfies("1.2.0", "<1.2"), false, "1.2.0 in <1.2");
  assert.equal(satisfies("1.2.0", ">=1.2"), true, "1.2.0 in >=1.2");
});

test("tilde_caret", () => {
  assert.equal(satisfies("1.2.3", "~1.2.3"), true, "1.2.3 in ~1.2.3");
  assert.equal(satisfies("1.2.9", "~1.2.3"), true, "1.2.9 in ~1.2.3");
  assert.equal(satisfies("1.3.0", "~1.2.3"), false, "1.3.0 in ~1.2.3");
  assert.equal(satisfies("1.2.2", "~1.2.3"), false, "1.2.2 in ~1.2.3");
  assert.equal(satisfies("1.2.0", "~1.2"), true, "1.2.0 in ~1.2");
  assert.equal(satisfies("1.9.0", "~1"), true, "1.9.0 in ~1");
  assert.equal(satisfies("2.0.0", "~1"), false, "2.0.0 in ~1");
  assert.equal(satisfies("1.9.9", "^1.2.3"), true, "1.9.9 in ^1.2.3");
  assert.equal(satisfies("2.0.0", "^1.2.3"), false, "2.0.0 in ^1.2.3");
  assert.equal(satisfies("1.2.2", "^1.2.3"), false, "1.2.2 in ^1.2.3");
  assert.equal(satisfies("0.2.9", "^0.2.3"), true, "0.2.9 in ^0.2.3");
  assert.equal(satisfies("0.3.0", "^0.2.3"), false, "0.3.0 in ^0.2.3");
  assert.equal(satisfies("0.0.3", "^0.0.3"), true, "0.0.3 in ^0.0.3");
  assert.equal(satisfies("0.0.4", "^0.0.3"), false, "0.0.4 in ^0.0.3");
  assert.equal(satisfies("1.2.0", "^1.2"), true, "1.2.0 in ^1.2");
  assert.equal(satisfies("1.99.0", "^1.2"), true, "1.99.0 in ^1.2");
});

test("hyphen_and_or", () => {
  assert.equal(satisfies("1.2.3", "1.2.3 - 2.3.4"), true, "1.2.3 in 1.2.3 - 2.3.4");
  assert.equal(satisfies("2.3.4", "1.2.3 - 2.3.4"), true, "2.3.4 in 1.2.3 - 2.3.4");
  assert.equal(satisfies("2.3.5", "1.2.3 - 2.3.4"), false, "2.3.5 in 1.2.3 - 2.3.4");
  assert.equal(satisfies("2.3.9", "1.2.3 - 2.3"), true, "2.3.9 in 1.2.3 - 2.3");
  assert.equal(satisfies("2.4.0", "1.2.3 - 2.3"), false, "2.4.0 in 1.2.3 - 2.3");
  assert.equal(satisfies("1.2.2", "1.2.3 - 2.3"), false, "1.2.2 in 1.2.3 - 2.3");
  assert.equal(satisfies("1.5.0", ">=1.2.3 <2.0.0"), true, "1.5.0 in >=1.2.3 <2.0.0");
  assert.equal(satisfies("2.0.0", ">=1.2.3 <2.0.0"), false, "2.0.0 in >=1.2.3 <2.0.0");
  assert.equal(satisfies("3.1.0", "^1.0.0 || ^3.0.0"), true, "3.1.0 in ^1.0.0 || ^3.0.0");
  assert.equal(satisfies("2.1.0", "^1.0.0 || ^3.0.0"), false, "2.1.0 in ^1.0.0 || ^3.0.0");
  assert.equal(satisfies("0.1.0", "<0.2.0 || >5"), true, "0.1.0 in <0.2.0 || >5");
  assert.equal(satisfies("6.0.0", "<0.2.0 || >5"), true, "6.0.0 in <0.2.0 || >5");
  assert.equal(satisfies("5.9.0", "<0.2.0 || >5"), false, "5.9.0 in <0.2.0 || >5");
});

test("prerelease", () => {
  assert.equal(satisfies("1.2.3-alpha.7", ">1.2.3-alpha.3"), true, "1.2.3-alpha.7 in >1.2.3-alpha.3");
  assert.equal(satisfies("3.4.5-alpha.9", ">1.2.3-alpha.3"), false, "3.4.5-alpha.9 in >1.2.3-alpha.3");
  assert.equal(satisfies("1.2.3-beta.4", "^1.2.3-beta.2"), true, "1.2.3-beta.4 in ^1.2.3-beta.2");
  assert.equal(satisfies("1.2.4-beta.4", "^1.2.3-beta.2"), false, "1.2.4-beta.4 in ^1.2.3-beta.2");
  assert.equal(satisfies("1.2.4", "^1.2.3-beta.2"), true, "1.2.4 in ^1.2.3-beta.2");
  assert.equal(satisfies("1.0.0-rc.1", "*"), false, "1.0.0-rc.1 in *");
  assert.equal(satisfies("1.0.0-rc.1", "1.x"), false, "1.0.0-rc.1 in 1.x");
  assert.equal(satisfies("1.0.0-rc.1", ">=1.0.0-rc.0 <2.0.0"), true, "1.0.0-rc.1 in >=1.0.0-rc.0 <2.0.0");
  assert.equal(satisfies("1.0.0-rc.1", "^0.9.0 || >=1.0.0-rc.0"), true, "1.0.0-rc.1 in ^0.9.0 || >=1.0.0-rc.0");
  assert.equal(satisfies("1.0.0-rc.1", "<1.0.0"), false, "1.0.0-rc.1 in <1.0.0");
  assert.equal(satisfies("2.0.0-alpha", "~2.0.0-alpha"), true, "2.0.0-alpha in ~2.0.0-alpha");
  assert.equal(satisfies("2.0.1-alpha", "~2.0.0-alpha"), false, "2.0.1-alpha in ~2.0.0-alpha");
});

test("invalid range throws", () => {
  assert.throws(() => satisfies("1.2.3", ">>1.2.3"), ">>1.2.3");
  assert.throws(() => satisfies("1.2.3", "1.2.3.4"), "1.2.3.4");
  assert.throws(() => satisfies("1.2.3", "1..2"), "1..2");
  assert.throws(() => satisfies("1.2.3", "=>1.2.3"), "=>1.2.3");
  assert.throws(() => satisfies("1.2.3", "^a.b"), "^a.b");
  assert.throws(() => satisfies("1.2.3", "1.2.3 -"), "1.2.3 -");
});

test("invalid version throws", () => {
  assert.throws(() => satisfies("1.2", "*"), "1.2");
  assert.throws(() => satisfies("01.2.3", "*"), "01.2.3");
  assert.throws(() => satisfies("1.2.3-", "*"), "1.2.3-");
  assert.throws(() => satisfies("1.2.3-01", "*"), "1.2.3-01");
  assert.throws(() => satisfies("1.2.3.4", "*"), "1.2.3.4");
  assert.throws(() => satisfies("v1.2.3", "*"), "v1.2.3");
  assert.throws(() => satisfies("", "*"), "");
});
