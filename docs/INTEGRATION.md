# Integration

This file covers one boundary: how `nostr-site` uses [`nostr-crdt`](https://github.com/YousefED/nostr-crdt).

## Boundary

`nostr-crdt` is the transport and sync layer.

It owns:

- document sync
- room transport
- replay and merge behavior

`nostr-site` owns:

- trust decisions
- site/runtime behavior
- projection and document integration
- how live state is rendered and published

The framework should never smuggle site policy down into the transport layer.

## First integration targets

The first collaborative unit types are:

- static pages
- post-like authored units
- entity or wiki records

Other data can stay event-shaped until collaboration pressure makes a CRDT path worth it.

## Trust hook

The framework provides the transport with an acceptance rule that answers questions like:

- is this signer currently trusted here
- is this signer allowed to mutate this unit type

Transport should not own those answers.

## Rendering rule

The model stays the same:

1. static baseline
2. trusted live overlay

That rule applies to CRDT-backed units and to other public runtime state as well.

## Pinner relationship

Pinner interacts with collaborative units by:

- replaying trusted state
- optionally checkpointing it
- exporting reviewed output
- opening or updating a PR

Browser collaboration should not depend on pinner being present. Pinner is for publication and review, not for basic editing to function.

## Current integration surface

Today the framework exposes:

- `createNostrCrdtBridge(config)`
- `createStaticPageOverlayApi(config)`
- `createStructuredUnitOverlayApi(config)`

It also exposes the runtime and document plumbing needed for downstream hosts to connect those units to the rest of the site model.
