#!/usr/bin/env -S deno run --allow-all

// Resolve the real file location (not the symlink) to find deno.json
const selfPath = new URL(import.meta.url).pathname
const realPath = Deno.realPathSync(selfPath)
const dir = realPath.replace(/\/[^/]+$/, "")
const configPath = `${dir}/deno.json`

// ── Parse --branch / --pr (point gre at a different PR than the active branch) ─
// Both flags are stripped from the args before they reach the entry script;
// the override travels via the GRE_BRANCH env var (gh.getCurrentBranch reads it).
let branchOverride: string | undefined
const passthrough: string[] = []
for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i]
    if ((a === "--branch" || a === "-b") && i + 1 < Deno.args.length) {
        branchOverride = Deno.args[++i]
        continue
    }
    if (a === "--pr" && i + 1 < Deno.args.length) {
        const num = Deno.args[++i]
        const out = await new Deno.Command("gh", {
            args: ["pr", "view", num, "--json", "headRefName", "-q", ".headRefName"],
            stdout: "piped", stderr: "piped",
        }).output()
        if (out.code !== 0) {
            const err = new TextDecoder().decode(out.stderr).trim() || `gh exited ${out.code}`
            console.error(`Failed to look up PR #${num}: ${err}`)
            Deno.exit(1)
        }
        branchOverride = new TextDecoder().decode(out.stdout).trim()
        if (!branchOverride) {
            console.error(`PR #${num} has no headRefName`)
            Deno.exit(1)
        }
        continue
    }
    passthrough.push(a)
}

// Re-exec with --config so the import map from deno.json applies.
// Dynamic imports don't use import maps, and when invoked via symlink
// Deno can't find deno.json, so we re-exec pointing at the real config.
const entry = passthrough.length === 0 ? `${dir}/src/tui_entry.ts` : `${dir}/src/cli_entry.ts`

const env = { ...Deno.env.toObject() }
if (branchOverride) { env.GRE_BRANCH = branchOverride }

const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", `--config=${configPath}`, entry, ...passthrough],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env,
})

const status = await cmd.spawn().status
Deno.exit(status.code)
