import "dotenv/config";
import express, { type Request, type Response } from "express";
import {
  LinearWebhookClient,
  type AgentSessionEventWebhookPayload,
} from "@linear/sdk/webhooks";
import {
  handleOAuthAuthorize,
  handleOAuthCallback,
  getOAuthToken,
} from "./lib/oauth.js";
import { AgentClient, PreviousComment } from "./lib/agent/agentClient.js";
import {
  sessionRegistry,
  type InteractionType,
} from "./lib/session/sessionRegistry.js";

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
 * Active sessions endpoint
 */
app.get("/sessions", (_req: Request, res: Response) => {
  const sessions = sessionRegistry.getAll().map((session) => ({
    sessionId: session.sessionId,
    ticketId: session.ticketId,
    interactionType: session.interactionType,
    startedAt: session.startedAt,
    worktreePath: session.worktreePath,
  }));

  res.json({
    count: sessions.length,
    sessions,
  });
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

  const sessionId = webhook.agentSession.id;
  const ticketId = webhook.agentSession.issue?.identifier || "unknown";
  const isExistingSession = sessionRegistry.has(sessionId);

  if (isExistingSession) {
    console.log(
      `Webhook received for existing session: ${sessionId} (ticket: ${ticketId})`
    );
  } else {
    console.log(
      `Webhook received for new session: ${sessionId} (ticket: ${ticketId})`
    );
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
