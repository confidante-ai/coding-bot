import { LinearClient } from "@linear/sdk";
import { ImplementationPlan, FileChange } from "../types.js";

/**
 * Extract implementation plan from a Linear ticket.
 * The plan is expected to be in the ticket description in a specific format.
 */
export async function extractImplementationPlan(
  linearClient: LinearClient,
  issueId: string
): Promise<ImplementationPlan | null> {
  try {
    const issue = await linearClient.issue(issueId);
    const description = issue.description || "";

    // Look for implementation plan section in the description
    const planMatch = description.match(
      /## Implementation Plan\s*([\s\S]*?)(?=##|$)/i
    );

    if (!planMatch) {
      console.log("No implementation plan found in ticket description");
      return null;
    }

    const planContent = planMatch[1].trim();
    return parseImplementationPlan(planContent);
  } catch (error) {
    console.error("Error extracting implementation plan:", error);
    return null;
  }
}

/**
 * Parse the implementation plan content into structured format.
 */
function parseImplementationPlan(content: string): ImplementationPlan {
  const lines = content.split("\n");
  const files: FileChange[] = [];
  const dependencies: string[] = [];
  const testCommands: string[] = [];
  const buildCommands: string[] = [];

  let currentSection = "";

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Detect section headers
    if (trimmedLine.toLowerCase().startsWith("### files")) {
      currentSection = "files";
      continue;
    } else if (trimmedLine.toLowerCase().startsWith("### dependencies")) {
      currentSection = "dependencies";
      continue;
    } else if (trimmedLine.toLowerCase().startsWith("### test")) {
      currentSection = "tests";
      continue;
    } else if (trimmedLine.toLowerCase().startsWith("### build")) {
      currentSection = "build";
      continue;
    }

    // Parse content based on section
    if (trimmedLine.startsWith("-") || trimmedLine.startsWith("*")) {
      const item = trimmedLine.slice(1).trim();

      switch (currentSection) {
        case "files":
          const fileChange = parseFileChange(item);
          if (fileChange) {
            files.push(fileChange);
          }
          break;
        case "dependencies":
          if (item) {
            dependencies.push(item);
          }
          break;
        case "tests":
          if (item) {
            testCommands.push(item);
          }
          break;
        case "build":
          if (item) {
            buildCommands.push(item);
          }
          break;
      }
    }
  }

  return {
    files,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
    testCommands: testCommands.length > 0 ? testCommands : undefined,
    buildCommands: buildCommands.length > 0 ? buildCommands : undefined,
  };
}

/**
 * Parse a file change line into structured format.
 * Expected formats:
 * - [create] path/to/file.ts - Description
 * - [modify] path/to/file.ts - Description
 * - [delete] path/to/file.ts - Description
 */
function parseFileChange(line: string): FileChange | null {
  const match = line.match(
    /\[(create|modify|delete)\]\s*([^\s-]+)\s*(?:-\s*(.*))?/i
  );

  if (match) {
    return {
      action: match[1].toLowerCase() as "create" | "modify" | "delete",
      path: match[2],
      description: match[3] || "",
    };
  }

  // Fallback: try to parse as simple file path
  const simpleMatch = line.match(/^([^\s]+)(?:\s*-\s*(.*))?$/);
  if (simpleMatch) {
    return {
      action: "modify",
      path: simpleMatch[1],
      description: simpleMatch[2] || "",
    };
  }

  return null;
}

/**
 * Generate a user prompt from the implementation plan for the agent.
 */
export function generateAgentPrompt(
  ticketTitle: string,
  ticketDescription: string,
  plan: ImplementationPlan | null
): string {
  let prompt = `# Ticket: ${ticketTitle}\n\n`;

  if (ticketDescription) {
    prompt += `## Description\n${ticketDescription}\n\n`;
  }

  if (plan) {
    prompt += `## Implementation Plan\n\n`;

    if (plan.files.length > 0) {
      prompt += `### Files to Change\n`;
      for (const file of plan.files) {
        prompt += `- [${file.action}] ${file.path}${file.description ? ` - ${file.description}` : ""}\n`;
      }
      prompt += "\n";
    }

    if (plan.dependencies && plan.dependencies.length > 0) {
      prompt += `### Dependencies\n`;
      for (const dep of plan.dependencies) {
        prompt += `- ${dep}\n`;
      }
      prompt += "\n";
    }

    if (plan.testCommands && plan.testCommands.length > 0) {
      prompt += `### Test Commands\n`;
      for (const cmd of plan.testCommands) {
        prompt += `- ${cmd}\n`;
      }
      prompt += "\n";
    }

    if (plan.buildCommands && plan.buildCommands.length > 0) {
      prompt += `### Build Commands\n`;
      for (const cmd of plan.buildCommands) {
        prompt += `- ${cmd}\n`;
      }
      prompt += "\n";
    }
  }

  prompt += `\nPlease implement the changes described above. Follow the implementation plan step by step.`;

  return prompt;
}
