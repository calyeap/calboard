# Calboard — Entry Point

This file is a **router**, not a source of truth. It tells a fresh session
where to look; it does not itself state project facts, and nothing here
should be treated as current status.

## Where authority lives

- **This repo (code, tests, commits, PRs, CI, merges)** is authoritative for
  implementation facts — what the code currently does, what's tested, what's
  merged. Verify against `git log`, the working tree, and GitHub, not against
  memory or prior reports.
- **Calboard Command Center** (external, canonical) owns semantic project
  state: accepted milestone, current blocker, authorised next work. This repo
  does not restate it — ask or check the Command Center rather than inferring
  it from filenames, branch names, or doc age.
- **Stock Analyzer contract work** (spec/design/frozen artefacts): the
  external Technical Specs Index is what identifies which frozen
  artefacts/revisions are currently *approved*. `scripts/evidence/config.ts`
  (`FROZEN_HASHES`) is the repo-side machine-verifiable hash register that
  proves the bytes in `docs/frozen/` match what was frozen — evidence of
  integrity, not a statement of current semantic authority. Neither filename
  age nor mere presence in `docs/frozen/` determines which artefact governs;
  check the Technical Specs Index.
- **`DESIGN.md`** is a routing/index surface over design intent, not the
  design contract itself. Defer to the specific approved design contract it
  points to when the two could differ.
- **Old specs, plans, and history** (`docs/spec/`, `docs/superpowers/plans/`,
  prior milestone docs, etc.) are historical record. Their existence is not
  authorisation — don't let an old plan steer current work just because it's
  there. This does not extend to `docs/superpowers/specs/`: an approved spec
  there (e.g. the Portfolio UX spec) may still govern its area — confirm
  current status via the Command Center rather than assuming either way.
- **Another AI/chat's report or summary** (including this file's own past
  sessions) is evidence to weigh, never authority to act on directly.

## If authorities conflict

If two authoritative sources disagree on something a change would depend on,
**stop before making the consequential mutation** and return
`RECONCILIATION REQUIRED`, naming the conflicting sources, rather than
picking one.
