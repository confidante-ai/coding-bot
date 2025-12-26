import "dotenv/config";
import express, { Request, Response } from "express";
import {
  LinearWebhookClient,
  AgentSessionEventWebhookPayload,
} from "@linear/sdk/webhooks";
import {
  handleOAuthAuthorize,
  handleOAuthCallback,
  getOAuthToken,
} from "./lib/oauth.js";
import { AgentClient } from "./lib/agent/agentClient.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to get raw body for webhook signature verification
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    // Store raw body for signature verification
    (req as Request & { rawBody?: Buffer }).rawBody = req.body;
    next();
  }
);

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
app.post("/webhook", async (req: Request, res: Response) => {
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    res.status(500).send("Webhook secret not configured");
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).send("Anthropic API key not configured");
    return;
  }

  try {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      res.status(400).send("Missing request body");
      return;
    }

    // Create webhook client and handler
    const webhookClient = new LinearWebhookClient(webhookSecret);
    const handler = webhookClient.createHandler();

    handler.on("AgentSessionEvent", async (payload) => {
      await handleAgentSessionEvent(payload);
    });

    // Create a compatible request object for the Linear webhook handler
    const webhookRequest = new globalThis.Request(
      `${process.env.TAILSCALE_HOSTNAME}/webhook`,
      {
        method: "POST",
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(
            ([, v]) => typeof v === "string"
          ) as [string, string][]
        ),
        body: rawBody,
      }
    );

    const webhookResponse = await handler(webhookRequest);
    res.status(webhookResponse.status).send(await webhookResponse.text());
  } catch (error) {
    console.error("Error in webhook handler:", error);
    res.status(500).send("Error handling webhook");
  }
});

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

  const agentClient = new AgentClient(token);
  const userPrompt = generateUserPrompt(webhook);
  await agentClient.handleUserPrompt(webhook.agentSession.id, userPrompt);
}

/**
 * Generate a user prompt for the agent based on the webhook payload
 */
function generateUserPrompt(webhook: AgentSessionEventWebhookPayload): string {
  const issueTitle = webhook.agentSession.issue?.title;
  const commentBody = webhook.agentSession.comment?.body;

  if (issueTitle && commentBody) {
    return `Issue: ${issueTitle}\n\nTask: ${commentBody}`;
  } else if (issueTitle) {
    return `Task: ${issueTitle}`;
  } else if (commentBody) {
    return `Task: ${commentBody}`;
  }
  return "";
}

export default app;
