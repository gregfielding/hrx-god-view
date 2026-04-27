# HRX Slack Connection – Cursor Implementation Tasks

**Status**: Phase 4 (Bidirectional Messaging) Complete → Connection/Setup Tasks Pending

**Goal**: Implement the Slack OAuth flow and workspace connection UI so users can connect their Slack workspace to HRX.

---

## Overview

Currently, the Slack integration assumes:
- Slack bot token is stored in Firebase Secret Manager (`SLACK_BOT_TOKEN`)
- Workspace mappings exist in `slackTeams` collection
- The `slackEvents` endpoint is configured and receiving events

**What's Missing:**
- OAuth flow for users to connect their Slack workspace
- UI for initiating the connection
- Storing OAuth tokens securely
- Verifying connection status
- Disconnect/reconnect functionality

---

## Task List

### 1. Slack OAuth Flow Setup

#### 1.1. Create OAuth Redirect Handler
- [ ] **File**: `functions/src/slackOAuth.ts` (new)
- [ ] **Function**: `slackOAuthCallback` (HTTPS onRequest)
- [ ] **Purpose**: Handle OAuth callback from Slack after user authorizes
- [ ] **Actions**:
  - Exchange `code` for `access_token` via Slack OAuth API
  - Store tokens in Firebase Secret Manager or Firestore (encrypted)
  - Create/update `slackTeams` document with workspace info
  - Create/update tenant integration document
  - Redirect user back to HRX with success/error status

#### 1.2. Create OAuth Initiation Endpoint
- [ ] **File**: `functions/src/slackOAuth.ts`
- [ ] **Function**: `initiateSlackOAuth` (HTTPS onRequest or onCall)
- [ ] **Purpose**: Generate OAuth URL and redirect user to Slack
- [ ] **Actions**:
  - Build Slack OAuth URL with:
    - `client_id` (from env/secret)
    - `client_secret` (from env/secret)
    - `redirect_uri` (Firebase function URL)
    - `scope` (chat:write, channels:read, users:read, etc.)
    - `state` (tenantId + userId for verification)
  - Return OAuth URL to frontend or redirect directly

#### 1.3. Store OAuth Tokens Securely
- [ ] **Decision**: Use Firebase Secret Manager vs Firestore (encrypted)
- [ ] **Recommendation**: Use Secret Manager for bot tokens, Firestore for per-tenant workspace tokens
- [ ] **Structure**:
  ```typescript
  // In slackTeams collection
  {
    id: teamId,
    tenantId: string,
    teamName: string,
    botToken: string, // Reference to Secret Manager secret name
    accessToken?: string, // Encrypted in Firestore or Secret Manager
    botUserId: string,
    installedAt: Timestamp,
    installedBy: string, // HRX userId
  }
  ```

---

### 2. Frontend Connection UI

#### 2.1. Update Connection Status Card
- [ ] **File**: `src/pages/Admin/components/SlackConnectionStatusCard.tsx`
- [ ] **Current**: Shows "Not Connected" status
- [ ] **Updates Needed**:
  - [ ] Add "Connect Slack Workspace" button
  - [ ] Show connection status (Connected/Not Connected)
  - [ ] Display workspace name when connected
  - [ ] Add "Disconnect" button (for securityLevel >= 5)
  - [ ] Show last event timestamp
  - [ ] Show error status if connection failed

#### 2.2. Create OAuth Flow Handler
- [ ] **File**: `src/pages/Admin/components/SlackOAuthCallback.tsx` (new, or handle in existing route)
- [ ] **Purpose**: Handle OAuth callback redirect from Slack
- [ ] **Actions**:
  - Parse `code` and `state` from URL params
  - Call backend to complete OAuth flow
  - Show success/error message
  - Redirect to Slack Integration page

#### 2.3. Add Connection Button to Settings
- [ ] **File**: `src/pages/TenantViews/SettingsLanding.tsx`
- [ ] **Update**: Slack Integration card should show connection status
- [ ] **Action**: If not connected, show "Connect" button; if connected, show "Manage" link

---

### 3. Environment Configuration

#### 3.1. Slack App Configuration
- [ ] **Slack App Settings** (in Slack API dashboard):
  - [ ] Set OAuth Redirect URL: `https://us-central1-hrx1-d3beb.cloudfunctions.net/slackOAuthCallback`
  - [ ] Configure OAuth Scopes:
    - `chat:write` (send messages)
    - `channels:read` (read channel info)
    - `users:read` (read user info)
    - `im:read` (read DMs)
    - `im:write` (write DMs)
    - `groups:read` (read private channels)
  - [ ] Enable Events API
  - [ ] Set Events API Request URL: `https://us-central1-hrx1-d3beb.cloudfunctions.net/slackEvents`

#### 3.2. Firebase Secrets
- [ ] **Verify Secrets Exist**:
  - [ ] `SLACK_BOT_TOKEN` (already exists)
  - [ ] `SLACK_CLIENT_ID` (new - from Slack app)
  - [ ] `SLACK_CLIENT_SECRET` (new - from Slack app)
  - [ ] `SLACK_SIGNING_SECRET` (already exists)

#### 3.3. Environment Variables
- [ ] **Functions Config**:
  ```bash
  firebase functions:config:set \
    slack.client_id="YOUR_CLIENT_ID" \
    slack.client_secret="YOUR_CLIENT_SECRET"
  ```
  - [ ] Or use Secret Manager (recommended):
    ```bash
    firebase functions:secrets:set SLACK_CLIENT_ID
    firebase functions:secrets:set SLACK_CLIENT_SECRET
    ```

---

### 4. Backend Integration

