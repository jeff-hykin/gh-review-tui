import { crayon } from "https://deno.land/x/crayon@3.3.3/mod.ts"

import { Tui } from "deno_tui/tui.ts"
import { handleInput } from "deno_tui/input.ts"
import { handleMouseControls } from "deno_tui/controls.ts"
import { Signal } from "deno_tui/signals/mod.ts"
import { TextBox } from "deno_tui/components/textbox.ts"
import { Label } from "deno_tui/components/label.ts"
import { Frame } from "deno_tui/components/frame.ts"
import { insertAt, textWidth as tuiTextWidth } from "deno_tui/utils/strings.ts"
import { clamp } from "deno_tui/utils/numbers.ts"

import type { ReviewState, ReviewItem, ItemCategory, ItemStatus } from "./types.ts"
import { itemId, computeDisplayStatus } from "./types.ts"
import { statePath } from "./paths.ts"
import { loadState, saveState } from "./state.ts"
import { syncState } from "./sync.ts"
import * as gh from "./gh.ts"
import { truncate } from "./display.ts"
import { generateClipboardContent, copyToClipboard } from "./clipboard.ts"
import { wordWrap } from "./word_wrap.ts"

// ── Logging ──────────────────────────────────────────────────────────────

const LOG_FILE = "/tmp/gre-debug.log"
Deno.writeTextFileSync(LOG_FILE, `=== gre TUI log ${new Date().toISOString()} ===\n`)
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

const BG = 0x1e1e2e, BG_SEL = 0x313244, BG_SURF = 0x181825, FG = 0xcdd6f4, DIM = 0x6c7086
const YELLOW = 0xf9e2af, GREEN = 0xa6e3a1, RED = 0xf38ba8, MAGENTA = 0xcba6f7
const CYAN = 0x89dceb, ORANGE = 0xfab387, BLUE = 0x89b4fa, PINK = 0xf5c2e7

const AUTHOR_HUES = [RED, GREEN, BLUE, ORANGE, MAGENTA, CYAN, YELLOW, PINK]
function authorHue(name: string): number {
    return AUTHOR_HUES[hashCode(name) % AUTHOR_HUES.length]
}

// ── Word-jump helpers ───────────────────────────────────────────────────

function wordBoundaryLeft(line: string, x: number): number {
    let i = x - 1
    while (i > 0 && /\s/.test(line[i]!)) { i-- }
    while (i > 0 && !/\s/.test(line[i - 1]!)) { i-- }
    return Math.max(0, i)
}

function wordBoundaryRight(line: string, x: number): number {
    let i = x
    while (i < line.length && !/\s/.test(line[i]!)) { i++ }
    while (i < line.length && /\s/.test(line[i]!)) { i++ }
    return i
}

// ── Types ────────────────────────────────────────────────────────────────

type ViewMode = "list" | "detail_browse" | "detail_edit"
type EditTarget = "notes" | "draft"

let detailCommentOffsets: number[] = []

// ── Helpers ──────────────────────────────────────────────────────────────

function statusLabel(s: ItemStatus): string {
    switch (s) {
        case "unseen":      return " ★  "
        case "unaddressed":  return " ○  "
        case "auto_solved":  return " ◎  "
        case "solved":       return " ✓  "
    }
}

function catLabel(c: ItemCategory): string {
    switch (c) {
        case "simple_fix":   return " fix "
        case "discussion":   return " dsc "
        case "wontfix":      return " ✗wnt"
        case "large_change": return " lrg "
        case "unknown":      return " ??? "
    }
}

// Centralized color palette — all include bgHex(BG) for consistent background
const C = {
    fg: crayon.bgHex(BG).hex(FG), dim: crayon.bgHex(BG).hex(DIM),
    red: crayon.bgHex(BG).hex(RED), green: crayon.bgHex(BG).hex(GREEN),
    blue: crayon.bgHex(BG).hex(BLUE), cyan: crayon.bgHex(BG).hex(CYAN),
    magenta: crayon.bgHex(BG).hex(MAGENTA), orange: crayon.bgHex(BG).hex(ORANGE), sep: crayon.bgHex(BG).hex(0x45475a),
    selFg: crayon.bgHex(BG_SEL).hex(FG), selDim: crayon.bgHex(BG_SEL).hex(DIM),
    selCyan: crayon.bgHex(BG_SEL).hex(CYAN),
    badgeNew: crayon.bgHex(YELLOW).hex(BG_SURF).bold, badgeOk: crayon.bgHex(GREEN).hex(BG_SURF),
    badgeAut: crayon.bgHex(ORANGE).hex(BG_SURF), badgeDim: crayon.bgHex(BG).hex(DIM),
    badgeSelDim: crayon.bgHex(BG_SEL).hex(DIM),
    hkKey: crayon.bgHex(BG).hex(CYAN).bold,
}

// Help-bar shortcut: bright key, dim word
function hk(key: string, word: string): string {
    return C.hkKey(key) + C.dim(" " + word)
}
function helpBar(entries: Array<[string, string]>): string {
    return " " + entries.map(([k, w]) => hk(k, w)).join(C.dim("  "))
}

