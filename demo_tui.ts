#!/usr/bin/env -S deno run --allow-all
// Demo TUI with fake data — no GitHub connection needed.
// Run: deno run --allow-all demo_tui.ts

import { crayon } from "https://deno.land/x/crayon@3.3.3/mod.ts"
import { Tui } from "deno_tui/tui.ts"
import { handleInput } from "deno_tui/input.ts"
import { handleMouseControls } from "deno_tui/controls.ts"
import { Signal } from "deno_tui/signals/mod.ts"
import { TextBox } from "deno_tui/components/textbox.ts"
import { Label } from "deno_tui/components/label.ts"
import { Frame } from "deno_tui/components/frame.ts"

import type { ReviewState, ReviewItem, ItemCategory, ItemStatus } from "./src/types.ts"
import { itemId, computeDisplayStatus } from "./src/types.ts"
import { truncate } from "./src/display.ts"
import { generateClipboardContent, copyToClipboard } from "./src/clipboard.ts"
import { wordWrap } from "./src/word_wrap.ts"
import { insertAt, textWidth as tuiTextWidth } from "deno_tui/utils/strings.ts"
import { clamp } from "deno_tui/utils/numbers.ts"

// ── Logging ──────────────────────────────────────────────────────────────

const LOG_FILE = "/tmp/gre-debug.log"
Deno.writeTextFileSync(LOG_FILE, `=== gre TUI debug log ${new Date().toISOString()} ===\n`)
function log(...args: unknown[]): void {
    const line = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")
    Deno.writeTextFileSync(LOG_FILE, `[${new Date().toISOString().slice(11, 23)}] ${line}\n`, { append: true })
}

// ── Author hashing ──────────────────────────────────────────────────────

const AUTHOR_SYMBOLS = [
    "◆", "◇", "●", "○", "■", "□", "▲", "△", "▼", "▽",
    "♠", "♣", "♥", "♦", "★", "☆", "◈", "◉", "◊", "▣",
    "▧", "▩", "⊕", "⊗", "⊙", "⊘", "⊛", "⊜", "⊞", "⊟",
]

function hashCode(s: string): number {
    let hash = 0
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash)
}

function authorTag(name: string): string {
    const h = hashCode(name)
    return AUTHOR_SYMBOLS[h % AUTHOR_SYMBOLS.length] + AUTHOR_SYMBOLS[Math.abs((h >>> 8) ^ (h * 31)) % AUTHOR_SYMBOLS.length]
}

// ── Catppuccin palette ──────────────────────────────────────────────────

const BG      = 0x1e1e2e
const BG_SEL  = 0x313244
const BG_SURF = 0x181825
const FG      = 0xcdd6f4
const DIM     = 0x6c7086
const YELLOW  = 0xf9e2af
const GREEN   = 0xa6e3a1
const RED     = 0xf38ba8
const MAGENTA = 0xcba6f7
const CYAN    = 0x89dceb
const ORANGE  = 0xfab387
const BLUE    = 0x89b4fa
const PINK    = 0xf5c2e7

const AUTHOR_HUES = [RED, GREEN, BLUE, ORANGE, MAGENTA, CYAN, YELLOW, PINK]
function authorHue(name: string): number {
    return AUTHOR_HUES[hashCode(name) % AUTHOR_HUES.length]
}

// ── Fake data ────────────────────────────────────────────────────────────

