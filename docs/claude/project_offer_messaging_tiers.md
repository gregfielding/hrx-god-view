# offer messaging tiers

> "Qwick-style offer messaging — Tier 1 (invitation framing) SHIPPED 2026-07-11; Tier 2 (true one-tap Accept Offer + Greg's \"always hire\" auto-accept designation) PARKED pending rock-solid SOPs"

# Offer-style worker messaging — tier plan

Origin: Greg saw Qwick's "New Job Offer" SMS (2026-07-11) and wants the
click-through lift, but Qwick's language works because tapping actually
secures the shift (their CTA: "Confirm" / "I Can Work"; direct offers =
pre-selected, first-confirm-wins). Calling ours an "offer" while the
button says Apply would cry-wolf and burn trust.

**Tier 1 — SHIPPED 2026-07-11 (commit 7ebff9f4):** honest invitation
framing. Blast SMS: "Hi {name} — you're invited to work a {title} shift
in {city}, {date}, $X/hr. Spots are limited: {link}" (EN/ES,
per-recipient, fields degrade gracefully); links carry ?invite=1 →
JobPostingDetail invited-state banner; gig CTA renamed "I Can Work This
Shift" (jobs.applyForShift); post-tap state "Shift Requested" already
fits. Click-through measurable per blast via the SMS link shortener —
compare against pre-2026-07-11 baseline.

**Tier 2 — PARKED (revisit later, Greg 2026-07-11):** true "New Job
Offer" = one-tap **Accept Offer** that instantly assigns
(first-accept-wins, capacity-checked). All machinery exists: readiness
gating, placementsCreateAssignments, overlap auto-release, DNR/
separation guards, applicant pools. Two flavors discussed:
  1. Recruiter-targeted direct offers to pre-qualified (fully
     work-ready) workers on a specific shift.
  2. **Greg's "always hire" designation**: mark a worker as
     auto-accepted — when they apply to a gig they're instantly
     assigned instead of waiting for recruiter review.

**Why parked:** Greg's words — "we would need rock-solid SOPs on our
end to make sure we don't make a mistake and hire a bunch of people
incorrectly." Before building, define: who may grant/revoke the
always-hire flag; scope (per-account? per-role? global?); hard
server-side gates that must ALL pass at accept time (work-ready for the
entity, screening satisfied for the account, no DNR/separation, no
overlap, shift capacity); audit trail + instant recruiter notification
on every auto-acceptance; and a kill switch.
