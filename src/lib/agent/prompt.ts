/**
 * System prompt for the coding bot agent.
 * This prompt defines the agent's behavior for implementing Linear tickets.
 */

export const loadPlanningPrompt = (ticketId: string) =>
  `use the linear mcp server to pull the implementation plan for ${ticketId} ticket.`;

export const extractPlanPrompt = (implementationPlan: string) =>
  `Here is the implementation plan:\n\n${implementationPlan}\n\nExtract the key steps from this plan as a numbered list.`;

export const implementationPrompt = (ticketId: string, worktreePath: string) =>
  `use the linear mcp server to pull the implementation plan for ${ticketId} and implement it in the worktree located at ${worktreePath} using the supervisor skill.`;

export const implementationPlanPrompt = (
  ticketId: string,
  plan: string,
  worktreePath: string
) =>
  `Here is the implementation plan:\n\n${plan} for ${ticketId}. Implement it in the worktree located at ${worktreePath} using the supervisor skill.`;

export const reviewPrompt = (ticketId: string, worktreePath: string) =>
  `Review the code changes made in the worktree located at ${worktreePath} for the Linear ticket ${ticketId}. Provide feedback on code quality, adherence to best practices, and any potential issues.`;

export const commentPrompt = (
  ticketId: string,
  commentBody: string,
  worktreePath: string
) =>
  `The user has added the following comment to the Linear ticket ${ticketId}:\n\n"${commentBody}"\n\nRespond to this comment appropriately, considering the current state of the code in the worktree located at ${worktreePath}.`;

export const checkCapabilitiesPrompt = () =>
  `List the tools, mcp servers and skills you have access to for implementing Linear tickets. Provide a brief description of each capability.`;

export const questionPrompt = (
  question: string,
  previousContext: string,
  ticketId?: string
) =>
  `The user is asking a question about the codebase. Answer their question using the available read-only tools (Read, Grep, Glob, and git log via Bash).

${previousContext ? `## Previous conversation context:\n${previousContext}\n\n` : ""}## User's question:
${question}

${ticketId ? `This question is related to Linear ticket ${ticketId}.\n\n` : ""}

Provide a clear, helpful answer based on the codebase and git history. Do not make any changes to the code.`;
