# Contributing

Keep framework changes focused, reviewable, and easy to squash.

## How we ship changes

Use a short-lived branch for one coherent slice:

1. branch from `main`
2. keep the branch focused
3. open a PR against `main`
4. keep the PR in draft until the bar is met
5. squash merge
6. delete the branch

Direct commits to `main` should be the exception.

## Branch shape

Good branch names explain the job:

- `issue-58-comment-thread-state`
- `issue-91-runtime-projection-store`
- `task-support-lib-polish`

One branch should solve one real problem.

## PR shape

A good PR says:

- what changed
- why it belongs upstream
- what validation was run
- which docs changed if the reusable guidance changed

Keep the body short and readable.

## Validation before merge

Before merge:

- run the focused checks for the changed behavior
- run broader framework validation when shared runtime or portable behavior changed
- rebuild support assets when `portable/` or support-lib output changed
- update the relevant docs when reusable behavior or workflow changed

See [TESTING.md](./TESTING.md) for the current bar.

## Docs changes

When you touch docs:

- use relative links inside this repo
- use `https://github.com/...` links for cross-repo or external references
- never use local filesystem paths in docs
- keep the writing practical and easy to navigate

## Merge expectations

- prefer squash merge
- keep the squash title clear and scoped
- do not carry noisy fixup history into `main`
