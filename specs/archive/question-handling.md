# Support for Issue Assignment and Question Handling

## Problem Statement

The current code assumes all webhooks are for **issue assignment** (implementing a ticket). However, users may also **ask questions** by mentioning the agent in a comment thread. The code needs to distinguish between these two interaction types and handle them appropriately.

## Key Differentiator

The webhook payload structure indicates the interaction type:

| Interaction Type        | `previousComments` | `agentSession.comment` | Expected Behavior                   |
| ----------------------- | ------------------ | ---------------------- | ----------------------------------- |
| **Issue Assignment**    | `null`/`undefined` | `null`/`undefined`     | Create worktree, implement ticket   |
| **Question in Comment** | Array of comments  | Comment object         | Answer question, no worktree needed |

## Current Behavior

In `agentClient.ts`, `handleUserPrompt()` always:

1. Creates a worktree for the ticket
2. Sets up environment
3. Runs Claude with implementation-focused prompt

This is wrong for questions - no worktree is needed to answer a question.

## Required Changes

### 1. Update Session Registry (extends stop-signal-handling.md)

**File: `src/lib/session/sessionRegistry.ts`**

Add interaction type to the session:

```typescript
type InteractionType = "issue_assignment" | "question";

interface ActiveSession {
  sessionId: string;
  ticketId: string;
  abortController: AbortController;
  worktreePath?: string; // Only set for issue_assignment
  startedAt: Date;
  interactionType: InteractionType; // NEW
}
```

### 2. Add Interaction Type Detection

**File: `src/app.ts`**

Add function to determine interaction type:

```typescript
function getInteractionType(
  payload: AgentSessionEventWebhookPayload
): InteractionType {
  // If previousComments exists, this is a question in a thread
  if (payload.previousComments && payload.previousComments.length > 0) {
    return "question";
  }
  // If there's a comment but no previous comments, check if it's a direct question
  if (payload.agentSession.comment) {
    return "question";
  }
  // Default to issue assignment
  return "issue_assignment";
}
```

Pass this to `handleAgentSessionEvent()`.

### 3. Split handleUserPrompt() into Two Paths

**File: `src/lib/agent/agentClient.ts`**

Refactor `handleUserPrompt()` to branch based on interaction type:

```typescript
public async handleUserPrompt(
  agentSession: AgentSessionEventWebhookPayload["agentSession"],
  interactionType: InteractionType,
  previousComments?: CommentChildWebhookPayload[]
): Promise<void> {
  if (interactionType === 'question') {
    await this.handleQuestion(agentSession, previousComments);
  } else {
    await this.handleIssueAssignment(agentSession);
  }
}
```

#### handleIssueAssignment() - Existing Logic (with additions)

- **Set ticket status to "In Progress"** (NEW - before starting work)
- Create worktree
- Setup environment
- Run implementation prompt
- Register session with worktree
- **Set ticket status to "Done" on success** (NEW - after successful completion)

#### handleQuestion() - New Logic

- Extract question from comment
- Build context from previousComments
- Set CWD to main repo (read-only access to codebase and git logs)
- Run answer prompt with read-only tools (Read, Grep, Glob, Bash for `git log`)
- Register session without worktree

### 4. Add Ticket Status Update for Issue Assignments

**File: `src/lib/agent/agentClient.ts`**

Add a method to update the ticket status to "In Progress" when starting work:

```typescript
private async setTicketStatus(ticketId: string, statusName: string): Promise<void> {
  const issue = await this.linearClient.issue(ticketId);
  const team = await issue.team;

  const states = await team?.states();
  const targetState = states?.nodes.find(
    state => state.name.toLowerCase() === statusName.toLowerCase()
  );

  if (targetState) {
    await issue.update({ stateId: targetState.id });
    console.log(`Set ticket ${ticketId} to ${statusName}`);
  }
}
```

Call `setTicketStatus(ticketId, 'In Progress')` at the start of `handleIssueAssignment()`.
Call `setTicketStatus(ticketId, 'Done')` after successful completion (when `result.success` is true).

### 5. Update Webhook Handler

**File: `src/app.ts`**

```typescript
async function handleAgentSessionEvent(
  webhook: AgentSessionEventWebhookPayload
): Promise<void> {
  // ... existing token validation ...

  const interactionType = getInteractionType(webhook);
  const agentClient = new AgentClient(token);

  await agentClient.handleUserPrompt(
    webhook.agentSession,
    interactionType,
    webhook.previousComments // Pass for context in questions
  );
}
```

## Compatibility with Stop Signal Handling

The stop signal spec (`specs/stop-signal-handling.md`) remains compatible:

- **Session Registry**: Now includes `interactionType` field
- **Abort behavior**: Works the same for both types
- **Cleanup**: `worktreePath` is only set for issue assignments, so cleanup only runs when needed

## Files to Modify

| File                                 | Changes                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `src/lib/session/sessionRegistry.ts` | Add `interactionType` to `ActiveSession`                                         |
| `src/app.ts`                         | Add `getInteractionType()`, pass type and comments to handler                    |
| `src/lib/agent/agentClient.ts`       | Split `handleUserPrompt()` into `handleQuestion()` and `handleIssueAssignment()` |

## Sequence Flows

### Issue Assignment Flow

```
Webhook (no previousComments) -> getInteractionType() -> 'issue_assignment'
                                                              |
                                                              v
                                                   handleIssueAssignment()
                                                              |
                                                              v
                                                   setTicketInProgress()
                                                              |
                                                              v
                                                   createWorktree() -> executePrompt()
```

### Question Flow

```
Webhook (has previousComments) -> getInteractionType() -> 'question'
                                                              |
                                                              v
                                                      handleQuestion()
                                                              |
                                                              v
                                           executePrompt() (read-only, main repo)
                                                              |
                                                              v
                                           Can read files + git logs to answer
```
