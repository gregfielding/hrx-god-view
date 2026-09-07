# Slack as Natalie Brooks (persona user token)

Natalie Brooks (`n.brooks@c1staffing.com`, Slack user `U0BV79X65R9`) is the
HRX recruiting persona (see [[project_portal_worker]]). Greg wants her to
post in Slack "like a regular user" — e.g. asking the Indeed Flex team in
`#indeedflex_c1staffing` (`C0B8ACFEU21`, Slack Connect) whether they want a
replacement after a CANCEL / no-show. Bot tokens post as an app, so we use
a **user token** obtained by Natalie herself authorizing a dedicated app.

## The app (created 2026-09-07 from Greg's api.slack.com account)

- Name **Natalie Brooks (HRX)**, App ID `A0C04FT6V6E`, workspace C1 Staffing.
- Client ID `7582435419591.12004537233218` (public; the client secret is NOT
  in the repo — Secret Manager `SLACK_NATALIE_CLIENT_SECRET`).
- User scopes: `chat:write, channels:read, groups:read, channels:history,
  groups:history, users:read, im:write`. No bot scopes.
- Redirect URL `https://hrxone.com/slack/oauth/callback` (an SPA route —
  nothing handles it; the `code` is read off the address bar by hand).
- Manifest: `functions/.scratch/slack-natalie-app-manifest.json` (gitignored
  scratch; reproduce from the bullets above if lost).
- Slack's "Create and Install" button errored ("Installation was not
  completed") — that would have installed it for GREG, which we don't want
  anyway. The app exists; only Natalie's authorization matters.

## Status 2026-09-07 evening: DONE — token stored and verified

`NATALIE_SLACK_USER_TOKEN` (Secret Manager) is Natalie's (`auth.test` →
U0BV79X65R9 n.brooks). Verified: reads #indeedflex_c1staffing, posts and
thread-replies in #dev. Two earlier attempts stored GREG's token (Allow was
clicked in his signed-in Chrome profile) — both revoked at Slack
(`auth.revoke`) and the secret versions disabled; only version 3 is live.
Lessons: the Slack permission page does NOT name the user; do the Allow in
a real Incognito window signed in as Natalie, and the SPA now serves
`/slack/oauth/callback` as a page that shows the code (commit f7c722ed)
instead of bouncing to /login and losing it.

