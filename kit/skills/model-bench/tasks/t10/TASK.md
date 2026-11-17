Implement `compare` and `satisfies` in src/semver.ts (no dependencies; behave like npm's node-semver for everything below).

Versions: `MAJOR.MINOR.PATCH` with optional `-prerelease` (dot-separated identifiers of [0-9A-Za-z-]; numeric parts and numeric identifiers have no leading zeros). No build metadata, no `v` prefix. Anything else throws. Precedence follows SemVer 2.0 (1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0). `compare` returns -1, 0 or 1.

Ranges:
- `||` separates alternatives; within one alternative, space-separated comparators must all match. `*`, `x` or an empty string match any version.
- Comparators: `=`, `<`, `<=`, `>`, `>=` (optional whitespace after the operator) or no operator (meaning `=`), followed by a full or partial version (`1`, `1.2`, `1.x`, `1.2.X`, `*`). Partials expand like node-semver: `1.2` = `1.2.x` = `>=1.2.0 <1.3.0`; `>1.2` = `>=1.3.0`; `<=1.2` = `<1.3.0`; `<1.2` = `<1.2.0`.
- Tilde: `~1.2.3` = `>=1.2.3 <1.3.0`, `~1.2` = `>=1.2.0 <1.3.0`, `~1` = `>=1.0.0 <2.0.0`.
- Caret: `^1.2.3` = `>=1.2.3 <2.0.0`, `^0.2.3` = `>=0.2.3 <0.3.0`, `^0.0.3` = `>=0.0.3 <0.0.4`, `^1.2` = `>=1.2.0 <2.0.0`.
- Hyphen: `1.2.3 - 2.3.4` = `>=1.2.3 <=2.3.4`; a partial upper end is exclusive of the next: `1.2.3 - 2.3` = `>=1.2.3 <2.4.0`.
- Prereleases: a version with a prerelease tag only satisfies an alternative if, in that same alternative, some comparator's version has a prerelease tag and the same MAJOR.MINOR.PATCH. So `1.2.3-alpha.7` satisfies `>1.2.3-alpha.3`, but `3.4.5-alpha.9` does not.
- An invalid range throws. `satisfies` with an invalid version throws.

Repo convention: tests use node:test, run with `npm test` (Node 24 runs .ts directly). Do not add dependencies.
