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

const red = crayon.hex(0xf38ba8)
const green = crayon.hex(0xa6e3a1)
const blue = crayon.hex(0x89b4fa)
const yellow = crayon.hex(0xf9e2af)
const magenta = crayon.hex(0xcba6f7)
const cyan = crayon.hex(0x89dceb)
const dim = crayon.hex(0x6c7086)
const bold = crayon.bold

const text = new Signal([
    bold("Rendering test") + dim("  (press q to quit)"),
    "",
    "BMP symbols:  ◆ ◇ ● ○ ■ □ ▲ △ ▼ ▽ ♠ ♣ ♥ ♦ ★ ☆",
    "",
    "Emoji:  🔥 🐍 🧀 🔔 🔑 🌲 👍 🎯 💎 🐸",
    "",
    "Inline colors:",
    `  ${red("red")} ${green("green")} ${blue("blue")} ${yellow("yellow")} ${magenta("magenta")} ${cyan("cyan")}`,
    "",
    "Mixed emoji + color:",
    `  🔥 ${red("FAILED")} tests/test_costmap.py  ${dim("2026-04-22")}`,
    `  ✓  ${green("PASSED")} tests/test_planner.py  ${dim("2026-04-22")}`,
    "",
    `Colored authors: ${blue("jeff-hykin")} ${red("arescrimson")} ${green("connor")}`,
    "",
    dim("If colors render inline, the overlay system can be simplified."),
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
