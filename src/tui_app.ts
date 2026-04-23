import { crayon } from "https://deno.land/x/crayon@3.3.3/mod.ts"

import { Tui } from "https://deno.land/x/tui@2.1.11/src/tui.ts"
import { handleInput } from "https://deno.land/x/tui@2.1.11/src/input.ts"
import { handleMouseControls } from "https://deno.land/x/tui@2.1.11/src/controls.ts"
import { Signal } from "https://deno.land/x/tui@2.1.11/src/signals/mod.ts"
import { TextBox } from "https://deno.land/x/tui@2.1.11/src/components/textbox.ts"
import { Label } from "https://deno.land/x/tui@2.1.11/src/components/label.ts"
import { Frame } from "https://deno.land/x/tui@2.1.11/src/components/frame.ts"
import { insertAt } from "https://deno.land/x/tui@2.1.11/src/utils/strings.ts"
import { clamp } from "https://deno.land/x/tui@2.1.11/src/utils/numbers.ts"

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

function statusColor(s: ItemStatus, sel: boolean): any {
    if (s === "unseen")  return crayon.bgHex(YELLOW).hex(BG_SURF).bold
    if (s === "solved")  return crayon.bgHex(GREEN).hex(BG_SURF)
    if (s === "auto_solved") return crayon.bgHex(ORANGE).hex(BG_SURF)
    return crayon.bgHex(sel ? BG_SEL : BG).hex(DIM)
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

    const { columns: termW, rows: termH } = Deno.consoleSize()
    const PAD_LEFT = 2
    const PAD_TOP = 1
    const contentW = Math.min(termW - PAD_LEFT * 2, 118)
    const BODY_ROW = 1 + PAD_TOP
    log("Launch TUI, size:", { termW, termH, contentW })

    const mode = new Signal<ViewMode>("list")
    const selectedIndex = new Signal(0)
    const editTarget = new Signal<EditTarget>("notes")
    const commentScrollOffset = new Signal(0)

    const BODY_LINES = termH - 3 - PAD_TOP
    const LINES_PER_ITEM = 3
    const MAX_VISIBLE_ITEMS = Math.floor(BODY_LINES / LINES_PER_ITEM)

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

    // ── Base components ──────────────────────────────────────────────

    const headerText = new Signal("loading...")
    new Label({
        parent: tui,
        theme: { base: crayon.bgHex(BG_SURF).hex(BLUE).bold },
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
        theme: { base: crayon.bgHex(BG_SEL).hex(0xa6adc8) },
        rectangle: { column: PAD_LEFT, row: termH - 2, width: contentW, height: 2 },
        overwriteRectangle: true, text: helpText, zIndex: 10,
    })

    const splitRow = Math.floor(termH * 0.55) + PAD_TOP
    const editorHeight = termH - splitRow - 3

    const editor = new TextBox({
        parent: tui,
        theme: {
            base: crayon.bgHex(BG).hex(FG), focused: crayon.bgHex(BG_SEL).hex(FG), active: crayon.bgHex(0x45475a).hex(FG),
            value: { base: crayon.bgHex(BG).hex(FG), focused: crayon.bgHex(BG_SEL).hex(FG), active: crayon.bgHex(0x45475a).hex(FG) },
            cursor: { base: crayon.bgWhite.black, focused: crayon.bgHex(YELLOW).black, active: crayon.bgHex(GREEN).black },
            lineNumbers: { base: crayon.bgHex(BG_SURF).hex(DIM), focused: crayon.bgHex(BG_SURF).hex(DIM), active: crayon.bgHex(BG_SURF).hex(DIM) },
            highlightedLine: { base: crayon.bgHex(BG_SEL).hex(FG), focused: crayon.bgHex(0x45475a).hex(FG), active: crayon.bgHex(0x585b70).hex(FG) },
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
            if (ctrl && key === "k") { textLines[cur.y] = textLine.slice(0, cur.x); editor.text.value = textLines.join("\n"); editor.cursorPosition.value = { ...cur }; return }
            // Alt/Option + arrow
            if (meta && key === "left") { cur.x = wordBoundaryLeft(textLine, cur.x); editor.cursorPosition.value = { ...cur }; return }
            if (meta && key === "right") { cur.x = wordBoundaryRight(textLine, cur.x); editor.cursorPosition.value = { ...cur }; return }
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
                case "return": ++cur.y; break
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
    const eovStyle = crayon.bgHex(BG_SURF).hex(DIM)
    const editorOverlay = new Label({
        parent: tui,
        theme: { base: eovStyle, focused: eovStyle, active: eovStyle, disabled: eovStyle },
        rectangle: editorOverlayRect, overwriteRectangle: true, text: editorOverlayText, zIndex: 9,
    })

    // ── Detail view frames ──────────────────────────────────────────

    const commentFrameRect = new Signal<any>({ column: 2, row: 2, width: contentW - 2, height: splitRow - 4 })
    const cfs = crayon.bgHex(BG).hex(BLUE)
    const commentFrame = new Frame({
        parent: tui, charMap: "rounded",
        theme: { base: cfs, focused: cfs, active: cfs, disabled: cfs },
        rectangle: commentFrameRect, zIndex: 7,
    })
    commentFrame.visible.value = false

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

    // ── Overlay system ──────────────────────────────────────────────

    type Ov = { text: Signal<string>; label: Label; rect: Signal<any> }

    function mkOv(w: number, z = 6): Ov {
        const text = new Signal(" ")
        const rect = new Signal<any>({ column: 0, row: 9999, width: w, height: 1 })
        const s = crayon.bgHex(BG).hex(FG)
        const label = new Label({ parent: tui, theme: { base: s, focused: s, active: s, disabled: s }, rectangle: rect, overwriteRectangle: true, text, zIndex: z })
        label.visible.value = false
        return { text, label, rect }
    }

    function ovShow(ov: Ov, col: number, row: number, w: number, txt: string, style: any): void {
        ov.label.theme = { base: style, focused: style, active: style, disabled: style }
        ov.rect.value = { column: col, row, width: w, height: 1 }
        ov.text.value = txt.length >= w ? txt.slice(0, w) : txt + " ".repeat(w - txt.length)
        ov.label.visible.value = true
        ov.label.state.value = "focused"; ov.label.state.value = "base"
    }

    function ovHide(ov: Ov): void { ov.label.visible.value = false }

    const selBar = mkOv(contentW, 5)

    const itemOvs: { status: Ov; cat: Ov; author: Ov; file: Ov; flags: Ov; sep: Ov }[] = []
    for (let i = 0; i < MAX_VISIBLE_ITEMS; i++) {
        itemOvs.push({ status: mkOv(5), cat: mkOv(5), author: mkOv(20), file: mkOv(40), flags: mkOv(10), sep: mkOv(contentW) })
    }

    const DETAIL_MAX_AUTHORS = 10
    const detailAuthorOvs: Ov[] = []
    for (let i = 0; i < DETAIL_MAX_AUTHORS; i++) { detailAuthorOvs.push(mkOv(40)) }

    const DETAIL_MAX_SEPS = 10
    const detailSepOvs: Ov[] = []
    for (let i = 0; i < DETAIL_MAX_SEPS; i++) { detailSepOvs.push(mkOv(contentW)) }

    const DETAIL_MAX_ERRORS = 10
    const detailErrorOvs: Ov[] = []
    for (let i = 0; i < DETAIL_MAX_ERRORS; i++) { detailErrorOvs.push(mkOv(contentW)) }

    function hideAllItemOvs(): void {
        ovHide(selBar)
        for (const io of itemOvs) { ovHide(io.status); ovHide(io.cat); ovHide(io.author); ovHide(io.file); ovHide(io.flags); ovHide(io.sep) }
    }
    function hideAllDetailOvs(): void { for (const ov of detailAuthorOvs) { ovHide(ov) }; for (const ov of detailSepOvs) { ovHide(ov) }; for (const ov of detailErrorOvs) { ovHide(ov) } }

    // ── Render: list view ────────────────────────────────────────────

    function renderListView(): void {
        log("renderListView")
        hideAllDetailOvs()
        editorOverlay.visible.value = false
        editorOverlayRect.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
        commentFrame.visible.value = false
        editorFrame.visible.value = false

        const pr = state!.pr
        headerText.value = ` PR #${pr.number}: ${truncate(pr.title, contentW - 15)}  (${visibleItems.length} items)`

        const lines: string[] = []
        const sel = selectedIndex.peek()
        let startIdx = 0
        if (sel >= MAX_VISIBLE_ITEMS) { startIdx = sel - MAX_VISIBLE_ITEMS + 1 }
        const endIdx = Math.min(startIdx + MAX_VISIBLE_ITEMS, visibleItems.length)

        for (let i = startIdx; i < endIdx; i++) {
            const { item } = visibleItems[i]
            const isSelected = i === sel
            const ds = computeDisplayStatus(item, state!.gh_user)
            const ptr = isSelected ? " ▸" : "  "
            const st = statusLabel(item.status)

            let authName = ""
            if (item.type === "comment" && item.comments.length > 0) { authName = item.comments[0].author }
            else if (item.type === "ci_failure") { authName = "CI Failure" }
            else if (item.type === "merge_conflict") { authName = "Merge Conflict" }

            const flagParts: string[] = []
            if (item.draft_response) { flagParts.push("D") }
            if (item.notes) { flagParts.push("N") }
            if (ds === "pending") { flagParts.push("wait") }

            const file = shortFile(item)
            const cat = catLabel(item.category)
            const snippet = itemSnippet(item, contentW - 8)

            const l1L = `${ptr} ${st}  ${authorTag(authName)} ${authName}`
            const l1R = `${file}  ${cat}`
            const g1 = Math.max(1, contentW - l1L.length - l1R.length)
            lines.push(l1L + " ".repeat(g1) + l1R)

            const l2L = `       ${snippet}`
            const l2R = flagParts.length ? `  ${flagParts.join(" ")}  ` : ""
            const g2 = Math.max(1, contentW - l2L.length - l2R.length)
            lines.push(l2L + " ".repeat(g2) + l2R)

            lines.push(`  ${"─".repeat(Math.min(contentW - 4, 60))}`)
        }

        bodyText.value = padLines(lines, BODY_LINES)
        helpText.value = " up/dn navigate  enter detail  r resolve  s solved  S unsolved  c clip  q quit\n 1 fix  2 discuss  3 wontfix  4 large  0 unknown  R sync  o open"
        editor.rectangle.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
        editor.state.value = "base"

        // Overlays
        for (let vi = 0; vi < MAX_VISIBLE_ITEMS; vi++) {
            const io = itemOvs[vi]
            const dataIdx = startIdx + vi
            if (dataIdx >= endIdx) { ovHide(io.status); ovHide(io.cat); ovHide(io.author); ovHide(io.file); ovHide(io.flags); ovHide(io.sep); continue }
            const { item } = visibleItems[dataIdx]
            const isSelected = dataIdx === sel
            const row1 = BODY_ROW + vi * LINES_PER_ITEM, row2 = row1 + 1, row3 = row1 + 2
            const bg = isSelected ? BG_SEL : BG

            if (isSelected) {
                const sty = crayon.bgHex(BG_SEL).hex(FG)
                selBar.label.theme = { base: sty, focused: sty, active: sty, disabled: sty }
                selBar.rect.value = { column: PAD_LEFT, row: row1, width: contentW, height: 2 }
                selBar.text.value = " \n "; selBar.label.visible.value = true
                selBar.label.state.value = "focused"; selBar.label.state.value = "base"
            }

            ovShow(io.status, PAD_LEFT + 3, row1, 5, statusLabel(item.status), statusColor(item.status, isSelected))
            const catCol = PAD_LEFT + contentW - 5
            ovShow(io.cat, catCol, row1, 5, catLabel(item.category), catColor(item.category, isSelected))

            let authName = ""
            if (item.type === "comment" && item.comments.length > 0) { authName = item.comments[0].author }
            else if (item.type === "ci_failure") { authName = "CI Failure" }
            else if (item.type === "merge_conflict") { authName = "Merge Conflict" }
            const hue = (item.type === "ci_failure" || item.type === "merge_conflict") ? RED : authorHue(authName)
            ovShow(io.author, PAD_LEFT + 9, row1, Math.min(authName.length + 3, 22), `${authorTag(authName)} ${authName}`, crayon.bgHex(bg).hex(hue))

            const file = shortFile(item)
            if (file) { const fw = Math.min(file.length + 2, 35); ovShow(io.file, catCol - fw - 1, row1, fw, `${file}  `, crayon.bgHex(bg).hex(DIM)) }
            else { ovHide(io.file) }

            const flagParts: string[] = []
            if (item.draft_response) { flagParts.push("D") }; if (item.notes) { flagParts.push("N") }
            if (computeDisplayStatus(item, state!.gh_user) === "pending") { flagParts.push("wait") }
            if (flagParts.length) { const fs = ` ${flagParts.join(" ")} `; ovShow(io.flags, PAD_LEFT + contentW - fs.length, row2, fs.length, fs, crayon.bgHex(bg).hex(CYAN)) }
            else { ovHide(io.flags) }

            ovShow(io.sep, PAD_LEFT, row3, contentW, `  ${"─".repeat(Math.min(contentW - 4, 60))}`, crayon.bgHex(BG).hex(0x45475a))
        }
        for (let vi = endIdx - startIdx; vi < MAX_VISIBLE_ITEMS; vi++) {
            const io = itemOvs[vi]; ovHide(io.status); ovHide(io.cat); ovHide(io.author); ovHide(io.file); ovHide(io.flags); ovHide(io.sep)
        }
    }

    // ── Render: detail view ──────────────────────────────────────────

    function renderDetailView(): void {
        log("renderDetailView")
        hideAllItemOvs()

        const sel = selectedIndex.peek()
        if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]
        const id = itemId(item, visibleItems[sel].origIndex)
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

        const commentLines: string[] = []
        const authorRows: { row: number; author: string }[] = []
        const sepRows: number[] = []
        const failedRows: number[] = []
        const panelW = contentW - 6

        if (item.type === "comment") {
            for (const c of item.comments) {
                authorRows.push({ row: commentLines.length, author: c.author })
                commentLines.push(` ${authorTag(c.author)} ${c.author}  ${c.created_at.slice(0, 10)}`)
                commentLines.push("")
                for (const wl of wordWrap(c.body, panelW)) { commentLines.push(`    ${wl}`) }
                commentLines.push("")
                sepRows.push(commentLines.length)
                commentLines.push(` ${"─".repeat(panelW + 2)}`)
                commentLines.push("")
            }
        } else if (item.type === "ci_failure") {
            authorRows.push({ row: commentLines.length, author: "CI" })
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

        const commentAreaHeight = splitRow - 2 - PAD_TOP - 2
        const scrollOff = commentScrollOffset.peek()
        const scrolled = commentLines.slice(scrollOff, scrollOff + commentAreaHeight)

        const bodyLines: string[] = [" "]
        for (const line of scrolled) { bodyLines.push(line) }
        while (bodyLines.length < commentAreaHeight + 1) { bodyLines.push(" ") }
        bodyLines.push(` ─── [${tabLabel}] ─── (left/right: ${otherLabel})`)
        bodyText.value = padLines(bodyLines, BODY_LINES)

        const ovRowBase = BODY_ROW + 1

        // Author overlays
        hideAllDetailOvs()
        let ovIdx = 0
        for (const { row: srcRow, author } of authorRows) {
            const visRow = srcRow - scrollOff
            if (visRow < 0 || visRow >= commentAreaHeight) continue
            if (ovIdx >= DETAIL_MAX_AUTHORS) break
            if (author === "CI") {
                const ciStr = ` ✗  CI Failure: ${(item.type === "ci_failure" ? item.check_name : "")}`
                ovShow(detailAuthorOvs[ovIdx++], PAD_LEFT, ovRowBase + visRow, ciStr.length, ciStr, crayon.bgHex(BG).hex(RED).bold)
            } else {
                ovShow(detailAuthorOvs[ovIdx++], PAD_LEFT, ovRowBase + visRow, Math.min(author.length + 4, 30), ` ${authorTag(author)} ${author}`, crayon.bgHex(BG).hex(authorHue(author)).bold)
            }
        }

        // Separator overlays (dimmed)
        let sepIdx = 0
        for (const srcRow of sepRows) {
            const visRow = srcRow - scrollOff
            if (visRow < 0 || visRow >= commentAreaHeight) continue
            if (sepIdx >= DETAIL_MAX_SEPS) break
            const sepText = ` ${"─".repeat(panelW + 2)}`
            ovShow(detailSepOvs[sepIdx++], PAD_LEFT, ovRowBase + visRow, sepText.length, sepText, crayon.bgHex(BG).hex(0x45475a))
        }

        // FAILED line overlays (red)
        let errIdx = 0
        for (const srcRow of failedRows) {
            const visRow = srcRow - scrollOff
            if (visRow < 0 || visRow >= commentAreaHeight) continue
            if (errIdx >= DETAIL_MAX_ERRORS) break
            const errText = commentLines[srcRow] ?? ""
            ovShow(detailErrorOvs[errIdx++], PAD_LEFT, ovRowBase + visRow, errText.length + 1, errText, crayon.bgHex(BG).hex(RED))
        }

        // Frames and editor position
        commentFrameRect.value = { column: PAD_LEFT + 1, row: BODY_ROW + 1, width: contentW - 2, height: commentAreaHeight }
        commentFrame.visible.value = true
        const edRow = splitRow + 1
        editor.rectangle.value = { column: PAD_LEFT + 1, row: edRow, width: contentW - 2, height: editorHeight - 1 }
        editorFrameRect.value = { column: PAD_LEFT + 1, row: edRow, width: contentW - 2, height: editorHeight - 1 }
        editorFrame.visible.value = true

        if (isEditing) {
            setFrameColor(commentFrame, DIM)
            setFrameColor(editorFrame, CYAN)
            editorOverlay.visible.value = false
            editorOverlayRect.value = { column: PAD_LEFT, row: 9999, width: contentW, height: editorHeight }
            editor.state.value = "active"
            helpText.value = " Typing...  cmd+enter submit reply  esc back to thread\n "
        } else {
            setFrameColor(commentFrame, BLUE)
            setFrameColor(editorFrame, DIM)
            const overlayLines: string[] = []
            const edText = editor.text.peek()
            if (edText) {
                for (const line of edText.split("\n").slice(0, editorHeight - 2)) { overlayLines.push(` ${line}`) }
                while (overlayLines.length < Math.floor((editorHeight - 1) / 2)) { overlayLines.push(" ") }
                overlayLines.push("  ── press enter to edit ──")
            } else {
                for (let i = 0; i < Math.floor((editorHeight - 1) / 2) - 1; i++) { overlayLines.push(" ") }
                overlayLines.push("  ── press enter to start typing ──")
            }
            while (overlayLines.length < editorHeight - 1) { overlayLines.push(" ") }
            editorOverlayText.value = overlayLines.join("\n")
            editorOverlayRect.value = { column: PAD_LEFT + 1, row: edRow, width: contentW - 2, height: editorHeight - 1 }
            editorOverlay.visible.value = true
            editor.state.value = "base"
            helpText.value = ` up/dn comments  left/right ${otherLabel}  enter edit  c clip  o open  esc back  r resolve  s solved\n `
        }
    }

    // ── Editor helpers ───────────────────────────────────────────────

    function loadEditorText(): void {
        const sel = selectedIndex.peek()
        if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]
        const target = editTarget.peek()
        const newText = target === "draft" ? (item.draft_response ?? "") : (item.notes ?? "")
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
        saveState(path, state!).catch(() => {})
    }

    // ── Keyboard handling ────────────────────────────────────────────

    tui.on("keyPress", (event: any) => {
        log("key:", event.key, "ctrl:", event.ctrl, "meta:", event.meta, "mode:", mode.peek())
        const m = mode.peek()
        if (m === "list") { handleListKey(event) }
        else if (m === "detail_browse") { handleDetailBrowseKey(event) }
        else if (m === "detail_edit") { handleDetailEditKey(event) }
    })

    function handleListKey(e: any): void {
        const k = e.key
        if (k === "up") { const s = selectedIndex.peek(); if (s > 0) { selectedIndex.value = s - 1; renderListView() } }
        else if (k === "down") { const s = selectedIndex.peek(); if (s < visibleItems.length - 1) { selectedIndex.value = s + 1; renderListView() } }
        else if (k === "return") { mode.value = "detail_browse"; editTarget.value = "notes"; loadEditorText(); commentScrollOffset.value = 0; renderDetailView() }
        else if (k === "q" || k === "escape") { tui.destroy(); Deno.exit(0) }
        else if (k === "r") { resolveCurrentItem() }
        else if (k === "u") { unresolveCurrentItem() }
        else if (k === "s") { setCurrentItemStatus("solved") }
        else if (k === "S") { setCurrentItemStatus("unaddressed") }
        else if (k === "c") { clipCurrentItem() }
        else if (k === "o") { openCurrentItem() }
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
            const prev = detailCommentOffsets.filter(r => r < off)
            commentScrollOffset.value = prev.length > 0 ? prev[prev.length - 1] : 0
            renderDetailView()
        } else if (k === "down") {
            const off = commentScrollOffset.peek()
            const next = detailCommentOffsets.find(r => r > off)
            if (next !== undefined) { commentScrollOffset.value = next }
            renderDetailView()
        } else if (k === "left" || k === "right") {
            saveEditorText()
            editTarget.value = editTarget.peek() === "notes" ? "draft" : "notes"
            loadEditorText(); renderDetailView()
        } else if (k === "return") { mode.value = "detail_edit"; renderDetailView() }
        else if (k === "c") { clipCurrentItem() }
        else if (k === "r") { resolveCurrentItem().then(() => renderDetailView()) }
        else if (k === "s") { setCurrentItemStatus("solved"); renderDetailView() }
        else if (k === "o") { openCurrentItem() }
    }

    function handleDetailEditKey(e: any): void {
        if (e.key === "return" && (e.meta || e.ctrl)) { sendCurrentDraft(); return }
        if (e.key === "escape") { saveEditorText(); mode.value = "detail_browse"; renderDetailView() }
    }

    // ── Actions ──────────────────────────────────────────────────────

    async function resolveCurrentItem(): Promise<void> {
        const sel = selectedIndex.peek()
        if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]
        if (item.type !== "comment" || !item.thread_node_id) return
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
        const { item } = visibleItems[sel]; if (item.type !== "comment") return
        item.resolved = false; saveState(path, state!).catch(() => {}); visibleItems = getVisibleItems(); renderListView()
    }

    function setCurrentItemStatus(status: ItemStatus): void {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        visibleItems[sel].item.status = status; saveState(path, state!).catch(() => {}); renderListView()
    }

    function setCurrentItemCategory(category: ItemCategory): void {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        visibleItems[sel].item.category = category; saveState(path, state!).catch(() => {}); renderListView()
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

    async function sendCurrentDraft(): Promise<void> {
        const sel = selectedIndex.peek(); if (sel >= visibleItems.length) return
        const { item } = visibleItems[sel]
        if (item.type !== "comment" || !item.draft_response || !item.thread_node_id) return
        const ok = await gh.postReply(state!.pr.repo, state!.pr.number, item.thread_node_id, item.draft_response)
        if (ok) { item.draft_response = ""; editor.text.value = ""; await saveState(path, state!); saveEditorText(); mode.value = "detail_browse"; renderDetailView() }
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