const fakeState: ReviewState = {
    pr: {
        number: 42, repo: "dimensional-robotics/dimos",
        branch: "feature/smart-nav-refactor", base_branch: "dev",
        title: "Refactor smart_nav to use SimplePlanner with costmap integration",
        url: "https://github.com/dimensional-robotics/dimos/pull/42",
        author: "jeff-hykin",
    },
    last_synced: "2026-04-23T10:00:00Z",
    gh_user: "jeff-hykin",
    items: [
        {
            type: "comment", thread_id: "1001", thread_node_id: "PRRT_1001",
            category: "unknown", status: "unseen",
            file: "src/smart_nav/planner.py", line: 142,
            diff_hunk: "@@ -140,6 +140,10 @@\n+        if costmap is None:\n+            return None",
            comments: [
                { id: "c1", author: "arescrimson", body: "Should we fall back to the old planner here instead of returning None? Returning None will cause the robot to stop moving entirely.\n\nMaybe a retry with a short timeout would be better?", created_at: "2026-04-22T14:30:00Z" },
            ],
            resolved: false, draft_response: "", notes: "", summary: "",
        },
        {
            type: "comment", thread_id: "1002", thread_node_id: "PRRT_1002",
            category: "simple_fix", status: "unaddressed",
            file: "src/smart_nav/costmap.py", line: 78,
            diff_hunk: "@@ -76,3 +76,8 @@\n+        merged = np.zeros_like(self.base_map)",
            comments: [
                { id: "c2", author: "connor-grepile", body: "nit: this allocates a new array every call. Consider caching the merged result.", created_at: "2026-04-22T15:00:00Z" },
                { id: "c3", author: "jeff-hykin", body: "Good catch. I'll add a dirty flag.", created_at: "2026-04-22T16:00:00Z" },
            ],
            resolved: false, draft_response: "", notes: "", summary: "Cache merged costmap",
        },
        {
            type: "comment", thread_id: "1003", thread_node_id: "PRRT_1003",
            category: "discussion", status: "unseen",
            file: "src/smart_nav/config.py", line: 23,
            diff_hunk: "@@ -20,6 +20,10 @@\n+    \"inflation_radius\": 0.3,",
            comments: [
                { id: "c4", author: "arescrimson", body: "The inflation radius of 0.3m seems too small for our robot's footprint.", created_at: "2026-04-22T15:30:00Z" },
                { id: "c5", author: "connor-grepile", body: "Agreed. Also the costmap_resolution should match SLAM output.", created_at: "2026-04-22T15:45:00Z" },
            ],
            resolved: false, draft_response: "", notes: "Check ARISE output resolution",
            summary: "Config values need per-robot tuning",
        },
        {
            type: "comment", thread_id: "1004", thread_node_id: "PRRT_1004",
            category: "unknown", status: "unseen",
            file: "tests/test_planner.py", line: 55, diff_hunk: "",
            comments: [
                { id: "c6", author: "connor-grepile", body: "This test will fail if compute_path returns None for empty costmaps.", created_at: "2026-04-22T16:15:00Z" },
            ],
            resolved: false,
            draft_response: "You're right, I'll fix the test to set up a valid costmap first.",
            notes: "", summary: "Test inconsistent with None-return",
        },
        {
            type: "ci_failure", category: "unknown", status: "unseen",
            run_id: "88888", check_name: "pytest-ubuntu", conclusion: "FAILURE",
            commit_sha: "a1b2c3d4", recorded_at: "2026-04-23T08:00:00Z",
            error_summary: "FAILED tests/test_costmap.py::test_merge_layers\nFAILED tests/test_planner.py::test_compute_path",
            url: "https://github.com/org/repo/actions/runs/88888",
            draft_response: "", notes: "", summary: "",
        },
    ] as ReviewItem[],
}

// ── App state ────────────────────────────────────────────────────────────

type ViewMode = "list" | "detail_browse" | "detail_edit"
type EditTarget = "notes" | "draft"

const state = fakeState
const { columns: termW, rows: termH } = Deno.consoleSize()
const PAD_LEFT = 2
const PAD_TOP = 1  // blank row after header
const contentW = Math.min(termW - PAD_LEFT * 2, 118)
log("size:", { termW, termH, contentW })

const mode = new Signal<ViewMode>("list")
const selectedIndex = new Signal(0)
const editTarget = new Signal<EditTarget>("notes")  // default to notes
const commentScrollOffset = new Signal(0)

let detailCommentOffsets: number[] = []

function getVisibleItems(): { item: ReviewItem; origIndex: number }[] {
    return state.items
        .map((item, origIndex) => ({ item, origIndex }))
        .filter(({ item }) => computeDisplayStatus(item, state.gh_user) !== "resolved")
}

let visibleItems = getVisibleItems()

const BODY_LINES = termH - 3 - PAD_TOP
const LINES_PER_ITEM = 3
const MAX_VISIBLE_ITEMS = Math.floor(BODY_LINES / LINES_PER_ITEM)

function padLines(lines: string[], count: number): string {
    const result = [...lines]
    while (result.length < count) { result.push(" ") }
    return result.slice(0, count).join("\n")
}

// ── TUI setup ────────────────────────────────────────────────────────────

const tui = new Tui({
    style: crayon.bgHex(BG),
    refreshRate: 1000 / 30,
})

handleInput(tui)
handleMouseControls(tui)
tui.dispatch()
tui.run()

// ── Base components ─────────────────────────────────────────────────────

const BODY_ROW = 1 + PAD_TOP  // first row of body content

const headerText = new Signal("loading...")
new Label({
    parent: tui,
    theme: { base: crayon.bgHex(BG_SURF).hex(BLUE).bold },
    rectangle: { column: PAD_LEFT, row: 0, width: contentW, height: 1 },
    overwriteRectangle: true,
    text: headerText,
    zIndex: 10,
})

const bodyText = new Signal(padLines([], BODY_LINES))
new Label({
    parent: tui,
    theme: { base: crayon.bgHex(BG).hex(FG) },
    rectangle: { column: PAD_LEFT, row: BODY_ROW, width: contentW, height: BODY_LINES },
    overwriteRectangle: true,
    text: bodyText,
    zIndex: 4,
})

