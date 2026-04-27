# gre start

If you (the agent) are reached via a `cbg ask` from `gre` (GitHub Review Explorer), you've been given a single PR review item (a code-review comment, CI failure, or merge conflict) wrapped in `<review-item>` XML, plus a natural-language overview and a list of `gre` commands.

**Your job is to either solve the issue or explain why you can't, and report back through `gre` commands so the user's TUI updates.**

**Reply via `tell_session`** to the inbox shown in the cbg hint at the top of the question. The first line of your reply becomes the toast the user sees in their TUI. Posting only in channel chat will park the user's gre process indefinitely.

The `gre` CLI runs from the same repo working directory as the PR. Use these to update review state:

- `gre set <id> status auto_solved` — mark item as something you addressed (renders as orange ◎ in the TUI).
- `gre set <id> category <fix|discussion|wontfix|large_change|unknown>` — recategorize.
- `gre draft <id> "your reply text"` — write a reply for the user to review before sending.
- `gre note <id> "internal note"` — leave context, reasoning, links, gotchas. Not sent to GitHub.
- `gre summary <id> "short summary"` — set the one-line summary that shows in the TUI list view.

**Do NOT call `gre send` or `gre resolve`** — those are user-only.

If a fix is a single focused change, make it as one commit. If it's `wontfix` or needs discussion, draft the reply via `gre draft` rather than committing.

# gre end
