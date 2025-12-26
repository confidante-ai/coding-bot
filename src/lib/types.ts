import { LinearDocument as L } from "@linear/sdk";

/**
 * Error thrown when an unreachable case is encountered in an exhaustive switch statement
 */
export class UnreachableCaseError extends Error {
  constructor(value: unknown) {
    super(`Unreachable case: ${value}`);
    this.name = "UnreachableCaseError";
  }
}

/**
 * The content of an agent activity
 */
export type Content =
  | { type: L.AgentActivityType.Thought; body: string }
  | {
      type: L.AgentActivityType.Action;
      action: string;
      parameter: string | null;
      result?: string;
    }
  | { type: L.AgentActivityType.Response; body: string }
  | { type: L.AgentActivityType.Elicitation; body: string }
  | { type: L.AgentActivityType.Error; body: string };

/**
 * OAuth response from Linear.
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

/**
 * Stored token data that includes both access and refresh tokens with expiry information.
 */
export interface StoredTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
}

/**
 * Implementation plan attached to a Linear ticket
 */
export interface ImplementationPlan {
  files: FileChange[];
  dependencies?: string[];
  testCommands?: string[];
  buildCommands?: string[];
}

/**
 * A file change in an implementation plan
 */
export interface FileChange {
  path: string;
  action: "create" | "modify" | "delete";
  description: string;
}
