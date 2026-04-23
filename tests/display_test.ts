import { assertEquals, assert } from "jsr:@std/assert@1"
import { authorColor, truncate, itemSnippet, formatListRow } from "../src/display.ts"
import { sampleComment, sampleCIFailure, sampleConflict } from "./fixtures/sample_state.ts"

Deno.test("authorColor is deterministic", () => {
    const c1 = authorColor("reviewer1")
    const c2 = authorColor("reviewer1")
    assertEquals(c1, c2)
})

Deno.test("authorColor differs for different names", () => {
    // Not guaranteed but very likely with 8 colors and different names
    const colors = new Set([
        authorColor("alice"),
        authorColor("bob"),
        authorColor("charlie"),
        authorColor("diana"),
    ])
    // At least 2 different colors among 4 names
    assert(colors.size >= 2)
})

Deno.test("truncate: short string unchanged", () => {
    assertEquals(truncate("hello", 10), "hello")
})

Deno.test("truncate: long string truncated with ellipsis", () => {
    assertEquals(truncate("hello world", 8), "hello w…")
})

Deno.test("truncate: exact length unchanged", () => {
    assertEquals(truncate("hello", 5), "hello")
})

Deno.test("itemSnippet: uses summary if present", () => {
    const item = { ...sampleComment, summary: "Use Map for better perf" }
    assertEquals(itemSnippet(item), "Use Map for better perf")
})

Deno.test("itemSnippet: falls back to first line of comment", () => {
    const snippet = itemSnippet(sampleComment)
    assert(snippet.includes("Map instead"))
})

Deno.test("itemSnippet: CI failure shows check name", () => {
    const snippet = itemSnippet(sampleCIFailure)
    assert(snippet.includes("build-and-test"))
})

Deno.test("itemSnippet: merge conflict shows base branch", () => {
    const snippet = itemSnippet(sampleConflict)
    assert(snippet.includes("main"))
})

Deno.test("formatListRow returns a string for each type", () => {
    const row1 = formatListRow(sampleComment, 0, "jeff-hykin")
    assert(row1.length > 0)
    assert(row1.includes("c0"))

    const row2 = formatListRow(sampleCIFailure, 1, "jeff-hykin")
    assert(row2.includes("ci1"))

    const row3 = formatListRow(sampleConflict, 2, "jeff-hykin")
    assert(row3.includes("mc2"))
})
