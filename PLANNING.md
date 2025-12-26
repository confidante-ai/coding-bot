# Coding Bot Conversion Scoping Document

## Executive Summary

Convert the existing **Weather Bot** (Cloudflare Workers + OpenAI) into a **Coding Bot** (Express.js + Tailscale + Claude Agent SDK) that automatically implements Linear tickets with attached implementation plans.

### Current State
- Cloudflare Workers deployment (not Express.js)
- OpenAI GPT-4o-mini integration (not Claude Agent SDK)
- Weather-focused tools (getCoordinates, getWeather, getTime)
- Linear OAuth and webhook handling (reusable)

### Target State
- Local Express.js server exposed via Tailscale Funnel
- Claude Agent SDK for AI-powered coding
- Git worktree management, file operations, shell execution
- Implementation plan parsing and execution
- PR creation workflow

---

## Prioritized Change List

### Priority 1: Core Infrastructure Changes

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 1.1 | **Migrate to Express.js** | Replace Cloudflare Worker entry point with Express.js server | `src/index.ts`, `package.json` |
| 1.2 | **Update dependencies** | Remove `wrangler`, add `express`, `dotenv`, Claude SDK | `package.json` |
| 1.3 | **Replace token storage** | Migrate from Cloudflare KV to local file/SQLite storage | `src/lib/oauth.ts` |
| 1.4 | **Add environment configuration** | Create `.env` template with required variables | `.env.example` |
| 1.5 | **Update wrangler.jsonc** | Remove or repurpose for local dev, or delete entirely | `wrangler.jsonc` |

### Priority 2: AI Model Migration

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 2.1 | **Replace OpenAI with Claude Agent SDK** | Swap out OpenAI client for Claude Agent SDK | `src/lib/agent/agentClient.ts`, `package.json` |
| 2.2 | **Implement Claude skill pattern** | Define coding workflow as a Claude skill | `src/lib/agent/prompt.ts` |
| 2.3 | **Update agent loop** | Adapt agent orchestration for Claude SDK patterns | `src/lib/agent/agentClient.ts` |

### Priority 3: Tools Cleanup

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 3.1 | **Remove weather tools** | Delete getCoordinates, getWeather, getTime | `src/lib/agent/tools.ts` |
| 3.2 | **Remove tools.ts** | File operations, shell commands, and git ops are built into Claude Agent SDK | `src/lib/agent/tools.ts` (delete) |

> **Note**: Claude Agent SDK provides built-in tools for file operations, shell execution, and git commands. No custom tool implementations needed.

### Priority 4: MCP Server Integration

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 4.1 | **Configure Linear MCP server** | Set up MCP server within Claude Agent SDK to extract implementation plans from Linear tickets | `src/lib/agent/agentClient.ts` |

> **Note**: Plan extraction is handled by an MCP server within the Claude Agent SDK, not custom parsing code. The agent uses the MCP server to read ticket data and extract the implementation plan.

### Priority 5: Workflow Orchestration

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 5.1 | **Ticket handler** | Extract implementation plan from assigned ticket | `src/lib/workflow/ticketHandler.ts` (new) |
| 5.2 | **Worktree lifecycle** | Create → Initialize → Execute → Cleanup workflow (implemented directly in code, not via agent tools) | `src/lib/workflow/worktreeLifecycle.ts` (new) |
| 5.3 | **Environment setup** | Install dependencies, configure environment in worktree | `src/lib/workflow/envSetup.ts` (new) |

> **Note**: Git worktree operations (create, cleanup) are implemented directly in Node.js code using `simple-git` or shell commands, not delegated to the agent. The agent operates within an already-prepared worktree.

### Priority 6: GitHub/PR Integration

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 6.1 | **GitHub API client** | Initialize Octokit for PR operations | `src/lib/github/client.ts` (new) |
| 6.2 | **PR creation** | Create pull request with structured description | `src/lib/github/pullRequest.ts` (new) |
| 6.3 | **Linear ticket update** | Update ticket status on PR creation | `src/lib/agent/agentClient.ts` |

