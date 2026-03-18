# Contributing

## Workflow

`nostr-site` should use a branch -> purpose -> squash workflow.

Normal changes should follow this path:

1. branch from `main`
2. keep one branch focused on one coherent slice
3. open a PR against `main`
4. squash merge the PR
5. delete the branch after merge

Direct commits to `main` should be exceptions.

## Branch and PR shape

Use names that explain the slice:

- `issue-58-comment-thread-state`
- `issue-91-public-state-cache-contract`
- `task-support-lib-polish`

PRs should stay reviewable in one pass and should state:

- what contract changed
- what reusable layer changed
- what validation was run

## Merge policy

- prefer squash merge
- keep the squashed commit message clear and scoped
- do not preserve noisy intermediate fixup history in `main`

## Validation minimum

Before merge:

- run the relevant `node --check` commands
- run the deterministic tests for the changed contract
- rebuild support assets if the support library changed

See [TESTING.md](./TESTING.md) for the current testing baseline.
