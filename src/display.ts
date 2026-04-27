import type { ReviewItem, CommentItem, CIFailureItem, MergeConflictItem, DisplayStatus, ItemCategory, ItemStatus } from "./types.ts"
import { computeDisplayStatus, itemId } from "./types.ts"
import { textWidth as tuiTextWidth } from "deno_tui/utils/strings.ts"

// ── ANSI colors ──────────────────────────────────────────────────────────

const DIM = "\x1b[2m"
const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"
const MAGENTA = "\x1b[35m"
const WHITE = "\x1b[37m"
const BG_RED = "\x1b[41m"
const BG_YELLOW = "\x1b[43m"
const BG_GREEN = "\x1b[42m"

// 8 distinguishable foreground colors for author hashing
const AUTHOR_COLORS = [
    "\x1b[31m", // red
    "\x1b[32m", // green
    "\x1b[33m", // yellow
    "\x1b[34m", // blue
    "\x1b[35m", // magenta
    "\x1b[36m", // cyan
    "\x1b[91m", // bright red
    "\x1b[94m", // bright blue
]

// ── Deterministic author color ───────────────────────────────────────────

function hashString(s: string): number {
    let hash = 0
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash)
}

export function authorColor(name: string): string {
    return AUTHOR_COLORS[hashString(name) % AUTHOR_COLORS.length]
}

export function coloredAuthor(name: string): string {
    return `${authorColor(name)}${name}${RESET}`
}

// ── Status formatting ────────────────────────────────────────────────────

export function formatDisplayStatus(ds: DisplayStatus): string {
    switch (ds) {
        case "pending":
            return `${CYAN}pending${RESET}`
        case "response_needed":
            return `${YELLOW}needs response${RESET}`
        case "resolved":
            return `${DIM}resolved${RESET}`
    }
}

export function formatItemStatus(status: ItemStatus): string {
    switch (status) {
        case "unseen":
            return `${BOLD}${WHITE}NEW${RESET}`
        case "unaddressed":
            return `${YELLOW}unaddressed${RESET}`
        case "asked_claude":
            return `${YELLOW}asked-claude${RESET}`
        case "auto_solved":
            return `${BG_YELLOW}\x1b[30m auto-solved ${RESET}`
        case "solved":
            return `${GREEN}solved${RESET}`
    }
}

export function formatCategory(cat: ItemCategory): string {
    switch (cat) {
        case "simple_fix":
            return `${GREEN}simple fix${RESET}`
        case "discussion":
            return `${MAGENTA}discuss${RESET}`
        case "wontfix":
            return `${DIM}wontfix${RESET}`
        case "large_change":
            return `${RED}large change${RESET}`
        case "unknown":
            return `${DIM}???${RESET}`
    }
}

// ── Truncate ─────────────────────────────────────────────────────────────

export function truncate(s: string, max: number): string {
    if (tuiTextWidth(s) <= max) {
        return s
    }
    // Trim characters until visual width fits, accounting for wide chars
    let result = s
    while (tuiTextWidth(result) > max - 1 && result.length > 0) {
        result = result.slice(0, result.length - 1)
    }
    return result + "…"
}

// ── Snippet for list view ────────────────────────────────────────────────

export function itemSnippet(item: ReviewItem): string {
    if (item.summary) {
        return truncate(item.summary, 60)
    }

    switch (item.type) {
        case "comment": {
            const firstBody = item.comments[0]?.body ?? ""
            const firstLine = firstBody.split("\n").find((l) => l.trim().length > 0) ?? ""
            return truncate(firstLine.replace(/<[^>]*>/g, ""), 60)
        }
        case "ci_failure":
            return truncate(`CI: ${item.check_name} failed`, 60)
        case "merge_conflict":
            return truncate(`Merge conflict with ${item.base_branch}`, 60)
    }
}

// ── Format a single list row ─────────────────────────────────────────────

