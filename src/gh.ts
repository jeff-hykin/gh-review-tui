import $ from "jsr:@david/dax@0.42"
import type { Comment, CommentItem, CIFailureItem, MergeConflictItem, PRMetadata } from "./types.ts"

// ── Get current GH user ──────────────────────────────────────────────────

export async function getGHUser(): Promise<string> {
    const result = await $`gh api user --jq .login`.stdout("piped")
    return result.stdout.trim()
}

// ── Get current branch ───────────────────────────────────────────────────

export async function getCurrentBranch(cwd?: string): Promise<string> {
    const cmd = $`git rev-parse --abbrev-ref HEAD`.stdout("piped")
    if (cwd) {
        cmd.cwd(cwd)
    }
    const result = await cmd
    return result.stdout.trim()
}

// ── Get remote URL (for state dir keying) ────────────────────────────────

export async function getRemoteUrl(cwd?: string): Promise<string> {
    const cmd = $`git remote get-url origin`.stdout("piped")
    if (cwd) {
        cmd.cwd(cwd)
    }
    const result = await cmd
    return result.stdout.trim()
}

// ── Find PR for the current branch ───────────────────────────────────────

export async function findPRForBranch(branch: string, remote?: string): Promise<PRMetadata | null> {
    // Try to detect repo from remote URL or let gh figure it out
    const args = ["gh", "pr", "list", "--head", branch, "--state", "open", "--json",
        "number,title,url,headRefName,baseRefName,author,headRepository",
        "--limit", "1"]

    const result = await $`${args}`.stdout("piped").noThrow()
    if (result.code !== 0) {
        return null
    }

    const prs = JSON.parse(result.stdout)
    if (prs.length === 0) {
        return null
    }

    const pr = prs[0]

    // Get the repo name with owner
    let repo = ""
    if (pr.headRepository?.nameWithOwner) {
        repo = pr.headRepository.nameWithOwner
    } else {
        // Fallback: parse from remote URL
        if (remote) {
            const match = remote.match(/[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)
            if (match) {
                repo = match[1]
            }
        }
    }

    return {
        number: pr.number,
        repo,
        branch: pr.headRefName,
        base_branch: pr.baseRefName,
        title: pr.title,
        url: pr.url,
        author: pr.author?.login ?? "unknown",
    }
}

// ── Fetch review threads (comment items) ─────────────────────────────────

interface GHReviewThread {
    id: string           // node ID for resolving
    isResolved: boolean
    comments: {
        nodes: {
            id: string
            author: { login: string } | null
            body: string
            createdAt: string
            path: string
            line: number | null
            diffHunk: string
            databaseId: number
        }[]
    }
}

export async function fetchReviewThreads(repo: string, prNumber: number): Promise<CommentItem[]> {
    // Use GraphQL for review threads since REST doesn't group them well
    const query = `
        query($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
                pullRequest(number: $number) {
                    reviewThreads(first: 100) {
                        nodes {
                            id
                            isResolved
                            comments(first: 100) {
                                nodes {
                                    id
                                    databaseId
                                    author { login }
                                    body
                                    createdAt
                                    path
                                    line
                                    diffHunk
                                }
                            }
                        }
                    }
                }
            }
        }
    `

    const [owner, repoName] = repo.split("/")
    const result = await $`gh api graphql -f query=${query} -F owner=${owner} -F repo=${repoName} -F number=${prNumber}`
        .stdout("piped").noThrow()

    if (result.code !== 0) {
        console.error("Failed to fetch review threads:", result.stderr)
        return []
    }

    const data = JSON.parse(result.stdout)
    const threads: GHReviewThread[] = data.data.repository.pullRequest.reviewThreads.nodes

    return threads.map((thread): CommentItem => {
        const comments = thread.comments.nodes
        const firstComment = comments[0]
        return {
            type: "comment",
            thread_id: String(firstComment?.databaseId ?? thread.id),
            thread_node_id: thread.id,
            category: "unknown",
            status: "unseen",
            file: firstComment?.path ?? "",
            line: firstComment?.line ?? 0,
            diff_hunk: firstComment?.diffHunk ?? "",
            comments: comments.map((c): Comment => ({
                id: String(c.databaseId),
                author: c.author?.login ?? "unknown",
                body: c.body,
                created_at: c.createdAt,
                node_id: c.id,
            })),
            resolved: thread.isResolved,
            draft_response: "",
            notes: "",
            summary: "",
        }
    })
}

// ── Fetch CI status ──────────────────────────────────────────────────────

export async function fetchCIStatus(repo: string, prNumber: number): Promise<CIFailureItem[]> {
    const result = await $`gh pr view ${prNumber} -R ${repo} --json statusCheckRollup,headRefOid`
        .stdout("piped").noThrow()

    if (result.code !== 0) {
        return []
    }

    const data = JSON.parse(result.stdout)
    const checks = data.statusCheckRollup ?? []
    const commitSha = data.headRefOid ?? ""
    const now = new Date().toISOString()

    return checks
        .filter((c: any) => c.conclusion === "FAILURE")
        .map((c: any): CIFailureItem => ({
            type: "ci_failure",
            category: "unknown",
            status: "unseen",
            run_id: String(c.detailsUrl?.match(/runs\/(\d+)/)?.[1] ?? c.name),
            check_name: c.name,
            conclusion: c.conclusion,
            commit_sha: commitSha,
            recorded_at: now,
            error_summary: "",
            url: c.detailsUrl ?? "",
            draft_response: "",
            notes: "",
            summary: "",
        }))
}

// ── Check for merge conflicts ────────────────────────────────────────────

export async function checkMergeConflict(repo: string, prNumber: number): Promise<MergeConflictItem | null> {
    const result = await $`gh pr view ${prNumber} -R ${repo} --json mergeable,baseRefName,headRefOid`
        .stdout("piped").noThrow()

    if (result.code !== 0) {
        return null
    }

    const data = JSON.parse(result.stdout)
    if (data.mergeable === "CONFLICTING") {
        return {
            type: "merge_conflict",
            category: "unknown",
            status: "unseen",
            conflicting_files: [], // GH API doesn't easily expose this
            base_branch: data.baseRefName ?? "",
            recorded_at: new Date().toISOString(),
            commit_sha: data.headRefOid ?? "",
            draft_response: "",
            notes: "",
            summary: "",
        }
    }

    return null
}

// ── Post a reply to a review thread ──────────────────────────────────────

export async function postReply(repo: string, prNumber: number, threadNodeId: string, body: string): Promise<boolean> {
    const mutation = `
        mutation($threadId: ID!, $body: String!) {
            addPullRequestReviewComment(input: {
                pullRequestReviewThreadId: $threadId
                body: $body
            }) {
                comment { id }
            }
        }
    `

    const result = await $`gh api graphql -f query=${mutation} -F threadId=${threadNodeId} -F body=${body}`
        .stdout("piped").noThrow()

    return result.code === 0
}

// ── Resolve a review thread ─────────────────────────────────────────────

export async function resolveThread(threadNodeId: string): Promise<boolean> {
    const mutation = `
        mutation($threadId: ID!) {
            resolveReviewThread(input: { threadId: $threadId }) {
                thread { isResolved }
            }
        }
    `

    const result = await $`gh api graphql -f query=${mutation} -F threadId=${threadNodeId}`
        .stdout("piped").noThrow()

    return result.code === 0
}

// ── Fetch failed CI run logs ─────────────────────────────────────────────

export async function fetchFailedLogs(repo: string, runId: string): Promise<string> {
    const result = await $`gh run view ${runId} -R ${repo} --log-failed`
        .stdout("piped").stderr("null").noThrow()

    if (result.code !== 0) {
        return "(could not fetch logs)"
    }

    // Return last 50 lines
    const lines = result.stdout.split("\n")
    return lines.slice(-50).join("\n")
}
