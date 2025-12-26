import { LinearClient, LinearDocument as L } from "@linear/sdk";
import { query, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { Content } from "../types.js";
import { systemPrompt } from "./prompt.js";

/**
 * Agent client that uses Claude Agent SDK to implement Linear tickets.
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
   * @param agentSessionId - The Linear agent session ID
   * @param userPrompt - The user prompt containing the implementation plan
   */
  public async handleUserPrompt(
    agentSessionId: string,
    userPrompt: string
  ): Promise<void> {
    try {
      console.log(`Processing ticket: ${userPrompt.substring(0, 100)}...`);

      // Create initial thinking activity
      await this.createThought(
        agentSessionId,
        "Analyzing the implementation plan and preparing to execute..."
      );

      // Execute the task using Claude Agent SDK
      const result = await this.executeWithClaudeAgent(
        agentSessionId,
        userPrompt
      );

      // Send final response
      if (result.subtype === "success") {
        await this.createResponse(
          agentSessionId,
          `Implementation complete!\n\n${result.result}`
        );
      } else {
        const errors =
          "errors" in result ? result.errors.join("\n") : "Unknown error";
        await this.createError(
          agentSessionId,
          `Implementation encountered issues:\n${errors}`
        );
      }
    } catch (error) {
      const errorMessage = `Agent error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      console.error(errorMessage, error);
      await this.createError(agentSessionId, errorMessage);
    }
  }

  /**
   * Execute the implementation task using Claude Agent SDK
   */
  private async executeWithClaudeAgent(
    agentSessionId: string,
    userPrompt: string
  ): Promise<SDKResultMessage> {
    const cwd = process.env.REPO_BASE_PATH || process.cwd();

    // Create the query with Claude Agent SDK
    const agentQuery = query({
      prompt: userPrompt,
      options: {
        cwd,
        systemPrompt,
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
        permissionMode: "acceptEdits",
        maxTurns: 50,
        tools: { type: "preset", preset: "claude_code" },
        includePartialMessages: false,
      },
    });

    let lastResult: SDKResultMessage | null = null;

    // Process the agent's messages
    for await (const message of agentQuery) {
      switch (message.type) {
        case "assistant": {
          // Extract text content from assistant messages
          type ContentBlock = { type: string; text?: string; name?: string; input?: unknown };
          const content = message.message.content as ContentBlock[];

          const textContent = content
            .filter((block: ContentBlock): block is ContentBlock & { type: "text"; text: string } =>
              block.type === "text" && typeof block.text === "string"
            )
            .map((block) => block.text)
            .join("\n");

          if (textContent) {
            await this.createThought(agentSessionId, textContent);
          }

          // Check for tool use
          const toolUses = content.filter(
            (block: ContentBlock): block is ContentBlock & { type: "tool_use"; name: string; input: unknown } =>
              block.type === "tool_use" && typeof block.name === "string"
          );

          for (const toolUse of toolUses) {
            await this.createAction(
              agentSessionId,
              toolUse.name,
              JSON.stringify(toolUse.input, null, 2)
            );
          }
          break;
        }

        case "result":
          lastResult = message;
          break;

        case "system":
          if (message.subtype === "init") {
            console.log(`Claude Agent initialized with tools: ${message.tools.join(", ")}`);
          }
          break;

        default:
          // Handle other message types as needed
          break;
      }
    }

    if (!lastResult) {
      throw new Error("No result received from Claude Agent");
    }

    return lastResult;
  }

  /**
   * Create a thought activity in Linear
   */
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

  /**
   * Create an action activity in Linear
   */
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

  /**
   * Create a response activity in Linear
   */
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

  /**
   * Create an error activity in Linear
   */
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
