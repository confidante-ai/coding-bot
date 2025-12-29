# Debug Plan: Linear OAuth Token Not Found on Second Webhook

## Problem
When receiving a second webhook event, the log shows:
```
Handling AgentSessionEvent webhook
Linear OAuth token not found
```

## Root Cause (Suspected)
The token lookup is likely failing because of an **ID format mismatch**:

1. **Token Storage** (OAuth callback): Token is stored using the organization ID from the Linear GraphQL API (`viewer.organization.id`), which returns a UUID format like `06be50c1-a50c-48e1-80b3-8a9f78a30a03`

2. **Token Lookup** (Webhook handler): Token is looked up using `webhook.organizationId` from the webhook payload, which may use a different ID format

The existing token file: `.tokens/linear_oauth_token_06be50c1-a50c-48e1-80b3-8a9f78a30a03.json`

## Implementation Plan

### Step 1: Add Debug Logging

**File: `src/app.ts` (line ~104)**

Add logging to `handleAgentSessionEvent` to see the exact organizationId from the webhook:

```typescript
async function handleAgentSessionEvent(
  webhook: AgentSessionEventWebhookPayload
): Promise<void> {
  console.log("Looking up token for organizationId:", webhook.organizationId);
  const token = await getOAuthToken(webhook.organizationId);
  if (!token) {
    console.error("Linear OAuth token not found for organizationId:", webhook.organizationId);
    return;
  }
  // ...rest of function
}
```

## Files to Modify
- [src/app.ts:104-111](src/app.ts#L104-L111) - Add organizationId logging

## Next Steps
After logging is added and you trigger another webhook, share the logged organizationId so we can confirm the mismatch and implement the appropriate fix.
