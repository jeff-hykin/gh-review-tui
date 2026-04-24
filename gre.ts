#!/usr/bin/env -S deno run --allow-all

// Resolve the real file location (not the symlink) to find deno.json
const selfPath = new URL(import.meta.url).pathname
const realPath = Deno.realPathSync(selfPath)
const dir = realPath.replace(/\/[^/]+$/, "")
const configPath = `${dir}/deno.json`

// Re-exec with --config so the import map from deno.json applies.
// Dynamic imports don't use import maps, and when invoked via symlink
// Deno can't find deno.json, so we re-exec pointing at the real config.
const entry = Deno.args.length === 0 ? `${dir}/src/tui_entry.ts` : `${dir}/src/cli_entry.ts`
const args = Deno.args.length === 0 ? [] : Deno.args

const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", `--config=${configPath}`, entry, ...args],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
})

const status = await cmd.spawn().status
Deno.exit(status.code)
