# LinkedIn daily session: sends are lost unless the session stamps

**Discovered 2026-08-25**, recovering the 2026-08-24 session.

## The failure

The daily LinkedIn session is a two-stage design: `linkedin-build-manifest.ts`
picks the queue (no browser), then the browser stage sends, then
`linkedin-stamp-from-manifest.ts` writes `linkedinOutreach.messagedAt`.

**If the session ends before the stamp step, the sends are invisible to
Firestore.** The manifest builder filters on `messagedAt` missing, so the next
day it re-serves the exact same people. Nothing in the DB records that they
were already messaged — the only evidence is the LinkedIn inbox.

On 2026-08-24 a session sent 14 book DMs and 3 profile-viewer DMs and never
stamped. The 2026-08-25 manifest re-served all 14 as rows 1–16. Sending them
again would have double-messaged contacts three days apart, in the same
"trying you once more" voice.

## Check for this at the start of every session

Before sending anything, open `linkedin.com/messaging/` and read the thread
list. Threads are ordered by recency, so a prior unstamped session shows up as
a contiguous block of `You: Hi <name> — …` previews dated after
`integrations/linkedinBook.lastSessionAt`.

Compare that block against the freshly built manifest:

- Names present in **both** → already sent, unstamped. Stamp them, do not resend.
- `lastSessionAt` older than the newest outbound DM in the inbox → a session
  ran and did not stamp. Always reconcile before sending.

Stamping late is fine — `messagedAt` gets today's timestamp rather than the
real send date, which is a small inaccuracy next to duplicate outreach.

## Reconstructing the block

Two traps when reading the inbox:

- **Contacts who replied are bumped out of the outbound block.** Their preview
  shows *their* text (`Joseph: Greg - appreciate you…`), not `You: Hi …`, so a
  regex on `You: Hi` silently drops them. Cross-check the Unread filter.
- **The conversation list virtualizes.** `document.querySelectorAll` only sees
  rendered rows, so JS extraction returns a partial list that looks complete.
  Scroll the list pane in steps and read screenshots; do not trust one JS dump.

A gap inside an otherwise contiguous alphabetical run usually means those rows
were *verified and skipped*, not missed — on 2026-08-24 the two gaps were an
`#OPENTOWORK` profile and a "Retired -" headline. Open them and confirm before
assuming they still need sending.

## Related

- Composer mechanics and the retry-on-first-type quirk: see the
  `linkedin-daily-session` scheduled task.
- Skip semantics (`linkedinOutreach.excluded` vs `needsNameFix`): same task,
  SKIP BOOKKEEPING section.
