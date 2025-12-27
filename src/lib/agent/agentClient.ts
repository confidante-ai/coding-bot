import { LinearClient, LinearDocument as L } from "@linear/sdk";
import { query, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { Content } from "../types.js";

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
    agentSessionId: string,
    userPrompt: string
  ): Promise<void> {
    try {
      console.log(`Processing ticket: ${userPrompt.substring(0, 100)}...`);

      await this.createThought(
        agentSessionId,
        "Analyzing the implementation plan and preparing to execute..."
      );

      const result = await executePrompt(userPrompt, {
        onText: async (text) => {
          await this.createThought(agentSessionId, text);
        },
        onToolUse: async (toolName, input) => {
          await this.createAction(
            agentSessionId,
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
          agentSessionId,
          `Implementation complete!\n\n${result.result}`
        );
      } else {
        await this.createError(
          agentSessionId,
          `Implementation encountered issues:\n${result.errors?.join("\n")}`
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
