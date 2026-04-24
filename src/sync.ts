import type { ReviewState, ReviewItem, CommentItem, CIFailureItem, MergeConflictItem } from "./types.ts"
import * as gh from "./gh.ts"

// ── Sync: fetch fresh GH data and merge with existing state ──────────────

export async function syncState(existing: ReviewState | null, cwd?: string): Promise<ReviewState> {
    const ghUser = await gh.getGHUser()
    const branch = await gh.getCurrentBranch(cwd)
    const remote = await gh.getRemoteUrl(cwd)
    const pr = await gh.findPRForBranch(branch, remote)

    if (!pr) {
        throw new Error(`No open PR found for branch "${branch}"`)
    }

    // Fetch fresh data from GH
    const [freshThreads, freshCI, mergeConflict] = await Promise.all([
        gh.fetchReviewThreads(pr.repo, pr.number),
        gh.fetchCIStatus(pr.repo, pr.number),
        gh.checkMergeConflict(pr.repo, pr.number),
    ])

    const existingItems = existing?.items ?? []

    // Merge comment threads
    const mergedComments = mergeCommentItems(existingItems, freshThreads)

    // Append CI failures (accumulate, don't replace)
    const mergedCI = mergeCIItems(existingItems, freshCI)

    // Append merge conflict if present
    const mergedConflicts = mergeConflictItems(existingItems, mergeConflict)

    const allItems: ReviewItem[] = [
        ...mergedComments,
        ...mergedCI,
        ...mergedConflicts,
    ]

    return {
        pr,
        last_synced: new Date().toISOString(),
        gh_user: ghUser,
        items: allItems,
    }
}

// ── Merge comment items: preserve local annotations ──────────────────────

function mergeCommentItems(
    existing: ReviewItem[],
    fresh: CommentItem[],
): CommentItem[] {
    const existingComments = existing.filter(
        (i): i is CommentItem => i.type === "comment"
    )

    // Index existing by thread_id for fast lookup
    const existingByThread = new Map<string, CommentItem>()
    for (const item of existingComments) {
        existingByThread.set(item.thread_id, item)
    }

    return fresh.map((freshItem) => {
        const prev = existingByThread.get(freshItem.thread_id)
        if (!prev) {
            // New thread — keep as unseen
            return freshItem
        }

        // Merge: keep local annotations, update GH data
        const hasNewComments = freshItem.comments.length > prev.comments.length
        return {
            ...freshItem,
            // Preserve local state
            category: prev.category,
            status: hasNewComments && prev.status !== "unseen" ? "unaddressed" : prev.status,
            draft_response: prev.draft_response,
            notes: prev.notes,
            summary: prev.summary,
        }
    })
}

// ── Merge CI items: accumulate history ───────────────────────────────────

// Maximum number of CI failure records to retain
const MAX_CI_FAILURES = 20

function mergeCIItems(
    existing: ReviewItem[],
    fresh: CIFailureItem[],
): CIFailureItem[] {
    const existingCI = existing.filter(
        (i): i is CIFailureItem => i.type === "ci_failure"
    )

    // Keep all existing CI entries
    const result = [...existingCI]

    // Add fresh ones that aren't duplicates (same run_id + check_name)
    const existingKeys = new Set(
        existingCI.map((i) => `${i.run_id}:${i.check_name}`)
    )

    for (const item of fresh) {
        const key = `${item.run_id}:${item.check_name}`
        if (!existingKeys.has(key)) {
            result.push(item)
        }
    }

    // Prune: if we have fresh failures, only keep failures from the latest
    // commit SHA plus a small history. This prevents unbounded accumulation.
    if (result.length > MAX_CI_FAILURES) {
        // Sort by recorded_at descending (newest first), then keep the cap
        result.sort((a, b) => (b.recorded_at ?? "").localeCompare(a.recorded_at ?? ""))
        result.length = MAX_CI_FAILURES
    }

    return result
}

// ── Merge conflict items: accumulate history ─────────────────────────────

function mergeConflictItems(
    existing: ReviewItem[],
    fresh: MergeConflictItem | null,
): MergeConflictItem[] {
    const existingConflicts = existing.filter(
        (i): i is MergeConflictItem => i.type === "merge_conflict"
    )

    const result = [...existingConflicts]

    if (fresh) {
        // Check if we already have a conflict for this commit
        const hasSameCommit = existingConflicts.some(
            (c) => c.commit_sha === fresh.commit_sha
        )
        if (!hasSameCommit) {
            result.push(fresh)
        }
    }

    return result
}
