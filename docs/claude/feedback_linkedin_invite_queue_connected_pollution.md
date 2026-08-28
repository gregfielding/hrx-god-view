# LinkedIn invite queue was full of people Greg is already connected to

**Found 2026-08-28.** The connect queue (`functions/.scratch/linkedin-session-targets.ts`)
filtered on `queuedAt`, `excluded`, `needsNameFix`, `connectSentAt` and `messagedAt`
— but **never on `linkedinConnection`**. Already-connected contacts therefore ranked
straight to the top of the *invite* queue.

The whole verified top of the queue that day was already 1st-degree: Chris Morgan
(RVP, Oak View Group), Scott Yeager (VP Ops, Aramark Facilities), Allan Collins (VP,
Sodexo Schools), Cal Thetford (SVP Ops Campus, Sodexo), Matt Horvath (RVP, Levy),
Alain Morize (SVP Ops, Sodexo). Six for six. The invite lane produced **zero** valid
targets from its top entries until the filter was added.

Adding `if (v.linkedinConnection === true) return;` moved **6,593** contacts out of
the invite queue and surfaced genuinely-unconnected targets (HR managers at Nutrien,
Dot Foods, CJ Logistics, Johnsonville, Bimbo, White Lodging…).

**Why it matters beyond the wasted queue slots:** these are not DM targets either.
All six already have `linkedinConnection: true` *and* an email on file, so the
manifest correctly skips them under `email_lane_owns_this_quarter` (360 skips that
day). They are the email lane's this quarter. Do **not** "rescue" them into the DM
manifest — that double-touches against the email sender.

**Watch item:** `connectSentAt` is not a reliable record of pending invites. Several
contacts showed **Pending** on the live profile with an empty `connectSentAt`
(Shannon Tanner, Vickie McCreary, Andrea Alvarez, Joseph Medley). Invites sent
outside the stamped flow are invisible to the picker, so it will keep re-offering
them. Verify against the live profile before spending an invite; a periodic sweep of
`mynetwork/invitation-manager/sent/` back into `connectSentAt` would close this.

Related: [feedback_linkedin_composer_mechanics.md](feedback_linkedin_composer_mechanics.md).
