# gre start

`gre` (GitHub Review Explorer) is the central place in this repo for tracking PR review feedback — comments, CI failures, and merge conflicts. **If you make a change that addresses a review item, update gre so the user's TUI reflects reality.** Stale state is worse than no state. If a single change covers multiple items, mark each one.

You're collaborating with the user — keep the state up to date without clobbering choices the user already made. Strict rules below.

## Finding items

The state YAML lives at the path printed by `gre info`. Most relevant commands:
- `gre list` — list unresolved items
- `gre list --type <comment|ci_failure|merge_conflict>`, `--category <…>`, `--status <…>` — filters
- `gre show <id>` — full details for one item; **read this before updating** so you know what's already there
- `gre info` — print the state YAML path

Item ids: `c0`, `c1`, …, `ci0`, …, `mc0`, …

## Updating: narrow rules

### Status — only set `auto_solved`
Once you've made the code change, run `gre set <id> status auto_solved`. The status badge flips to orange ◎ in the TUI. **Do NOT set any other status** — `unseen`, `unaddressed`, `asked_claude`, and `solved` are all user-managed.

### Category — only promote from `unknown`
First run `gre show <id>` and look at the `category` field.
- If it's `unknown`: pick one of these and set it (`gre set <id> category <…>`):
  - `simple_fix` — small, contained code change
  - `discussion` — needs a back-and-forth, no clear answer yet
  - `wontfix` — explicitly not changing
  - `large_change` — substantial refactor / multi-file
  - `nit` — stylistic nitpick, low urgency
  - `later` — defer; not for this PR
- If it's anything else: **leave it alone.** The user already categorized it.

### Notes — don't clobber
`gre note <id> "<text>"` overwrites whatever was there. Always read first:
1. `gre note <id>` (no args) prints the current note.
2. If empty: `gre note <id> "<your note>"`.
3. If non-empty: combine the existing note with your addition (preserve the user's content verbatim) and write the combined value. Easiest pattern via stdin:
   `{ gre note <id>; printf '\n\n<your addition>'; } | gre note <id> --stdin`

### Draft response — don't clobber
`gre draft <id>` works the same way. **Critical:** if a draft is non-empty, the user is mid-typing it. Do NOT overwrite their draft. Either:
- Skip the draft and put your suggested wording in `gre note <id>` instead (the user can copy it over manually), OR
- If you genuinely need to extend it, read first and write the combined version (same stdin pattern as notes).

### Summary — fill if empty, otherwise leave it
The summary is a one-liner shown in the TUI list view. If empty, set one. If already set, don't touch it.

## When you fix something

If a fix is a single focused change, make it as one commit. After committing:
1. `gre set <id> status auto_solved`
2. If category was `unknown`, set it (probably `fix`).
3. If summary was empty, set a one-liner.
4. Optionally add a `gre note` recording what changed and why (using the don't-clobber pattern).
5. **Update every related item.** If your single commit addresses multiple review items, mark each of them auto_solved.

If it's `wontfix` or needs discussion, capture your reasoning in notes/draft per the rules above and set category if it's still `unknown` — don't commit code.

## Linked issues

If the user pressed `i` on a comment, gre spun off a GitHub issue from it via `claude -p` + `gh issue create` and recorded the issue URL on the item's `linked_issues` array. The list view shows an `I` (or `Iₙ`) flag on those items. If you're addressing a comment that has linked issues, mention the issue URL in your reply or note so it stays threaded.

## Do NOT call

- `gre send` — posts the draft to GitHub. User-only.
- `gre resolve` — resolves the thread on GitHub. User-only.
- Don't run `gh issue create` directly — that's the user's `i` key flow.

## Special case: reached via `cbg ask` from the gre TUI

If you arrived through a `cbg ask` (the user pressed `c` in their gre TUI on a specific item), the question payload wraps that item's full context in `<review-item>` XML. **Reply via `tell_session`** to the inbox in the cbg hint at the top — the first line of your reply becomes the toast the user sees. Posting only in channel chat will park the user's gre process indefinitely. Apply the rules above to update state alongside the reply.

# gre end
