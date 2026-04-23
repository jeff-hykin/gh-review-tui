import type { ReviewItem, ReviewState } from "./types.ts"
import { itemId } from "./types.ts"
import $ from "jsr:@david/dax@0.42"

// ── Generate "ask Claude" content and copy to clipboard ──────────────────

export function generateClipboardContent(
    item: ReviewItem,
    index: number,
    state: ReviewState,
): string {
    const id = itemId(item, index)
    const parts: string[] = []

    // 1. Natural language overview
    parts.push(generateOverview(item, state))
    parts.push("")

    // 2. XML structured data
    parts.push(generateXML(item, index, state))
    parts.push("")

    // 3. CLI instructions
    parts.push(generateCLIInstructions(id))

    return parts.join("\n")
}

function generateOverview(item: ReviewItem, state: ReviewState): string {
    const pr = state.pr
    const lines: string[] = []

    lines.push(`I'm working on PR #${pr.number} "${pr.title}" in ${pr.repo} (branch: ${pr.branch}).`)

    switch (item.type) {
        case "comment": {
            const author = item.comments[0]?.author ?? "someone"
            lines.push(`${author} left a review comment on ${item.file}:${item.line}.`)
            if (item.notes) {
                lines.push(`My notes on this: ${item.notes}`)
            }
            if (item.category === "simple_fix") {
                lines.push("I've categorized this as a simple fix — please make the code change as a single commit.")
            } else if (item.category === "large_change") {
                lines.push("This requires a larger design change. Please implement it and explain your approach.")
            } else if (item.category === "wontfix") {
                lines.push("I've decided this is a wontfix. Please draft a polite response explaining why we're not changing this.")
            } else if (item.category === "discussion") {
                lines.push("I need to think about this more. Please help me reason through the tradeoffs.")
            }
            break
        }
        case "ci_failure":
            lines.push(`CI check "${item.check_name}" is failing. Please investigate and fix the issue in a single commit.`)
            break
        case "merge_conflict":
            lines.push(`There's a merge conflict with ${item.base_branch}. Please help resolve it.`)
            break
    }

    return lines.join("\n")
}

function generateXML(item: ReviewItem, index: number, state: ReviewState): string {
    const lines: string[] = []
    const id = itemId(item, index)

    lines.push("<review-item>")
    lines.push(`  <id>${id}</id>`)
    lines.push(`  <type>${item.type}</type>`)
    lines.push(`  <category>${item.category}</category>`)
    lines.push(`  <status>${item.status}</status>`)

    lines.push("  <pr>")
    lines.push(`    <number>${state.pr.number}</number>`)
    lines.push(`    <repo>${state.pr.repo}</repo>`)
    lines.push(`    <branch>${state.pr.branch}</branch>`)
    lines.push(`    <base>${state.pr.base_branch}</base>`)
    lines.push(`    <url>${state.pr.url}</url>`)
    lines.push("  </pr>")

    if (item.type === "comment") {
        lines.push(`  <file>${item.file}</file>`)
        lines.push(`  <line>${item.line}</line>`)
        if (item.diff_hunk) {
            lines.push(`  <diff-hunk><![CDATA[${item.diff_hunk}]]></diff-hunk>`)
        }
        lines.push("  <comments>")
        for (const c of item.comments) {
            lines.push("    <comment>")
            lines.push(`      <author>${c.author}</author>`)
            lines.push(`      <date>${c.created_at}</date>`)
            lines.push(`      <body><![CDATA[${c.body}]]></body>`)
            lines.push("    </comment>")
        }
        lines.push("  </comments>")
    } else if (item.type === "ci_failure") {
        lines.push(`  <check-name>${item.check_name}</check-name>`)
        lines.push(`  <run-id>${item.run_id}</run-id>`)
        lines.push(`  <commit>${item.commit_sha}</commit>`)
        lines.push(`  <url>${item.url}</url>`)
        if (item.error_summary) {
            lines.push(`  <error><![CDATA[${item.error_summary}]]></error>`)
        }
    } else if (item.type === "merge_conflict") {
        lines.push(`  <base-branch>${item.base_branch}</base-branch>`)
        lines.push(`  <commit>${item.commit_sha}</commit>`)
        if (item.conflicting_files.length > 0) {
            lines.push(`  <files>${item.conflicting_files.join(", ")}</files>`)
        }
    }

    if (item.notes) {
        lines.push(`  <notes><![CDATA[${item.notes}]]></notes>`)
    }
    if (item.draft_response) {
        lines.push(`  <draft-response><![CDATA[${item.draft_response}]]></draft-response>`)
    }

    lines.push("</review-item>")
    return lines.join("\n")
}

function generateCLIInstructions(id: string): string {
    return `After making changes, use these commands to update the review state:

# Mark the item as auto-solved (you think it's addressed but I haven't confirmed):
gre set ${id} status auto_solved

# Write a draft response for me to review before sending:
gre draft ${id} "Your explanation of what was changed and why"

# Add notes (context, reasoning, etc):
gre note ${id} "Your notes here"

# Set the summary (short description for the list view):
gre summary ${id} "Brief description of what this item is about"

# If this is a code fix, make it as a single focused commit on the current branch.`
}

// ── Copy text to clipboard (macOS/Linux) ─────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
    const os = Deno.build.os
    try {
        if (os === "darwin") {
            await $`pbcopy`.stdinText(text)
        } else {
            // Try xclip, then xsel
            const hasXclip = await $.commandExists("xclip")
            if (hasXclip) {
                await $`xclip -selection clipboard`.stdinText(text)
            } else {
                await $`xsel --clipboard --input`.stdinText(text)
            }
        }
        return true
    } catch {
        return false
    }
}
