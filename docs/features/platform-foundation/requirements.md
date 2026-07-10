# Platform Foundation — Requirements (pseudo-feature)

Cross-cutting delivery infrastructure. Per the pseudo-feature rules in `docs/CLAUDE.md`, this describes **platform capabilities provided to feature work**, not user-observable ACs.

## Capabilities

1. **Uniform validation verbs.** `make build` / `make lint` / `make test` / `make dev` exist and delegate to the stack-native commands, so skills and humans never call stack commands directly. Local, git-hook, and CI runs execute the same verbs — one definition of green.
2. **Push gate.** An opt-in pre-push hook (`make setup` wires `.githooks/`) runs the build gate before any push.
3. **CI parity.** GitHub Actions runs exactly `make build` → `make lint` → `make test` on PRs and pushes to `main`.
4. **Documentation-driven pipeline.** The `docs/` system (grounding → DRs → feature docs → validated tasks) is installed and is the only door for product knowledge (see `docs/CLAUDE.md`, `docs/process.md`).
5. **Delivery hygiene backlog.** Migration/schema reconciliation, error monitoring, and test-suite hermeticity are tracked here until done (sourced from the 2026-07-09 audit's Epic B).

## Non-goals

User-facing behavior. Anything with an observable AC belongs in a real feature folder.
