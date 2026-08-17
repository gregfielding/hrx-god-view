# Claude Code setup for teammates

> How a new team member (e.g. Mark) gets a fully-context-loaded Claude
> working on HRX. Decision 2026-08-17: individual Claude plans per person,
> no Team workspace — shared context lives in this repo, not in any
> Anthropic account.

1. **Subscribe individually** at claude.ai on your own email (Pro to
   start; upgrade to Max if you hit usage limits). Expense it.
2. **Install Claude Code** (claude.com/claude-code), clone this repo,
   run `claude` from the repo root. It auto-loads `CLAUDE.md` and this
   `docs/claude/` knowledge base — your Claude starts knowing the
   integrations, conventions, and footguns.
3. **Access you need from Greg**: GitHub collaborator on this repo,
   Firebase console membership on `hrx1-d3beb`, and the
   `functions/.env.hrx1-d3beb` secrets from the shared password vault
   (file is gitignored — reconstruct locally, never commit).
4. **Conversations are per-person and stay that way** (they accumulate
   PII/screenshots). What must outlive any one person's laptop is
   knowledge — when your Claude learns a durable ops/dev fact, have it
   update the matching file here and the README index.

Why no Team plan: Anthropic Team seats don't share conversation history
between users anyway, and premium seats can carry LOWER usage limits
than an individual Max subscription. Revisit Team/Enterprise when the
team is 3+ and admin controls (SSO, centralized billing) matter.
