import { assertEquals, assertNotEquals } from "jsr:@std/assert@1"
import { loadState, saveState } from "../src/state.ts"
import { sampleState } from "./fixtures/sample_state.ts"

Deno.test("loadState returns null for missing file", async () => {
    const result = await loadState("/tmp/gre-test-nonexistent/state.yaml")
    assertEquals(result, null)
})

Deno.test("saveState + loadState roundtrip", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "gre-test-" })
    const path = `${tmpDir}/state.yaml`

    await saveState(path, sampleState)
    const loaded = await loadState(path)

    assertNotEquals(loaded, null)
    assertEquals(loaded!.pr.number, 42)
    assertEquals(loaded!.pr.repo, "org/repo")
    assertEquals(loaded!.gh_user, "jeff-hykin")
    assertEquals(loaded!.items.length, 3)

    // Check comment item
    const comment = loaded!.items[0]
    assertEquals(comment.type, "comment")
    if (comment.type === "comment") {
        assertEquals(comment.thread_id, "12345")
        assertEquals(comment.comments.length, 2)
        assertEquals(comment.comments[0].author, "reviewer1")
        assertEquals(comment.category, "unknown")
        assertEquals(comment.status, "unseen")
    }

    // Check CI failure
    const ci = loaded!.items[1]
    assertEquals(ci.type, "ci_failure")
    if (ci.type === "ci_failure") {
        assertEquals(ci.check_name, "build-and-test")
        assertEquals(ci.run_id, "99999")
    }

    // Check merge conflict
    const conflict = loaded!.items[2]
    assertEquals(conflict.type, "merge_conflict")
    if (conflict.type === "merge_conflict") {
        assertEquals(conflict.conflicting_files.length, 2)
    }

    // Cleanup
    await Deno.remove(tmpDir, { recursive: true })
})
