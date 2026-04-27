// Async bridge between gre and a cbg-managed Claude session.
//
// On launch: ensure a topic session exists for the current branch.
// On ask:    spawn `cbg ask --sync` as a background subprocess and call
//            onReply / onError when it finishes. The TUI stays responsive.

export interface AskOptions {
    targetTopic: string
    fromInbox: string
    question: string
    timeoutMs?: number
}

export interface AskResult {
    text: string
    raw: string
}

export interface AskHandle {
    promise: Promise<AskResult>
    cancel: () => void
}

export async function touchTopic(topic: string): Promise<{ ok: boolean; error?: string }> {
    const cmd = new Deno.Command("cbg", {
        args: ["new", "--touch", `topic:${topic}`],
        stdout: "piped", stderr: "piped",
    })
    try {
        const out = await cmd.output()
        if (out.code !== 0) {
            return { ok: false, error: new TextDecoder().decode(out.stderr).trim() || `cbg exited ${out.code}` }
        }
        return { ok: true }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
}

export function askAsync(opts: AskOptions): AskHandle {
    const cmd = new Deno.Command("cbg", {
        args: [
            "ask", "--sync",
            "--question", opts.question,
            "--from", opts.fromInbox,
            "--to", `topic:${opts.targetTopic}`,
        ],
        stdout: "piped", stderr: "piped",
    })
    const child = cmd.spawn()
    let timedOut = false
    let cancelled = false
    let timer: number | undefined
    const cancel = () => {
        cancelled = true
        try { child.kill("SIGTERM") } catch { /* already gone */ }
    }
    if (opts.timeoutMs && opts.timeoutMs > 0) {
        timer = setTimeout(() => { timedOut = true; cancel() }, opts.timeoutMs)
    }
    const promise = child.output().then((out) => {
        if (timer !== undefined) clearTimeout(timer)
        if (timedOut) { throw new Error(`cbg ask timed out after ${opts.timeoutMs}ms`) }
        if (cancelled) { throw new Error("cbg ask cancelled") }
        if (out.code !== 0) {
            const err = new TextDecoder().decode(out.stderr).trim() || `cbg ask exited ${out.code}`
            throw new Error(err)
        }
        const raw = new TextDecoder().decode(out.stdout).trim()
        let text = raw
        try {
            const parsed = JSON.parse(raw)
            if (typeof parsed?.text === "string") { text = parsed.text }
        } catch { /* not JSON, fall through with raw */ }
        return { text, raw }
    })
    return { promise, cancel }
}

// Sanitize a branch name into something safe to use as a topic / inbox
// identifier. Strips path separators and other characters that might
// confuse cbg target resolution; keeps the name recognizable.
function sanitizeBranch(branch: string): string {
    return branch.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default"
}

export function topicForBranch(branch: string): string {
    return `gre-${sanitizeBranch(branch)}`
}

// Inbox is shared across all asks for a branch — accumulates replies as a
// per-branch record at $CBG_DIR/inboxes/<name>/messages.jsonl. Tradeoff:
// concurrent asks on the same branch would evict each other on cbg's side,
// so callers must single-flight (only one ask in flight per branch).
export function inboxForBranch(branch: string): string {
    return `gre-${sanitizeBranch(branch)}`
}

// Idempotently ensure a `# gre start … # gre end` block exists in the given
// CLAUDE.local.md file. The block is the agent's standing instructions for
// when a cbg-spawned Claude session in this project receives a gre ask. The
// block is a backup layer — every question payload also carries the contract
// inline (see generateAgentContract in clipboard.ts) — but Claude Code reads
// the project-local CLAUDE.local.md at session start, so the agent has the
// context up-front before it ever sees a question.
//
// Replaces existing content between markers if present, appends if missing,
// creates the file if missing. Returns "created" | "updated" | "unchanged".
const GRE_BLOCK_BODY = `\`gre\` (GitHub Review Explorer) is the central place in this repo for tracking PR review feedback — comments, CI failures, and merge conflicts. **If you make a change that addresses a review item, update gre so the user's TUI reflects reality.** Stale state is worse than no state. If a single change covers multiple items, mark each one.

You're collaborating with the user — keep the state up to date without clobbering choices the user already made. Strict rules below.

## Finding items

The state YAML lives at the path printed by \`gre info\`. Most relevant commands:
- \`gre list\` — list unresolved items
- \`gre list --type <comment|ci_failure|merge_conflict>\`, \`--category <…>\`, \`--status <…>\` — filters
- \`gre show <id>\` — full details for one item; **read this before updating** so you know what's already there
- \`gre info\` — print the state YAML path

Item ids: \`c0\`, \`c1\`, …, \`ci0\`, …, \`mc0\`, …

## Updating: narrow rules

### Status — only set \`auto_solved\`
Once you've made the code change, run \`gre set <id> status auto_solved\`. The status badge flips to orange ◎ in the TUI. **Do NOT set any other status** — \`unseen\`, \`unaddressed\`, \`asked_claude\`, and \`solved\` are all user-managed.

### Category — only promote from \`unknown\`
First run \`gre show <id>\` and look at the \`category\` field.
- If it's \`unknown\`: pick one of these and set it (\`gre set <id> category <…>\`):
  - \`simple_fix\` — small, contained code change
  - \`discussion\` — needs a back-and-forth, no clear answer yet
  - \`wontfix\` — explicitly not changing
  - \`large_change\` — substantial refactor / multi-file
  - \`nit\` — stylistic nitpick, low urgency
  - \`later\` — defer; not for this PR
- If it's anything else: **leave it alone.** The user already categorized it.

### Notes — don't clobber
\`gre note <id> "<text>"\` overwrites whatever was there. Always read first:
1. \`gre note <id>\` (no args) prints the current note.
2. If empty: \`gre note <id> "<your note>"\`.
3. If non-empty: combine the existing note with your addition (preserve the user's content verbatim) and write the combined value. Easiest pattern via stdin:
   \`{ gre note <id>; printf '\\n\\n<your addition>'; } | gre note <id> --stdin\`

### Draft response — don't clobber
\`gre draft <id>\` works the same way. **Critical:** if a draft is non-empty, the user is mid-typing it. Do NOT overwrite their draft. Either:
- Skip the draft and put your suggested wording in \`gre note <id>\` instead (the user can copy it over manually), OR
- If you genuinely need to extend it, read first and write the combined version (same stdin pattern as notes).

### Summary — fill if empty, otherwise leave it
The summary is a one-liner shown in the TUI list view. If empty, set one. If already set, don't touch it.

## When you fix something

If a fix is a single focused change, make it as one commit. After committing:
1. \`gre set <id> status auto_solved\`
2. If category was \`unknown\`, set it (probably \`fix\`).
3. If summary was empty, set a one-liner.
4. Optionally add a \`gre note\` recording what changed and why (using the don't-clobber pattern).
5. **Update every related item.** If your single commit addresses multiple review items, mark each of them auto_solved.

If it's \`wontfix\` or needs discussion, capture your reasoning in notes/draft per the rules above and set category if it's still \`unknown\` — don't commit code.

## Do NOT call

- \`gre send\` — posts the draft to GitHub. User-only.
- \`gre resolve\` — resolves the thread on GitHub. User-only.

## Special case: reached via \`cbg ask\` from the gre TUI

If you arrived through a \`cbg ask\` (the user pressed \`c\` in their gre TUI on a specific item), the question payload wraps that item's full context in \`<review-item>\` XML. **Reply via \`tell_session\`** to the inbox in the cbg hint at the top — the first line of your reply becomes the toast the user sees. Posting only in channel chat will park the user's gre process indefinitely. Apply the rules above to update state alongside the reply.`

const GRE_START = "# gre start"
const GRE_END = "# gre end"

export async function ensureGreInstructionBlock(filePath: string): Promise<"created" | "updated" | "unchanged"> {
    const block = `${GRE_START}\n\n${GRE_BLOCK_BODY}\n\n${GRE_END}`
    let existing: string | null = null
    try { existing = await Deno.readTextFile(filePath) }
    catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e }

    if (existing === null) {
        await Deno.writeTextFile(filePath, block + "\n")
        return "created"
    }

    const startIdx = existing.indexOf(GRE_START)
    const endIdx = existing.indexOf(GRE_END)
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        // Replace between markers (inclusive)
        const before = existing.slice(0, startIdx).trimEnd()
        const after = existing.slice(endIdx + GRE_END.length)
        const next = (before ? before + "\n\n" : "") + block + after
        if (next === existing) return "unchanged"
        await Deno.writeTextFile(filePath, next)
        return "updated"
    }

    // Marker missing — append
    const sep = existing.endsWith("\n") ? "\n" : "\n\n"
    await Deno.writeTextFile(filePath, existing + sep + block + "\n")
    return "updated"
}