#### 4.1. Update slackEvents to Use Stored Tokens
- [ ] **File**: `functions/src/slackEvents.ts`
- [ ] **Current**: Uses `SLACK_BOT_TOKEN` from Secret Manager
- [ ] **Update**: 
  - [ ] Check if workspace-specific token exists
  - [ ] Fall back to global `SLACK_BOT_TOKEN` if not
  - [ ] Support multiple workspaces per tenant (future)

#### 4.2. Update sendMessageToSlack to Use Workspace Token
- [ ] **File**: `functions/src/messaging/sendMessageToSlack.ts`
- [ ] **Update**:
  - [ ] Resolve workspace token from `slackTeams` collection
  - [ ] Use workspace-specific token if available
  - [ ] Fall back to global `SLACK_BOT_TOKEN`

#### 4.3. Add Token Refresh Logic
- [ ] **File**: `functions/src/slackOAuth.ts`
- [ ] **Function**: `refreshSlackToken` (helper)
- [ ] **Purpose**: Refresh expired OAuth tokens
- [ ] **Actions**:
  - Check token expiry
  - Call Slack OAuth refresh endpoint
  - Update stored token

---

### 5. Security & Validation

#### 5.1. OAuth State Validation
- [ ] **File**: `functions/src/slackOAuth.ts`
- [ ] **Purpose**: Prevent CSRF attacks
- [ ] **Implementation**:
  - [ ] Generate random `state` token on initiation
  - [ ] Store `state` in Firestore with expiry (5 min)
  - [ ] Validate `state` on callback
  - [ ] Include `tenantId` and `userId` in state for verification

#### 5.2. Access Control
- [ ] **File**: `functions/src/slackOAuth.ts`
- [ ] **Checks**:
  - [ ] Only `securityLevel >= 5` users can initiate OAuth
  - [ ] Only users with access to `tenantId` can connect workspace
  - [ ] Verify `state` contains valid `tenantId` and `userId`

#### 5.3. Token Encryption
- [ ] **Decision**: How to store tokens
- [ ] **Options**:
  - [ ] Firebase Secret Manager (recommended for bot tokens)
  - [ ] Firestore with encryption (for per-tenant tokens)
  - [ ] Cloud KMS for encryption keys

---

### 6. Testing Checklist

#### 6.1. OAuth Flow
- [ ] [ ] User clicks "Connect Slack Workspace"
- [ ] [ ] Redirects to Slack authorization page
- [ ] [ ] User authorizes app
- [ ] [ ] Redirects back to HRX with success
- [ ] [ ] Connection status updates to "Connected"
- [ ] [ ] Workspace name displays correctly

#### 6.2. Token Storage
- [ ] [ ] Tokens stored securely (Secret Manager or encrypted Firestore)
- [ ] [ ] `slackTeams` document created/updated
- [ ] [ ] Tenant integration document updated

#### 6.3. Message Flow
- [ ] [ ] Slack → HRX messages work (already implemented)
- [ ] [ ] HRX → Slack messages work (Phase 4)
- [ ] [ ] Messages use correct workspace token

#### 6.4. Disconnect Flow
- [ ] [ ] User can disconnect workspace
- [ ] [ ] Tokens revoked/removed
- [ ] [ ] Connection status updates
- [ ] [ ] Future messages fail gracefully

---

### 7. Error Handling

#### 7.1. OAuth Errors
- [ ] [ ] Handle `access_denied` (user cancels)
- [ ] [ ] Handle `invalid_code` (expired code)
- [ ] [ ] Handle `invalid_state` (CSRF attempt)
- [ ] [ ] Handle network errors
- [ ] [ ] Show user-friendly error messages

#### 7.2. Token Errors
- [ ] [ ] Handle expired tokens
- [ ] [ ] Auto-refresh if possible
- [ ] [ ] Show "Reconnect" prompt if refresh fails
- [ ] [ ] Log errors for debugging

---

### 8. Documentation

#### 8.1. Setup Instructions
- [ ] [ ] Document Slack app creation steps
- [ ] [ ] Document OAuth redirect URL configuration
- [ ] [ ] Document required scopes
- [ ] [ ] Document Firebase secrets setup

#### 8.2. User Guide
- [ ] [ ] How to connect workspace
- [ ] [ ] How to disconnect workspace
- [ ] [ ] Troubleshooting connection issues

---

## Implementation Priority

### Phase 1: Basic Connection (High Priority)
1. OAuth initiation endpoint
2. OAuth callback handler
3. Token storage (Firestore encrypted or Secret Manager)
4. Connection status UI updates
5. Basic error handling

### Phase 2: Enhanced Features (Medium Priority)
1. Token refresh logic
2. Disconnect functionality
3. Multiple workspace support (future)
4. Connection health monitoring

### Phase 3: Polish (Low Priority)
1. Better error messages
2. Connection analytics
3. Workspace management UI
4. Bulk operations

---

## Notes

- **Current State**: Phase 4 bidirectional messaging is complete and assumes tokens are already configured
- **Next Step**: Implement OAuth flow so users can connect workspaces without manual token setup
- **Security**: All OAuth operations require `securityLevel >= 5` (Staff Manager, Manager, Admin)
- **Multi-tenancy**: Each tenant can connect one Slack workspace (can be extended later)

---

## References

- [Slack OAuth Guide](https://api.slack.com/authentication/oauth-v2)
- [Slack Events API](https://api.slack.com/events-api)
- [Firebase Secret Manager](https://firebase.google.com/docs/functions/config-env#secret-manager)
- Phase 4 Spec: `hrx-slack-phase4-bidirectional-spec.md`



