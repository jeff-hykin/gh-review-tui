#!/usr/bin/env -S deno run --allow-all

// Resolve imports relative to the real file location (not the symlink)
const selfPath = new URL(import.meta.url).pathname
const realPath = Deno.realPathSync(selfPath)
const base = "file://" + realPath.replace(/\/[^/]+$/, "/")

if (Deno.args.length === 0) {
    const { launchTUI } = await import(base + "src/tui_app.ts")
    await launchTUI()
} else {
    const { buildCLI } = await import(base + "src/cli.ts")
    await buildCLI().parse(Deno.args)
}