const helpText = new Signal(" \n ")
new Label({
    parent: tui,
    theme: { base: crayon.bgHex(BG).hex(DIM) },
    rectangle: { column: PAD_LEFT, row: termH - 2, width: contentW, height: 2 },
    overwriteRectangle: true,
    text: helpText,
    zIndex: 10,
})

const splitRow = Math.floor(termH * 0.55) + PAD_TOP
const editorHeight = termH - splitRow - 3  // -3: help bar (2) + frame bottom border (1)
const COMMENT_AREA_HEIGHT = splitRow - 2 - PAD_TOP - 2

// ── Word-jump helpers ───────────────────────────────────────────────────

function wordBoundaryLeft(line: string, x: number): number {
    let i = x - 1
    // skip whitespace
    while (i > 0 && /\s/.test(line[i]!)) { i-- }
    // skip word chars
    while (i > 0 && !/\s/.test(line[i - 1]!)) { i-- }
    return Math.max(0, i)
}

function wordBoundaryRight(line: string, x: number): number {
    let i = x
    // skip word chars
    while (i < line.length && !/\s/.test(line[i]!)) { i++ }
    // skip whitespace
    while (i < line.length && /\s/.test(line[i]!)) { i++ }
    return i
}

// ── Editor with custom keyboard handler ─────────────────────────────────

const editor = new TextBox({
    parent: tui,
    theme: {
        base: crayon.bgHex(BG).hex(FG),
        focused: crayon.bgHex(BG).hex(FG),
        active: crayon.bgHex(BG).hex(FG),
        value: {
            base: crayon.bgHex(BG).hex(FG),
            focused: crayon.bgHex(BG).hex(FG),
            active: crayon.bgHex(BG).hex(FG),
        },
        cursor: {
            base: crayon.bgWhite.black,
            focused: crayon.bgHex(YELLOW).black,
            active: crayon.bgHex(GREEN).black,
        },
        lineNumbers: {
            base: crayon.bgHex(BG_SURF).hex(DIM),
            focused: crayon.bgHex(BG_SURF).hex(DIM),
            active: crayon.bgHex(BG_SURF).hex(DIM),
        },
        highlightedLine: {
            base: crayon.bgHex(BG_SEL).hex(FG),
            focused: crayon.bgHex(BG_SEL).hex(FG),
            active: crayon.bgHex(BG_SEL).hex(FG),
        },
    },
    rectangle: { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight },
    text: "",
    lineNumbering: false,
    lineHighlighting: true,
    multiCodePointSupport: true,
    zIndex: 8,
    keyboardHandler({ key, ctrl, meta, shift }: any) {
        const cur = editor.cursorPosition.peek()
        const textLines = editor.text.peek().split("\n")
        const textLine = textLines[cur.y] ??= ""

        // ── Ctrl shortcuts ──
        if (ctrl && key === "a") { cur.x = 0; editor.cursorPosition.value = { ...cur }; return }
        if (ctrl && key === "e") { cur.x = textLine.length; editor.cursorPosition.value = { ...cur }; return }
        // Cmd+left/right → jump to start/end of line (macOS sends ctrl+arrow for cmd+arrow)
        if (ctrl && key === "left") { cur.x = 0; editor.cursorPosition.value = { ...cur }; return }
        if (ctrl && key === "right") { cur.x = textLine.length; editor.cursorPosition.value = { ...cur }; return }
        if (ctrl && key === "k") {
            // Kill to end of line
            textLines[cur.y] = textLine.slice(0, cur.x)
            editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return
        }
        if (ctrl && key === "w") {
            // Delete word left
            const boundary = wordBoundaryLeft(textLine, cur.x)
            textLines[cur.y] = textLine.slice(0, boundary) + textLine.slice(cur.x)
            cur.x = boundary
            editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return
        }
        if (ctrl && key === "backspace") {
            // Cmd+backspace: delete entire line (macOS sends ctrl+backspace for cmd+backspace)
            if (textLines.length > 1) {
                textLines.splice(cur.y, 1)
                cur.y = Math.min(cur.y, textLines.length - 1)
                cur.x = Math.min(cur.x, textLines[cur.y]?.length ?? 0)
            } else {
                textLines[0] = ""
                cur.x = 0
            }
            editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return
        }

        // ── Alt/Option + arrow = word jump ──
        // macOS terminals send alt+left as meta+"b" (readline) or meta+"left" (xterm)
        if (meta && (key === "left" || key === "b")) { cur.x = wordBoundaryLeft(textLine, cur.x); editor.cursorPosition.value = { ...cur }; return }
        if (meta && (key === "right" || key === "f")) { cur.x = wordBoundaryRight(textLine, cur.x); editor.cursorPosition.value = { ...cur }; return }
        // Alt+up/down = jump to start/end of document
        if (meta && key === "up") { cur.y = 0; cur.x = 0; editor.cursorPosition.value = { ...cur }; return }
        if (meta && key === "down") { cur.y = textLines.length - 1; cur.x = textLines[cur.y].length; editor.cursorPosition.value = { ...cur }; return }
        // Alt+backspace = delete word left
        if (meta && key === "backspace") {
            const boundary = wordBoundaryLeft(textLine, cur.x)
            textLines[cur.y] = textLine.slice(0, boundary) + textLine.slice(cur.x)
            cur.x = boundary
            editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return
        }

        // Skip remaining ctrl/meta combos (cmd+enter etc. propagate to tui keyPress)
        if (ctrl || meta) return

        let character!: string

        switch (key) {
            case "left":  --cur.x; break
            case "right": ++cur.x; break
            case "up":    --cur.y; break
            case "down":
                if (textLines.length - 1 > cur.y) { ++cur.y }
                break
            case "home": cur.x = 0; editor.cursorPosition.value = { ...cur }; return
            case "end":  cur.x = textLine.length; editor.cursorPosition.value = { ...cur }; return
            case "backspace":
                if (cur.x === 0) {
                    if (cur.y === 0) return
                    textLines[cur.y - 1] += textLines[cur.y]
                    textLines.splice(cur.y, 1)
                    --cur.y
                    cur.x = textLines[cur.y].length
                } else {
                    textLines[cur.y] = textLine.slice(0, cur.x - 1) + textLine.slice(cur.x)
                    cur.x = clamp(cur.x - 1, 0, textLine.length)
                }
                break
            case "delete":
                textLines[cur.y] = textLine.slice(0, cur.x) + textLine.slice(cur.x + 1)
                if (cur.x === textLine.length && textLines.length - 1 > cur.y) {
                    textLines[cur.y] += textLines[cur.y + 1]
                    textLines.splice(cur.y + 1, 1)
                }
                break
            case "return": ++cur.y; break
            case "space": character = " "; break
            case "tab":   character = "\t"; break
            default:
                if (key.length > 1) return
                character = key
        }

        cur.y = clamp(cur.y, 0, textLines.length)
        cur.x = clamp(cur.x, 0, textLines[cur.y]?.length ?? 0)

        if (character) {
            textLines[cur.y] = insertAt(textLine, cur.x, character)
            ++cur.x
        }

        editor.text.value = textLines.join("\n")
        editor.cursorPosition.value = { ...cur }
    },
})

