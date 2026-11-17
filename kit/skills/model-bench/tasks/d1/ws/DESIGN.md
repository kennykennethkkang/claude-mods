# Ledgerly design system

Quiet, dense product UI. Hairline borders, one accent, no gradients or shadows.

## Tokens

Declare these as CSS custom properties on `:root` with exactly these names and values. No other colors may appear in the CSS.

| Token | Light | Dark |
| --- | --- | --- |
| --color-bg | #ffffff | #07080a |
| --color-surface | #f5f5f6 | #101111 |
| --color-text | #18191a | #f4f4f6 |
| --color-muted | #5f6062 | #9c9c9d |
| --color-border | #e2e3e5 | #242728 |
| --color-accent | #2f6fe4 | #57c1ff |
| --color-on-accent | #ffffff | #07080a |
| --color-danger | #d93636 | #ff6161 |
| --color-focus | #2f6fe4 | #57c1ff |

Dark values apply through `@media (prefers-color-scheme: dark)`.

Spacing: --space-1 4px, --space-2 8px, --space-3 12px, --space-4 16px, --space-6 24px, --space-8 32px. Use only these.

Radius: --radius-sm 6px (inputs, buttons), --radius-md 10px (cards). Nothing rounder.

Type: --font-sans "Inter", system-ui, sans-serif. Sizes --text-sm 13px, --text-md 15px, --text-lg 20px, --text-xl 28px. Body is --text-md, never below --text-sm.

Motion: --dur-fast 150ms, ease-out. Every transition must stop under `prefers-reduced-motion: reduce`.

## Rules

- Controls are at least 44px tall, checkboxes and radios included (the hit area, not only the box).
- Focus is always visible: a 2px --color-focus outline with 2px offset. Never remove it without a replacement.
- Every control has a visible label tied to it. Placeholders are hints, not labels.
- Related controls sit in a fieldset with a legend.
- One h1 per page, sections are h2.
- Destructive actions use --color-danger, live in their own section at the bottom and always ask before acting.
- Must work from 380px wide with no horizontal scroll.
- No inline styles.

## Brief: settings page

Copy is sentence case and must read exactly:

- Page heading: Settings
- Sections, in order: Profile, Notifications, Appearance, Danger zone
- Profile labels: Display name, Email, Time zone
- Notifications: Weekly digest email, Mentions
- Appearance: Theme, with options System, Light, Dark
- Primary button: Save changes
- Status after saving: Saved
- Danger zone button: Delete workspace
- Confirmation before deleting: Delete this workspace? This cannot be undone.

The page is a single card, max 640px wide, centered, on --color-bg.
