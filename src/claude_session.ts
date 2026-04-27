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
