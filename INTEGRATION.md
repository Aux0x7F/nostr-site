# Integration Contract

This document describes how `nostr-site` should consume `nostr-crdt`.

It is intentionally separate from `ARCHITECTURE.md`:

- `ARCHITECTURE.md` explains the repo boundary and long-term model
- `INTEGRATION.md` explains how the framework should hook into a generic CRDT transport

## Boundary

`nostr-site` should treat `nostr-crdt` as a transport and merge layer, not as an application framework.

That means:

- `nostr-crdt` handles document sync
- `nostr-site` decides whether a synced update is trusted
- `nostr-site` decides how live document state is rendered or published

## First integration targets

The first collaborative unit types should be:

- static pages
- posts
- entity or wiki records

Everything else can remain event-shaped until a collaboration need justifies moving it.

## Acceptance hook

`nostr-site` should provide an acceptance function to the transport layer.

At a minimum, it must answer:

- is the signer currently trusted for this site
- is the signer allowed to mutate this unit type

The transport library should not embed those rules.

## Rendering contract

`nostr-site` should render:

1. static baseline
2. trusted live overlay

That means collaborative state should enhance or replace the corresponding unit after static load, not replace the whole site boot model.

## Pinner contract

Peer pinner should interact with collaborative units by:

- replaying current trusted document state
- optionally checkpointing it
- exporting it into repo files on a configured cadence
- opening or updating a GitHub PR

Peer pinner should not be required for basic browser collaboration to work.

## Migration contract

Until the CRDT transport lands, existing event-shaped workflows remain valid.

The migration path should be:

1. keep current static-first rendering
2. add live collaborative units one unit type at a time
3. preserve bakedown and PR workflow as the static publication layer

## Current integration surface

The framework now exposes a generic CRDT bridge for host code:

- `createNostrCrdtBridge(config)`
- `createStaticPageOverlayApi(config)`

That bridge is responsible for:

- deriving room ids from the site namespace
- creating a transport adapter on top of the existing relay toolchain
- creating signers from the existing deterministic key model
- creating Yjs sync instances without embedding application-specific trust rules

The first intended consumer is static page units.

`createStaticPageOverlayApi(config)` is the higher-level helper for that first slice. It provides:

- one live unit per page id
- trusted signer filtering via host-provided admin lookup
- read-only live overlay for visitors
- explicit publish hooks for admin-authored page changes
