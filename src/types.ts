// ── Item types ───────────────────────────────────────────────────────────

export type ItemType = "comment" | "ci_failure" | "merge_conflict"

export type ItemCategory = "simple_fix" | "discussion" | "wontfix" | "large_change" | "unknown"

export type ItemStatus = "unseen" | "unaddressed" | "asked_claude" | "auto_solved" | "solved"

// ── Comment data ─────────────────────────────────────────────────────────

export interface Comment {
    id: string
    author: string
    body: string
    created_at: string
    // GH node ID for API operations
    node_id?: string
}

export interface CommentItem {
    type: "comment"
    thread_id: string
    // GH node ID for resolving threads
    thread_node_id?: string
    category: ItemCategory
    status: ItemStatus
    file: string
    line: number
    // Original diff hunk for context
    diff_hunk?: string
    // The comment chain in chronological order
    comments: Comment[]
    resolved: boolean
    draft_response: string
    notes: string
    summary: string
}

// ── CI failure data ──────────────────────────────────────────────────────

export interface CIFailureItem {
    type: "ci_failure"
    category: ItemCategory
    status: ItemStatus
    run_id: string
    check_name: string
    conclusion: string
    commit_sha: string
    // When this CI run was recorded
    recorded_at: string
    error_summary: string
    url: string
    draft_response: string
    notes: string
    summary: string
}

// ── Merge conflict data ──────────────────────────────────────────────────

export interface MergeConflictItem {
    type: "merge_conflict"
    category: ItemCategory
    status: ItemStatus
    conflicting_files: string[]
    base_branch: string
    // When this conflict was detected
    recorded_at: string
    commit_sha: string
    draft_response: string
    notes: string
    summary: string
}

// ── Union type ───────────────────────────────────────────────────────────

export type ReviewItem = CommentItem | CIFailureItem | MergeConflictItem

// ── PR metadata ──────────────────────────────────────────────────────────

export interface PRMetadata {
    number: number
    repo: string          // "owner/repo"
    branch: string
    base_branch: string
    title: string
    url: string
    author: string
}

// ── State file root ──────────────────────────────────────────────────────

export interface ReviewState {
    pr: PRMetadata
    last_synced: string
    gh_user: string       // current user's GH login, for "pending" detection
    items: ReviewItem[]
}

// ── Derived display state (not persisted) ────────────────────────────────

export type DisplayStatus =
    | "pending"           // I replied last, waiting for response
    | "response_needed"   // Someone else replied last, or unseen
    | "resolved"          // Thread is resolved on GH

export interface DisplayItem {
    index: number         // position in the items array (stable ID for CLI)
    item: ReviewItem
    display_status: DisplayStatus
}

// ── Helper to get a stable short ID for CLI usage ────────────────────────

export function itemId(item: ReviewItem, index: number): string {
    switch (item.type) {
        case "comment":
            return `c${index}`
        case "ci_failure":
            return `ci${index}`
        case "merge_conflict":
            return `mc${index}`
    }
}

// ── Compute display status ───────────────────────────────────────────────

export function computeDisplayStatus(item: ReviewItem, ghUser: string): DisplayStatus {
    if (item.type === "comment") {
        if (item.resolved) {
            return "resolved"
        }
        // "pending" = there's a back-and-forth where the user just replied
        // and is waiting on someone else. A single comment by the user (e.g.
        // a self-comment on their own PR) isn't really "waiting" on anyone
        // specific, so don't flag those as pending.
        if (item.comments.length > 1) {
            const lastComment = item.comments[item.comments.length - 1]
            if (lastComment.author === ghUser) {
                return "pending"
            }
        }
        return "response_needed"
    }
    // CI failures and merge conflicts are always "response_needed" unless solved
    if (item.status === "solved" || item.status === "auto_solved") {
        return "resolved"
    }
    return "response_needed"
}
