import { assert, assertEquals } from "jsr:@std/assert@1"
import { generateClipboardContent } from "../src/clipboard.ts"
import { sampleState, sampleComment, sampleCIFailure, sampleConflict } from "./fixtures/sample_state.ts"

Deno.test("clipboard content has overview, XML, and CLI instructions", () => {
    const content = generateClipboardContent(sampleComment, 0, sampleState)

    // Should have natural language overview
    assert(content.includes("PR #42"))
    assert(content.includes("Add cool feature"))

    // Should have XML structured data
    assert(content.includes("<review-item>"))
    assert(content.includes("</review-item>"))
    assert(content.includes("<file>src/main.ts</file>"))
    assert(content.includes("<line>42</line>"))

    // Should have CLI instructions
    assert(content.includes("gre set c0"))
    assert(content.includes("gre draft c0"))
    assert(content.includes("auto_solved"))
})

Deno.test("clipboard content for CI failure", () => {
    const content = generateClipboardContent(sampleCIFailure, 1, sampleState)

    assert(content.includes("CI check"))
    assert(content.includes("build-and-test"))
    assert(content.includes("<check-name>"))
    assert(content.includes("gre set ci1"))
})

Deno.test("clipboard content for merge conflict", () => {
    const content = generateClipboardContent(sampleConflict, 2, sampleState)

    assert(content.includes("merge conflict"))
    assert(content.includes("<base-branch>main</base-branch>"))
    assert(content.includes("gre set mc2"))
})

Deno.test("clipboard includes notes when present", () => {
    const itemWithNotes = { ...sampleComment, notes: "Need to check performance impact" }
    const content = generateClipboardContent(itemWithNotes, 0, sampleState)

    assert(content.includes("Need to check performance impact"))
    assert(content.includes("<notes>"))
})

Deno.test("clipboard includes draft when present", () => {
    const itemWithDraft = { ...sampleComment, draft_response: "Switched to Map, PTAL" }
    const content = generateClipboardContent(itemWithDraft, 0, sampleState)

    assert(content.includes("Switched to Map, PTAL"))
    assert(content.includes("<draft-response>"))
})

Deno.test("clipboard for wontfix includes explanation request", () => {
    const wontfix = { ...sampleComment, category: "wontfix" as const }
    const content = generateClipboardContent(wontfix, 0, sampleState)

    assert(content.includes("wontfix"))
})

Deno.test("clipboard for simple fix requests single commit", () => {
    const simple = { ...sampleComment, category: "simple_fix" as const }
    const content = generateClipboardContent(simple, 0, sampleState)

    assert(content.includes("single commit"))
})
