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

// Session deduplication cache to prevent processing Linear webhook retries
// Keyed by agentSession.id since webhookId is a static endpoint identifier
const processedSessions = new Map<string, number>();
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cleanupSessionCache() {
  const now = Date.now();
  for (const [id, timestamp] of processedSessions) {
    if (now - timestamp > SESSION_CACHE_TTL_MS) {
      processedSessions.delete(id);
    }
  }
}

/**
 * Determine the interaction type from the webhook payload.
 *
 * Issue assignments have a system-generated comment like:
 * "This thread is for an agent session with {agentName}."
 *
 * Questions are user-written comments or replies in existing threads.
 */
function getInteractionType(
  payload: AgentSessionEventWebhookPayload
): InteractionType {
  // If previousComments exists with content, this is a question in an existing thread
  if (payload.previousComments && payload.previousComments.length > 0) {
    return "question";
  }

  // Check if the comment is system-generated (delegation) vs user-written
  const commentBody = payload.agentSession.comment?.body;
  if (commentBody) {
    // System-generated comments for delegation follow this pattern
    const isDelegationComment =
      /^This thread is for an agent session with .+\.$/.test(commentBody);

    if (!isDelegationComment) {
      // User wrote a custom comment - treat as question
      return "question";
    }
  }

  // Either no comment, or system-generated delegation comment
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

const webhookClient = new LinearWebhookClient(
  process.env.LINEAR_WEBHOOK_SECRET || ""
);
const handler = webhookClient.createHandler();

handler.on("AgentSessionEvent", (payload) => {
  // log the received webhook payload for debugging purposes with the current timestamp
  console.log(`Received AgentSessionEvent webhook at ${new Date().toISOString()}`);

  // console dir the payload for inspection but limit depth to top level only and don't include the promptContext key
  const { promptContext, ...payloadWithoutPromptContext } = payload as AgentSessionEventWebhookPayload & { promptContext?: unknown };
  console.dir(payloadWithoutPromptContext, { depth: 1 });

  // Deduplicate by session ID to prevent processing Linear retries
  // webhookId is a static webhook endpoint identifier, not unique per event
  const sessionId = payload.agentSession?.id;
  if (sessionId && processedSessions.has(sessionId)) {
    console.log(`Skipping duplicate webhook for session: ${sessionId}`);
    return;
  }

  if (sessionId) {
    processedSessions.set(sessionId, Date.now());
    cleanupSessionCache();
  }

  // Process asynchronously - respond immediately to Linear
  handleAgentSessionEvent(payload).catch((error) => {
    console.error("Error processing webhook:", error);
  });
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
    console.error(
      "Linear OAuth token not found for organizationId:",
      webhook.organizationId
    );
    return;
  }

  if (!webhook.agentSession) {
    console.error("No agent session found in webhook payload");
    return;
  }

  const sessionId = webhook.agentSession.id;
  const ticketId = webhook.agentSession.issue?.identifier || "unknown";

  // Check if this session is already being processed
  if (sessionRegistry.has(sessionId)) {
    console.log(
      `Session already being processed: ${sessionId} (ticket: ${ticketId}) - skipping`
    );
    return;
  }

  const interactionType = getInteractionType(webhook);

  // Register the session BEFORE processing to prevent duplicate handling
  sessionRegistry.register({
    sessionId,
    ticketId,
    abortController: new AbortController(),
    startedAt: new Date(),
    interactionType,
  });

  console.log(`Processing new session: ${sessionId} (ticket: ${ticketId})`);

  try {
    const agentClient = new AgentClient(token);
    await agentClient.handleUserPrompt(
      webhook.agentSession,
      interactionType,
      (webhook.previousComments as PreviousComment[] | undefined) ?? undefined // Pass for context in questions
    );
  } finally {
    // Always unregister when done (success or failure)
    sessionRegistry.unregister(sessionId);
  }
}

export default app;
