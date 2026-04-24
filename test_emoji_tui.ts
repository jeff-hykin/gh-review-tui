#!/usr/bin/env -S deno run --allow-all
// Minimal test: can deno_tui Labels render emojis and BMP symbols?

import { crayon } from "https://deno.land/x/crayon@3.3.3/mod.ts"
import { Tui } from "deno_tui/tui.ts"
import { handleInput } from "deno_tui/input.ts"
import { Signal } from "deno_tui/signals/mod.ts"
import { Label } from "deno_tui/components/label.ts"

const tui = new Tui({
    style: crayon.bgHex(0x1e1e2e),
    refreshRate: 1000 / 30,
})
handleInput(tui)
tui.dispatch()
tui.run()

const text = new Signal([
    "Emoji rendering test (press q to quit)",
    "",
    "BMP symbols (U+0000-FFFF):",
    "  ◆ ◇ ● ○ ■ □ ▲ △ ▼ ▽ ♠ ♣ ♥ ♦ ★ ☆ ◈ ◉ ◊ ▣",
    "",
    "Emoji (above U+FFFF / surrogate pairs):",
    "  🔥 🐍 🧀 🔔 🔑 🌲 👍 🎯 💎 🐸",
    "",
    "Mixed line:",
    "  ◊♥ arescrimson    Should we fall back...",
    "  ♠♣ connor-grepile Cache merged costmap",
    "",
    "If emojis show as ?? or blank, Labels can't handle them.",
    "If BMP symbols show correctly, we use those instead.",
].join("\n"))

new Label({
    parent: tui,
    theme: { base: crayon.bgHex(0x1e1e2e).hex(0xcdd6f4) },
    rectangle: { column: 2, row: 1, width: 80, height: 16 },
    overwriteRectangle: true,
    text,
    zIndex: 5,
})

tui.on("keyPress", (e: any) => {
    if (e.key === "q") { tui.destroy(); Deno.exit(0) }
})
