---
name: review
description: Fetch, summarize, and address PR/MR review feedback. Categorizes comments by severity and type, helps triage and resolve issues, draft responses, and push fixes. Use when a PR has review comments to address, when asked to handle review feedback, or when preparing to re-request review.
---

# Review

Fetch PR/MR review feedback, categorize it, and help the developer address it systematically.

This skill is about **handling feedback you received**, not generating reviews. For first-pass code review, use your workspace's dedicated review skill if available.

## When to Use

- PR has review comments (changes requested, inline feedback)
- CodeRabbit or another bot posted a review
- You need to understand what a reviewer is asking for
- You want to work through feedback items one by one
- You need to respond to reviewer questions
- You're ready to push fixes and re-request review

---

## Step 1: Fetch Review Data

### Detect Platform

Determine platform from git remote:

```bash
git remote get-url origin
# github.com → GitHub
# gitlab.com → GitLab
```

### GitHub — Use GraphQL

The REST API (`gh api repos/.../pulls/.../comments`) **flattens threads and loses resolution status**. Always use GraphQL for complete review data.

#### Fetch PR number from current branch

```bash
gh pr view --json number,title,state,url --jq '.'
```

#### Fetch complete review threads

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      body
      state
      url
      reviewDecision
      mergeable
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first: 50) {
                nodes {
                  ... on CheckRun {
                    name
                    conclusion
                  }
                  ... on StatusContext {
                    context
                    state
                  }
                }
              }
            }
          }
        }
      }
      reviews(first: 100) {
        nodes {
          author { login }
          state
          body
          submittedAt
        }
      }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          diffSide
          comments(first: 50) {
            nodes {
              id
              databaseId
              author { login }
              body
              createdAt
              path
              line
              url
            }
          }
        }
      }
    }
  }
}' -f owner=OWNER -f repo=REPO -F number=NUMBER
```

Extract `OWNER` and `REPO` from `git remote get-url origin`:
- SSH `git@github.com:owner/repo.git` → parse with regex
- HTTPS `https://github.com/owner/repo.git` → parse with regex

Key fields:
- `reviewThreads.nodes` — each thread is a conversation on a specific line, with nested replies
- `isResolved` — whether the author marked the thread resolved
- `isOutdated` — code has changed since the comment was made
- `comments.nodes[].databaseId` — numeric review comment ID for REST reply endpoints
- `reviews.nodes` — top-level review verdicts (APPROVED, CHANGES_REQUESTED, COMMENTED)
- `reviewDecision` — overall PR review status
- `statusCheckRollup` — CI status
- `mergeable` — whether the PR can be merged

### GitLab — Use Discussions API

GitLab groups threaded comments into discussions with resolution tracking.

#### Fetch MR metadata

```bash
# Resolve project identifier from remote URL
REMOTE_URL=$(git remote get-url origin)
PROJECT_PATH=$(echo "$REMOTE_URL" | sed -E 's#(git@gitlab.com:|https://gitlab.com/)##; s#\.git$##')
PROJECT_ID="${PROJECT_PATH//\//%2F}"   # URL-encoded path: group%2Fproject

# Get MR IID + metadata from current branch
MR_IID=$(glab mr view --json iid --jq '.iid')
glab mr view --json iid,title,state,web_url,pipeline --jq '.'

# Or via API
glab api "projects/$PROJECT_ID/merge_requests/$MR_IID"
```

#### Fetch complete discussions

```bash
glab api "projects/$PROJECT_ID/merge_requests/$MR_IID/discussions"
```

Each discussion contains:
- `notes[]` — threaded replies in order
- `notes[].resolvable` / `notes[].resolved` — resolution status
- `notes[].type` — `DiffNote` (inline) or `DiscussionNote` (general)
- `notes[].position` — file, line, and diff context for inline comments

#### Fetch pipeline status

```bash
glab api "projects/$PROJECT_ID/merge_requests/$MR_IID/pipelines"
```

---

## Step 2: Classify Comments

Each review comment gets **two dimensions**: severity and category.

### Severity

Infer from comment content since platforms have no native severity field.

| Severity | Meaning | Signals |
|----------|---------|---------|
| **Critical** | Blocks merge. Security, data loss, correctness | "security", "vulnerability", "data loss", "race condition", "breaks", "injection", reviewer used CHANGES_REQUESTED |
| **Major** | Should fix before merge. Logic errors, missing edge cases | "bug", "wrong", "incorrect", "missing", "should be", "this will cause", "fails when" |
| **Minor** | Improve but won't block. Better naming, small refactors | "consider", "suggestion", "could", "might be better", "prefer", "would be clearer" |
| **Nit** | Stylistic, take-it-or-leave-it | "nit:", "nitpick:", "optional:", "style:", "minor:", "bikeshed", "tiny:" |
| **Question** | Needs a response, not a code change | Ends with `?`, "why", "what does", "can you explain", "curious", "wondering" |
| **Praise** | Positive feedback, no action needed | "nice", "great", "love this", "clever", "+1", "LGTM", "clean" |

