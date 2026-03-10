# Nostr Site Peer Pinner

Reusable peer pinner package for `nostr-site`.

## Purpose

- mirror tagged relay events locally
- expose a small relay-compatible WebSocket endpoint
- keep admin, alias, and snapshot state available to downstream tools
- act as the fulfillment gate for higher-impact actions

## Fulfillment rule

If you add PR generation, seed snapshots, or other downstream actions here, the request should only be fulfilled when the signer is currently authorized in the mirrored admin state. That blocks revoked admins from triggering new actions even if they still possess older local material.

## Build

```bash
npm install
npm run build
```

## Start

```bash
npm start
```

## Useful environment variables

- `PORT`
- `APP_TAG`
- `APP_KINDS`
- `UPSTREAM_RELAYS`
- `DATA_DIR`
- `EVENTS_FILE`
- `IDENTITY_FILE`
