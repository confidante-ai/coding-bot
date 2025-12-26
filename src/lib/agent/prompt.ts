/**
 * System prompt for the coding bot agent.
 * This prompt defines the agent's behavior for implementing Linear tickets.
 */

export const loadPlanningPrompt = (ticketId: string) =>
  `use the linear mcp server to pull the implementation plan for ${ticketId} ticket.`;

export const implementationPrompt = (ticketId: string, worktreePath: string) =>
  `use the linear mcp server to pull the implementation plan for ${ticketId} and implement it in the worktree located at ${worktreePath} using the supervisor skill.`;
