#!/usr/bin/env -S deno run --allow-all
// Demo: multiline text editor using deno_tui
// Test this by running: deno run --allow-all demo_editor.ts
// Press Ctrl+C to exit

import { crayon } from "https://deno.land/x/crayon@3.3.3/mod.ts"

import { Tui } from "https://deno.land/x/tui@2.1.11/src/tui.ts"
import { handleInput } from "https://deno.land/x/tui@2.1.11/src/input.ts"
import { handleKeyboardControls, handleMouseControls } from "https://deno.land/x/tui@2.1.11/src/controls.ts"
import { Signal } from "https://deno.land/x/tui@2.1.11/src/signals/mod.ts"

import { TextBox } from "https://deno.land/x/tui@2.1.11/src/components/textbox.ts"
import { Label } from "https://deno.land/x/tui@2.1.11/src/components/label.ts"
import { Button } from "https://deno.land/x/tui@2.1.11/src/components/button.ts"
import { Frame } from "https://deno.land/x/tui@2.1.11/src/components/frame.ts"

// ── Initialize TUI ───────────────────────────────────────────────────────

const tui = new Tui({
    style: crayon.bgBlack,
    refreshRate: 1000 / 60,
})

handleInput(tui)
handleMouseControls(tui)
handleKeyboardControls(tui)
tui.dispatch()
tui.run()

// ── Theme ────────────────────────────────────────────────────────────────

const editorTheme = {
    base: crayon.bgHex(0x1e1e2e).white,
    focused: crayon.bgHex(0x313244).white,
    active: crayon.bgHex(0x45475a).white,
    disabled: crayon.bgLightBlack.black,
    value: {
        base: crayon.bgHex(0x1e1e2e).lightWhite,
        focused: crayon.bgHex(0x313244).lightWhite,
        active: crayon.bgHex(0x45475a).lightWhite,
    },
    cursor: {
        base: crayon.bgWhite.black,
        focused: crayon.bgLightYellow.black,
        active: crayon.bgLightGreen.black,
    },
    lineNumbers: {
        base: crayon.bgHex(0x181825).hex(0x6c7086),
        focused: crayon.bgHex(0x181825).hex(0x89b4fa),
        active: crayon.bgHex(0x181825).hex(0x89b4fa),
    },
    highlightedLine: {
        base: crayon.bgHex(0x313244).white,
        focused: crayon.bgHex(0x45475a).lightWhite,
        active: crayon.bgHex(0x585b70).lightWhite,
    },
}

const titleTheme = {
    base: crayon.bgHex(0x181825).hex(0x89b4fa).bold,
}

const statusTheme = {
    base: crayon.bgHex(0x313244).hex(0xa6adc8),
}

const buttonTheme = {
    base: crayon.bgHex(0x45475a).hex(0xcdd6f4),
    focused: crayon.bgHex(0x89b4fa).hex(0x1e1e2e),
    active: crayon.bgHex(0xa6e3a1).hex(0x1e1e2e),
}

// ── Title ────────────────────────────────────────────────────────────────

new Label({
    parent: tui,
    theme: titleTheme,
    rectangle: { column: 1, row: 0 },
    text: " gre — multiline editor demo ",
    zIndex: 1,
})

// ── Frame around editor ──────────────────────────────────────────────────

new Frame({
    parent: tui,
    theme: {
        base: crayon.bgBlack.hex(0x585b70),
        focused: crayon.bgBlack.hex(0x89b4fa),
        active: crayon.bgBlack.hex(0xa6e3a1),
    },
    rectangle: {
        column: 1,
        row: 1,
        width: 72,
        height: 17,
    },
    charMap: "rounded",
    zIndex: 0,
})

// ── Editor ───────────────────────────────────────────────────────────────

const editor = new TextBox({
    parent: tui,
    theme: editorTheme,
    rectangle: {
        column: 2,
        row: 2,
        width: 70,
        height: 15,
    },
    text: "Welcome to the gre multiline editor demo!\n\nTry typing here:\n- Arrow keys to move cursor\n- Home/End to jump to line start/end\n- Backspace/Delete to remove characters\n- Enter for new lines\n\nThis is what the draft response editor will look like\nin the final TUI.\n",
    lineNumbering: false,
    lineHighlighting: true,
    multiCodePointSupport: true,
    zIndex: 1,
})

// ── Status bar ───────────────────────────────────────────────────────────

const statusText = new Signal(" Ln 1, Col 1 | 0 chars | Click editor to start typing ")

new Label({
    parent: tui,
    theme: statusTheme,
    rectangle: { column: 1, row: 18 },
    text: statusText,
    overwriteRectangle: true,
    zIndex: 1,
})

// Update status bar when cursor moves or text changes
editor.cursorPosition.subscribe(({ x, y }) => {
    const text = editor.text.peek()
    const lines = text.split("\n").length
    const chars = text.length
    statusText.value = ` Ln ${y + 1}, Col ${x + 1} | ${lines} lines, ${chars} chars | Ctrl+C to exit `
})

editor.text.subscribe((text) => {
    const { x, y } = editor.cursorPosition.peek()
    const lines = text.split("\n").length
    const chars = text.length
    statusText.value = ` Ln ${y + 1}, Col ${x + 1} | ${lines} lines, ${chars} chars | Ctrl+C to exit `
})

// ── Buttons ──────────────────────────────────────────────────────────────

const saveButton = new Button({
    parent: tui,
    theme: buttonTheme,
    rectangle: {
        column: 2,
        row: 20,
        width: 12,
        height: 1,
    },
    label: { text: " Save " },
    zIndex: 1,
})

const clearButton = new Button({
    parent: tui,
    theme: buttonTheme,
    rectangle: {
        column: 16,
        row: 20,
        width: 12,
        height: 1,
    },
    label: { text: " Clear " },
    zIndex: 1,
})

// ── Button actions ───────────────────────────────────────────────────────

const messageText = new Signal("")

new Label({
    parent: tui,
    theme: { base: crayon.bgBlack.hex(0xa6e3a1) },
    rectangle: { column: 30, row: 20 },
    text: messageText,
    zIndex: 1,
})

saveButton.state.subscribe((state) => {
    if (state === "active") {
        const content = editor.text.peek()
        Deno.writeTextFileSync("/tmp/gre-demo-output.txt", content)
        messageText.value = ` Saved! (${content.length} chars → /tmp/gre-demo-output.txt) `
        setTimeout(() => {
            messageText.value = ""
        }, 2000)
    }
})

clearButton.state.subscribe((state) => {
    if (state === "active") {
        editor.text.value = ""
        editor.cursorPosition.value = { x: 0, y: 0 }
        messageText.value = " Cleared! "
        setTimeout(() => {
            messageText.value = ""
        }, 2000)
    }
})

// ── Help text ────────────────────────────────────────────────────────────

new Label({
    parent: tui,
    theme: { base: crayon.bgBlack.hex(0x6c7086) },
    rectangle: { column: 2, row: 22 },
    text: "Arrow keys: navigate | Tab: switch focus | Enter: activate button / newline in editor",
    zIndex: 0,
})
