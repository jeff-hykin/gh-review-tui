import { Command } from "jsr:@cliffy/command@1.0.0-rc.7"
import $ from "jsr:@david/dax@0.42"
import { readAll } from "jsr:@std/io@0.224/read-all"
import type { ReviewState, ItemCategory, ItemStatus } from "./types.ts"
import { itemId, computeDisplayStatus } from "./types.ts"
import { statePath } from "./paths.ts"
import { loadState, saveState } from "./state.ts"
import { syncState } from "./sync.ts"
import * as gh from "./gh.ts"
import { formatListRow, formatItemDetail } from "./display.ts"
import { generateClipboardContent, copyToClipboard } from "./clipboard.ts"

// ── Helpers ──────────────────────────────────────────────────────────────

async function getStatePathForCwd(): Promise<string> {
    const remote = await gh.getRemoteUrl()
    const branch = await gh.getCurrentBranch()
    return statePath(remote, branch)
}

async function loadCurrentState(): Promise<ReviewState> {
    const path = await getStatePathForCwd()
    const state = await loadState(path)
    if (!state) {
        throw new Error("No state file found. Run `gre sync` first.")
    }
    return state
}

async function saveCurrentState(state: ReviewState): Promise<void> {
    const path = await getStatePathForCwd()
    await saveState(path, state)
}

function resolveItemIndex(state: ReviewState, idStr: string): number {
    const match = idStr.match(/^(c|ci|mc)(\d+)$/)
    if (!match) {
        throw new Error(`Invalid item ID "${idStr}". Use format like c0, ci1, mc0.`)
    }

    const [, prefix, numStr] = match
    const index = parseInt(numStr, 10)

    const item = state.items[index]
    if (!item) {
        throw new Error(`Item index ${index} out of range (${state.items.length} items total).`)
    }

    const expectedPrefix = item.type === "comment" ? "c" : item.type === "ci_failure" ? "ci" : "mc"
    if (prefix !== expectedPrefix) {
        throw new Error(`ID "${idStr}" has prefix "${prefix}" but item at index ${index} is type "${item.type}" (expected prefix "${expectedPrefix}").`)
    }

    return index
}

const VALID_CATEGORIES: ItemCategory[] = ["simple_fix", "discussion", "wontfix", "large_change", "nit", "later", "unknown"]
const VALID_STATUSES: ItemStatus[] = ["unseen", "unaddressed", "auto_solved", "solved"]

// ── Individual command actions (extracted for type clarity) ───────────────

async function infoAction(): Promise<void> {
    const path = await getStatePathForCwd()
    console.log(path)
}

async function syncAction(): Promise<void> {
    const path = await getStatePathForCwd()
    const existing = await loadState(path)
    console.log("Syncing with GitHub...")
    const state = await syncState(existing)
    await saveState(path, state)
    const commentCount = state.items.filter((i) => i.type === "comment").length
    const ciCount = state.items.filter((i) => i.type === "ci_failure").length
    const conflictCount = state.items.filter((i) => i.type === "merge_conflict").length
    console.log(`Synced PR #${state.pr.number} "${state.pr.title}"`)
    console.log(`  ${commentCount} comment threads, ${ciCount} CI failures, ${conflictCount} merge conflicts`)
}

async function listAction(options: { all?: boolean; type?: string; category?: string; status?: string }): Promise<void> {
    const state = await loadCurrentState()
    let items = state.items.map((item, index) => ({ item, index }))

    if (!options.all) {
        items = items.filter(({ item }) => {
            const ds = computeDisplayStatus(item, state.gh_user)
            return ds !== "resolved"
        })
    }

    if (options.type) {
        items = items.filter(({ item }) => item.type === options.type)
    }
    if (options.category) {
        items = items.filter(({ item }) => item.category === options.category)
    }
    if (options.status) {
        items = items.filter(({ item }) => item.status === options.status)
    }

    if (items.length === 0) {
        console.log("No items to show.")
        return
    }

    console.log(`PR #${state.pr.number}: ${state.pr.title}`)
    console.log(`${"─".repeat(80)}`)
    for (const { item, index } of items) {
        console.log(formatListRow(item, index, state.gh_user))
    }
    console.log(`${"─".repeat(80)}`)
    console.log(`${items.length} item(s)`)
}