function statusColor(s: ItemStatus, sel: boolean): any {
    if (s === "unseen") return C.badgeNew
    if (s === "solved") return C.badgeOk
    if (s === "auto_solved") return C.badgeAut
    return sel ? C.badgeSelDim : C.badgeDim
}

function catColor(c: ItemCategory, sel: boolean): any {
    if (c === "simple_fix") return sel ? C.selFg : C.green
    if (c === "discussion") return sel ? crayon.bgHex(BG_SEL).hex(MAGENTA) : C.magenta
    if (c === "large_change") return sel ? crayon.bgHex(BG_SEL).hex(RED) : C.red
    return sel ? C.selDim : C.dim
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

function padLines(lines: string[], count: number): string {
    const result = [...lines]
    while (result.length < count) { result.push(" ") }
    return result.slice(0, count).join("\n")
}

// ── Launch TUI ───────────────────────────────────────────────────────────

export async function launchTUI(): Promise<void> {
    const remote = await gh.getRemoteUrl()
    const branch = await gh.getCurrentBranch()
    const path = statePath(remote, branch)
    let state = await loadState(path)

    if (!state) {
        console.log("No state found. Syncing with GitHub first...")
        state = await syncState(null)
        await saveState(path, state)
    }

    let { columns: termW, rows: termH } = Deno.consoleSize()
    const PAD_LEFT = 2
    const PAD_TOP = 1
    let contentW = Math.min(termW - PAD_LEFT * 2, 118)
    const BODY_ROW = 1 + PAD_TOP
    log("Launch TUI, size:", { termW, termH, contentW })

    const mode = new Signal<ViewMode>("list")
    const selectedIndex = new Signal(0)
    const editTarget = new Signal<EditTarget>("notes")
    const commentScrollOffset = new Signal(0)
    let confirmingResolveAll = false

    // Undo stack
    type UndoAction = { type: "status"; itemIndex: number; oldValue: string } | { type: "category"; itemIndex: number; oldValue: string } | { type: "resolve"; itemIndex: number; oldValue: boolean } | { type: "text"; oldText: string; field: "notes" | "draft_response"; itemIndex: number }
    const undoStack: UndoAction[] = []
    function pushUndo(a: UndoAction): void { undoStack.push(a); if (undoStack.length > 50) undoStack.shift() }
    function performUndo(): boolean {
        const a = undoStack.pop(); if (!a) return false
        const item = state!.items[a.itemIndex]; if (!item) return false
        if (a.type === "status") item.status = a.oldValue as any
        else if (a.type === "category") item.category = a.oldValue as any
        else if (a.type === "resolve" && item.type === "comment") item.resolved = a.oldValue
        else if (a.type === "text") { if (a.field === "notes") item.notes = a.oldText; else item.draft_response = a.oldText }
        visibleItems = getVisibleItems()
        if (selectedIndex.peek() >= visibleItems.length) selectedIndex.value = Math.max(0, visibleItems.length - 1)
        saveState(path, state!).catch(() => {})
        return true
    }

    // Search state
    let searchMode = false, searchQuery = "", searchResults: number[] = [], searchResultIdx = 0
    function doSearch(): void {
        const q = searchQuery.toLowerCase(); searchResults = []
        for (let i = 0; i < visibleItems.length; i++) {
            const { item } = visibleItems[i]; let text = ""
            if (item.type === "comment") { text = item.comments.map(c => `${c.author} ${c.body}`).join(" ") + ` ${item.file}` }
            else if (item.type === "ci_failure") { text = `${item.check_name} ${item.error_summary ?? ""}` }
            text += ` ${item.summary ?? ""} ${item.notes ?? ""}`
            if (text.toLowerCase().includes(q)) searchResults.push(i)
        }
        searchResultIdx = 0
    }

    let BODY_LINES = termH - 3 - PAD_TOP
    const LINES_PER_ITEM = 3
    let MAX_VISIBLE_ITEMS = Math.floor(BODY_LINES / LINES_PER_ITEM)

    function getVisibleItems(): { item: ReviewItem; origIndex: number }[] {
        return state!.items
            .map((item, origIndex) => ({ item, origIndex }))
            .filter(({ item }) => computeDisplayStatus(item, state!.gh_user) !== "resolved")
    }

    let visibleItems = getVisibleItems()

    // ── TUI setup ────────────────────────────────────────────────────
    const tui = new Tui({ style: crayon.bgHex(BG), refreshRate: 1000 / 30 })
    handleInput(tui)
    handleMouseControls(tui)
    tui.dispatch()
    tui.run()

    // ── Resize handling ─────────────────────────────────────────────

    function recalcLayout(): void {
        const size = Deno.consoleSize()
        termW = Math.max(20, size.columns)
        termH = Math.max(6, size.rows)
        contentW = Math.max(10, Math.min(termW - PAD_LEFT * 2, 118))
        BODY_LINES = Math.max(1, termH - 3 - PAD_TOP)
        MAX_VISIBLE_ITEMS = Math.max(1, Math.floor(BODY_LINES / LINES_PER_ITEM))
        splitRow = Math.max(PAD_TOP + 2, Math.floor(termH * 0.55) + PAD_TOP)
        editorHeight = Math.max(1, termH - splitRow - 3)
        COMMENT_AREA_HEIGHT = Math.max(1, splitRow - 2 - PAD_TOP - 2)
        log("resize:", { termW, termH, contentW })
    }

    Deno.addSignalListener("SIGWINCH", () => {
        recalcLayout()
        if (mode.peek() === "list") { renderListView() }
        else { renderDetailView() }
    })

    // ── Base components ──────────────────────────────────────────────

    const headerText = new Signal("loading...")
    new Label({
        parent: tui,
        theme: { base: crayon.bgHex(BG).hex(BLUE).bold },
        rectangle: { column: PAD_LEFT, row: 0, width: contentW, height: 1 },
        overwriteRectangle: true, text: headerText, zIndex: 10,
    })

    const bodyText = new Signal(padLines([], BODY_LINES))
    new Label({
        parent: tui,
        theme: { base: crayon.bgHex(BG).hex(FG) },
        rectangle: { column: PAD_LEFT, row: BODY_ROW, width: contentW, height: BODY_LINES },
        overwriteRectangle: true, text: bodyText, zIndex: 4,
    })

    const helpText = new Signal(" \n ")
    new Label({
        parent: tui,
        theme: { base: crayon.bgHex(BG).hex(DIM) },
        rectangle: { column: PAD_LEFT, row: termH - 2, width: contentW, height: 2 },
        overwriteRectangle: true, text: helpText, zIndex: 10,
    })

    let splitRow = Math.floor(termH * 0.55) + PAD_TOP
    let editorHeight = termH - splitRow - 3
    let COMMENT_AREA_HEIGHT = splitRow - 2 - PAD_TOP - 2

    const editor = new TextBox({
        parent: tui,
        theme: {
            base: crayon.bgHex(BG).hex(FG), focused: crayon.bgHex(BG).hex(FG), active: crayon.bgHex(BG).hex(FG),
            value: { base: crayon.bgHex(BG).hex(FG), focused: crayon.bgHex(BG).hex(FG), active: crayon.bgHex(BG).hex(FG) },
            cursor: { base: crayon.bgWhite.black, focused: crayon.bgHex(YELLOW).black, active: crayon.bgHex(GREEN).black },
            lineNumbers: { base: crayon.bgHex(BG_SURF).hex(DIM), focused: crayon.bgHex(BG_SURF).hex(DIM), active: crayon.bgHex(BG_SURF).hex(DIM) },
            highlightedLine: { base: crayon.bgHex(BG_SEL).hex(FG), focused: crayon.bgHex(BG_SEL).hex(FG), active: crayon.bgHex(BG_SEL).hex(FG) },
        },
        rectangle: { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight },
        text: "", lineNumbering: false, lineHighlighting: true, multiCodePointSupport: true, zIndex: 8,
        keyboardHandler({ key, ctrl, meta, shift }: any) {
            const cur = editor.cursorPosition.peek()
            const textLines = editor.text.peek().split("\n")
            const textLine = textLines[cur.y] ??= ""
            // Ctrl shortcuts
            if (ctrl && key === "a") { cur.x = 0; editor.cursorPosition.value = { ...cur }; return }
            if (ctrl && key === "e") { cur.x = textLine.length; editor.cursorPosition.value = { ...cur }; return }
            if (ctrl && key === "left") { cur.x = 0; editor.cursorPosition.value = { ...cur }; return }
            if (ctrl && key === "right") { cur.x = textLine.length; editor.cursorPosition.value = { ...cur }; return }
            if (ctrl && key === "k") { textLines[cur.y] = textLine.slice(0, cur.x); editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return }
            if (ctrl && key === "w") { const b = wordBoundaryLeft(textLine, cur.x); textLines[cur.y] = textLine.slice(0, b) + textLine.slice(cur.x); cur.x = b; editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return }
            if (ctrl && key === "backspace") {
                if (textLines.length > 1) { textLines.splice(cur.y, 1); cur.y = Math.min(cur.y, textLines.length - 1); cur.x = Math.min(cur.x, textLines[cur.y]?.length ?? 0) }
                else { textLines[0] = ""; cur.x = 0 }
                editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return
            }
            // Alt/Option + arrow
            if (meta && (key === "left" || key === "b")) { cur.x = wordBoundaryLeft(textLine, cur.x); editor.cursorPosition.value = { ...cur }; return }
            if (meta && (key === "right" || key === "f")) { cur.x = wordBoundaryRight(textLine, cur.x); editor.cursorPosition.value = { ...cur }; return }
            if (meta && key === "up") { cur.y = 0; cur.x = 0; editor.cursorPosition.value = { ...cur }; return }
            if (meta && key === "down") { cur.y = textLines.length - 1; cur.x = textLines[cur.y].length; editor.cursorPosition.value = { ...cur }; return }
            if (meta && key === "backspace") { const b = wordBoundaryLeft(textLine, cur.x); textLines[cur.y] = textLine.slice(0, b) + textLine.slice(cur.x); cur.x = b; editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return }
            if (ctrl || meta) return
            let character!: string
            switch (key) {
                case "left": --cur.x; break; case "right": ++cur.x; break
                case "up": --cur.y; break
                case "down": if (textLines.length - 1 > cur.y) { ++cur.y } break
                case "home": cur.x = 0; editor.cursorPosition.value = { ...cur }; return
                case "end": cur.x = textLine.length; editor.cursorPosition.value = { ...cur }; return
                case "backspace":
                    if (cur.x === 0) { if (cur.y === 0) return; textLines[cur.y - 1] += textLines[cur.y]; textLines.splice(cur.y, 1); --cur.y; cur.x = textLines[cur.y].length }
                    else { textLines[cur.y] = textLine.slice(0, cur.x - 1) + textLine.slice(cur.x); cur.x = clamp(cur.x - 1, 0, textLine.length) }
                    break
                case "delete":
                    textLines[cur.y] = textLine.slice(0, cur.x) + textLine.slice(cur.x + 1)
                    if (cur.x === textLine.length && textLines.length - 1 > cur.y) { textLines[cur.y] += textLines[cur.y + 1]; textLines.splice(cur.y + 1, 1) }
                    break
                case "return": { const bef = textLine.slice(0, cur.x); const aft = textLine.slice(cur.x); textLines[cur.y] = bef; textLines.splice(cur.y + 1, 0, aft); ++cur.y; cur.x = 0; break }
                case "space": character = " "; break; case "tab": character = "\t"; break
                default: if (key.length > 1) return; character = key
            }
            cur.y = clamp(cur.y, 0, textLines.length); cur.x = clamp(cur.x, 0, textLines[cur.y]?.length ?? 0)
            if (character) { textLines[cur.y] = insertAt(textLine, cur.x, character); ++cur.x }
            editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }
        },
    })

    // Editor overlay
    const editorOverlayText = new Signal(" ")
    const editorOverlayRect = new Signal<any>({ column: 1, row: 9999, width: contentW, height: editorHeight })
    const eovStyle = crayon.bgHex(BG).hex(DIM)
    const editorOverlay = new Label({
        parent: tui,
        theme: { base: eovStyle, focused: eovStyle, active: eovStyle, disabled: eovStyle },
        rectangle: editorOverlayRect, overwriteRectangle: true, text: editorOverlayText, zIndex: 9,
    })

    // ── Detail view frames ──────────────────────────────────────────

    const editorFrameRect = new Signal<any>({ column: 2, row: splitRow + 1, width: contentW - 2, height: editorHeight })
    const efs = crayon.bgHex(BG).hex(DIM)
    const editorFrame = new Frame({
        parent: tui, charMap: "rounded",
        theme: { base: efs, focused: efs, active: efs, disabled: efs },
        rectangle: editorFrameRect, zIndex: 7,
    })
    editorFrame.visible.value = false

    function setFrameColor(frame: Frame, color: number): void {
        const style = crayon.bgHex(BG).hex(color)
        frame.theme = { base: style, focused: style, active: style, disabled: style }
        frame.state.value = "focused"; frame.state.value = "base"
    }

    // ── Render: list view ────────────────────────────────────────────

    function renderListView(): void {
        log("renderListView")
        editorOverlay.visible.value = false
        editorOverlayRect.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
        editorFrame.visible.value = false

        const pr = state!.pr
        const totalCount = state!.items.length
        const resolvedCount = state!.items.filter(it => computeDisplayStatus(it, state!.gh_user) === "resolved").length
        const pendingCount = visibleItems.filter(v => computeDisplayStatus(v.item, state!.gh_user) === "pending").length
        const unseenCount = visibleItems.filter(v => v.item.status === "unseen").length
        const progressStr = `✓${resolvedCount}/${totalCount}  ★${unseenCount} unseen  ⏳${pendingCount} waiting`
        headerText.value = ` PR #${pr.number}: ${truncate(pr.title, contentW - 50)}  ${progressStr}`

        const lines: string[] = []
        const sel = selectedIndex.peek()
        let startIdx = 0
        if (sel >= MAX_VISIBLE_ITEMS) { startIdx = sel - MAX_VISIBLE_ITEMS + 1 }
        const endIdx = Math.min(startIdx + MAX_VISIBLE_ITEMS, visibleItems.length)

        for (let i = startIdx; i < endIdx; i++) {
            const { item } = visibleItems[i]
            const isSelected = i === sel
            const ds = computeDisplayStatus(item, state!.gh_user)
            const bg = isSelected ? BG_SEL : BG
            const baseFg = isSelected ? C.selFg : C.fg

            let authName = ""
            if (item.type === "comment" && item.comments.length > 0) { authName = item.comments[0].author }
            else if (item.type === "ci_failure") { authName = "CI Failure" }
            else if (item.type === "merge_conflict") { authName = "Merge Conflict" }
            const hue = (item.type === "ci_failure" || item.type === "merge_conflict") ? RED : authorHue(authName)

            const flagParts: string[] = []
            if (item.draft_response) { flagParts.push("D") }
            if (item.notes) { flagParts.push("N") }
            const isPending = ds === "pending"
            if (isPending) { flagParts.push("⏳ WAITING") }

            const file = shortFile(item)
            const snippet = itemSnippet(item, contentW - 8)

            const ptr = isSelected ? baseFg(" ▸") : baseFg("  ")
            const stStyled = statusColor(item.status, isSelected)(statusLabel(item.status))
            const authStyled = crayon.bgHex(bg).hex(hue)(`${authorTag(authName)} ${authName}`)
            const fileStyled = file ? (isSelected ? C.selDim : C.dim)(file) : ""
            const catStyled = catColor(item.category, isSelected)(catLabel(item.category))

            const l1L = `   ${statusLabel(item.status)}  ${authorTag(authName)} ${authName}`
            const l1R = `${file}  ${catLabel(item.category)}`
            const g1 = Math.max(1, contentW - tuiTextWidth(l1L) - tuiTextWidth(l1R))
            lines.push(ptr + baseFg(" ") + stStyled + baseFg("  ") + authStyled + baseFg(" ".repeat(g1)) + fileStyled + baseFg("  ") + catStyled)

            const l2L = `       ${snippet}`
            const l2R = flagParts.length ? `  ${flagParts.join(" ")}  ` : ""
            const g2 = Math.max(1, contentW - tuiTextWidth(l2L) - tuiTextWidth(l2R))
            const flagColor = isPending ? (isSelected ? crayon.bgHex(BG_SEL).hex(ORANGE) : C.orange) : (isSelected ? C.selCyan : C.cyan)
            const flagStyled = flagParts.length ? flagColor(` ${flagParts.join(" ")} `) : ""
            lines.push(baseFg("       ") + baseFg(snippet) + baseFg(" ".repeat(g2)) + flagStyled)

            lines.push(C.sep(`${"─".repeat(contentW)}`))
        }

        bodyText.value = padLines(lines, BODY_LINES)
        helpText.value =
            helpBar([["up/dn", "navigate"], ["enter", "detail"], ["v", "viewed"], ["s", "solved"], ["r", "resolve"], ["u", "unresolve"], ["A", "resolve-all"], ["c", "clip"], ["o", "open"], ["w", "web"], ["q", "quit"]])
            + "\n"
            + helpBar([["/", "search"], ["ctrl+z", "undo"], ["1", "fix"], ["2", "discuss"], ["3", "wontfix"], ["4", "large"], ["0", "unknown"], ["R", "sync"]])
        editor.rectangle.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
        editor.state.value = "base"
    }

    // ── Render: detail view ──────────────────────────────────────────

    function renderDetailView(): void {
        log("renderDetailView")

        const sel = selectedIndex.peek()
        if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]
        const id = itemId(item, visibleItems[sel].origIndex)
        const target = editTarget.peek()
        const isEditing = mode.peek() === "detail_edit"

        const stIcon = statusLabel(item.status).trim()
        const catIcon = catLabel(item.category).trim()
        let hdr = ` ${stIcon} ${id}`
        if (item.type === "comment") { hdr += `  ${item.file}:${item.line}` }
        else if (item.type === "ci_failure") { hdr += `  CI: ${item.check_name}` }
        else { hdr += `  merge conflict` }
        const tabLabel = target === "notes" ? "NOTES" : "REPLY"
        const otherLabel = target === "notes" ? "reply" : "notes"
        hdr += `  [${catIcon}]  [${tabLabel}]`
        headerText.value = hdr

        const commentLines: string[] = []
        const authorRows: { row: number; author: string; date: string }[] = []
        const sepRows: number[] = []
        const failedRows: number[] = []
        const panelW = contentW - 6

        if (item.type === "comment") {
            for (const c of item.comments) {
                authorRows.push({ row: commentLines.length, author: c.author, date: c.created_at.slice(0, 10) })
                commentLines.push(` ${authorTag(c.author)} ${c.author}  ${c.created_at.slice(0, 10)}`)
                commentLines.push("")
                for (const wl of wordWrap(c.body, panelW)) { commentLines.push(`    ${wl}`) }
                commentLines.push("")
                sepRows.push(commentLines.length)
                commentLines.push(` ${"─".repeat(panelW + 2)}`)
                commentLines.push("")
            }
        } else if (item.type === "ci_failure") {
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
                    const trimmed = el.trim()
                    if (trimmed.startsWith("FAILED")) { failedRows.push(commentLines.length); commentLines.push(`   ✗ ${trimmed}`) }
                    else if (trimmed) { commentLines.push(`     ${trimmed}`) }
                    else { commentLines.push("") }
                }
            }
        } else if (item.type === "merge_conflict") {
            commentLines.push(` Merge Conflict with ${item.base_branch}`)
            if (item.conflicting_files.length > 0) { commentLines.push(""); for (const f of item.conflicting_files) { commentLines.push(`    ${f}`) } }
        }

        detailCommentOffsets = authorRows.map(r => r.row)

        const commentAreaHeight = COMMENT_AREA_HEIGHT - 2
        const scrollOff = commentScrollOffset.peek()
        const scrolled = commentLines.slice(scrollOff, scrollOff + commentAreaHeight)

        // Inline ANSI colors (always include bgHex(BG) for consistent background)
        for (const { row: srcRow, author, date } of authorRows) {
            const visRow = srcRow - scrollOff
            if (visRow < 0 || visRow >= commentAreaHeight) continue
            if (author === "CI") {
                scrolled[visRow] = C.red.bold(` ✗  CI Failure: ${(item.type === "ci_failure" ? item.check_name : "")}`)
            } else {
                scrolled[visRow] = crayon.bgHex(BG).hex(authorHue(author)).bold(` ${authorTag(author)} ${author}`) + C.dim(`  ${date}`)
            }
        }
        for (const srcRow of sepRows) {
            const visRow = srcRow - scrollOff
            if (visRow < 0 || visRow >= commentAreaHeight) continue
            scrolled[visRow] = C.sep(` ${"─".repeat(panelW + 2)}`)
        }
        for (const srcRow of failedRows) {
            const visRow = srcRow - scrollOff
            if (visRow < 0 || visRow >= commentAreaHeight) continue
            scrolled[visRow] = C.red(commentLines[srcRow] ?? "")
        }

        // Build body with inline frame borders
        const frameDim = isEditing ? C.dim : C.blue
        const frameW = contentW - 2
        function padToWidth(s: string, targetW: number): string {
            const visW = tuiTextWidth(s)
            return visW >= targetW ? s : s + " ".repeat(Math.max(0, targetW - visW))
        }
        const stBadge = statusColor(item.status, false)(statusLabel(item.status))
        const catBadge = catColor(item.category, false)(catLabel(item.category))
        const resolvedBadge = (item.type === "comment" && item.resolved) ? C.green(" ✓ resolved ") : ""
        const detailDs = computeDisplayStatus(item, state!.gh_user)
        const pendingBadge = detailDs === "pending" ? C.orange(" ⏳ WAITING ") : ""
        const statusBarText = ` ${stBadge}  ${catBadge}  ${resolvedBadge}${pendingBadge}`

        const bodyLines: string[] = []
        bodyLines.push(frameDim(`╭${"─".repeat(frameW)}╮`))
        bodyLines.push(frameDim("│") + padToWidth(statusBarText, frameW) + frameDim("│"))
        bodyLines.push(frameDim("│") + frameDim(`${"─".repeat(frameW)}`) + frameDim("│"))
        for (const line of scrolled) { bodyLines.push(frameDim("│") + padToWidth(line || "", frameW) + frameDim("│")) }
        while (bodyLines.length < commentAreaHeight + 3) { bodyLines.push(frameDim("│") + " ".repeat(frameW) + frameDim("│")) }
        bodyLines.push(frameDim(`╰${"─".repeat(frameW)}╯`))
        const notesBtn = target === "notes"
            ? crayon.bgHex(BLUE).hex(BG_SURF).bold(" NOTES ")
            : C.dim(" notes ")
        const replyBtn = target === "draft"
            ? crayon.bgHex(BLUE).hex(BG_SURF).bold(" REPLY ")
            : C.dim(" reply ")
        bodyLines.push(` ${notesBtn}  ${replyBtn}  ${C.dim("← →  switch")}`)
        bodyText.value = padLines(bodyLines, BODY_LINES)

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
            const submitHelp = target === "draft" ? `  ${hk("ctrl+s", "send reply")}` : ""
            helpText.value = ` ${C.dim("Editing " + editLabel + "...")}${submitHelp}  ${hk("esc", "back to thread")}\n `
        } else {
            setFrameColor(editorFrame, DIM)
            const browseLabel = target === "notes" ? "NOTES" : "REPLY"
            const overlayLines: string[] = []
            const edText = editor.text.peek()
            if (edText) {
                for (const line of edText.split("\n").slice(0, editorHeight - 2)) { overlayLines.push(line || " ") }
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
            editor.rectangle.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
            helpText.value = " " + [
                hk("up/dn", "comments"), hk("left/right", otherLabel), hk("enter", "edit"),
                hk("v", "viewed"), hk("c", "clip"), hk("o", "open"), hk("w", "web"),
                hk("esc", "back"), hk("r", "resolve"), hk("s", "solved"),
            ].join(C.dim("  ")) + "\n "
        }
    }

    // ── Editor helpers ───────────────────────────────────────────────

    function loadEditorText(): void {
        const sel = selectedIndex.peek()
        if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]
        const target = editTarget.peek()
        const newText = target === "draft" ? (item.draft_response ?? "") : (item.notes ?? "")
        // Always set text and reset cursor; if the value is unchanged the Signal
        // won't fire subscribers, but we still need the cursor at the top.
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
        saveState(path, state!).catch(() => {})
    }

    // ── Keyboard handling ────────────────────────────────────────────

    tui.on("keyPress", (event: any) => {
        log("key:", event.key, "ctrl:", event.ctrl, "meta:", event.meta, "mode:", mode.peek())
        if (searchMode) {
            const k = event.key
            if (k === "escape") { searchMode = false; renderListView() }
            else if (k === "return") { searchMode = false; if (searchResults.length > 0) selectedIndex.value = searchResults[searchResultIdx]; renderListView() }
            else if (k === "backspace") { searchQuery = searchQuery.slice(0, -1); doSearch(); if (searchResults.length > 0) selectedIndex.value = searchResults[0]; renderListView(); helpText.value = ` Search: ${searchQuery}_  (${searchResults.length} matches)\n ` }
            else if (k === "tab") { if (searchResults.length > 0) { searchResultIdx = (searchResultIdx + 1) % searchResults.length; selectedIndex.value = searchResults[searchResultIdx]; renderListView() }; helpText.value = ` Search: ${searchQuery}_  (${searchResultIdx + 1}/${searchResults.length})\n ` }
            else if (k === "space") { searchQuery += " "; doSearch(); if (searchResults.length > 0) selectedIndex.value = searchResults[0]; renderListView(); helpText.value = ` Search: ${searchQuery}_  (${searchResults.length} matches)\n ` }
            else if (k.length === 1 && !event.ctrl && !event.meta) { searchQuery += k; doSearch(); if (searchResults.length > 0) selectedIndex.value = searchResults[0]; renderListView(); helpText.value = ` Search: ${searchQuery}_  (${searchResults.length} matches)\n ` }
            return
        }
        const m = mode.peek()
        if (m === "list") { handleListKey(event) }
        else if (m === "detail_browse") { handleDetailBrowseKey(event) }
        else if (m === "detail_edit") { handleDetailEditKey(event) }
    })

    function handleListKey(e: any): void {
        const k = e.key

        if (confirmingResolveAll) {
            confirmingResolveAll = false
            if (k === "y") {
                const resolvePromises: Promise<void>[] = []
                for (const { item } of visibleItems) {
                    if (item.type === "comment" && !item.resolved && item.thread_node_id) {
                        resolvePromises.push(gh.resolveThread(item.thread_node_id).then(ok => { if (ok) item.resolved = true }))
                    }
                }
                helpText.value = ` Resolving ${resolvePromises.length} threads...\n `
                Promise.all(resolvePromises).then(async () => {
                    await saveState(path, state!)
                    visibleItems = getVisibleItems()
                    if (selectedIndex.peek() >= visibleItems.length) { selectedIndex.value = Math.max(0, visibleItems.length - 1) }
                    renderListView()
                })
            } else {
                renderListView()
            }
            return
        }

        if (k === "up") { const s = selectedIndex.peek(); if (s > 0) { selectedIndex.value = s - 1; renderListView() } }
        else if (k === "down") { const s = selectedIndex.peek(); if (s < visibleItems.length - 1) { selectedIndex.value = s + 1; renderListView() } }
        else if (k === "return") { mode.value = "detail_browse"; editTarget.value = "notes"; loadEditorText(); commentScrollOffset.value = 0; renderDetailView() }
        else if (k === "q" || k === "escape") { tui.destroy(); Deno.exit(0) }
        else if (e.ctrl && k === "z") { if (performUndo()) renderListView() }
        else if (k === "/") { searchMode = true; searchQuery = ""; searchResults = []; searchResultIdx = 0; helpText.value = ` Search: _\n ` }
        else if (k === "r") { resolveCurrentItem() }
        else if (k === "u") { unresolveCurrentItem() }
        else if (k === "v") { markCurrentItemViewed() }
        else if (k === "s") { toggleCurrentItemSolved() }
        else if (k === "c") { clipCurrentItem() }
        else if (k === "o") { openCurrentItem() }
        else if (k === "w") { openInBrowser() }
        else if (k === "A") {
            confirmingResolveAll = true
            const count = visibleItems.filter(v => v.item.type === "comment" && !v.item.resolved).length
            helpText.value = ` Resolve all ${count} threads? Press y to confirm, any other key to cancel\n `
        }
        else if (k === "1") { setCurrentItemCategory("simple_fix") }
        else if (k === "2") { setCurrentItemCategory("discussion") }
        else if (k === "3") { setCurrentItemCategory("wontfix") }
        else if (k === "4") { setCurrentItemCategory("large_change") }
        else if (k === "0") { setCurrentItemCategory("unknown") }
        else if (k === "R") { resyncState() }
    }

    function handleDetailBrowseKey(e: any): void {
        const k = e.key
        if (k === "escape") { saveEditorText(); mode.value = "list"; renderListView() }
        else if (k === "up") {
            const off = commentScrollOffset.peek()
            if (detailCommentOffsets.length <= 1) {
                // Single or no comment — line-by-line scroll
                commentScrollOffset.value = Math.max(0, off - 1)
            } else {
                const prev = detailCommentOffsets.filter(r => r < off)
                if (prev.length > 0) {
                    commentScrollOffset.value = prev[prev.length - 1]
                } else {
                    commentScrollOffset.value = 0
                }
            }
            renderDetailView()
        } else if (k === "down") {
            const off = commentScrollOffset.peek()
            if (detailCommentOffsets.length <= 1) {
                // Single or no comment — line-by-line scroll
                commentScrollOffset.value = off + 1
            } else {
                const next = detailCommentOffsets.find(r => r > off)
                if (next !== undefined) {
                    commentScrollOffset.value = Math.max(0, next - 1)
                }
            }
            renderDetailView()
        } else if (k === "left" || k === "right") {
            saveEditorText()
            editTarget.value = editTarget.peek() === "notes" ? "draft" : "notes"
            loadEditorText(); renderDetailView()
        } else if (k === "return") { mode.value = "detail_edit"; renderDetailView() }
        else if (e.ctrl && k === "z") { if (performUndo()) renderDetailView() }
        else if (k === "c") { clipCurrentItem() }
        else if (k === "r") { resolveCurrentItem().then(() => renderDetailView()) }
        else if (k === "v") { markCurrentItemViewed(); renderDetailView() }
        else if (k === "s") { toggleCurrentItemSolved(); renderDetailView() }
        else if (k === "o") { openCurrentItem() }
        else if (k === "w") { openInBrowser() }
    }

    function handleDetailEditKey(e: any): void {
        // ctrl+s is the reliable submit key — most terminals strip the ctrl/meta
        // modifier from enter before sending (cmd+enter often isn't forwarded at
        // all, ctrl+enter arrives as plain \r), so we can't depend on them.
        const isSubmit = (e.ctrl && e.key === "s") || (e.key === "return" && (e.meta || e.ctrl))
        if (isSubmit) { if (editTarget.peek() === "draft") { sendCurrentDraft() } return }
        if (e.key === "escape") { saveEditorText(); mode.value = "detail_browse"; renderDetailView() }
    }

    // ── Actions ──────────────────────────────────────────────────────

    async function resolveCurrentItem(): Promise<void> {
        const sel = selectedIndex.peek()
        if (sel >= visibleItems.length) return
        const { item, origIndex } = visibleItems[sel]
        if (item.type !== "comment" || !item.thread_node_id) return
        pushUndo({ type: "resolve", itemIndex: origIndex, oldValue: item.resolved })
        const ok = await gh.resolveThread(item.thread_node_id)
        if (ok) {
            item.resolved = true; await saveState(path, state!)
            visibleItems = getVisibleItems()
            if (selectedIndex.peek() >= visibleItems.length) { selectedIndex.value = Math.max(0, visibleItems.length - 1) }
            renderListView()
        }
    }

    function unresolveCurrentItem(): void {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item, origIndex } = visibleItems[sel]; if (item.type !== "comment") return
        pushUndo({ type: "resolve", itemIndex: origIndex, oldValue: item.resolved })
        item.resolved = false; saveState(path, state!).catch(() => {}); visibleItems = getVisibleItems(); renderListView()
    }

    function setCurrentItemStatus(status: ItemStatus): void {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item, origIndex } = visibleItems[sel]
        pushUndo({ type: "status", itemIndex: origIndex, oldValue: item.status })
        item.status = status; saveState(path, state!).catch(() => {}); renderListView()
    }

    function markCurrentItemViewed(): void {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item, origIndex } = visibleItems[sel]
        pushUndo({ type: "status", itemIndex: origIndex, oldValue: item.status })
        item.status = item.status === "unseen" ? "unaddressed" : "unseen"
        saveState(path, state!).catch(() => {}); renderListView()
    }

    function toggleCurrentItemSolved(): void {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item, origIndex } = visibleItems[sel]
        pushUndo({ type: "status", itemIndex: origIndex, oldValue: item.status })
        item.status = (item.status === "solved" || item.status === "auto_solved") ? "unaddressed" : "solved"
        saveState(path, state!).catch(() => {}); renderListView()
    }

    function setCurrentItemCategory(category: ItemCategory): void {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item, origIndex } = visibleItems[sel]
        pushUndo({ type: "category", itemIndex: origIndex, oldValue: item.category })
        item.category = category; saveState(path, state!).catch(() => {}); renderListView()
    }

    async function clipCurrentItem(): Promise<void> {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item, origIndex } = visibleItems[sel]
        await copyToClipboard(generateClipboardContent(item, origIndex, state!))
    }

    async function openCurrentItem(): Promise<void> {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]; if (item.type !== "comment") return
        const { default: $ } = await import("jsr:@david/dax@0.42")
        const target = item.line > 0 ? `${item.file}:${item.line}` : item.file
        await $`code -g ${target}`.noThrow()
    }

    async function openInBrowser(): Promise<void> {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]
        const prUrl = state!.pr.url
        const { default: $ } = await import("jsr:@david/dax@0.42")
        if (item.type === "comment" && item.thread_id) {
            await $`open ${prUrl}/files#r${item.thread_id}`.noThrow()
        } else if (item.type === "ci_failure") {
            await $`open ${item.url}`.noThrow()
        } else {
            await $`open ${prUrl}`.noThrow()
        }
    }

    async function sendCurrentDraft(): Promise<void> {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]
        if (item.type !== "comment") { helpText.value = " ✗ Can only reply to comment threads\n "; return }
        if (!item.draft_response.trim()) { helpText.value = " ✗ Draft is empty — type a reply first\n "; return }
        if (!item.thread_node_id) { helpText.value = " ✗ Thread has no node ID (re-sync with R)\n "; return }
        helpText.value = ` ${C.cyan.bold("…")} Sending reply to GitHub...\n `
        const ok = await gh.postReply(state!.pr.repo, state!.pr.number, item.thread_node_id, item.draft_response)
        if (ok) {
            item.draft_response = ""; editor.text.value = ""
            await saveState(path, state!); saveEditorText()
            mode.value = "detail_browse"; renderDetailView()
            helpText.value = ` ${C.green("✓")} Reply sent\n `
        } else {
            helpText.value = ` ${C.red("✗")} Send failed — check gh auth status\n `
        }
    }

    async function resyncState(): Promise<void> {
        state = await syncState(state); await saveState(path, state)
        visibleItems = getVisibleItems()
        if (selectedIndex.peek() >= visibleItems.length) { selectedIndex.value = Math.max(0, visibleItems.length - 1) }
        renderListView()
    }

    editor.text.subscribe(() => { if (mode.peek() === "detail_edit") { saveEditorText() } })

    // ── Start ────────────────────────────────────────────────────────
    setTimeout(() => { log("Initial render firing"); renderListView(); log("Initial render done") }, 50)
}