export function formatListRow(
    item: ReviewItem,
    index: number,
    ghUser: string,
): string {
    const id = itemId(item, index)
    const ds = computeDisplayStatus(item, ghUser)
    const statusStr = formatItemStatus(item.status)
    const catStr = formatCategory(item.category)
    const snippet = itemSnippet(item)

    let authorStr = ""
    if (item.type === "comment" && item.comments.length > 0) {
        const firstAuthor = item.comments[0].author
        authorStr = coloredAuthor(firstAuthor)
    } else if (item.type === "ci_failure") {
        authorStr = `${RED}CI${RESET}`
    } else if (item.type === "merge_conflict") {
        authorStr = `${RED}CONFLICT${RESET}`
    }

    const draftIndicator = item.draft_response ? `${CYAN}✎${RESET} ` : ""
    const notesIndicator = item.notes ? `${DIM}📝${RESET} ` : ""

    const parts = [
        `${DIM}${id.padEnd(5)}${RESET}`,
        statusStr.padEnd(20),
        catStr.padEnd(22),
        `${authorStr}`.padEnd(25),
        `${draftIndicator}${notesIndicator}${snippet}`,
    ]

    return parts.join(" ")
}

// ── Format detailed view of a single item ────────────────────────────────

export function formatItemDetail(item: ReviewItem, index: number, ghUser: string): string {
    const lines: string[] = []
    const id = itemId(item, index)
    const ds = computeDisplayStatus(item, ghUser)

    lines.push(`${BOLD}Item: ${id}${RESET}`)
    lines.push(`  Type:     ${item.type}`)
    lines.push(`  Status:   ${formatItemStatus(item.status)}`)
    lines.push(`  Category: ${formatCategory(item.category)}`)
    lines.push(`  Display:  ${formatDisplayStatus(ds)}`)

    if (item.type === "comment") {
        lines.push(`  File:     ${item.file}:${item.line}`)
        lines.push(`  Thread:   ${item.thread_id}`)
        lines.push(`  Resolved: ${item.resolved}`)
        lines.push("")

        if (item.diff_hunk) {
            lines.push(`${DIM}── diff context ──${RESET}`)
            for (const line of item.diff_hunk.split("\n").slice(-6)) {
                lines.push(`  ${DIM}${line}${RESET}`)
            }
            lines.push("")
        }

        lines.push(`${BOLD}Comments (${item.comments.length}):${RESET}`)
        for (const c of item.comments) {
            const date = c.created_at.slice(0, 10)
            lines.push(`  ${coloredAuthor(c.author)} ${DIM}(${date})${RESET}:`)
            for (const bodyLine of c.body.split("\n")) {
                lines.push(`    ${bodyLine}`)
            }
            lines.push("")
        }
    } else if (item.type === "ci_failure") {
        lines.push(`  Check:    ${item.check_name}`)
        lines.push(`  Run ID:   ${item.run_id}`)
        lines.push(`  Commit:   ${item.commit_sha.slice(0, 8)}`)
        lines.push(`  URL:      ${item.url}`)
        if (item.error_summary) {
            lines.push("")
            lines.push(`${BOLD}Error:${RESET}`)
            lines.push(`  ${item.error_summary}`)
        }
    } else if (item.type === "merge_conflict") {
        lines.push(`  Base:     ${item.base_branch}`)
        lines.push(`  Commit:   ${item.commit_sha.slice(0, 8)}`)
        if (item.conflicting_files.length > 0) {
            lines.push(`  Files:    ${item.conflicting_files.join(", ")}`)
        }
    }

    if (item.notes) {
        lines.push("")
        lines.push(`${BOLD}Notes:${RESET}`)
        lines.push(`  ${item.notes}`)
    }

    if (item.draft_response) {
        lines.push("")
        lines.push(`${BOLD}${CYAN}Draft response:${RESET}`)
        for (const line of item.draft_response.split("\n")) {
            lines.push(`  ${CYAN}${line}${RESET}`)
        }
    }

    return lines.join("\n")
}
