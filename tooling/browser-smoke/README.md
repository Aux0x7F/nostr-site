# Browser Smoke

Lightweight live-browser smoke coverage for `nostr-site` deployments.

## Install

```bash
cd tooling/browser-smoke
npm install
npx playwright install chromium
```

## Required env

- `SMOKE_BASE_URL`
- `SMOKE_ADMIN_USERNAME`
- `SMOKE_ADMIN_PASSWORD`
- `SMOKE_USER_USERNAME`
- `SMOKE_USER_PASSWORD`

## Run

```bash
npm test
```

The suite is intended for a live deployed site. It exercises:

- anonymous gating on submit/comments
- admin login and entity creation
- submitter login and submission creation
- admin approval and chat reply
- submitter chat/status visibility
- comment publish and admin hide moderation
