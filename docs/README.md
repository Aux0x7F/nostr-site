# Nostr Site Docs

This folder is the framework handbook for `nostr-site`. Use it to understand the shared runtime, template layer, contribution workflow, and release checks.

## Start here if you want to...

### Understand the framework

- [ARCHITECTURE.md](./ARCHITECTURE.md)
  - repo boundaries, runtime model, and publication flow
- [INTEGRATION.md](./INTEGRATION.md)
  - how the framework uses `nostr-crdt`

### Work on template UI and rendering

- [COMPONENTS.md](./COMPONENTS.md)
  - reusable surface families and ownership boundaries
- [STYLE_GUIDE.md](./STYLE_GUIDE.md)
  - interaction and visual expectations
- [BROWSER_SUPPORT.md](./BROWSER_SUPPORT.md)
  - enhancement and fallback rules

### Make or review a framework change

- [CONTRIBUTING.md](./CONTRIBUTING.md)
  - branch, PR, and merge workflow
- [TESTING.md](./TESTING.md)
  - validation expectations and current commands

### Check release and deployment safety

- [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md)
  - production and release gate

### See current priorities

- [ROADMAP.md](./ROADMAP.md)
  - recent wins, current focus, and longer bets

## Neighboring repos

- [`truecost`](https://github.com/Aux0x7F/truecost)
  - concrete downstream site
- [`nostr-crdt`](https://github.com/YousefED/nostr-crdt)
  - transport and sync layer

If you are trying to understand a site-specific behavior, start in `truecost`. If you are trying to understand a reusable runtime behavior, start here.
