# Stop Signal Handling Implementation Plan

## Problem Statement

The current codebase does **not** handle stop signals as required by [Linear's Agent Signals documentation](https://linear.app/developers/agent-signals). When a user requests an agent to stop, the agent should immediately disengage and only re-engage once it receives a clear signal to do so.

### Current Gaps

1. **No stop signal detection** - Webhook handler doesn't check `agentActivity.signal` or `action` fields
2. **No session tracking** - No registry of running sessions with their abort controllers
3. **No interrupt capability** - `executePrompt()` runs to completion with no way to stop mid-execution
4. **No cleanup on stop** - Worktrees and resources aren't cleaned up when stopped

## Implementation Plan

### Phase 1: Session Registry Module

**New file: `src/lib/session/sessionRegistry.ts`**

Create a registry to track active sessions with their abort controllers:

```typescript
interface ActiveSession {
  sessionId: string;
  ticketId: string;
  abortController: AbortController;
  worktreePath?: string;
  startedAt: Date;
}

// Exports:
// - registerSession(sessionId, ticketId, abortController)
// - updateSessionWorktree(sessionId, worktreePath)
// - getSession(sessionId): ActiveSession | undefined
// - removeSession(sessionId): void
// - abortSession(sessionId): boolean
```

### Phase 2: Modify executePrompt() for AbortController

**File: `src/lib/agent/agentClient.ts`**

Update `executePrompt()` to accept an `AbortController`:

- Add `abortController?: AbortController` parameter
- Pass to `query()` options
- Handle `AbortError` in the for-await loop
- Return appropriate result when aborted

### Phase 3: Update handleUserPrompt() for Session Tracking

**File: `src/lib/agent/agentClient.ts`**

Update `handleUserPrompt()` to:

1. Create `AbortController` at start
2. Register session before work begins
3. Update with worktree path after creation
4. Pass `abortController` to `executePrompt()`
5. Clean up in `finally` block

### Phase 4: Add Stop Signal Detection to Webhook Handler

**File: `src/app.ts`**

Update webhook handler to:

1. Check for stop signal: `payload.agentActivity?.signal === 'stop'`
2. Check session status (skip if `complete`, `error`, or `stale`)
3. Add `handleStopSignal()` function that:
   - Aborts the running session
   - Cleans up worktree
   - Logs a simple acknowledgment to Linear: "Execution stopped as requested"

## Files to Modify

| File | Action |
|------|--------|
| `src/lib/session/sessionRegistry.ts` | **CREATE** |
| `src/lib/agent/agentClient.ts` | Modify |
| `src/app.ts` | Modify |

## Sequence Flows

### Stop Signal Flow
```
Webhook (stop signal) -> isStopSignal() -> handleStopSignal()
                                               |
                                               v
                                          abortSession()
                                               |
                                               v
                                          cleanupWorktree()
                                               |
                                               v
                                       Log to Linear
```

## Key SDK Types Used

From `@linear/sdk`:
- `AgentActivitySignal.Stop` - Signal value to detect
- `LinearDocument.AgentActivityType` - For logging responses

From `@anthropic-ai/claude-agent-sdk`:
- `AbortController` via `options.abortController` - For cancellation
- `AbortError` - Error type when aborted
