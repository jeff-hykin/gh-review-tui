import { assertEquals, assert } from "jsr:@std/assert@1"
import { sanitizeDirName, emojiHash } from "../src/paths.ts"

// ── sanitizeDirName tests ────────────────────────────────────────────────

Deno.test("sanitizeDirName: basic URL", () => {
    assertEquals(sanitizeDirName("github.com:org/repo"), "github_com_org_repo")
})

Deno.test("sanitizeDirName: git SSH URL", () => {
    assertEquals(sanitizeDirName("git@github.com:org/repo.git"), "git_github_com_org_repo_git")
})

Deno.test("sanitizeDirName: HTTPS URL", () => {
    assertEquals(
        sanitizeDirName("https://github.com/org/repo.git"),
        "https_github_com_org_repo_git",
    )
})

Deno.test("sanitizeDirName: branch with slashes", () => {
    assertEquals(sanitizeDirName("feature/my-cool-thing"), "feature_my-cool-thing")
})

Deno.test("sanitizeDirName: preserves hyphens and underscores", () => {
    assertEquals(sanitizeDirName("my-branch_name"), "my-branch_name")
})

Deno.test("sanitizeDirName: collapses multiple underscores", () => {
    assertEquals(sanitizeDirName("a///b"), "a_b")
})

Deno.test("sanitizeDirName: strips leading/trailing underscores", () => {
    assertEquals(sanitizeDirName("/leading/"), "leading")
})

// ── emojiHash tests ──────────────────────────────────────────────────────

Deno.test("emojiHash: returns 3 emojis", () => {
    const result = emojiHash("hello")
    // Should be exactly 3 emoji characters (each may be multi-byte)
    const chars = [...result]
    assertEquals(chars.length, 3, `Expected 3 emoji chars, got ${chars.length}: "${result}"`)
})

Deno.test("emojiHash: deterministic", () => {
    assertEquals(emojiHash("test"), emojiHash("test"))
    assertEquals(emojiHash("github.com:org/repo"), emojiHash("github.com:org/repo"))
})

Deno.test("emojiHash: different inputs produce different outputs (usually)", () => {
    const hashes = new Set([
        emojiHash("alpha"),
        emojiHash("beta"),
        emojiHash("gamma"),
        emojiHash("delta"),
        emojiHash("epsilon"),
    ])
    // With 200^3 = 8M possible combos, 5 inputs should almost always be distinct
    assert(hashes.size >= 4, `Expected at least 4 distinct hashes, got ${hashes.size}`)
})

Deno.test("emojiHash: empty string works", () => {
    const result = emojiHash("")
    const chars = [...result]
    assertEquals(chars.length, 3)
})
