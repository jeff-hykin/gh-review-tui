import { parse as parseYaml, stringify as stringifyYaml } from "jsr:@std/yaml@1"
import { ensureDir } from "jsr:@std/fs@1/ensure-dir"
import { dirname } from "jsr:@std/path@1/dirname"
import type { ReviewState } from "./types.ts"

// ── Load state from a YAML file ─────────────────────────────────────────

function validateState(data: unknown): data is ReviewState {
    if (data == null || typeof data !== "object") { return false }
    const d = data as Record<string, unknown>
    if (!d.pr || typeof d.pr !== "object") { return false }
    const pr = d.pr as Record<string, unknown>
    if (typeof pr.number !== "number" || typeof pr.repo !== "string") { return false }
    if (typeof d.gh_user !== "string") { return false }
    if (!Array.isArray(d.items)) { return false }
    return true
}

export async function loadState(path: string): Promise<ReviewState | null> {
    try {
        const text = await Deno.readTextFile(path)
        const data = parseYaml(text)
        if (!validateState(data)) {
            console.error(`Warning: state file ${path} is missing required fields, ignoring.`)
            return null
        }
        return data
    } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
            return null
        }
        throw e
    }
}

// ── Save state to a YAML file ────────────────────────────────────────────

export async function saveState(path: string, state: ReviewState): Promise<void> {
    await ensureDir(dirname(path))
    // deno-lint-ignore no-explicit-any
    const yaml = stringifyYaml(state as any, {
        lineWidth: 200,
        skipInvalid: true,
    })
    await Deno.writeTextFile(path, yaml)
}