// ── Detail view frames ──────────────────────────────────────────────────

// Editor panel frame
const editorFrameRect = new Signal<any>({ column: 2, row: splitRow + 1, width: contentW - 2, height: editorHeight })
const editorFrameStyle = crayon.bgHex(BG).hex(DIM)
const editorFrame = new Frame({
    parent: tui,
    charMap: "rounded",
    theme: { base: editorFrameStyle, focused: editorFrameStyle, active: editorFrameStyle, disabled: editorFrameStyle },
    rectangle: editorFrameRect,
    zIndex: 7,
})
editorFrame.visible.value = false

function setFrameColor(frame: Frame, color: number): void {
    const style = crayon.bgHex(BG).hex(color)
    frame.theme = { base: style, focused: style, active: style, disabled: style }
    frame.state.value = "focused"; frame.state.value = "base"
}

// "Press enter to start typing" overlay on top of editor
const editorOverlayText = new Signal(" ")
const editorOverlayRect = new Signal<any>({ column: 1, row: 9999, width: contentW, height: editorHeight })
const editorOverlayStyle = crayon.bgHex(BG).hex(DIM)
const editorOverlay = new Label({
    parent: tui,
    theme: { base: editorOverlayStyle, focused: editorOverlayStyle, active: editorOverlayStyle, disabled: editorOverlayStyle },
    rectangle: editorOverlayRect,
    overwriteRectangle: true,
    text: editorOverlayText,
    zIndex: 9,  // above editor (8)
})

log("Components created")

// ── Inline color helpers ────────────────────────────────────────────────
// All coloring uses inline ANSI via crayon, embedded directly in Label text.
// No overlay Labels needed.

// ── Helpers ──────────────────────────────────────────────────────────────

function statusLabel(s: ItemStatus): string {
    switch (s) {
        case "unseen":      return " NEW "
        case "unaddressed":  return "  .  "
        case "auto_solved":  return " AUT "
        case "solved":       return "  OK "
    }
}

function catLabel(c: ItemCategory): string {
    switch (c) {
        case "simple_fix":   return " fix "
        case "discussion":   return " dsc "
        case "wontfix":      return " wnt "
        case "large_change": return " lrg "
        case "unknown":      return " ??? "
    }
}

function statusColor(s: ItemStatus, _sel: boolean): any {
    if (s === "unseen")  return crayon.bgHex(YELLOW).hex(BG_SURF).bold
    if (s === "solved")  return crayon.bgHex(GREEN).hex(BG_SURF)
    if (s === "auto_solved") return crayon.bgHex(ORANGE).hex(BG_SURF)
    return crayon.bgHex(_sel ? BG_SEL : BG).hex(DIM)
}

