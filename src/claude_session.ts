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
const GRE_BLOCK_BODY = `\`gre\` (GitHub Review Explorer) is the central place in this repo for working on PR review feedback — comments, CI failures, and merge conflicts. Whenever you're addressing review items in this repo, find them and update them through \`gre\`.

## Standard usage

The state YAML lives at the path printed by \`gre info\`. All \`gre\` commands operate on the current branch's PR.

**Finding items:**
- \`gre sync\` — fetch PR data from GitHub into local state (run if state seems stale)
- \`gre list\` — list unresolved review items
- \`gre list --all\` — include resolved
- \`gre list --type <comment|ci_failure|merge_conflict>\`, \`--category <…>\`, \`--status <…>\` — filters
- \`gre show <id>\` — full details for a single item
- \`gre info\` — print the state YAML path

**Updating items** (item ids look like \`c0\`, \`c1\`, …, \`ci0\`, …, \`mc0\`, …):
- \`gre set <id> status <unseen|unaddressed|auto_solved|solved>\` — track progress. Use \`auto_solved\` (renders orange ◎) once you've addressed something but want the human to confirm.
- \`gre set <id> category <fix|discussion|wontfix|large_change|unknown>\` — categorize.
- \`gre note <id> "<note>"\` — internal context, reasoning, links, gotchas. Not sent to GitHub.
- \`gre summary <id> "<one-liner>"\` — short description for the TUI list view.
- \`gre draft <id> "<reply text>"\` — draft a reply for the user to review before sending.

**Other:**
- \`gre open <id>\` — open the file in VS Code at the comment line.
- \`gre clip <id>\` — copy structured "ask Claude" context to the clipboard (only useful outside this agent loop).

**Do NOT call** \`gre send\` or \`gre resolve\` — those hit the GitHub API and the user should pre-approve.

If a fix is a single focused change, make it as one commit. If it's \`wontfix\` or needs discussion, draft the reply via \`gre draft\` rather than committing.

## Special case: reached via \`cbg ask\` from the gre TUI

If you arrived through a \`cbg ask\` (the user pressed \`c\` in their gre TUI on a specific item), the question payload includes the item's full context wrapped in \`<review-item>\` XML — you're focused on that single item. **Reply via \`tell_session\`** to the inbox shown in the cbg hint at the top of the question; the first line of your reply becomes the toast the user sees. Posting only in channel chat will park the user's gre process indefinitely. Use the same \`gre\` commands above to update state alongside the reply.`

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
