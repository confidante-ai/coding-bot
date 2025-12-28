import { LinearClient, LinearDocument as L } from "@linear/sdk";
import { query, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { Content } from "../types.js";
import {
  createWorktree,
  getRepoPaths,
  setupEnvironment,
} from "../workflow/index.js";
import { checkCapabilitiesPrompt } from "./prompt.js";
import { AgentSessionEventWebhookPayload } from "@linear/sdk/webhooks";

/**
 * Callbacks for handling agent output during prompt execution.
 */
export interface AgentCallbacks {
  onText: (text: string) => Promise<void> | void;
  onToolUse: (toolName: string, input: unknown) => Promise<void> | void;
  onSystemInit: (tools: string[]) => Promise<void> | void;
}

/**
 * Result from executing a prompt.
 */
export interface ExecutePromptResult {
  success: boolean;
  result?: string;
  errors?: string[];
}

/**
 * Execute a prompt using the Claude Agent SDK with callbacks for output.
 */
export async function executePrompt(
  userPrompt: string,
  callbacks: AgentCallbacks
): Promise<ExecutePromptResult> {
  const cwd = process.env.REPO_BASE_PATH || process.cwd();
  console.log(`Executing prompt in directory: ${cwd}`);

  const agentQuery = query({
    prompt: userPrompt,
    options: {
      cwd,
      systemPrompt: { type: "preset", preset: "claude_code" },
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 50,
      settingSources: ["project", "user"],
      tools: { type: "preset", preset: "claude_code" },
      includePartialMessages: false,
    },
  });

  let lastResult: SDKResultMessage | null = null;

  for await (const message of agentQuery) {
    switch (message.type) {
      case "assistant": {
        type ContentBlock = {
          type: string;
          text?: string;
          name?: string;
          input?: unknown;
        };
        const content = message.message.content as ContentBlock[];

        // Handle text content
        const textContent = content
          .filter(
            (block): block is ContentBlock & { type: "text"; text: string } =>
              block.type === "text" && typeof block.text === "string"
          )
          .map((block) => block.text)
          .join("\n");

        if (textContent) {
          await callbacks.onText(textContent);
        }

        // Handle tool uses
        const toolUses = content.filter(
          (
            block
          ): block is ContentBlock & {
            type: "tool_use";
            name: string;
            input: unknown;
          } => block.type === "tool_use" && typeof block.name === "string"
        );

        for (const toolUse of toolUses) {
          await callbacks.onToolUse(toolUse.name, toolUse.input);
        }
        break;
      }

      case "result":
        lastResult = message;
        break;

      case "system":
        if (message.subtype === "init") {
          await callbacks.onSystemInit(message.tools);
        }
        break;
    }
  }

  if (!lastResult) {
    return { success: false, errors: ["No result received from agent"] };
  }

  if (lastResult.subtype === "success") {
    return { success: true, result: lastResult.result };
  } else {
    const errors =
      "errors" in lastResult ? lastResult.errors : ["Unknown error"];
    return { success: false, errors };
  }
}

/**
 * Agent client that uses Claude Agent SDK with Linear session logging.
 */
export class AgentClient {
  private linearClient: LinearClient;

  constructor(linearAccessToken: string) {
    this.linearClient = new LinearClient({
      accessToken: linearAccessToken,
    });
  }

  /**
   * Handle a user prompt by processing it through the Claude Agent SDK.
   */
  public async handleUserPrompt(
    agentSession: AgentSessionEventWebhookPayload["agentSession"]
  ): Promise<void> {
    try {
      const ticketId = agentSession.issue?.identifier || "";
      const issue = await this.linearClient.issue(ticketId);
      console.log(`Fetched issue for ticket ID: ${ticketId}`);
      console.dir(issue, { depth: null });
      const issueTitle = issue.title;

      const comments = await issue.comments();
      console.log(`Fetched comments for ticket ID: ${ticketId}`);
      console.dir(comments, { depth: null });

      const attachments = await issue.attachments();
      console.log(`Fetched attachments for ticket ID: ${ticketId}`);
      console.dir(attachments, { depth: null });

      const latestComment = comments.nodes.sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      )[0];
      const commentBody =
        comments.nodes[0].body ||
        latestComment?.documentContent?.content ||
        latestComment.body ||
        issue.description ||
        issueTitle;

      console.log(`Processing ticket: ${ticketId}...`);

      const { repoBasePath, repoName } = getRepoPaths();

      console.log(
        `Setting up worktree for base path: ${repoBasePath}, repo: ${repoName}`
      );

      const worktree = await createWorktree({
        repoBasePath,
        repoName,
        branchName: `ticket-${ticketId}`,
        baseBranch: "main",
      });

      console.log(`Switched to worktree at path: ${worktree.worktreePath}`);
      process.chdir(worktree.worktreePath);

      await setupEnvironment({ cwd: worktree.worktreePath });
      console.log(`Environment set up at path: ${worktree.worktreePath}`);

      const userPrompt = checkCapabilitiesPrompt();
      console.log(userPrompt);

      await this.createThought(
        agentSession.id,
        "Analyzing the implementation plan and preparing to execute..."
      );

      const result = await executePrompt(userPrompt, {
        onText: async (text) => {
          await this.createThought(agentSession.id, text);
        },
        onToolUse: async (toolName, input) => {
          await this.createAction(
            agentSession.id,
            toolName,
            JSON.stringify(input, null, 2)
          );
        },
        onSystemInit: (tools) => {
          console.log(
            `Claude Agent initialized with tools: ${tools.join(", ")}`
          );
        },
      });

      if (result.success) {
        await this.createResponse(
          agentSession.id,
          `Implementation complete!\n\n${result.result}`
        );
      } else {
        await this.createError(
          agentSession.id,
          `Implementation encountered issues:\n${result.errors?.join("\n")}`
        );
      }
    } catch (error) {
      const errorMessage = `Agent error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      console.error(errorMessage, error);
      await this.createError(agentSession.id, errorMessage);
    }
  }

  private async createThought(
    agentSessionId: string,
    body: string
  ): Promise<void> {
    await this.linearClient.createAgentActivity({
      agentSessionId,
      content: {
        type: L.AgentActivityType.Thought,
        body,
      } as Content,
    });
  }

  private async createAction(
    agentSessionId: string,
    action: string,
    parameter: string
  ): Promise<void> {
    await this.linearClient.createAgentActivity({
      agentSessionId,
      content: {
        type: L.AgentActivityType.Action,
        action,
        parameter,
      } as Content,
    });
  }

  private async createResponse(
    agentSessionId: string,
    body: string
  ): Promise<void> {
    await this.linearClient.createAgentActivity({
      agentSessionId,
      content: {
        type: L.AgentActivityType.Response,
        body,
      } as Content,
    });
  }

  private async createError(
    agentSessionId: string,
    body: string
  ): Promise<void> {
    await this.linearClient.createAgentActivity({
      agentSessionId,
      content: {
        type: L.AgentActivityType.Error,
        body,
      } as Content,
    });
  }
}

/**
 * CLI client that outputs agent activity to the console.
 */
export class CLIClient {
  /**
   * Execute a prompt and output summary progress to console.
   */
  public async executePrompt(userPrompt: string): Promise<void> {
    console.log("Starting agent...");

    const result = await executePrompt(userPrompt, {
      onText: () => {
        console.log("Thinking...");
      },
      onToolUse: (toolName, input) => {
        console.log(
          `Using tool: ${toolName} with input: ${JSON.stringify(
            input,
            null,
            2
          )}`
        );
      },
      onSystemInit: () => {
        console.log("Agent initialized");
      },
    });

    console.log("\n--- Result ---");
    if (result.success) {
      console.log(result.result);
    } else {
      console.error(`Error: ${result.errors?.join("\n")}`);
      process.exit(1);
    }
  }
}
