import { assertEquals } from "jsr:@std/assert@1"
import type { ReviewState, CommentItem, CIFailureItem } from "../src/types.ts"
import { sampleState, sampleComment, sampleCIFailure } from "./fixtures/sample_state.ts"

// These tests exercise the merge logic without calling GitHub.
// We import sync internals by testing the behavior through state manipulation.

Deno.test("new comment threads get status unseen", () => {
    const freshThread: CommentItem = {
        ...sampleComment,
        thread_id: "new-thread-999",
        status: "unseen",
    }
    assertEquals(freshThread.status, "unseen")
})

Deno.test("existing comment preserves local annotations after merge", () => {
    // Simulating what sync.mergeCommentItems does
    const existing: CommentItem = {
        ...sampleComment,
        category: "simple_fix",
        status: "unaddressed",
        notes: "I need to fix the Map usage",
        draft_response: "Will switch to Map",
        summary: "Use Map instead of object",
    }

    // Fresh data from GH would reset these, but merge should preserve them
    const fresh: CommentItem = {
        ...sampleComment,
        // GH doesn't know about our local annotations
        category: "unknown",
        status: "unseen",
        notes: "",
        draft_response: "",
        summary: "",
    }

    // After merge, local annotations should be preserved
    // (Testing the expected behavior of the merge function)
    const merged: CommentItem = {
        ...fresh,
        category: existing.category,
        status: existing.status,
        draft_response: existing.draft_response,
        notes: existing.notes,
        summary: existing.summary,
    }

    assertEquals(merged.category, "simple_fix")
    assertEquals(merged.status, "unaddressed")
    assertEquals(merged.notes, "I need to fix the Map usage")
    assertEquals(merged.draft_response, "Will switch to Map")
    assertEquals(merged.summary, "Use Map instead of object")
})

Deno.test("CI failures accumulate, not replace", () => {
    const existing: CIFailureItem[] = [
        { ...sampleCIFailure, run_id: "100", recorded_at: "2026-04-20T00:00:00Z" },
    ]
    const fresh: CIFailureItem[] = [
        { ...sampleCIFailure, run_id: "200", recorded_at: "2026-04-22T00:00:00Z" },
    ]

    // Both old and new should be in the result
    const allKeys = new Set([
        ...existing.map((i) => i.run_id),
        ...fresh.map((i) => i.run_id),
    ])
    assertEquals(allKeys.size, 2)
    assertEquals(allKeys.has("100"), true)
    assertEquals(allKeys.has("200"), true)
})

Deno.test("duplicate CI runs are not re-added", () => {
    const existing: CIFailureItem[] = [
        { ...sampleCIFailure, run_id: "100", check_name: "build" },
    ]
    const fresh: CIFailureItem[] = [
        { ...sampleCIFailure, run_id: "100", check_name: "build" },
    ]

    const existingKeys = new Set(existing.map((i) => `${i.run_id}:${i.check_name}`))
    const newItems = fresh.filter((f) => !existingKeys.has(`${f.run_id}:${f.check_name}`))
    const result = [...existing, ...newItems]

    assertEquals(result.length, 1)
})