function catColor(c: ItemCategory, sel: boolean): any {
    const bg = sel ? BG_SEL : BG
    if (c === "simple_fix")   return crayon.bgHex(bg).hex(GREEN)
    if (c === "discussion")   return crayon.bgHex(bg).hex(MAGENTA)
    if (c === "large_change") return crayon.bgHex(bg).hex(RED)
    return crayon.bgHex(bg).hex(DIM)
}

function shortFile(item: ReviewItem): string {
    if (item.type === "comment") {
        const parts = item.file.split("/")
        const short = parts.length > 2 ? parts.slice(-2).join("/") : item.file
        return item.line > 0 ? `${short}:${item.line}` : short
    }
    if (item.type === "ci_failure") return item.check_name
    if (item.type === "merge_conflict") return `conflict: ${item.base_branch}`
    return ""
}

function itemSnippet(item: ReviewItem, w: number): string {
    if (item.summary) return truncate(item.summary, w)
    if (item.type === "comment") {
        return truncate(item.comments[0]?.body?.split("\n").find(l => l.trim()) ?? "", w)
    }
    if (item.type === "ci_failure") return truncate(`${item.check_name} failed`, w)
    if (item.type === "merge_conflict") return truncate(`conflict with ${item.base_branch}`, w)
    return ""
}

// ── Render: list view ────────────────────────────────────────────────────

function renderListView(): void {
    log("renderListView")
    editorOverlay.visible.value = false
    editorOverlayRect.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
    editorFrame.visible.value = false

    const pr = state.pr
    headerText.value = ` PR #${pr.number}: ${truncate(pr.title, contentW - 15)}  (${visibleItems.length} items)`

    const lines: string[] = []
    const sel = selectedIndex.peek()

    let startIdx = 0
    if (sel >= MAX_VISIBLE_ITEMS) { startIdx = sel - MAX_VISIBLE_ITEMS + 1 }
    const endIdx = Math.min(startIdx + MAX_VISIBLE_ITEMS, visibleItems.length)

    for (let i = startIdx; i < endIdx; i++) {
        const { item } = visibleItems[i]
        const isSelected = i === sel
        const ds = computeDisplayStatus(item, state.gh_user)
        const bg = isSelected ? BG_SEL : BG
        const baseFg = crayon.bgHex(bg).hex(FG)

        // Author info
        let authName = ""
        if (item.type === "comment" && item.comments.length > 0) {
            authName = item.comments[0].author
        } else if (item.type === "ci_failure") {
            authName = "CI Failure"
        } else if (item.type === "merge_conflict") {
            authName = "Merge Conflict"
        }
        const hue = (item.type === "ci_failure" || item.type === "merge_conflict") ? RED : authorHue(authName)

        // Flags
        const flagParts: string[] = []
        if (item.draft_response) { flagParts.push("D") }
        if (item.notes) { flagParts.push("N") }
        if (ds === "pending") { flagParts.push("wait") }

        const file = shortFile(item)
        const snippet = itemSnippet(item, contentW - 8)

        // ── Line 1: pointer + status + author + (right-aligned) file + category ──
        const ptr = isSelected ? baseFg(" ▸") : baseFg("  ")
        const stStyled = statusColor(item.status, isSelected)(statusLabel(item.status))
        const authStyled = crayon.bgHex(bg).hex(hue)(`${authorTag(authName)} ${authName}`)
        const fileStyled = file ? crayon.bgHex(bg).hex(DIM)(file) : ""
        const catStyled = catColor(item.category, isSelected)(catLabel(item.category))

        // Calculate gap (use plain-text lengths for spacing)
        const l1Left = `   ${statusLabel(item.status)}  ${authorTag(authName)} ${authName}`
        const l1Right = `${file}  ${catLabel(item.category)}`
        const gap1 = Math.max(1, contentW - l1Left.length - l1Right.length)

        const line1 = ptr + baseFg(" ") + stStyled + baseFg("  ") + authStyled
            + baseFg(" ".repeat(gap1)) + fileStyled + baseFg("  ") + catStyled

        // ── Line 2: snippet + (right-aligned) flags ──
        const indent = baseFg("       ")
        const snippetStyled = baseFg(snippet)
        const flagStyled = flagParts.length
            ? crayon.bgHex(bg).hex(CYAN)(` ${flagParts.join(" ")} `)
            : ""

        const l2Left = `       ${snippet}`
        const l2Right = flagParts.length ? `  ${flagParts.join(" ")}  ` : ""
        const gap2 = Math.max(1, contentW - l2Left.length - l2Right.length)

        const line2 = indent + snippetStyled + baseFg(" ".repeat(gap2)) + flagStyled

        // ── Line 3: separator ──
        const line3 = crayon.bgHex(BG).hex(0x45475a)(`  ${"─".repeat(Math.min(contentW - 4, 60))}`)

        lines.push(line1, line2, line3)
    }

    bodyText.value = padLines(lines, BODY_LINES)
    helpText.value = " up/dn navigate  enter detail  r resolve  s solved  S unsolved  c clip  o open  q quit\n 1 fix  2 discuss  3 wontfix  4 large  0 unknown"

    editor.rectangle.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
    editor.state.value = "base"
}

