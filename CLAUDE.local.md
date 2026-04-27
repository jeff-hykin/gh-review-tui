# gre start

`gre` (GitHub Review Explorer) is the central place in this repo for working on PR review feedback — comments, CI failures, and merge conflicts. Whenever you're addressing review items in this repo, find them and update them through `gre`.

## Standard usage

The state YAML lives at the path printed by `gre info`. All `gre` commands operate on the current branch's PR.

**Finding items:**
- `gre sync` — fetch PR data from GitHub into local state (run if state seems stale)
- `gre list` — list unresolved review items
- `gre list --all` — include resolved
- `gre list --type <comment|ci_failure|merge_conflict>`, `--category <…>`, `--status <…>` — filters
- `gre show <id>` — full details for a single item
- `gre info` — print the state YAML path

**Updating items** (item ids look like `c0`, `c1`, …, `ci0`, …, `mc0`, …):
- `gre set <id> status <unseen|unaddressed|auto_solved|solved>` — track progress. Use `auto_solved` (renders orange ◎) once you've addressed something but want the human to confirm.
- `gre set <id> category <fix|discussion|wontfix|large_change|unknown>` — categorize.
- `gre note <id> "<note>"` — internal context, reasoning, links, gotchas. Not sent to GitHub.
- `gre summary <id> "<one-liner>"` — short description for the TUI list view.
- `gre draft <id> "<reply text>"` — draft a reply for the user to review before sending.

**Other:**
- `gre open <id>` — open the file in VS Code at the comment line.
- `gre clip <id>` — copy structured "ask Claude" context to the clipboard (only useful outside this agent loop).

**Do NOT call** `gre send` or `gre resolve` — those hit the GitHub API and the user should pre-approve.

If a fix is a single focused change, make it as one commit. If it's `wontfix` or needs discussion, draft the reply via `gre draft` rather than committing.

## Special case: reached via `cbg ask` from the gre TUI

If you arrived through a `cbg ask` (the user pressed `c` in their gre TUI on a specific item), the question payload includes the item's full context wrapped in `<review-item>` XML — you're focused on that single item. **Reply via `tell_session`** to the inbox shown in the cbg hint at the top of the question; the first line of your reply becomes the toast the user sees. Posting only in channel chat will park the user's gre process indefinitely. Use the same `gre` commands above to update state alongside the reply.

# gre end