**HRX wiring (commit same evening)** — `functions/src/messaging/slackAsNatalie.ts`:
`enqueueFlexTeamAsk` (called from the cadence worker-CANCEL branch and the
T+30 no-show flip, only for Flex-linked assignments) writes
`tenants/{t}/flex_team_asks/{kind__assignmentId}`; `drainFlexTeamAsks`
runs inside `dispatchScheduledWorkerReminders` (every 5 min, binds the
token) and posts `composeFlexTeamAsk(...)` as Natalie — "would you like a
replacement today?", escalating to "permanent replacement" from the 2nd
prior no-call/no-show (counted from the worker's other assignments).
Config in `tenants/{t}/app_config/indeed_flex`: `flexTeamAskChannelId`
(default **#dev C08U7U0FL03** for review; set to `C0B8ACFEU21` to go live
with the Indeed Flex team) and `flexTeamAsksEnabled` (false = suppress).
Index: `firestore.indexes.json` fieldOverride `flex_team_asks.status`
COLLECTION_GROUP. Deploy: `functions:dispatchScheduledWorkerReminders` +
whatever bundles `cadenceReplyHandler` (handleInboundSms) + `firestore:indexes`.

## Natalie answers DMs and @mentions (2026-09-07 night, Greg: "interact with her like a real team member")

`functions/src/natalie/` — `natalieSlackInbox` (scheduled every minute, her
user token, `maxInstances: 1`) polls `users.conversations` → `conversations.history`
since the per-channel cursor in `app_config/natalie_slack_inbox`, plus
`conversations.replies` for threads she already answered (follow-ups need no
mention). First tick only records cursors — no backlog is answered. Each
message → `answerAsNatalie` (`natalieAgent.ts`: Claude `claude-opus-5`,
adaptive thinking, effort medium, server-side refusal fallbacks, ≤8 tool
rounds, thread transcript from `natalie_slack_threads/{channel__threadTs}`)
→ posted as her (channels: in-thread; DMs: inline). Tools (`natalieTools.ts`):
`find_worker`, `worker_status` (assignments, cort state, late-check-in text,
last SMS), `portal_sync_status` (last successful fieldglass/flex actions,
heartbeat, failures), `request_portal_sync`, `list_flex_requests`,
`accept_flex_request` (real accept — only on an explicit ask),
`job_order_fill_status`, `send_worker_sms` (signed Natalie). She says so when
asked to do something she can't yet (book in Flex, submit to Fieldglass).

**Verified live 2026-09-07 11:59 PT**: Greg @mentioned her in #dev; 62s
later she answered in-thread with the real last-pass numbers for both
portals and the stuck smoke-test rows. Her intro/how-to post is in #dev
(ts 1788807644.485229). Guard: messages from users outside the C1 workspace
(Slack Connect partners) or bots are ignored — she never hands HRX data to
the Indeed Flex team's users even when they @mention her.

**DM scopes still missing**: her token has channels/groups history but not
`im:history, im:read, mpim:history, mpim:read`, so DMs are skipped
(`users.conversations` falls back to channel types) until she re-authorizes
with this URL (Incognito, signed in as Natalie; the callback page shows the
code; run the exchange script; the check script keeps it only if it is hers):

```
https://slack.com/oauth/v2/authorize?client_id=7582435419591.12004537233218&user_scope=chat:write,channels:read,groups:read,channels:history,groups:history,users:read,im:write,im:history,im:read,mpim:history,mpim:read&redirect_uri=https://hrxone.com/slack/oauth/callback
```

The api.slack.com session in Greg's Chrome stopped being a collaborator of
the app mid-evening ("Contact a member of your team who is a Collaborator")
— probably Greg signed into Slack as Natalie in that profile; sign back in
as Greg to edit the app config.

## One-time steps (Greg / Natalie) — historical

1. Copy the client secret from the app's Basic Information page into
   Secret Manager without echoing it (zsh, paste when prompted):

   ```bash
   read -s "S?Slack client secret: " && printf '%s' "$S" | gcloud secrets create SLACK_NATALIE_CLIENT_SECRET --project=hrx1-d3beb --replication-policy=automatic --data-file=- ; unset S
   ```

   (If the secret already exists use `gcloud secrets versions add
   SLACK_NATALIE_CLIENT_SECRET --project=hrx1-d3beb --data-file=-` instead.)

2. Signed in to Slack **as Natalie** (Incognito window, her Google login),
   open the authorize URL and click Allow:

   ```
   https://slack.com/oauth/v2/authorize?client_id=7582435419591.12004537233218&user_scope=chat:write,channels:read,groups:read,channels:history,groups:history,users:read,im:write&redirect_uri=https://hrxone.com/slack/oauth/callback
   ```

   The browser lands on `https://hrxone.com/slack/oauth/callback?code=…&state=`.
   Copy the `code` value (valid ~10 minutes).

3. Exchange it — reads the client secret in-process, stores the user token
   as Secret Manager `NATALIE_SLACK_USER_TOKEN`, prints only the user id /
   scopes / token prefix:

   ```bash
   cd functions && node .scratch/slack-natalie-token-exchange.cjs 7582435419591.12004537233218 <code>
   ```

4. HRX wiring — done, see the status section above (`slackAsNatalie.ts`).

## Gotchas

- User tokens (`xoxp-`) do not expire unless token rotation is enabled —
  the manifest sets `token_rotation_enabled: false` on purpose.
- Natalie must be a member of the channel; `chat:write` as a user cannot
  post into channels she hasn't joined (`im:write` covers DMs).
- Slack Connect channels: the token works because the C1 workspace is
  Natalie's home workspace; nothing is needed on the Indeed Flex side.
- The MCP Slack connector in Claude sessions posts as GREG — never use it
  for Natalie's voice.