// ── Render: detail view ──────────────────────────────────────────────────

function renderDetailView(): void {
    log("renderDetailView")

    const sel = selectedIndex.peek()
    if (sel >= visibleItems.length) return
    const { item, origIndex } = visibleItems[sel]
    const id = itemId(item, origIndex)
    const target = editTarget.peek()
    const isEditing = mode.peek() === "detail_edit"

    let hdr = ` ${id}`
    if (item.type === "comment") { hdr += `  ${item.file}:${item.line}` }
    else if (item.type === "ci_failure") { hdr += `  CI: ${item.check_name}` }
    else { hdr += `  merge conflict` }

    const tabLabel = target === "notes" ? "NOTES" : "REPLY"
    const otherLabel = target === "notes" ? "reply" : "notes"
    hdr += `  [${tabLabel}]`
    headerText.value = hdr

    // Build comment lines and track author header positions
    const commentLines: string[] = []
    const authorRows: { row: number; author: string; date: string }[] = []
    const sepRows: number[] = []
    const failedRows: number[] = []
    const panelW = contentW - 6

    if (item.type === "comment") {
        for (const c of item.comments) {
            const date = c.created_at.slice(0, 10)
            authorRows.push({ row: commentLines.length, author: c.author, date })
            commentLines.push(` ${authorTag(c.author)} ${c.author}  ${date}`)
            commentLines.push("")
            for (const wl of wordWrap(c.body, panelW)) {
                commentLines.push(`    ${wl}`)
            }
            commentLines.push("")
            sepRows.push(commentLines.length)
            commentLines.push(` ${"─".repeat(panelW + 2)}`)
            commentLines.push("")
        }
    } else if (item.type === "ci_failure") {
        // Track rows for CI-specific coloring
        authorRows.push({ row: commentLines.length, author: "CI", date: "" })
        commentLines.push(` ✗  CI Failure: ${item.check_name}`)
        commentLines.push("")
        commentLines.push(`   Commit  ${item.commit_sha.slice(0, 8)}`)
        commentLines.push(`   URL     ${item.url}`)
        if (item.error_summary) {
            commentLines.push("")
            sepRows.push(commentLines.length)
            commentLines.push(` ${"─".repeat(panelW + 2)}`)
            commentLines.push("")
            for (const el of item.error_summary.split("\n")) {
                // Color FAILED lines differently
                const trimmed = el.trim()
                if (trimmed.startsWith("FAILED")) {
                    failedRows.push(commentLines.length)
                    commentLines.push(`   ✗ ${trimmed}`)
                } else if (trimmed) {
                    commentLines.push(`     ${trimmed}`)
                } else {
                    commentLines.push("")
                }
            }
        }
    } else if (item.type === "merge_conflict") {
        commentLines.push(` Merge Conflict with ${item.base_branch}`)
        if (item.conflicting_files.length > 0) {
            commentLines.push("")
            for (const f of item.conflicting_files) { commentLines.push(`    ${f}`) }
        }
    }

    detailCommentOffsets = authorRows.map(r => r.row)

    // Scroll and build visible portion
    // commentAreaHeight is the visible lines inside the frame (minus 2 for frame borders)
    const commentAreaHeight = COMMENT_AREA_HEIGHT
    const scrollOff = commentScrollOffset.peek()
    const scrolled = commentLines.slice(scrollOff, scrollOff + commentAreaHeight)

    // Apply inline colors to author/separator/error lines
    for (const { row: srcRow, author, date } of authorRows) {
        const visRow = srcRow - scrollOff
        if (visRow < 0 || visRow >= commentAreaHeight) continue
        if (author === "CI") {
            scrolled[visRow] = crayon.hex(RED).bold(` ✗  CI Failure: ${(item.type === "ci_failure" ? item.check_name : "")}`)
        } else {
            scrolled[visRow] = crayon.hex(authorHue(author)).bold(` ${authorTag(author)} ${author}`) + crayon.hex(DIM)(`  ${date}`)
        }
    }
    for (const srcRow of sepRows) {
        const visRow = srcRow - scrollOff
        if (visRow < 0 || visRow >= commentAreaHeight) continue
        scrolled[visRow] = crayon.hex(0x45475a)(` ${"─".repeat(panelW + 2)}`)
    }
    for (const srcRow of failedRows) {
        const visRow = srcRow - scrollOff
        if (visRow < 0 || visRow >= commentAreaHeight) continue
        scrolled[visRow] = crayon.hex(RED)(commentLines[srcRow] ?? "")
    }

    // Build body with inline frame borders (no Frame component needed)
    const frameDim = isEditing ? crayon.hex(DIM) : crayon.hex(BLUE)
    const frameW = contentW - 2

    // Pad a line with possible inline ANSI to exactly targetW visible chars
    function padToWidth(s: string, targetW: number): string {
        const visW = tuiTextWidth(s)
        return visW >= targetW ? s : s + " ".repeat(targetW - visW)
    }

    const bodyLines: string[] = []
    bodyLines.push(frameDim(`╭${"─".repeat(frameW)}╮`))
    for (const line of scrolled) {
        bodyLines.push(frameDim("│") + padToWidth(line || "", frameW) + frameDim("│"))
    }
    while (bodyLines.length < commentAreaHeight + 1) {
        bodyLines.push(frameDim("│") + " ".repeat(frameW) + frameDim("│"))
    }
    bodyLines.push(frameDim(`╰${"─".repeat(frameW)}╯`))
    bodyLines.push("")
    bodyLines.push(` ─── [${tabLabel}] ─── (left/right: ${otherLabel})`)

    bodyText.value = padLines(bodyLines, BODY_LINES)

    // No author/separator/error overlays needed for detail view anymore
    // Detail view now uses inline ANSI colors — no overlay positioning needed

    // ── Frames and editor position ──

    // Editor frame and position
    const edRow = splitRow + 1
    editor.rectangle.value = { column: PAD_LEFT + 1, row: edRow, width: contentW - 2, height: editorHeight - 1 }
    editorFrameRect.value = { column: PAD_LEFT + 1, row: edRow, width: contentW - 2, height: editorHeight - 1 }
    editorFrame.visible.value = true

    if (isEditing) {
        setFrameColor(editorFrame, CYAN)
        editorOverlay.visible.value = false
        editorOverlayRect.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
        editor.state.value = "active"
        const editLabel = target === "notes" ? "NOTES" : "REPLY"
        helpText.value = ` Editing ${editLabel}...  cmd+enter submit reply  esc back to thread\n `
    } else {
        setFrameColor(editorFrame, DIM)
        // Show "press enter" overlay on top of editor with tab label
        const browseLabel = target === "notes" ? "NOTES" : "REPLY"
        const overlayLines: string[] = []
        const editorText = editor.text.peek()
        if (editorText) {
            const preview = editorText.split("\n").slice(0, editorHeight - 2)
            for (const line of preview) { overlayLines.push(line || " ") }
            while (overlayLines.length < Math.floor((editorHeight - 1) / 2)) { overlayLines.push(" ") }
            overlayLines.push(`  ── ${browseLabel}: press enter to edit ──`)
        } else {
            for (let i = 0; i < Math.floor((editorHeight - 1) / 2) - 1; i++) { overlayLines.push(" ") }
            overlayLines.push(`  ── ${browseLabel}: press enter to start typing ──`)
        }
        while (overlayLines.length < editorHeight - 1) { overlayLines.push(" ") }
        editorOverlayText.value = overlayLines.join("\n")
        editorOverlayRect.value = { column: PAD_LEFT + 1, row: edRow, width: contentW - 2, height: editorHeight - 1 }
        editorOverlay.visible.value = true
        editor.state.value = "base"
        // Move editor off-screen so it doesn't bleed through the overlay
        editor.rectangle.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
        helpText.value = ` up/dn comments  left/right ${otherLabel}  enter edit  c clip  o open  esc back  r resolve  s solved\n `
    }
}

