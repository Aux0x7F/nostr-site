# Browser Support Contract

`nostr-site` should degrade cleanly across current Chromium, Firefox, and Safari-family browsers.

The framework must not assume one browser engine is the baseline for reusable behavior.

## Baseline rule

The baseline template must work without:

- JavaScript-enhanced control labels
- backdrop blur
- custom scrollbar reservation
- Web Animations API
- a single relay or cache host always succeeding

Unsupported enhancements may be ignored by a browser, but that must not break navigation, access, or baseline content rendering.

## Progressive enhancement rules

- Put non-baseline CSS features behind `@supports`.
- Include vendor-prefixed variants where that is still required in practice.
- Keep a visually acceptable fallback before enhancement applies.
- Gate non-baseline JS features behind capability checks.
- Respect `prefers-reduced-motion`.

## Accessibility rules

- Reusable controls must have a discernible accessible name in the HTML before JavaScript enhancement.
- If JS changes control meaning or state, keep `aria-*` and visible state aligned.

## Current feature rules

- `backdrop-filter`
  - fallback: translucent background without blur
  - enhancement: gated with `@supports`, include `-webkit-backdrop-filter`
- `scrollbar-gutter`
  - fallback: ordinary scroll container
  - enhancement: gated with `@supports`
- reorder or overlay motion
  - fallback: no motion or a simple transform fallback path
  - enhancement: WAAPI when available

## Validation expectation

A browser-sensitive framework change should include:

- a fallback path in code
- a note about the compatibility decision in the PR
- at least one manual check against the browser most likely to disagree with Chromium
