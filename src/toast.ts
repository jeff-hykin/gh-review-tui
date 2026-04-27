// Toast notifications: ephemeral, stackable pop-ups in a corner of the TUI.
//
// Usage:
//     const toaster = new Toaster(tui, { bg: BG, fg: FG })
//     toaster.show("Reply sent")
//     toaster.show("Send failed", { type: "error", duration: 5000 })

import { crayon } from "https://deno.land/x/crayon@3.3.3/mod.ts"
import type { Tui } from "deno_tui/tui.ts"
import { Signal } from "deno_tui/signals/mod.ts"
import { Label, LabelRectangle } from "deno_tui/components/label.ts"
import { textWidth as tuiTextWidth } from "deno_tui/utils/strings.ts"

export type ToastType = "info" | "success" | "warning" | "error"

export interface ToastOptions {
    type?: ToastType
    durationMs?: number
}

export interface ToasterOptions {
    bg: number
    fg: number
    maxStack?: number
    rightPad?: number
    topPad?: number
    maxWidth?: number
    defaultDurationMs?: number
}

const ACCENTS: Record<ToastType, number> = {
    info:    0x89dceb,
    success: 0xa6e3a1,
    warning: 0xfab387,
    error:   0xf38ba8,
}

const ICONS: Record<ToastType, string> = {
    info:    "ⓘ",
    success: "✓",
    warning: "⚠",
    error:   "✗",
}

interface ActiveToast {
    label: Label
    rect: Signal<LabelRectangle>
    width: number
    timer: number
}

export class Toaster {
    #tui: Tui
    #opts: Required<ToasterOptions>
    #active: ActiveToast[] = []

    constructor(tui: Tui, opts: ToasterOptions) {
        this.#tui = tui
        this.#opts = {
            bg:                opts.bg,
            fg:                opts.fg,
            maxStack:          opts.maxStack          ?? 4,
            rightPad:          opts.rightPad          ?? 2,
            topPad:            opts.topPad            ?? 1,
            maxWidth:          opts.maxWidth          ?? 60,
            defaultDurationMs: opts.defaultDurationMs ?? 3000,
        }
    }

    show(text: string, options: ToastOptions = {}): void {
        const type     = options.type       ?? "info"
        const duration = options.durationMs ?? this.#opts.defaultDurationMs
        const accent   = ACCENTS[type]
        const icon     = ICONS[type]

        while (this.#active.length >= this.#opts.maxStack) {
            this.#dismiss(this.#active[0])
        }

        const inner = ` ${icon}  ${text} `
        const innerW = Math.min(tuiTextWidth(inner), this.#opts.maxWidth - 2)
        const truncated = innerW < tuiTextWidth(inner) ? this.#truncate(inner, innerW) : inner
        const padded = truncated + " ".repeat(Math.max(0, innerW - tuiTextWidth(truncated)))

        const accentStyle = crayon.bgHex(this.#opts.bg).hex(accent).bold
        const fgStyle     = crayon.bgHex(this.#opts.bg).hex(this.#opts.fg)

        const top = accentStyle(`╭${"─".repeat(innerW)}╮`)
        const mid = accentStyle("│") + fgStyle(padded) + accentStyle("│")
        const bot = accentStyle(`╰${"─".repeat(innerW)}╯`)

        const text$ = new Signal([top, mid, bot].join("\n"))
        const rect$ = new Signal<LabelRectangle>({ column: 0, row: 0, width: innerW + 2, height: 3 })

        const label = new Label({
            parent: this.#tui,
            theme: { base: crayon.bgHex(this.#opts.bg).hex(this.#opts.fg) },
            rectangle: rect$,
            overwriteRectangle: true,
            text: text$,
            zIndex: 100,
        })

        const toast: ActiveToast = { label, rect: rect$, width: innerW + 2, timer: 0 }
        this.#active.push(toast)
        this.#layout()
        toast.timer = setTimeout(() => this.#dismiss(toast), duration)
    }

    dismissAll(): void {
        while (this.#active.length > 0) { this.#dismiss(this.#active[0]) }
    }

    relayout(): void { this.#layout() }

    #layout(): void {
        const { columns } = this.#tui.canvas.size.peek()
        let row = this.#opts.topPad
        for (const t of this.#active) {
            const col = Math.max(0, columns - t.width - this.#opts.rightPad)
            t.rect.value = { column: col, row, width: t.width, height: 3 } as LabelRectangle
            row += 4
        }
    }

    #dismiss(toast: ActiveToast): void {
        const idx = this.#active.indexOf(toast)
        if (idx === -1) return
        clearTimeout(toast.timer)
        toast.label.destroy()
        this.#active.splice(idx, 1)
        this.#layout()
    }

    #truncate(s: string, w: number): string {
        let acc = ""
        let accW = 0
        for (const ch of s) {
            const cw = tuiTextWidth(ch)
            if (accW + cw > w - 1) { return acc + "…" }
            acc += ch
            accW += cw
        }
        return acc
    }
}