### Priority 7: System Prompt & Types

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 7.1 | **Coding bot system prompt** | Define agent behavior, workflow steps, tool usage | `src/lib/agent/prompt.ts` |
| 7.2 | **Update type definitions** | New ToolName union, plan types, activity types | `src/lib/types.ts` |

### Priority 8: API Endpoints

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 8.1 | **POST /webhook** | Receive Linear webhooks (update existing) | `src/index.ts` |
| 8.2 | **GET /oauth/authorize** | OAuth initiation (port from existing) | `src/index.ts` |
| 8.3 | **GET /oauth/callback** | OAuth callback (port from existing) | `src/index.ts` |
| 8.4 | **GET /health** | Health check endpoint (new) | `src/index.ts` |

### Priority 9: Documentation & Configuration

| # | Change | Description | Files Affected |
|---|--------|-------------|----------------|
| 9.1 | **Tailscale setup docs** | Document Tailscale Funnel configuration | `README.md` |
| 9.2 | **Linear OAuth setup docs** | Document OAuth app creation steps | `README.md` |
| 9.3 | **Environment variable docs** | Document all required env vars | `README.md`, `.env.example` |

---

## Reusable Components (No Changes Needed)

| Component | File | Notes |
|-----------|------|-------|
| OAuth token exchange logic | `src/lib/oauth.ts` | Core OAuth logic reusable, storage mechanism needs update |
| Linear webhook signature verification | (via @linear/sdk) | SDK handles this automatically |
| Linear API client pattern | `src/lib/agent/agentClient.ts` | LinearClient initialization pattern reusable |

---

## New Directory Structure

```
src/
├── index.ts                    # Express.js server (rewrite)
├── lib/
│   ├── agent/
│   │   ├── agentClient.ts     # Claude Agent SDK integration (rewrite)
│   │   └── prompt.ts          # Coding bot prompt/skill (rewrite)
│   ├── oauth.ts               # Linear OAuth (update storage)
│   ├── types.ts               # Type definitions (update)
│   ├── workflow/              # NEW
│   │   ├── ticketHandler.ts
│   │   ├── worktreeLifecycle.ts  # Direct git worktree management (not agent tools)
│   │   └── envSetup.ts
│   └── github/                # NEW
│       ├── client.ts
│       └── pullRequest.ts
```

> **Note**: `tools.ts` is removed since Claude Agent SDK provides built-in file/shell/git tools.

---

## Dependency Changes

### Remove
- `wrangler` - Cloudflare Workers CLI (no longer needed)
- `openai` - OpenAI SDK (replacing with Claude)

### Add
- `express` - Web framework
- `dotenv` - Environment variable loading
- `@anthropic-ai/claude-code` or Claude Agent SDK - AI integration (includes built-in file/shell/git tools)
- `@octokit/rest` - GitHub API client
- `simple-git` - Git worktree lifecycle management (used by workflow code, not agent)
- `better-sqlite3` or `lowdb` - Token storage (optional)

### Keep
- `@linear/sdk` - Linear API and webhook handling

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Claude Agent SDK API differences | Review SDK docs thoroughly before implementation |
| Local file permissions for git ops | Document required permissions, test on target machine |
| Tailscale Funnel availability | Require admin approval before deployment |
| Concurrent ticket handling | Implement job queue or limit parallel executions |
| Worktree cleanup failures | Add cleanup job and error recovery |

---

## Implementation Order Recommendation

1. **Phase 1**: Infrastructure (P1) - Get Express.js running locally
2. **Phase 2**: AI Migration (P2) - Replace OpenAI with Claude
3. **Phase 3**: Tools (P3) - Build coding-focused tools
4. **Phase 4**: Workflow (P4, P5) - Plan processing and orchestration
5. **Phase 5**: GitHub (P6) - PR creation
6. **Phase 6**: Polish (P7, P8, P9) - Prompts, endpoints, docs
