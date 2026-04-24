#!/usr/bin/env -S deno run --allow-all
// Minimal test: what key events does deno_tui see for alt+arrow?

import { crayon } from "https://deno.land/x/crayon@3.3.3/mod.ts"
import { Tui } from "deno_tui/tui.ts"
import { handleInput } from "deno_tui/input.ts"
import { Signal } from "deno_tui/signals/mod.ts"
import { Label } from "deno_tui/components/label.ts"

const tui = new Tui({ style: crayon.bgBlack, refreshRate: 1000 / 30 })
handleInput(tui)
tui.dispatch()
tui.run()

const logLines: string[] = ["Press keys to see events (q to quit)", ""]
const text = new Signal(logLines.join("\n"))
new Label({
    parent: tui,
    theme: { base: crayon.bgBlack.white },
    rectangle: { column: 1, row: 1, width: 80, height: 25 },
    overwriteRectangle: true,
    text,
    zIndex: 5,
})

const LOG_FILE = "/tmp/gre-keytest.log"
Deno.writeTextFileSync(LOG_FILE, "")

tui.on("keyPress", (e: any) => {
    const line = `key=${JSON.stringify(e.key)} ctrl=${e.ctrl} meta=${e.meta} shift=${e.shift} alt=${e.alt}`
    logLines.push(line)
    if (logLines.length > 22) logLines.splice(2, 1)
    text.value = logLines.join("\n")
    Deno.writeTextFileSync(LOG_FILE, line + "\n", { append: true })
    if (e.key === "q" && !e.ctrl && !e.meta) { tui.destroy(); Deno.exit(0) }
})