**Severity heuristics:**
- A CHANGES_REQUESTED review elevates its comments — treat unlabeled items as at least Major unless clearly a nit
- An APPROVED or COMMENTED review with suggestions — default to Minor unless language indicates higher severity
- Multiple reviewers flagging the same area — escalate severity
- Comments on test files — typically Minor or Nit unless testing a critical path

### Category

| Category | Scope |
|----------|-------|
| **Security** | Auth, injection, secrets, permissions, CORS, XSS |
| **Correctness** | Logic bugs, wrong behavior, missing edge cases, race conditions |
| **Performance** | N+1 queries, unnecessary re-renders, memory leaks, bundle size |
| **Architecture** | Patterns, abstractions, coupling, separation of concerns |
| **Testing** | Missing tests, test quality, coverage gaps |
| **Style** | Naming, formatting, code organization, consistency |
| **Documentation** | Missing docs, unclear comments, README updates |
| **Types** | Type safety, missing types, incorrect generics |

### CodeRabbit-Specific

CodeRabbit structures its reviews with labels and severity. When a comment author is `coderabbitai` or `github-actions[bot]` posting CodeRabbit output:

- Extract severity from CodeRabbit's own labels (it uses `[nitpick]`, `[important]`, etc.)
- Extract the walkthrough summary from the top-level review comment
- Don't re-infer severity — trust CodeRabbit's classification
- Group CodeRabbit comments separately from human reviewers

### Conflicting Signals

- Reviewer approved but left a "critical" sounding comment → flag the mismatch, don't silently escalate
- Two reviewers disagree on approach → flag as a conflict, present both positions
- Comment on outdated code → flag as potentially resolved, confirm with user

---

## Step 3: Present Summary

Format the summary grouped by reviewer, with severity tallies.

```
PR #247 — "PROD-123 | Add email notifications"
Status: Changes requested | CI: passing | Mergeable: yes

@alice — Changes requested (4 comments)
  Critical (1): SQL injection in user query               [security]     → src/db/users.ts:45
  Major    (2): Missing null check in parser               [correctness]  → src/parser.ts:112
                Race condition in cache invalidation       [correctness]  → src/cache.ts:67
  Minor    (1): Rename variable for clarity                [style]        → src/utils.ts:23

@bob — Commented (3 comments)
  Question (2): Why use Map instead of Object?             [architecture] → src/store.ts:34
                What's the migration plan for v2?          [architecture] → src/api.ts:89
  Nit      (1): Trailing whitespace                        [style]        → src/index.ts:5

@coderabbitai — Commented (4 comments)
  Major    (1): Unused import may indicate dead code       [correctness]  → src/lib.ts:3
  Minor    (3): Type narrowing opportunity                 [types]        → src/handler.ts:78
                Error message could be more descriptive    [documentation]→ src/errors.ts:15
                Naming convention inconsistency            [style]        → src/api.ts:42

Resolved threads: 2 | Outdated threads: 1

Totals: 2 critical, 3 major, 4 minor, 1 nit, 2 questions, 0 praise
```

---

## Step 4: Triage

Ask the user how they want to proceed:

1. **Address all blocking items** — Critical + Major (most common)
2. **Address everything** — all actionable items including Minor and Nit
3. **Let me pick** — user selects specific items
4. **Just the summary** — read-only, no changes
5. **Address by reviewer** — focus on one reviewer's feedback first

For option 3, present a numbered list and let the user select.

### Priority Order

When working through items, follow this order:
1. Critical items (highest risk)
2. Major items
3. Questions (may unblock other work or clarify intent)
4. Minor items
5. Nits

---

## Step 5: Address Items

For each selected item:

### Read Context

1. Show the reviewer's comment
2. Show the code at the referenced file:line
3. Show surrounding context (5-10 lines each side)
4. If the thread has replies, show the full conversation

### Propose Fix

- For code changes: describe the fix, then apply it
- For questions: draft a response explaining the reasoning
- For nits: apply if trivial, skip if the user said "blocking only"
- For architecture concerns: discuss with user before changing — these often need team consensus

### Apply

- Edit the file directly
- If multiple items touch the same file, batch them
- After each file edit, briefly state what was changed and why

### Draft Response (Optional)

For questions or items where context matters, draft a reply comment:

```
@alice Good catch — fixed in the latest push. Added parameterized query to prevent injection.
```

```
@bob We chose Map over Object because we need non-string keys for the widget IDs.
The v2 migration plan is tracked in PROD-456.
```

Don't post responses without user confirmation.

---

## Step 6: Wrap Up

After addressing all selected items:

### Commit Changes

Delegate to the **commit skill**. The commit message should reference the review:

```
fix(web): 🐛 address PR review feedback

- Fix SQL injection in user query
- Add null check in parser
- Fix cache invalidation race condition

PROD-123
```

Or if changes are substantial enough, create separate atomic commits per concern.

### Push

```bash
git push
```

