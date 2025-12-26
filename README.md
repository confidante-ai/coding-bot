# Coding Bot

A headless coding agent powered by the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) that integrates with Linear to automatically implement tickets assigned to it. The bot runs on a local machine using Express.js and Tailscale to expose webhooks to Linear.

## Overview

This bot monitors Linear for tickets assigned to it and automatically implements them following a workflow defined as a Claude skill. Each ticket comes with a complete implementation plan (created by upstream planning bots), which this bot executes by:

1. Creating a git worktree for isolated development
2. Initializing the worktree environment
3. Following the implementation plan step-by-step
4. Committing changes and creating pull requests

## Architecture

The bot runs as an Express.js server on your local machine, exposed to the internet via Tailscale:

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│     Linear      │──────│    Tailscale    │──────│  Local Machine  │
│    Webhooks     │      │     Funnel      │      │   Express.js    │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │  Claude Agent   │
                                                  │      SDK        │
                                                  └─────────────────┘
```

### Project Structure

```
src/
├── index.ts              # Express.js server entry point
├── lib/
│   ├── agent/
│   │   ├── agentClient.ts # Claude Agent SDK integration
│   │   └── prompt.ts      # System prompt for coding tasks
│   ├── github/
│   │   ├── githubClient.ts # GitHub PR management (Octokit wrapper)
│   │   └── index.ts
│   ├── workflow/
│   │   ├── ticketHandler.ts    # Extract implementation plans from tickets
│   │   ├── worktreeLifecycle.ts # Git worktree operations
│   │   ├── envSetup.ts         # Environment setup and validation
│   │   └── index.ts
│   ├── oauth.ts           # Linear OAuth handling
│   └── types.ts           # TypeScript type definitions
```

## Workflow

1. **Ticket Assignment** - A ticket is assigned to the bot in Linear with an attached implementation plan
2. **Worktree Creation** - Bot creates a new git worktree for the feature branch
3. **Environment Setup** - Initializes the worktree (dependencies, environment, etc.)
4. **Implementation** - Executes the plan using Claude Agent SDK as the coding engine
5. **Completion** - Commits changes, pushes branch, creates PR, and updates Linear ticket status

## Prerequisites

- Node.js 18+
- Git
- [Tailscale](https://tailscale.com/) installed and configured
- Local access to target repositories
- Linear workspace with permissions to create an OAuth app
- Anthropic API key (for Claude Agent SDK)
- GitHub token (for PR creation)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Tailscale Funnel

Tailscale Funnel exposes your local Express.js server to the internet, allowing Linear to send webhooks to your machine.

```bash
# Enable Tailscale Funnel (requires admin approval in Tailscale admin console)
tailscale funnel 3000
```

This will give you a public URL like `https://your-machine.tailnet-name.ts.net`

### 3. Configure Environment

Create a `.env` file with the following (see `.env.example` for a template):

```env
# Server Configuration
PORT=3000
TAILSCALE_HOSTNAME=https://your-machine.tailnet-name.ts.net

# Anthropic API
ANTHROPIC_API_KEY=your-anthropic-api-key

# Linear OAuth
LINEAR_CLIENT_ID=your-linear-client-id
LINEAR_CLIENT_SECRET=your-linear-client-secret
LINEAR_WEBHOOK_SECRET=your-webhook-secret

# GitHub (for PR creation)
GITHUB_TOKEN=your-github-token

# Repository Configuration
REPO_BASE_PATH=/path/to/your/repositories
```

### 4. Linear OAuth Setup

1. Create a new OAuth app in Linear
2. Set the redirect URI to `https://your-machine.tailnet-name.ts.net/oauth/callback`
3. Enable webhooks and set the webhook endpoint to `https://your-machine.tailnet-name.ts.net/webhook`
4. Subscribe to agent session webhooks
5. Copy the client ID, client secret, and webhook signing secret

### 5. Run the Bot

```bash
# Start the Express.js server
npm run start

# Or for development with auto-reload
npm run dev
```

The server will start on `http://localhost:3000` and be accessible via your Tailscale Funnel URL.

## Git Worktree Strategy

The bot uses git worktrees to enable parallel development without branch switching:

```bash
# Bot automatically creates worktrees like:
git worktree add ../feature-USP-1234 -b feature/USP-1234

# After completion, worktrees can be cleaned up:
git worktree remove ../feature-USP-1234
```

This allows the bot to work on multiple tickets simultaneously without conflicts.

## Implementation Plans

Tickets should include an implementation plan in a structured format. The bot expects plans created by upstream planning bots that include:

- List of files to create/modify
- Specific code changes with context
- Test requirements
- Dependencies to install (if any)
- Build/validation steps

Example format in ticket description:

```markdown
## Implementation Plan

### Files
- [create] src/lib/newFeature.ts - New feature implementation
- [modify] src/index.ts - Add endpoint for new feature

### Dependencies
- lodash

### Test Commands
- npm run test

### Build Commands
- npm run build
```

## Claude Agent SDK

The bot uses the Claude Agent SDK which provides:

- **Built-in tools** for file operations, shell commands, and git operations
- **Permission modes** for safe autonomous execution
- **Streaming responses** for real-time progress updates to Linear

The SDK handles all coding operations, so no custom tool implementations are needed.

## API Endpoints

The Express.js server exposes:

- `GET /` - Root endpoint with service info
- `GET /health` - Simple health check endpoint
- `GET /status` - Detailed status with configuration info
- `POST /webhook` - Receives Linear webhooks for ticket assignments
- `GET /oauth/authorize` - OAuth authorization endpoint
- `GET /oauth/callback` - OAuth callback handler

## Development

### Local Development

```bash
# Start with hot reload
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint
```

### Testing Webhooks Locally

With Tailscale Funnel running, Linear webhooks will reach your local machine directly. You can also use the Tailscale admin console to monitor traffic.

### Customization

1. Modify `src/lib/agent/prompt.ts` to adjust the agent's coding behavior
2. Update workflow modules in `src/lib/workflow/` for custom orchestration
3. Extend GitHub client in `src/lib/github/` for additional PR features

## Integration with Planning Bots

This bot is designed to work as part of a multi-agent system:

1. **Planning Bot** - Analyzes tickets and creates detailed implementation plans
2. **Coding Bot** (this repo) - Executes the implementation plans
3. **Review Bot** (optional) - Reviews PRs and provides feedback

The handoff between bots happens via Linear ticket updates with structured plan data.

## Tailscale Benefits

Using Tailscale instead of cloud deployment provides:

- **Local execution** - Full access to local file system and git repositories
- **Security** - Traffic encrypted end-to-end, no exposed ports
- **Simplicity** - No cloud infrastructure to manage
- **Cost** - No hosting fees for webhook endpoints

## License

This project is licensed under the MIT License.
