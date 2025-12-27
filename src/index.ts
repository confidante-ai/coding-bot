#!/usr/bin/env node
// CLI Implementation
import "dotenv/config";
import path from "node:path";
import app from "./app.js";
import { CLIClient } from "./lib/agent/agentClient.js";
import {
  cleanupWorktree,
  createWorktree,
} from "./lib/workflow/worktreeLifecycle.js";
import { setupEnvironment } from "./lib/workflow/index.js";
import { implementationPrompt } from "./lib/agent/prompt.js";

function printUsage(): void {
  console.log(`Usage: coding-bot <command> [options]

Commands:
  serve [--port <port>]            Start the HTTP server (default port: 3000)
  implement [--ticket <ticketId>]  Implement a Linear ticket using the Claude agent
  cleanup [--ticket <ticketId>]    Clean up worktrees and environments
  prompt <text...>                 Execute a prompt with the Claude agent
`);
}

async function runServe(args: string[]): Promise<void> {
  let port = 3000;
  const portIndex = args.indexOf("--port");
  if (portIndex !== -1 && args[portIndex + 1]) {
    const parsed = parseInt(args[portIndex + 1], 10);
    if (!isNaN(parsed)) {
      port = parsed;
    }
  }

  app.listen(port, () => {
    console.log(`Coding bot server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    if (process.env.TAILSCALE_HOSTNAME) {
      console.log(`Public URL: ${process.env.TAILSCALE_HOSTNAME}`);
    }
  });
}

async function runPrompt(args: string[]): Promise<void> {
  const prompt = args.join(" ");
  if (!prompt) {
    console.error("Error: No prompt provided");
    process.exit(1);
  }

  const client = new CLIClient();
  await client.executePrompt(prompt);
}

function getRepoPaths(): { repoBasePath: string; repoName: string } {
  const repoBasePath =
    process.env.REPO_BASE_PATH || path.dirname(process.cwd());
  const repoBaseName = process.env.REPO_NAME || path.basename(process.cwd());
  const repoName =
    repoBaseName.indexOf("/") !== -1
      ? repoBaseName.split("/")[1]
      : repoBaseName;

  return { repoBasePath, repoName };
}

function getTicketNumber(args: string[]): string {
  if (!args.includes("--ticket")) {
    console.error("Error: No ticket ID provided");
    process.exit(1);
  }

  const ticketIndex = args.indexOf("--ticket");
  const ticketId = args[ticketIndex + 1];
  if (!ticketId) {
    console.error("Error: No ticket ID provided");
    process.exit(1);
  }
  return ticketId;
}

async function runImplement(args: string[]): Promise<void> {
  const { repoBasePath, repoName } = getRepoPaths();
  const ticketId = getTicketNumber(args);

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

  const environment = await setupEnvironment({ cwd: worktree.worktreePath });
  console.log(`Environment set up at path: ${worktree.worktreePath}`);

  const prompt = implementationPrompt(ticketId, worktree.worktreePath);
  console.log(prompt);

  const client = new CLIClient();
  await client.executePrompt(prompt);
}

async function runCleanup(args: string[]): Promise<void> {
  const { repoBasePath, repoName } = getRepoPaths();
  const ticketId = getTicketNumber(args);
  const branchName = `ticket-${ticketId}`;

  console.log(
    `Cleaning up worktree for base path: ${repoBasePath}, repo: ${repoName}, branch: ${branchName}`
  );

  // Cleanup worktree
  try {
    await cleanupWorktree(repoBasePath, repoName, branchName);
    console.log(`Cleaned up worktree for branch: ${branchName}`);
  } catch (error) {
    console.error("Error during cleanup:", error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "serve":
      await runServe(args.slice(1));
      break;
    case "prompt":
      await runPrompt(args.slice(1));
      break;
    case "implement":
      await runImplement(args.slice(1));
      break;
    case "cleanup":
      await runCleanup(args.slice(1));
      break;
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