### Reply to Threads (Optional)

If the user confirms, post reply comments:

**GitHub:**
```bash
# Reply to a review thread
# COMMENT_DB_ID comes from comments.nodes[].databaseId in the GraphQL response
gh api repos/OWNER/REPO/pulls/NUMBER/comments/COMMENT_DB_ID/replies \
  -f body="Fixed in latest push — added parameterized query."

# Or post a general PR comment
gh pr comment NUMBER --body "Addressed all review feedback. Ready for re-review."
```

**GitLab:**
```bash
# Reply to a discussion
glab api "projects/$PROJECT_ID/merge_requests/$MR_IID/discussions/$DISCUSSION_ID/notes" \
  -f body="Fixed in latest push."

# General MR comment
glab api "projects/$PROJECT_ID/merge_requests/$MR_IID/notes" \
  -f body="Addressed all review feedback."
```

### Resolve Threads (Optional)

If all items in a thread are addressed:

**GitHub:**
```bash
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { isResolved }
  }
}' -f threadId=THREAD_ID
```

**GitLab:**
```bash
glab api -X PUT "projects/$PROJECT_ID/merge_requests/$MR_IID/discussions/$DISCUSSION_ID" \
  -f resolved=true
```

Ask user before resolving — some teams prefer reviewers resolve their own threads.

### Re-Request Review (Optional)

**GitHub:**
```bash
gh pr edit NUMBER --add-reviewer alice,bob
```

**GitLab:**
```bash
# Re-request via API
glab api -X PUT "projects/$PROJECT_ID/merge_requests/$MR_IID" \
  -f "reviewer_ids[]=USER_ID"
```

---

## CI Status Awareness

Before starting work, check CI status. If checks are failing:

- Show which checks failed
- Determine if failures are related to review feedback or pre-existing
- If pre-existing: note it but proceed with review feedback
- If caused by review changes: fix CI issues as part of addressing feedback

**GitHub:**
```bash
gh pr checks NUMBER
```

**GitLab:**
```bash
glab mr view --json pipeline
```

---

## Edge Cases

### Multiple Reviewers
Group by reviewer. Let user pick whose feedback to address first, or "all".

### Outdated Comments
Flag threads where `isOutdated` is true (GitHub) or the code has changed since the comment. Ask user: "This comment may already be resolved by recent changes. Skip or verify?"

### Self-Review Comments
If the PR author left comments on their own PR (common for context), classify as documentation/context — not actionable feedback.

### Bot Reviews
Identify bot reviewers (`coderabbitai`, `github-actions[bot]`, `copilot[bot]`) and group them separately. Extract structured data from their format rather than treating as freeform text.

### No Review Comments
If the PR has no reviews or all threads are resolved: "No pending review feedback. PR is ready for merge or additional review."

### Large Reviews (20+ comments)
Summarize by severity first, then ask user to select a category or severity level to work through rather than presenting all items at once.

---

## Agent Delegation

| Task | Delegate? | Rationale |
|------|-----------|-----------|
| Fetch review data (GraphQL/API) | Yes | Deterministic commands |
| Parse and extract threads | Yes | Data transformation |
| Classify severity/category | No | Needs judgment on content and context |
| Present summary | No | Needs formatting judgment |
| Triage decision | No | User interaction |
| Propose fixes | No | Needs code understanding |
| Apply code changes | No | Needs correctness judgment |
| Draft reply comments | No | Needs communication judgment |
| Commit changes | Yes | Delegate to commit skill |
| Push to remote | Yes | Simple command |
| Post reply comments (after user confirms) | Yes | API calls |
| Resolve threads (after user confirms) | Yes | API calls |

## Process (Agent)

1. **[delegate]** Detect platform from `git remote get-url origin`
2. **[delegate]** Fetch PR/MR number from current branch (`gh pr view` or `glab mr view`)
3. **[delegate]** Fetch complete review data via GraphQL (GitHub) or discussions API (GitLab)
4. **[delegate]** Fetch CI status
5. Parse review threads — reconstruct conversations, note resolution/outdated status
6. Classify each comment: severity (Critical/Major/Minor/Nit/Question/Praise) + category
7. Detect CodeRabbit or bot reviews — extract structured severity instead of inferring
8. Present summary to user (grouped by reviewer, severity tallies)
9. Ask user: address all blocking? everything? pick specific items? summary only?
10. For each selected item:
    - Show comment + code context
    - Propose fix or response
    - Apply changes
    - Draft reply if appropriate
11. **[delegate to commit skill]** Commit fixes
12. **[delegate]** Push
13. Ask user: post reply comments? resolve threads? re-request review?
14. **[delegate]** Execute confirmed actions

## Process (Human)

For teams not using AI agents, the review skill provides a mental framework:

1. Open PR, read review summary
2. Categorize feedback by severity (critical first)
3. Address critical and major items
4. Respond to questions with context
5. Address minor/nit items if time permits
6. Push fixes
7. Reply to threads explaining changes
8. Re-request review
