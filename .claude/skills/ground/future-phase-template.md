# Future-Phase Backlog Entry Template

When the `/ground` triage pass defers a finding, append an entry to `docs/future-phases/backlog.md` under the appropriate topic section using this shape.

## Entry shape

```markdown
### [Short title — what the deferred finding is]

- **Source:** `docs/grounding/extracts/YYYY-MM-DD-[source-slug].md`
- **Date deferred:** YYYY-MM-DD
- **Reason:** out-of-scope-phase-1 · requires-refinement · awaiting-client-input · dependent-on-other-system · other (describe)
- **Original wording:**
  > [Verbatim quote of the bullet from the extract.]
- **Refinement direction:** [Any refinement proposed during triage, even if not finalized. Captures the collective understanding so far so the next reader doesn't restart from zero.]
- **Open question(s):** [What needs to be answered before this can be re-triaged.]
- **Required to unblock:** [The next concrete step — a meeting, stakeholder confirmation, a phase-1 dependency to ship first, a volume signal to gather, etc.]
```

## Topic sections

The backlog is organized by topic, mirroring the extract sub-areas. Standard sections:

- Notices & Communications
- Construction Draws
- Invoicing & Receivables
- Real-Estate-Tax Tracking
- Cap-I Statements
- Payoff Quotes
- Tasks / Work Tracking
- Search / Aliases / Data Quality
- Problem Deals / Collections
- Other / Cross-Cutting

If a deferred finding doesn't fit any standard section, add a new topic section. When `docs/future-phases/backlog.md` is first created, seed it with the standard sections (each with `_(none yet)_` as a placeholder) so the section structure is visible from the start.

## Conventions

- Newest entries go at the top of their topic section so a reader scanning the file sees the most recent deferrals first.
- When a deferred entry is later picked up (incorporated into a phase-2+ build plan), don't delete it — change its status by adding a closing line: `**Picked up in:** [extract path or DR or feature name] on [YYYY-MM-DD].` This preserves the chain of custody.
- Group multiple related deferrals under a single entry only if they share the same blocker; otherwise list them separately so each can be unblocked independently.
- Cross-reference open questions in `docs/grounding/open-questions.md` by topic when the question and the deferred finding overlap.
