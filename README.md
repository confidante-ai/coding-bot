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

```
src/
├── index.ts              # Express.js server entry point
├── lib/
│   ├── agent/
│   │   ├── agentClient.ts # Claude Agent SDK integration
│   │   ├── tools.ts       # Tool implementations (git, file ops, etc.)
│   │   └── prompt.ts      # System prompt and skill definitions
│   └── oauth.ts           # Linear OAuth handling
│   └── types.ts           # TypeScript type definitions
```

## Workflow

1. **Ticket Assignment** - A ticket is assigned to the bot in Linear with an attached implementation plan
2. **Worktree Creation** - Bot creates a new git worktree for the feature branch
3. **Environment Setup** - Initializes the worktree (dependencies, environment, etc.)
4. **Implementation** - Executes the plan using Claude Agent SDK as the coding engine
5. **Completion** - Commits changes, pushes branch, and updates Linear ticket status

## Prerequisites

- Node.js 18+
- Git
- [Tailscale](https://tailscale.com/) installed and configured
- Local access to target repositories
- Linear workspace with permissions to create an OAuth app
- Anthropic API key (for Claude Agent SDK)

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

Create a `.env` file with the following:

```env
PORT=3000
TAILSCALE_HOSTNAME=https://your-machine.tailnet-name.ts.net

ANTHROPIC_API_KEY=your-anthropic-api-key
LINEAR_CLIENT_ID=your-linear-client-id
LINEAR_CLIENT_SECRET=your-linear-client-secret
LINEAR_WEBHOOK_SECRET=your-webhook-secret

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

## Claude Skills

The bot's workflow is defined as a Claude skill that orchestrates:

- Reading and parsing the implementation plan
- Executing file operations (create, edit, delete)
- Running shell commands (git, npm, tests)
- Validating changes against the plan
- Handling errors and edge cases

## API Endpoints

The Express.js server exposes:

- `POST /webhook` - Receives Linear webhooks for ticket assignments
- `GET /oauth/authorize` - OAuth authorization endpoint
- `GET /oauth/callback` - OAuth callback handler
- `GET /health` - Health check endpoint

## Development

### Local Development

```bash
# Start with hot reload
npm run dev

# Run tests
npm run test

# Type check
npm run typecheck
```

### Testing Webhooks Locally

With Tailscale Funnel running, Linear webhooks will reach your local machine directly. You can also use the Tailscale admin console to monitor traffic.

### Customization

1. Modify `src/lib/agent/prompt.ts` to adjust the agent's behavior
2. Add new tools in `src/lib/agent/tools.ts` for additional capabilities
3. Update the skill definition to change the implementation workflow

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
