# Changelog

All notable changes to notes-cli. Sections, in this order, and only when a release has entries: Breaking, Added, Changed, Fixed. Each Breaking entry says what to do to upgrade.

## [Unreleased]

### Added
- CSV export with `notes export --csv`
- Dark theme

### Changed
- Search is now 4x faster

## [2.3.2] - 2026-10-29

### Fixed
- `notes sync` refreshes an expired token instead of failing
- `notes edit` opens `$EDITOR` when `$VISUAL` is empty

## [2.3.1] - 2026-10-15

### Fixed
- Windows paths with spaces in `notes open`

[Unreleased]: https://github.com/quillworks/notes-cli/compare/v2.3.2...HEAD
[2.3.2]: https://github.com/quillworks/notes-cli/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/quillworks/notes-cli/compare/v2.3.0...v2.3.1
