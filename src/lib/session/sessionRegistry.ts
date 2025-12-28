/**
 * Session Registry for tracking active agent sessions.
 * Supports both issue assignment and question interaction types.
 */

export type InteractionType = "issue_assignment" | "question";

export interface ActiveSession {
  sessionId: string;
  ticketId: string;
  abortController: AbortController;
  worktreePath?: string; // Only set for issue_assignment
  startedAt: Date;
  interactionType: InteractionType;
}

/**
 * Registry for managing active agent sessions.
 */
class SessionRegistry {
  private sessions: Map<string, ActiveSession> = new Map();

  /**
   * Register a new session.
   */
  register(session: ActiveSession): void {
    this.sessions.set(session.sessionId, session);
    console.log(
      `Session registered: ${session.sessionId} (${session.interactionType})`
    );
  }

  /**
   * Get a session by ID.
   */
  get(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Remove a session from the registry.
   */
  unregister(sessionId: string): boolean {
    const result = this.sessions.delete(sessionId);
    if (result) {
      console.log(`Session unregistered: ${sessionId}`);
    }
    return result;
  }

  /**
   * Get all active sessions.
   */
  getAll(): ActiveSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Check if a session exists.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get the number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Update the worktree path for a session.
   */
  updateSessionWorktree(sessionId: string, worktreePath: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.worktreePath = worktreePath;
      console.log(`Session ${sessionId} worktree updated: ${worktreePath}`);
      return true;
    }
    return false;
  }

  /**
   * Abort a running session by triggering its abort controller.
   * Returns true if the session was found and aborted.
   */
  abortSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      console.log(`Session ${sessionId} aborted`);
      return true;
    }
    console.log(`Session ${sessionId} not found for abort`);
    return false;
  }
}

// Export a singleton instance
export const sessionRegistry = new SessionRegistry();
