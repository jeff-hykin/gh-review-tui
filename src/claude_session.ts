// Async bridge between gre and a cbg-managed Claude session.
//
// On launch: ensure a topic session exists for the current branch.
// On ask:    spawn `cbg ask --sync` as a background subprocess and call
//            onReply / onError when it finishes. The TUI stays responsive.

export interface AskOptions {
    targetTopic: string
    fromInbox: string
    question: string
}

export interface AskResult {
    text: string
    raw: string
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

export function askAsync(opts: AskOptions): Promise<AskResult> {
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
    return child.output().then((out) => {
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
}

// Build a stable inbox name for one in-flight ask. Unique per gre process
// + ask sequence so concurrent asks don't evict each other.
let askSeq = 0
export function newInboxName(): string {
    return `gre-${Deno.pid}-${Date.now().toString(36)}-${(askSeq++).toString(36)}`
}

// Sanitize a branch name into something safe to use as a topic identifier.
// Strips path separators and other characters that might confuse cbg target
// resolution; keeps the name recognizable.
export function topicForBranch(branch: string): string {
    const safe = branch.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
    return `gre-${safe || "default"}`
}
