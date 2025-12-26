import { simpleGit, SimpleGit } from "simple-git";
import fs from "fs/promises";
import path from "path";

/**
 * Configuration for worktree operations.
 */
export interface WorktreeConfig {
  /** Base path where repositories are stored */
  repoBasePath: string;
  /** Repository name */
  repoName: string;
  /** Branch name for the worktree */
  branchName: string;
  /** Base branch to create worktree from (e.g., 'main') */
  baseBranch: string;
}

/**
 * Result of worktree creation.
 */
export interface WorktreeResult {
  /** Path to the worktree */
  worktreePath: string;
  /** Branch name */
  branchName: string;
  /** Whether the worktree was newly created */
  created: boolean;
}

/**
 * Create a git worktree for isolated development.
 * The worktree allows parallel work on multiple branches without affecting the main checkout.
 */
export async function createWorktree(
  config: WorktreeConfig
): Promise<WorktreeResult> {
  const { repoBasePath, repoName, branchName, baseBranch } = config;

  const mainRepoPath = path.join(repoBasePath, repoName);
  const worktreePath = path.join(
    repoBasePath,
    ".worktrees",
    repoName,
    branchName
  );

  const git: SimpleGit = simpleGit(mainRepoPath);

  // Ensure worktrees directory exists
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });

  // Check if worktree already exists
  try {
    await fs.access(worktreePath);
    console.log(`Worktree already exists at: ${worktreePath}`);
    return { worktreePath, branchName, created: false };
  } catch {
    // Worktree doesn't exist, create it
  }

  try {
    // Fetch latest from remote
    await git.fetch("origin", baseBranch);

    // Check if branch exists remotely
    const branches = await git.branch(["-r"]);
    const remoteBranch = `origin/${branchName}`;
    const branchExists = branches.all.includes(remoteBranch);

    if (branchExists) {
      // Create worktree from existing remote branch
      await git.raw(["worktree", "add", worktreePath, branchName]);
      console.log(`Created worktree from existing branch: ${branchName}`);
    } else {
      // Create new branch and worktree from base branch
      await git.raw([
        "worktree",
        "add",
        "-b",
        branchName,
        worktreePath,
        `origin/${baseBranch}`,
      ]);
      console.log(`Created new worktree with branch: ${branchName}`);
    }

    return { worktreePath, branchName, created: true };
  } catch (error) {
    console.error("Error creating worktree:", error);
    throw error;
  }
}

/**
 * Clean up a git worktree after use.
 */
export async function cleanupWorktree(
  repoBasePath: string,
  repoName: string,
  branchName: string
): Promise<void> {
  const mainRepoPath = path.join(repoBasePath, repoName);
  const worktreePath = path.join(
    repoBasePath,
    ".worktrees",
    repoName,
    branchName
  );

  const git: SimpleGit = simpleGit(mainRepoPath);

  try {
    // Check if worktree exists
    await fs.access(worktreePath);

    // Remove the worktree
    await git.raw(["worktree", "remove", worktreePath, "--force"]);
    console.log(`Removed worktree: ${worktreePath}`);
  } catch (error) {
    // Worktree doesn't exist or already removed
    console.log(`Worktree not found or already removed: ${worktreePath}`);
  }

  try {
    // Prune any stale worktree references
    await git.raw(["worktree", "prune"]);
  } catch {
    // Ignore errors during pruning
  }
}

/**
 * Get the status of a worktree.
 */
export async function getWorktreeStatus(
  worktreePath: string
): Promise<{
  isClean: boolean;
  hasUncommittedChanges: boolean;
  currentBranch: string;
}> {
  const git: SimpleGit = simpleGit(worktreePath);

  const status = await git.status();
  const currentBranch = status.current || "";
  const isClean = status.isClean();
  const hasUncommittedChanges =
    status.modified.length > 0 ||
    status.created.length > 0 ||
    status.deleted.length > 0;

  return {
    isClean,
    hasUncommittedChanges,
    currentBranch,
  };
}

/**
 * Commit and push changes in a worktree.
 */
export async function commitAndPush(
  worktreePath: string,
  commitMessage: string
): Promise<{ commitHash: string }> {
  const git: SimpleGit = simpleGit(worktreePath);

  // Stage all changes
  await git.add("-A");

  // Check if there are changes to commit
  const status = await git.status();
  if (status.isClean()) {
    throw new Error("No changes to commit");
  }

  // Commit changes
  const commitResult = await git.commit(commitMessage);
  const commitHash = commitResult.commit;

  // Get current branch
  const currentBranch = status.current || "";

  // Push to remote
  await git.push("origin", currentBranch, ["--set-upstream"]);

  console.log(`Committed and pushed: ${commitHash}`);
  return { commitHash };
}

/**
 * Generate a branch name from a ticket identifier.
 */
export function generateBranchName(ticketId: string, prefix = "feat"): string {
  // Sanitize ticket ID for use in branch name
  const sanitizedId = ticketId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${prefix}/${sanitizedId}`;
}
