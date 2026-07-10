.PHONY: setup install dev build lint test

# One-time developer setup. Wires git hooks. Safe to re-run.
# core.hooksPath lives in the shared repo config, so running this once
# covers every worktree.
setup:
	git config core.hooksPath .githooks
	@echo "Git hooks path set to .githooks:"
	@echo "  pre-commit  lints staged .ts/.tsx files with ESLint (--fix)"
	@echo "  pre-push    runs 'make build' (the push gate, matching CI)"

# Install dependencies. Run after cloning or in a fresh git worktree
# (worktrees share git history but not node_modules).
install:
	npm install

# Parallel-worktree support: OFFSET shifts the web port so multiple dev
# servers run side by side (make dev OFFSET=1 → :3001). The database is the
# ONE shared dev Supabase project for every worktree — never run destructive
# db scripts (db:reset / db:fresh / db:restore) while another run is active.
OFFSET ?= 0
WEB_PORT := $(shell echo $$((3000 + $(OFFSET))))

dev:
	npx next dev --port $(WEB_PORT)

# Production build — the type/contract gate. Fails loudly on type errors.
build:
	npm run build

lint:
	npm run lint

# Run mode explicitly: `npm test` is bare `vitest`, which watches in a TTY.
test:
	npx vitest run
