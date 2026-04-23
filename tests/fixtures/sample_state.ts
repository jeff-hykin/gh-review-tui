import type { ReviewState, CommentItem, CIFailureItem, MergeConflictItem } from "../../src/types.ts"

export const sampleComment: CommentItem = {
    type: "comment",
    thread_id: "12345",
    thread_node_id: "PRRT_abc123",
    category: "unknown",
    status: "unseen",
    file: "src/main.ts",
    line: 42,
    diff_hunk: "@@ -40,6 +40,10 @@\n some context\n+new code here",
    comments: [
        {
            id: "c100",
            author: "reviewer1",
            body: "This should use a Map instead of an object for better performance.",
            created_at: "2026-04-20T10:00:00Z",
            node_id: "IC_abc",
        },
        {
            id: "c101",
            author: "jeff-hykin",
            body: "Good point, I'll fix that.",
            created_at: "2026-04-20T11:00:00Z",
            node_id: "IC_def",
        },
    ],
    resolved: false,
    draft_response: "",
    notes: "",
    summary: "",
}

export const sampleCIFailure: CIFailureItem = {
    type: "ci_failure",
    category: "unknown",
    status: "unseen",
    run_id: "99999",
    check_name: "build-and-test",
    conclusion: "FAILURE",
    commit_sha: "abc123def456",
    recorded_at: "2026-04-22T10:00:00Z",
    error_summary: "TypeError: Cannot read property 'x' of undefined",
    url: "https://github.com/org/repo/actions/runs/99999",
    draft_response: "",
    notes: "",
    summary: "",
}

export const sampleConflict: MergeConflictItem = {
    type: "merge_conflict",
    category: "unknown",
    status: "unseen",
    conflicting_files: ["src/main.ts", "src/utils.ts"],
    base_branch: "main",
    recorded_at: "2026-04-22T12:00:00Z",
    commit_sha: "abc123def456",
    draft_response: "",
    notes: "",
    summary: "",
}

export const sampleState: ReviewState = {
    pr: {
        number: 42,
        repo: "org/repo",
        branch: "feature/cool-thing",
        base_branch: "main",
        title: "Add cool feature",
        url: "https://github.com/org/repo/pull/42",
        author: "jeff-hykin",
    },
    last_synced: "2026-04-22T12:00:00Z",
    gh_user: "jeff-hykin",
    items: [sampleComment, sampleCIFailure, sampleConflict],
}
