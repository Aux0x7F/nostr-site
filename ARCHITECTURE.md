# Architecture

This repo is the host-application layer that sits between a generic CRDT transport and a concrete site implementation.

## Repo boundary

The intended three-repo split is:

- `nostr-crdt`
  - generic CRDT transport over Nostr
  - room identity, replay, checkpoints, buffered updates
  - no site-specific auth, review, publishing, or bakedown policy
- `nostr-site`
  - generic site framework and policy layer
  - account model, admin model, moderation model, draft model, bakedown requests, peer pinner integration
  - decides how and when a trusted live overlay should affect site state
- `truecost`
  - project-specific pages, content, copy, styling, and operating choices

`nostr-site` should consume a generic transport library. It should not become the transport library.

## Current state

Today, `nostr-site` already provides:

- deterministic accounts
- admin grant and revoke model
- public drafts, entities, comments, and moderation state
- encrypted submission intake
- peer-pinner-driven bakedown and PR support
- static-first rendering with relay-backed enrichment

Today, `nostr-site` does not yet provide:

- generic CRDT-backed collaborative document sync
- live overlay application from CRDT document state

## Target model

The target model is:

1. Static content is the baseline.
2. Clients optionally connect to Nostr after load.
3. Clients receive newer live unit state through a generic CRDT transport.
4. Clients only apply that live state if the signer is currently trusted by the host application's auth model.
5. Peer pinner periodically materializes the latest trusted state into repo files and opens or updates a PR.
6. Merge of that PR advances the static baseline.

This keeps first load fast and deterministic while still supporting live collaboration.

## Collaborative units

The host framework should think in terms of one collaborative unit per document:

- page
- post
- entity or wiki record

The framework should not encourage one giant site-wide document.

The framework also should not force a specific CRDT engine into all state. Only the units that benefit from live collaboration should use the transport layer.

## Trust boundary

`nostr-site` is where signer trust becomes product behavior.

The generic transport may verify event shape and Nostr signatures, but `nostr-site` decides whether a signer is allowed to affect visible state.

The intended trust rule is:

- live content events are signed by the editor's own key
- `nostr-site` reconstructs the current allowed admin set from its existing admin grant and revoke chain
- only updates from currently trusted signers are applied to privileged live overlay state

This is a host-app concern, not a transport concern.

## Peer pinner role

Peer pinner is not the transport layer and not the source of truth for merge logic.

Peer pinner should act as:

- durable peer
- checkpoint helper
- bakedown worker
- PR automation worker

It should not own application auth policy beyond enforcing the current trusted signer set when fulfilling privileged downstream actions.

## Publishing contract

For trusted live content, the long-term publishing model is:

- editors change collaborative units live
- clients receive and verify the live overlay
- pinner periodically materializes the latest trusted state into repo files
- Git PR review keeps the static baseline auditable

This is intentionally simpler than a heavy manual snapshot queue for every edit.

## Implementation guidance

When `nostr-site` adopts `nostr-crdt`, the first integration should target:

- static pages
- posts
- entity or wiki records

Submissions, admin logs, moderation events, and other workflow records can stay event-shaped rather than CRDT-shaped unless a real collaboration need appears.

## Open questions

- whether all admins should remain publishers, or whether `editor` and `publisher` should diverge later
- how much checkpointing should happen in browsers versus durable peers
- whether entity wiki data should be a richer structured document than page and post content
