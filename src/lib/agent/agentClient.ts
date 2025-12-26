import { LinearClient, LinearDocument as L } from "@linear/sdk";
import { Content } from "../types.js";

/**
 * Agent client that uses Claude Agent SDK to implement Linear tickets.
 * This is a stub for Phase 1 - will be fully implemented in Phase 2.
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
   * @param userPrompt - The user prompt
   */
  public async handleUserPrompt(
    agentSessionId: string,
    userPrompt: string
  ): Promise<void> {
    try {
      // Log the incoming request
      console.log(`Processing ticket: ${userPrompt}`);

      // Create initial thinking activity
      await this.linearClient.createAgentActivity({
        agentSessionId,
        content: {
          type: L.AgentActivityType.Thought,
          body: "Analyzing the implementation plan...",
        } as Content,
      });

      // TODO: Phase 2 will implement Claude Agent SDK integration
      // For now, just acknowledge receipt
      await this.linearClient.createAgentActivity({
        agentSessionId,
        content: {
          type: L.AgentActivityType.Response,
          body: "Coding bot infrastructure is ready. Claude Agent SDK integration coming in Phase 2.",
        } as Content,
      });
    } catch (error) {
      const errorMessage = `Agent error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      await this.linearClient.createAgentActivity({
        agentSessionId,
        content: {
          type: L.AgentActivityType.Error,
          body: errorMessage,
        } as Content,
      });
    }
  }
}