async function showAction(id: string): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    console.log(formatItemDetail(state.items[index], index, state.gh_user))
}

async function setAction(id: string, field: string, value: string): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    const item = state.items[index]

    switch (field) {
        case "category": {
            if (!VALID_CATEGORIES.includes(value as ItemCategory)) {
                throw new Error(`Invalid category "${value}". Valid: ${VALID_CATEGORIES.join(", ")}`)
            }
            item.category = value as ItemCategory
            break
        }
        case "status": {
            if (!VALID_STATUSES.includes(value as ItemStatus)) {
                throw new Error(`Invalid status "${value}". Valid: ${VALID_STATUSES.join(", ")}`)
            }
            item.status = value as ItemStatus
            break
        }
        default:
            throw new Error(`Unknown field "${field}". Valid: category, status`)
    }

    await saveCurrentState(state)
    console.log(`Set ${id}.${field} = ${value}`)
}

async function draftAction(id: string, text: string | undefined, useStdin: boolean): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    const item = state.items[index]

    if (useStdin) {
        const buf = await readAll(Deno.stdin)
        if (buf.length > 0) {
            item.draft_response = new TextDecoder().decode(buf).trimEnd()
            await saveCurrentState(state)
            console.log(`Draft saved for ${id} (${item.draft_response.length} chars)`)
        }
    } else if (text) {
        item.draft_response = text
        await saveCurrentState(state)
        console.log(`Draft saved for ${id} (${item.draft_response.length} chars)`)
    } else {
        if (item.draft_response) {
            console.log(item.draft_response)
        } else {
            console.log("(no draft)")
        }
    }
}

async function noteAction(id: string, text: string | undefined, useStdin: boolean): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    const item = state.items[index]

    if (useStdin) {
        const buf = await readAll(Deno.stdin)
        if (buf.length > 0) {
            item.notes = new TextDecoder().decode(buf).trimEnd()
            await saveCurrentState(state)
            console.log(`Notes saved for ${id}`)
        }
    } else if (text) {
        item.notes = text
        await saveCurrentState(state)
        console.log(`Notes saved for ${id}`)
    } else {
        if (item.notes) {
            console.log(item.notes)
        } else {
            console.log("(no notes)")
        }
    }
}

async function summaryAction(id: string, text: string | undefined): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    const item = state.items[index]

    if (text) {
        item.summary = text
        await saveCurrentState(state)
        console.log(`Summary saved for ${id}`)
    } else {
        if (item.summary) {
            console.log(item.summary)
        } else {
            console.log("(no summary)")
        }
    }
}

async function sendAction(id: string): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    const item = state.items[index]

    if (item.type !== "comment") {
        throw new Error("Can only send replies to comment items.")
    }
    if (!item.draft_response) {
        throw new Error(`No draft response for ${id}. Use \`gre draft ${id} "text"\` first.`)
    }
    if (!item.thread_node_id) {
        throw new Error("Missing thread node ID — try re-syncing with `gre sync`.")
    }

    console.log("Sending reply...")
    const result = await gh.postReply(state.pr.repo, state.pr.number, item.thread_node_id, item.draft_response)
    if (result.ok) {
        item.draft_response = ""
        await saveCurrentState(state)
        console.log(`Reply sent for ${id}.`)
    } else {
        console.error(`Failed to send reply: ${result.error ?? "unknown error"}`)
        Deno.exit(1)
    }
}

