import { assertEquals } from "jsr:@std/assert@1"
import { itemId, computeDisplayStatus } from "../src/types.ts"
import { sampleComment, sampleCIFailure, sampleConflict } from "./fixtures/sample_state.ts"

Deno.test("itemId generates correct prefixes", () => {
    assertEquals(itemId(sampleComment, 0), "c0")
    assertEquals(itemId(sampleCIFailure, 1), "ci1")
    assertEquals(itemId(sampleConflict, 2), "mc2")
    assertEquals(itemId(sampleComment, 15), "c15")
})

Deno.test("computeDisplayStatus: pending when my reply is last", () => {
    const result = computeDisplayStatus(sampleComment, "jeff-hykin")
    assertEquals(result, "pending")
})

Deno.test("computeDisplayStatus: response_needed when reviewer reply is last", () => {
    const item = {
        ...sampleComment,
        comments: [sampleComment.comments[0]], // only reviewer's comment
    }
    const result = computeDisplayStatus(item, "jeff-hykin")
    assertEquals(result, "response_needed")
})

Deno.test("computeDisplayStatus: resolved when thread is resolved", () => {
    const item = { ...sampleComment, resolved: true }
    const result = computeDisplayStatus(item, "jeff-hykin")
    assertEquals(result, "resolved")
})

Deno.test("computeDisplayStatus: CI failure is response_needed by default", () => {
    const result = computeDisplayStatus(sampleCIFailure, "jeff-hykin")
    assertEquals(result, "response_needed")
})

Deno.test("computeDisplayStatus: CI failure resolved when solved", () => {
    const item = { ...sampleCIFailure, status: "solved" as const }
    const result = computeDisplayStatus(item, "jeff-hykin")
    assertEquals(result, "resolved")
})

Deno.test("computeDisplayStatus: merge conflict is response_needed", () => {
    const result = computeDisplayStatus(sampleConflict, "jeff-hykin")
    assertEquals(result, "response_needed")
})
