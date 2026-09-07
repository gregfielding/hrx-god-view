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

## One-time steps (Greg / Natalie)

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

4. Wire HRX: a `postAsNatalie(channelId, text)` helper that binds
   `defineSecret('NATALIE_SLACK_USER_TOKEN')` and calls `chat.postMessage`
   (user tokens post as the user — no `as_user` needed). Callers: the
   CANCEL / no-show branch of the cadence reply handler, the late check-in
   step, and the ops alert drain when a persona voice is wanted.

## Gotchas

- User tokens (`xoxp-`) do not expire unless token rotation is enabled —
  the manifest sets `token_rotation_enabled: false` on purpose.
- Natalie must be a member of the channel; `chat:write` as a user cannot
  post into channels she hasn't joined (`im:write` covers DMs).
- Slack Connect channels: the token works because the C1 workspace is
  Natalie's home workspace; nothing is needed on the Indeed Flex side.
- The MCP Slack connector in Claude sessions posts as GREG — never use it
  for Natalie's voice.
