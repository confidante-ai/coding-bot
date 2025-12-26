import { Octokit } from "@octokit/rest";

/**
 * Configuration for the GitHub client.
 */
export interface GitHubConfig {
  /** GitHub personal access token */
  token: string;
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
}

/**
 * Pull request creation options.
 */
export interface CreatePROptions {
  /** PR title */
  title: string;
  /** PR body/description */
  body: string;
  /** Source branch (the branch with changes) */
  head: string;
  /** Target branch (usually main or master) */
  base: string;
  /** Whether to create as draft PR */
  draft?: boolean;
  /** Labels to add to the PR */
  labels?: string[];
}

/**
 * Pull request result.
 */
export interface PRResult {
  /** PR number */
  number: number;
  /** PR URL */
  url: string;
  /** PR state */
  state: "open" | "closed" | "merged";
  /** PR title */
  title: string;
}

/**
 * GitHub client for managing pull requests.
 */
export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
  }

  /**
   * Create a new pull request.
   */
  async createPullRequest(options: CreatePROptions): Promise<PRResult> {
    const { title, body, head, base, draft = false, labels } = options;

    const response = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      head,
      base,
      draft,
    });

    const pr = response.data;

    // Add labels if specified
    if (labels && labels.length > 0) {
      await this.octokit.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: pr.number,
        labels,
      });
    }

    return {
      number: pr.number,
      url: pr.html_url,
      state: pr.state as "open" | "closed" | "merged",
      title: pr.title,
    };
  }

  /**
   * Get an existing pull request by number.
   */
  async getPullRequest(prNumber: number): Promise<PRResult | null> {
    try {
      const response = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });

      const pr = response.data;
      return {
        number: pr.number,
        url: pr.html_url,
        state: pr.merged
          ? "merged"
          : (pr.state as "open" | "closed" | "merged"),
        title: pr.title,
      };
    } catch (error) {
      console.error(`Error getting PR #${prNumber}:`, error);
      return null;
    }
  }

  /**
   * Find an existing pull request by head branch.
   */
  async findPullRequestByBranch(headBranch: string): Promise<PRResult | null> {
    try {
      const response = await this.octokit.pulls.list({
        owner: this.owner,
        repo: this.repo,
        head: `${this.owner}:${headBranch}`,
        state: "open",
      });

      if (response.data.length === 0) {
        return null;
      }

      const pr = response.data[0];
      return {
        number: pr.number,
        url: pr.html_url,
        state: pr.state as "open" | "closed" | "merged",
        title: pr.title,
      };
    } catch (error) {
      console.error(`Error finding PR for branch ${headBranch}:`, error);
      return null;
    }
  }

  /**
   * Add a comment to a pull request.
   */
  async addComment(prNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      body,
    });
  }

  /**
   * Request a review on a pull request.
   */
  async requestReview(prNumber: number, reviewers: string[]): Promise<void> {
    await this.octokit.pulls.requestReviewers({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      reviewers,
    });
  }

  /**
   * Update the PR title and body.
   */
  async updatePullRequest(
    prNumber: number,
    updates: { title?: string; body?: string }
  ): Promise<PRResult> {
    const response = await this.octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      ...updates,
    });

    const pr = response.data;
    return {
      number: pr.number,
      url: pr.html_url,
      state: pr.merged ? "merged" : (pr.state as "open" | "closed" | "merged"),
      title: pr.title,
    };
  }

  /**
   * Check if a PR is mergeable.
   */
  async isMergeable(prNumber: number): Promise<{
    mergeable: boolean;
    mergeableState: string;
  }> {
    const response = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return {
      mergeable: response.data.mergeable ?? false,
      mergeableState: response.data.mergeable_state,
    };
  }

  /**
   * Get the default branch for the repository.
   */
  async getDefaultBranch(): Promise<string> {
    const response = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });

    return response.data.default_branch;
  }

  /**
   * Check if a branch exists in the repository.
   */
  async branchExists(branchName: string): Promise<boolean> {
    try {
      await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch: branchName,
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a GitHub client from environment variables.
 */
export function createGitHubClientFromEnv(
  owner: string,
  repo: string
): GitHubClient | null {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN environment variable not set");
    return null;
  }

  return new GitHubClient({ token, owner, repo });
}

/**
 * Generate a PR body from implementation details.
 */
export function generatePRBody(options: {
  ticketUrl?: string;
  ticketTitle?: string;
  summary: string;
  changes: string[];
  testingNotes?: string;
}): string {
  const { ticketUrl, ticketTitle, summary, changes, testingNotes } = options;

  let body = "";

  // Link to Linear ticket
  if (ticketUrl && ticketTitle) {
    body += `## Linear Ticket\n[${ticketTitle}](${ticketUrl})\n\n`;
  }

  // Summary
  body += `## Summary\n${summary}\n\n`;

  // Changes
  body += `## Changes\n`;
  for (const change of changes) {
    body += `- ${change}\n`;
  }
  body += "\n";

  // Testing notes
  if (testingNotes) {
    body += `## Testing Notes\n${testingNotes}\n\n`;
  }

  // Auto-generated notice
  body += `---\n*This PR was automatically generated by the coding bot.*\n`;

  return body;
}
