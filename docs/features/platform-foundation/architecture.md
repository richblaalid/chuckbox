# Platform Foundation — Architecture (pseudo-feature)

Indexes the authoritative sources rather than restating them.

| Concern | Authority |
|---|---|
| Validation verbs & delegation | `Makefile` (root) — verbs delegate to `npm run build` / `npm run lint` / `npx vitest run` / `npm run dev` |
| Git hooks | `.githooks/pre-push` (runs `make build`); wired per-clone via `make setup` |
| CI | `.github/workflows/ci.yml` — same verbs as local |
| Doc-system rules | `docs/CLAUDE.md` (constitution), `docs/process.md` (tacit conventions) |
| Stack / environment facts | `docs/tech.md`; Supabase env safety rules in root `CLAUDE.md` |
| Test strategy | `docs/testing.md` |
| Known platform debt | `reports/2026-07-09-chuckbox-current-state-audit.md` (Epics B, C, F) |

Active DRs constraining this pseudo-feature: _none yet_ (retroactive DRs pending — see `docs/tech.md` DR index).