// ── Editor helpers ───────────────────────────────────────────────────────

function loadEditorText(): void {
    const sel = selectedIndex.peek()
    if (sel >= visibleItems.length) return
    const { item } = visibleItems[sel]
    const target = editTarget.peek()
    const newText = target === "draft" ? (item.draft_response ?? "") : (item.notes ?? "")
    // Force Signal to fire even if text is the same (e.g., both empty)
    editor.text.value = "\x00"
    editor.text.value = newText
    editor.cursorPosition.value = { x: 0, y: 0 }
}

function saveEditorText(): void {
    const sel = selectedIndex.peek()
    if (sel >= visibleItems.length) return
    const { item } = visibleItems[sel]
    const target = editTarget.peek()
    if (target === "draft") { item.draft_response = editor.text.peek() }
    else { item.notes = editor.text.peek() }
}

// ── Key handling ─────────────────────────────────────────────────────────

tui.on("keyPress", (event: any) => {
    log("key:", event.key, "ctrl:", event.ctrl, "meta:", event.meta, "mode:", mode.peek())
    const m = mode.peek()
    if (m === "list") { handleListKey(event) }
    else if (m === "detail_browse") { handleDetailBrowseKey(event) }
    else if (m === "detail_edit") { handleDetailEditKey(event) }
})

