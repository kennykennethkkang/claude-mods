# Release checklist: vX.Y.Z

Copy to `release-X.Y.Z.md` and fill it in. Keep these headings, in this order.

## Details

- Version:
- Release date:
- Previous tag:
- Compare link:

## Steps

The steps below are in no particular order. List them in the order they must run: a step goes after everything it depends on. Fill each owner from the roster.

| Step | Depends on | Owner |
| --- | --- | --- |
| Announce in #releases with a link to the GitHub release | Create GitHub release | |
| Bump version in package.json | Update CHANGELOG.md | |
| Create GitHub release from the tag, notes from CHANGELOG.md | Publish to npm | |
| Commit the version bump and CHANGELOG.md | Bump version in package.json | |
| Freeze main | nothing | |
| Publish to npm | Tag the release commit | |
| Tag the release commit `vX.Y.Z` and push the tag | CI green on the release commit | |
| Unfreeze main | Announce in #releases | |
| Update CHANGELOG.md | Freeze main | |
| CI green on the release commit | Commit the version bump and CHANGELOG.md | |

## Roster

- Priya: release captain, owns every step not listed below.
- Dev: Publish to npm (the only account with npm 2FA).
- Sam: Announce in #releases.
- Kenneth: every commit. Agents and the release captain never commit.

## Sign-off

- Release captain:
- Date:
