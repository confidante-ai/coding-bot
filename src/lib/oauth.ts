import { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "node:url";
import { OAuthTokenResponse, StoredTokenData } from "./types.js";

const TOKENS_DIR = ".tokens";
const OAUTH_TOKEN_KEY_PREFIX = "linear_oauth_token_";

// Get the project root directory based on this file's location (src/lib/oauth.ts -> project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

/**
 * Ensure the tokens directory exists
 */
async function ensureTokensDir(): Promise<string> {
  const tokensPath = path.resolve(PROJECT_ROOT, TOKENS_DIR);
  try {
    await fs.mkdir(tokensPath, { recursive: true });
  } catch {
    // Directory already exists
  }
  return tokensPath;
}

/**
 * Generate a workspace-specific file path for storing OAuth tokens
 */
function getWorkspaceTokenPath(workspaceId: string): string {
  return path.join(TOKENS_DIR, `${OAUTH_TOKEN_KEY_PREFIX}${workspaceId}.json`);
}

/**
 * Handles the OAuth authorization request.
 * Redirects the user to Linear's OAuth authorization page.
 */
export function handleOAuthAuthorize(_req: Request, res: Response): void {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const baseUrl = process.env.TAILSCALE_HOSTNAME;

  if (!clientId || !baseUrl) {
    res.status(500).send("OAuth configuration missing");
    return;
  }

  const scope = "read,write,app:assignable,app:mentionable";

  const authUrl = new URL("https://linear.app/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", `${baseUrl}/oauth/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("actor", "app");

  res.redirect(authUrl.toString());
}

/**
 * Handles the OAuth callback from Linear by exchanging the authorization code for an access token and storing it.
 */
export async function handleOAuthCallback(
  req: Request,
  res: Response
): Promise<void> {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;

  if (error) {
    res.status(400).send(`OAuth Error: ${error}`);
    return;
  }

  if (!code) {
    res.status(400).send("Missing required OAuth parameters");
    return;
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  const baseUrl = process.env.TAILSCALE_HOSTNAME;

  if (!clientId || !clientSecret || !baseUrl) {
    res.status(500).send("OAuth configuration missing");
    return;
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${baseUrl}/oauth/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      res.status(400).send(`Token exchange failed: ${errorText}`);
      return;
    }

    const tokenData = (await tokenResponse.json()) as OAuthTokenResponse;

    // Get workspace information using the access token
    const workspaceInfo = await getWorkspaceInfo(tokenData.access_token);

    // Create stored token data with expiry information
    const storedTokenData: StoredTokenData = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
    };

    // Store the token data with workspace-specific key
    await setOAuthTokenData(storedTokenData, workspaceInfo.id);

    res.status(200).send(`
      <html>
        <head><title>OAuth Success</title></head>
        <body>
          <h1>OAuth Authorization Successful!</h1>
          <p>Access token received and stored securely for workspace: <strong>${workspaceInfo.name}</strong></p>
          <p>You can now interact with the coding bot!</p>
        </body>
      </html>
    `);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    res.status(500).send(`Token exchange error: ${errorMessage}`);
  }
}

/**
 * Retrieves the stored OAuth token for a specific workspace, automatically refreshing if expired.
 */
export async function getOAuthToken(
  workspaceId: string
): Promise<string | null> {
  try {
    const tokenPath = getWorkspaceTokenPath(workspaceId);
    const fullPath = path.resolve(PROJECT_ROOT, tokenPath);
    console.log("Looking for token at path:", fullPath);

    let storedData: string;
    try {
      storedData = await fs.readFile(fullPath, "utf-8");
    } catch (err) {
      console.error("Failed to read token file:", err);
      return null;
    }

    let tokenData: StoredTokenData;
    try {
      tokenData = JSON.parse(storedData) as StoredTokenData;
    } catch {
      console.warn("Found invalid token format");
      return null;
    }

    // Check if token is expired (with 5 minute buffer)
    const bufferTime = 5 * 60 * 1000;
    const isExpired = Date.now() >= tokenData.expires_at - bufferTime;

    if (!isExpired) {
      return tokenData.access_token;
    }

    // Token is expired, try to refresh
    if (!tokenData.refresh_token) {
      console.error("Token expired and no refresh token available");
      return null;
    }

    try {
      console.log("Access token expired, refreshing...");
      const refreshedTokenData = await refreshAccessToken(
        tokenData.refresh_token
      );

      const newStoredTokenData: StoredTokenData = {
        access_token: refreshedTokenData.access_token,
        refresh_token: refreshedTokenData.refresh_token,
        expires_at: Date.now() + refreshedTokenData.expires_in * 1000,
      };

      await setOAuthTokenData(newStoredTokenData, workspaceId);

      console.log("Token refreshed successfully");
      return newStoredTokenData.access_token;
    } catch (refreshError) {
      console.error("Failed to refresh token:", refreshError);
      return null;
    }
  } catch (error) {
    console.error("Error retrieving OAuth token:", error);
    return null;
  }
}

/**
 * Stores the OAuth token data for a specific workspace using local file storage.
 */
export async function setOAuthTokenData(
  tokenData: StoredTokenData,
  workspaceId: string
): Promise<void> {
  await ensureTokensDir();
  const tokenPath = getWorkspaceTokenPath(workspaceId);
  const fullPath = path.resolve(PROJECT_ROOT, tokenPath);
  await fs.writeFile(fullPath, JSON.stringify(tokenData, null, 2));
}

/**
 * Checks if OAuth token exists and is valid for a specific workspace.
 */
export async function hasOAuthToken(workspaceId: string): Promise<boolean> {
  const token = await getOAuthToken(workspaceId);
  return token !== null;
}

/**
 * Refresh an expired access token using the refresh token
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<OAuthTokenResponse> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("OAuth configuration missing");
  }

  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  return (await response.json()) as OAuthTokenResponse;
}

/**
 * Get the workspace information from Linear using the access token
 */
async function getWorkspaceInfo(
  accessToken: string
): Promise<{ id: string; name: string }> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: `
        query {
          viewer {
            organization {
              id
              name
            }
          }
        }
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get workspace info: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    data?: {
      viewer?: {
        organization?: {
          id: string;
          name: string;
        };
      };
    };
  };

  const organization = data.data?.viewer?.organization;

  if (!organization) {
    throw new Error("No organization found in response");
  }

  return {
    id: organization.id,
    name: organization.name,
  };
}
