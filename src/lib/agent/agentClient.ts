import { LinearClient, LinearDocument as L } from "@linear/sdk";
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Content } from "../types.js";
import {
  createWorktree,
  getRepoPaths,
  setupEnvironment,
} from "../workflow/index.js";
import { implementationPrompt, questionPrompt } from "./prompt.js";
import type { AgentSessionEventWebhookPayload } from "@linear/sdk/webhooks";
import type { InteractionType } from "../session/sessionRegistry.js";

/**
 * Simplified comment interface for previous comments context.
 */
export interface PreviousComment {
  body: string;
  userId?: string | null;
}

/**
 * Callbacks for handling agent output during prompt execution.
 */
export interface AgentCallbacks {
  onText: (text: string) => Promise<void> | void;
  onToolUse: (toolName: string, input: unknown) => Promise<void> | void;
  onSystemInit: (tools: string[], agents?: string[]) => Promise<void> | void;
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
  callbacks: AgentCallbacks,
  tools?: string[]
): Promise<ExecutePromptResult> {
  const cwd = process.cwd();
  console.log(`Executing prompt in directory: ${cwd}`);

  const agentQuery = query({
    prompt: userPrompt,
    options: {
      cwd,
      systemPrompt: { type: "preset", preset: "claude_code" },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project", "user"],
      tools: tools ? tools : { type: "preset", preset: "claude_code" },
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
          await callbacks.onSystemInit(message.tools, message.agents);
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
   * Handle a user prompt by routing to the appropriate handler based on interaction type.
   */
  public async handleUserPrompt(
    agentSession: AgentSessionEventWebhookPayload["agentSession"],
    interactionType: InteractionType,
    previousComments?: PreviousComment[]
  ): Promise<void> {
    const ticketId = agentSession.issue?.identifier || undefined;
    if (interactionType === "question") {
      await this.handleQuestion(agentSession, previousComments, ticketId);
    } else if (ticketId) {
      await this.handleIssueAssignment(agentSession, ticketId);
    } else {
      console.error("No ticket ID found for issue assignment");
    }
  }

  /**
   * Handle an issue assignment - create worktree, setup environment, and implement.
   */
  private async handleIssueAssignment(
    agentSession: AgentSessionEventWebhookPayload["agentSession"],
    ticketId: string
  ): Promise<void> {
    try {
      console.log(`Processing ticket: ${ticketId}...`);
      const { repoBasePath, repoName } = getRepoPaths();

      await this.createThought(
        agentSession.id,
        "Analyzing the implementation plan and preparing to execute..."
      );

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

      const userPrompt = implementationPrompt(ticketId);
      console.log(userPrompt);

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
        onSystemInit: (tools, agents) => {
          console.log(
            `Claude Agent initialized with tools: ${tools
              .filter((tool) => tool.indexOf("mcp_") === -1)
              .join(", ")}`
          );
          if (agents) {
            console.log(`Claude Agent initialized with agents: ${agents.join(", ")}`);
          }
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

  /**
   * Handle a question in a comment thread - answer without creating a worktree.
   */
  private async handleQuestion(
    agentSession: AgentSessionEventWebhookPayload["agentSession"],
    previousComments?: PreviousComment[],
    ticketId?: string
  ): Promise<void> {
    try {
      console.log(`Handling question for ticket: ${ticketId}`);

      await this.createThought(
        agentSession.id,
        "Analyzing your question and searching the codebase..."
      );

      // Extract the question from the comment
      const question = agentSession.comment?.body || "";
      if (!question) {
        console.error("No question found in comment");
        await this.createError(agentSession.id, "No question found in comment");
        return;
      }

      // Build context from previous comments
      const previousContext =
        previousComments?.map((c) => `Comment: ${c.body}`).join("\n\n") || "";

      // Set CWD to main repo for read-only access
      const { repoBasePath, repoName } = getRepoPaths();
      const mainRepoPath = `${repoBasePath}/${repoName}`;
      process.chdir(mainRepoPath);
      console.log(`Set working directory to main repo: ${mainRepoPath}`);

      const userPrompt = questionPrompt(question, previousContext, ticketId);
      console.log(userPrompt);

      const result = await executePrompt(
        userPrompt,
        {
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
              `Claude Agent initialized with tools: ${tools
                .filter((tool) => tool.indexOf("mcp_") === -1)
                .join(", ")}`
            );
          },
        },
        ["Read", "Grep", "Glob", "Bash"] // Limit tools for read-only question answering
      );

      if (result.success) {
        await this.createResponse(
          agentSession.id,
          result.result ||
            "I've analyzed the codebase and provided my answer above."
        );
      } else {
        await this.createError(
          agentSession.id,
          `Error answering question:\n${result.errors?.join("\n")}`
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

  /**
   * Set the ticket status to a specified state (e.g., "In Progress", "Done").
   */
  private async setTicketStatus(
    ticketId: string,
    statusName: string
  ): Promise<void> {
    try {
      const issue = await this.linearClient.issue(ticketId);
      const team = await issue.team;

      const states = await team?.states();
      const targetState = states?.nodes.find(
        (state) => state.name.toLowerCase() === statusName.toLowerCase()
      );

      if (targetState) {
        await issue.update({ stateId: targetState.id });
        console.log(`Set ticket ${ticketId} to ${statusName}`);
      } else {
        console.warn(`Status "${statusName}" not found for ticket ${ticketId}`);
      }
    } catch (error) {
      console.error(
        `Failed to set ticket status: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
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
