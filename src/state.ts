import { parse as parseYaml, stringify as stringifyYaml } from "jsr:@std/yaml@1"
import { ensureDir } from "jsr:@std/fs@1/ensure-dir"
import { dirname } from "jsr:@std/path@1/dirname"
import type { ReviewState } from "./types.ts"

// ── Load state from a YAML file ─────────────────────────────────────────

export async function loadState(path: string): Promise<ReviewState | null> {
    try {
        const text = await Deno.readTextFile(path)
        const data = parseYaml(text) as ReviewState
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