function handleListKey(e: any): void {
    const k = e.key
    if (k === "up") {
        const s = selectedIndex.peek()
        if (s > 0) { selectedIndex.value = s - 1; renderListView() }
    } else if (k === "down") {
        const s = selectedIndex.peek()
        if (s < visibleItems.length - 1) { selectedIndex.value = s + 1; renderListView() }
    } else if (k === "return") {
        mode.value = "detail_browse"
        editTarget.value = "notes"  // default to notes
        loadEditorText()
        commentScrollOffset.value = 0
        renderDetailView()
    } else if (k === "q" || k === "escape") {
        tui.destroy(); Deno.exit(0)
    } else if (k === "r") {
        const { item } = visibleItems[selectedIndex.peek()]
        if (item.type === "comment") {
            item.resolved = true
            visibleItems = getVisibleItems()
            if (selectedIndex.peek() >= visibleItems.length) { selectedIndex.value = Math.max(0, visibleItems.length - 1) }
            renderListView()
        }
    } else if (k === "s") { visibleItems[selectedIndex.peek()].item.status = "solved"; renderListView() }
    else if (k === "S") { visibleItems[selectedIndex.peek()].item.status = "unaddressed"; renderListView() }
    else if (k === "c") { const { item, origIndex } = visibleItems[selectedIndex.peek()]; copyToClipboard(generateClipboardContent(item, origIndex, state)) }
    else if (k === "1") { visibleItems[selectedIndex.peek()].item.category = "simple_fix"; renderListView() }
    else if (k === "2") { visibleItems[selectedIndex.peek()].item.category = "discussion"; renderListView() }
    else if (k === "3") { visibleItems[selectedIndex.peek()].item.category = "wontfix"; renderListView() }
    else if (k === "4") { visibleItems[selectedIndex.peek()].item.category = "large_change"; renderListView() }
    else if (k === "0") { visibleItems[selectedIndex.peek()].item.category = "unknown"; renderListView() }
}

function handleDetailBrowseKey(e: any): void {
    const k = e.key
    if (k === "escape") {
        saveEditorText()
        mode.value = "list"
        renderListView()
    } else if (k === "up") {
        const off = commentScrollOffset.peek()
        // Find the previous comment that starts before the current scroll position
        const prev = detailCommentOffsets.filter(r => r < off)
        if (prev.length > 0) {
            const target = prev[prev.length - 1]
            // Scroll just enough to show the target at the top
            commentScrollOffset.value = target
        } else {
            commentScrollOffset.value = 0
        }
        renderDetailView()
    } else if (k === "down") {
        const off = commentScrollOffset.peek()
        const visibleEnd = off + COMMENT_AREA_HEIGHT
        // Find the next comment that starts after the current scroll position
        const next = detailCommentOffsets.find(r => r > off)
        if (next !== undefined) {
            // If the next comment header is already visible, just scroll a few lines
            // to bring it near the top (with 1 line of context from previous)
            if (next < visibleEnd) {
                commentScrollOffset.value = Math.max(0, next - 1)
            } else {
                // Not visible — scroll to show it at the top
                commentScrollOffset.value = Math.max(0, next - 1)
            }
        }
        renderDetailView()
    } else if (k === "left" || k === "right") {
        saveEditorText()
        editTarget.value = editTarget.peek() === "notes" ? "draft" : "notes"
        loadEditorText()
        renderDetailView()
    } else if (k === "return") {
        // Enter editing mode
        mode.value = "detail_edit"
        renderDetailView()
    } else if (k === "c") {
        const { item, origIndex } = visibleItems[selectedIndex.peek()]
        copyToClipboard(generateClipboardContent(item, origIndex, state))
    } else if (k === "r") {
        const { item } = visibleItems[selectedIndex.peek()]
        if (item.type === "comment") { item.resolved = true }
        renderDetailView()
    } else if (k === "s") {
        visibleItems[selectedIndex.peek()].item.status = "solved"
        renderDetailView()
    }
}

function handleDetailEditKey(e: any): void {
    // cmd+enter = submit (only for draft/reply tab)
    if (e.key === "return" && (e.meta || e.ctrl)) {
        log("cmd+enter detected — would submit reply")
        // TODO: actual submit via gh API
        saveEditorText()
        mode.value = "detail_browse"
        renderDetailView()
        return
    }
    if (e.key === "escape") {
        saveEditorText()
        mode.value = "detail_browse"
        renderDetailView()
    }
    // All other keys handled by TextBox (it's in "active" state)
}

editor.text.subscribe(() => { if (mode.peek() === "detail_edit") { saveEditorText() } })

// ── Start ────────────────────────────────────────────────────────────────
log("Starting... scheduling render")
setTimeout(() => {
    log("Initial render firing")
    renderListView()
    log("Initial render done")
}, 50)
