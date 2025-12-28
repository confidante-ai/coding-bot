# Plan: Handle `awaitingInput` State with AskUserQuestion Tool

## Summary

Implement support for the `awaitingInput` agent session state when Claude's `AskUserQuestion` tool is invoked. The solution uses the Claude Agent SDK's streaming input mode (`AsyncIterable<SDKUserMessage>`) to keep sessions alive while waiting for user responses from Linear.

## Architecture

```
Webhook (initial) --> executeStreamingPrompt(AsyncIterable) --> SDK Running
                                                                    |
                                                        (AskUserQuestion detected)
                                                                    |
                                                                    v
                                                        Create Elicitation activity
                                                        (triggers awaitingInput state)
                                                                    |
                                                           Session waiting...
                                                                    |
Webhook (user answer) --> Route to session --> inputChannel.push(answer)
                                                                    |
                                                                    v
                                                              SDK Resumes
                                                                    |
                                                                    v
                                                               Complete
```

## Files to Modify

| File                                 | Changes                                          |
| ------------------------------------ | ------------------------------------------------ |
| `src/lib/session/sessionRegistry.ts` | CREATE - Session registry with input channels    |
| `src/lib/session/index.ts`           | CREATE - Export barrel                           |
| `src/lib/agent/agentClient.ts`       | Add streaming mode, elicitation handling         |
| `src/lib/types.ts`                   | Add `AskUserQuestionInput` type                  |
| `src/app.ts`                         | Add interaction type detection, response routing |

## Implementation Steps

### Step 1: Create Session Registry (`src/lib/session/sessionRegistry.ts`)

Create a registry to track active sessions with input channels:

```typescript
interface InputChannel {
  push(message: SDKUserMessage): void;
  close(): void;
  getIterable(): AsyncIterable<SDKUserMessage>;
}

interface ActiveSession {
  sessionId: string;
  ticketId: string;
  abortController: AbortController;
  worktreePath?: string;
  startedAt: Date;
  interactionType: "issue_assignment" | "question";
  inputChannel: InputChannel;
  pendingQuestion?: PendingQuestion;
  timeoutHandle?: NodeJS.Timeout;
}
```

The `InputChannel` uses a deferred promise pattern:

- Starts with initial prompt in queue
- `push()` either resolves a waiting promise or queues the message
- `getIterable()` returns an `AsyncIterable` for the SDK

### Step 2: Add `AskUserQuestionInput` Type (`src/lib/types.ts`)

```typescript
export interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  answers?: Record<string, string>;
}
```

### Step 3: Add Streaming Prompt Execution (`src/lib/agent/agentClient.ts`)

Create `executeStreamingPrompt()`:

- Accept `AsyncIterable<SDKUserMessage>` instead of string prompt
- Detect `AskUserQuestion` tool use in the message loop
- Call new `onAskUserQuestion` callback when detected

Add to `AgentClient`:

- `handleAskUserQuestion()` - Store pending question, create Elicitation activity
- `handleUserResponse()` - Route answer to input channel, resume SDK
- `createElicitation()` - Send Elicitation activity to Linear
- Timeout management for waiting sessions

### Step 4: Update Webhook Handler (`src/app.ts`)

Update `getInteractionType()` to detect three cases:

1. `issue_assignment` - New ticket, no existing session
2. `question` - Question in comment thread (from existing spec)
3. `user_response` - Session exists with pending question

Add routing logic:

```typescript
switch (interactionType) {
  case "issue_assignment":
    await agentClient.handleIssueAssignment(webhook.agentSession);
    break;
  case "question":
    await agentClient.handleQuestion(
      webhook.agentSession,
      webhook.previousComments
    );
    break;
  case "user_response":
    const answer = extractUserAnswer(webhook);
    await agentClient.handleUserResponse(webhook.agentSession.id, answer);
    break;
}
```

### Step 5: Timeout and Cleanup

- Default session timeout: 60 minutes
- Question timeout: Reset to 30 minutes when awaiting input
- On timeout: Create Error activity, abort session, cleanup worktree
- On stop signal: Abort via AbortController, close input channel

## Key Design Decisions

1. **Streaming Input Mode**: Uses SDK's native `AsyncIterable<SDKUserMessage>` support - no process pause/resume needed

2. **Session Registry**: Singleton map tracking all active sessions with their input channels and pending questions

3. **Linear Elicitation**: Creating an `Elicitation` activity automatically transitions the session to `awaitingInput` state in Linear

4. **Tool Result Format**: User answers are fed back as `tool_result` messages with the original `tool_use_id`

## Compatibility with Existing Specs

This integrates with `specs/question-handling.md`:

- Adds `user_response` as a third `InteractionType`
- Uses the same session registry pattern defined for stop signals
- `handleIssueAssignment()` replaces/extends `handleUserPrompt()`

## Error Handling

| Error Case                       | Handling                                    |
| -------------------------------- | ------------------------------------------- |
| User never responds              | Timeout aborts session, Error activity sent |
| SDK throws during execution      | Catch, Error activity sent, cleanup         |
| Webhook for non-existent session | Log warning, ignore                         |
| Session aborted while waiting    | Input channel closed, SDK exits gracefully  |
