import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

/**
 * Environment setup options.
 */
export interface EnvSetupOptions {
  /** Working directory for commands */
  cwd: string;
  /** Additional dependencies to install */
  dependencies?: string[];
  /** Environment variables to set */
  envVars?: Record<string, string>;
  /** Timeout for each command in milliseconds */
  timeout?: number;
}

/**
 * Result of environment setup.
 */
export interface EnvSetupResult {
  success: boolean;
  steps: StepResult[];
}

/**
 * Result of a single setup step.
 */
export interface StepResult {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Set up the development environment in a worktree.
 */
export async function setupEnvironment(
  options: EnvSetupOptions
): Promise<EnvSetupResult> {
  const { cwd, dependencies = [], timeout = 300000 } = options;
  const steps: StepResult[] = [];
  let allSuccessful = true;

  // Step 1: Detect package manager
  const packageManager = await detectPackageManager(cwd);
  steps.push({
    name: "Detect package manager",
    success: true,
    output: `Using ${packageManager}`,
  });

  // Step 2: Install dependencies
  try {
    const installCommand = getInstallCommand(packageManager);
    const { stdout, stderr } = await execAsync(installCommand, {
      cwd,
      timeout,
    });
    steps.push({
      name: "Install dependencies",
      success: true,
      output: stdout || stderr,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    steps.push({
      name: "Install dependencies",
      success: false,
      error: errorMessage,
    });
    allSuccessful = false;
  }

  // Step 3: Install additional dependencies if specified
  if (dependencies.length > 0 && allSuccessful) {
    try {
      const addCommand = getAddCommand(packageManager, dependencies);
      const { stdout, stderr } = await execAsync(addCommand, { cwd, timeout });
      steps.push({
        name: "Install additional dependencies",
        success: true,
        output: stdout || stderr,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      steps.push({
        name: "Install additional dependencies",
        success: false,
        error: errorMessage,
      });
      allSuccessful = false;
    }
  }

  // Step 4: Run type check if TypeScript project
  const isTypeScriptProject = await hasTypeScript(cwd);
  if (isTypeScriptProject && allSuccessful) {
    try {
      const typeCheckCommand = getTypeCheckCommand(packageManager);
      const { stdout, stderr } = await execAsync(typeCheckCommand, {
        cwd,
        timeout,
      });
      steps.push({
        name: "Type check",
        success: true,
        output: stdout || stderr,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      steps.push({
        name: "Type check",
        success: false,
        error: errorMessage,
      });
      // Don't fail on type errors - the agent should fix them
    }
  }

  return {
    success: allSuccessful,
    steps,
  };
}

/**
 * Detect the package manager used in the project.
 */
async function detectPackageManager(
  cwd: string
): Promise<"npm" | "yarn" | "pnpm" | "bun"> {
  // Check for lock files
  try {
    await fs.access(path.join(cwd, "bun.lockb"));
    return "bun";
  } catch {}

  try {
    await fs.access(path.join(cwd, "pnpm-lock.yaml"));
    return "pnpm";
  } catch {}

  try {
    await fs.access(path.join(cwd, "yarn.lock"));
    return "yarn";
  } catch {}

  // Default to npm
  return "npm";
}

/**
 * Check if the project uses TypeScript.
 */
async function hasTypeScript(cwd: string): Promise<boolean> {
  try {
    await fs.access(path.join(cwd, "tsconfig.json"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the install command for a package manager.
 */
function getInstallCommand(
  packageManager: "npm" | "yarn" | "pnpm" | "bun"
): string {
  switch (packageManager) {
    case "yarn":
      return "yarn install";
    case "pnpm":
      return "pnpm install";
    case "bun":
      return "bun install";
    default:
      return "npm install";
  }
}

/**
 * Get the add command for installing additional dependencies.
 */
function getAddCommand(
  packageManager: "npm" | "yarn" | "pnpm" | "bun",
  dependencies: string[]
): string {
  const deps = dependencies.join(" ");
  switch (packageManager) {
    case "yarn":
      return `yarn add ${deps}`;
    case "pnpm":
      return `pnpm add ${deps}`;
    case "bun":
      return `bun add ${deps}`;
    default:
      return `npm install ${deps}`;
  }
}

/**
 * Get the type check command.
 */
function getTypeCheckCommand(
  packageManager: "npm" | "yarn" | "pnpm" | "bun"
): string {
  switch (packageManager) {
    case "yarn":
      return "yarn tsc --noEmit";
    case "pnpm":
      return "pnpm tsc --noEmit";
    case "bun":
      return "bun tsc --noEmit";
    default:
      return "npx tsc --noEmit";
  }
}

/**
 * Run a command in the environment.
 */
export async function runCommand(
  cwd: string,
  command: string,
  timeout = 300000
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout });
    return { stdout, stderr };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    throw new Error(
      `Command failed: ${command}\n${execError.stderr || execError.stdout || "Unknown error"}`
    );
  }
}