async function resolveAction(id: string): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    const item = state.items[index]

    if (item.type !== "comment") {
        throw new Error("Can only resolve comment items.")
    }
    if (!item.thread_node_id) {
        throw new Error("Missing thread node ID — try re-syncing with `gre sync`.")
    }

    console.log("Resolving thread...")
    const result = await gh.resolveThread(item.thread_node_id)
    if (result.ok) {
        item.resolved = true
        await saveCurrentState(state)
        console.log(`Thread ${id} resolved.`)
    } else {
        console.error(`Failed to resolve thread: ${result.error ?? "unknown error"}`)
        Deno.exit(1)
    }
}

async function openAction(id: string): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    const item = state.items[index]

    if (item.type !== "comment") {
        throw new Error("Can only open files for comment items.")
    }

    const target = item.line > 0 ? `${item.file}:${item.line}` : item.file
    await $`code -g ${target}`
    console.log(`Opened ${target}`)
}

async function clipAction(id: string): Promise<void> {
    const state = await loadCurrentState()
    const index = resolveItemIndex(state, id)
    const content = generateClipboardContent(state.items[index], index, state)
    const ok = await copyToClipboard(content)
    if (ok) {
        console.log(`Copied ${content.length} chars to clipboard for ${id}.`)
    } else {
        console.log(content)
        console.error("\n(Could not copy to clipboard — printed above instead)")
    }
}

// ── CLI Definition ───────────────────────────────────────────────────────

export function buildCLI(): Command {
    const cmd = new Command()
        .name("gre")
        .version("0.1.0")
        .description("GitHub Review Explorer — burn through PR review comments from the terminal.")

    cmd.command("info", "Print the path to the YAML state file for the current PR")
        .action(infoAction)

    cmd.command("sync", "Fetch PR data from GitHub and update local state")
        .action(syncAction)

    cmd.command("list", "List all review items")
        .option("-a, --all", "Include resolved items")
        .option("-t, --type <type:string>", "Filter by type (comment, ci_failure, merge_conflict)")
        .option("-c, --category <category:string>", "Filter by category")
        .option("-s, --status <status:string>", "Filter by status")
        .action(listAction)

    cmd.command("show <id:string>", "Show details for a review item")
        .action((_options: void, id: string) => showAction(id))

    cmd.command("set <id:string> <field:string> <value:string>", "Set a field on a review item")
        .action((_options: void, id: string, field: string, value: string) => setAction(id, field, value))

    cmd.command("draft <id:string> [text...:string]", "Get or set a draft response")
        .option("--stdin", "Read draft from stdin")
        .action((options: { stdin?: boolean }, id: string, ...textParts: string[]) => {
            const text = textParts.length > 0 ? textParts.join(" ") : undefined
            return draftAction(id, text, options.stdin ?? false)
        })

    cmd.command("note <id:string> [text...:string]", "Get or set notes for an item")
        .option("--stdin", "Read notes from stdin")
        .action((options: { stdin?: boolean }, id: string, ...textParts: string[]) => {
            const text = textParts.length > 0 ? textParts.join(" ") : undefined
            return noteAction(id, text, options.stdin ?? false)
        })

    cmd.command("summary <id:string> [text...:string]", "Get or set the summary for an item")
        .action((_options: void, id: string, ...textParts: string[]) => {
            const text = textParts.length > 0 ? textParts.join(" ") : undefined
            return summaryAction(id, text)
        })

    cmd.command("send <id:string>", "Send draft response as a GitHub reply")
        .action((_options: void, id: string) => sendAction(id))

    cmd.command("resolve <id:string>", "Resolve a review thread on GitHub")
        .action((_options: void, id: string) => resolveAction(id))

    cmd.command("open <id:string>", "Open the relevant file in VS Code")
        .action((_options: void, id: string) => openAction(id))

    cmd.command("clip <id:string>", "Copy 'ask Claude' context to clipboard")
        .action((_options: void, id: string) => clipAction(id))

    return cmd
}
