import "dotenv/config";
import express, { type Request, type Response } from "express";
import {
  LinearWebhookClient,
  type AgentSessionEventWebhookPayload,
} from "@linear/sdk/webhooks";
import { LinearClient, LinearDocument as L } from "@linear/sdk";
import {
  handleOAuthAuthorize,
  handleOAuthCallback,
  getOAuthToken,
} from "./lib/oauth.js";
import { AgentClient, PreviousComment } from "./lib/agent/agentClient.js";
import { sessionRegistry, type InteractionType } from "./lib/session/sessionRegistry.js";
import { cleanupWorktree, getRepoPaths } from "./lib/workflow/index.js";

/**
 * Determine the interaction type from the webhook payload.
 * Questions have previousComments or a comment, while issue assignments do not.
 */
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

/**
 * Check if the webhook payload contains a stop signal.
 */
function isStopSignal(payload: AgentSessionEventWebhookPayload): boolean {
  // Check for stop signal in agentActivity
  const signal = (payload as unknown as { agentActivity?: { signal?: string } }).agentActivity?.signal;
  return signal === "stop";
}

/**
 * Check if the session status indicates we should skip processing.
 */
function shouldSkipSession(payload: AgentSessionEventWebhookPayload): boolean {
  const status = payload.agentSession?.status;
  return status === "complete" || status === "error" || status === "stale";
}

/**
 * Handle a stop signal by aborting the session and cleaning up.
 */
async function handleStopSignal(
  payload: AgentSessionEventWebhookPayload,
  token: string
): Promise<void> {
  const sessionId = payload.agentSession?.id;
  if (!sessionId) {
    console.log("Stop signal received but no session ID found");
    return;
  }

  console.log(`Stop signal received for session: ${sessionId}`);

  // Get the session from the registry
  const session = sessionRegistry.get(sessionId);

  if (session) {
    // Abort the running session
    sessionRegistry.abortSession(sessionId);

    // Clean up worktree if it exists
    if (session.worktreePath) {
      try {
        const { repoBasePath, repoName } = getRepoPaths();
        // Extract branch name from worktree path
        const branchName = session.worktreePath.split("/").pop() || "";
        await cleanupWorktree(repoBasePath, repoName, branchName);
        console.log(`Cleaned up worktree for session: ${sessionId}`);
      } catch (error) {
        console.error(`Failed to cleanup worktree: ${error}`);
      }
    }

    // Unregister the session
    sessionRegistry.unregister(sessionId);
  } else {
    console.log(`Session ${sessionId} not found in registry (may have already completed)`);
  }

  // Log acknowledgment to Linear
  try {
    const linearClient = new LinearClient({ accessToken: token });
    await linearClient.createAgentActivity({
      agentSessionId: sessionId,
      content: {
        type: L.AgentActivityType.Response,
        body: "Execution stopped as requested",
      },
    });
    console.log(`Logged stop acknowledgment to Linear for session: ${sessionId}`);
  } catch (error) {
    console.error(`Failed to log stop acknowledgment to Linear: ${error}`);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Health check endpoint
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "coding-bot" });
});

/**
 * Status endpoint with more detailed information
 */
app.get("/status", (_req: Request, res: Response) => {
  const status = {
    service: "coding-bot",
    version: "0.0.1",
    status: "running",
    uptime: process.uptime(),
    config: {
      port: PORT,
      hasLinearWebhookSecret: !!process.env.LINEAR_WEBHOOK_SECRET,
      hasAnthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
      hasGithubToken: !!process.env.GITHUB_TOKEN,
      repoBasePath: process.env.REPO_BASE_PATH || "not configured",
      tailscaleHostname: process.env.TAILSCALE_HOSTNAME || "not configured",
    },
    timestamp: new Date().toISOString(),
  };
  res.json(status);
});

/**
 * Root endpoint
 */
app.get("/", (_req: Request, res: Response) => {
  res.send("Coding bot is running! 🤖");
});

/**
 * OAuth authorization endpoint
 */
app.get("/oauth/authorize", (req: Request, res: Response) => {
  handleOAuthAuthorize(req, res);
});

/**
 * OAuth callback endpoint
 */
app.get("/oauth/callback", async (req: Request, res: Response) => {
  await handleOAuthCallback(req, res);
});

/**
 * Webhook endpoint for Linear events
 */

const webhookClient = new LinearWebhookClient(process.env.LINEAR_WEBHOOK_SECRET || "");
const handler = webhookClient.createHandler();

handler.on("AgentSessionEvent", async (payload) => {
  console.log("Handling AgentSessionEvent webhook");
  await handleAgentSessionEvent(payload);
});

app.post("/webhook", handler);

/**
 * Handle an AgentSessionEvent webhook
 */
async function handleAgentSessionEvent(
  webhook: AgentSessionEventWebhookPayload
): Promise<void> {
  const token = await getOAuthToken(webhook.organizationId);
  if (!token) {
    console.error("Linear OAuth token not found");
    return;
  }

  if (!webhook.agentSession) {
    console.error("No agent session found in webhook payload");
    return;
  }

  // Check for stop signal first
  if (isStopSignal(webhook)) {
    await handleStopSignal(webhook, token);
    return;
  }

  // Skip if session is in a terminal state
  if (shouldSkipSession(webhook)) {
    console.log(`Skipping session with status: ${webhook.agentSession.status}`);
    return;
  }

  const interactionType = getInteractionType(webhook);
  const agentClient = new AgentClient(token);

  await agentClient.handleUserPrompt(
    webhook.agentSession,
    interactionType,
    (webhook.previousComments as PreviousComment[] | undefined) ?? undefined // Pass for context in questions
  );
}

export default app;
