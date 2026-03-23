# Browser Support

`nostr-site` should behave well across current Chromium, Firefox, and Safari-family browsers. The framework cannot assume that one engine is the baseline for reusable behavior.

## Baseline

The template baseline must still work without:

- JavaScript-enhanced labels
- backdrop blur
- custom scrollbar reservation
- Web Animations API
- every relay or cache host succeeding

If an enhancement is unsupported, the site should still be readable, navigable, and usable.

## Enhancement rules

- guard non-baseline CSS with `@supports`
- include vendor-prefixed variants where they still matter
- gate non-baseline JS behind capability checks
- respect `prefers-reduced-motion`

## Accessibility rules

- reusable controls need an accessible name in static HTML
- if JS changes state or meaning, keep `aria-*` aligned with the visible state

## Current feature notes

- `backdrop-filter`
  - fallback: translucent background without blur
- `scrollbar-gutter`
  - fallback: normal scroll behavior
- reorder or overlay motion
  - fallback: no animation or a simple transform path

## Validation

When a framework change adds browser-sensitive behavior:

- keep a fallback path in code
- note the compatibility choice in the PR
- do at least one manual check in the browser most likely to disagree with Chromium
