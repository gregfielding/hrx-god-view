# LinkedIn daily session — lane budgets

Operational state of the DM lane mix. The scripts that implement this live in
gitignored `functions/.scratch/`, so the *numbers and the reasoning* belong here —
a fresh checkout (or Mark's laptop) has the doc but not the script.

## Accept cap: 15 → 25 (2026-09-08, Greg's call)

`linkedin-build-manifest.ts --accept-cap` default is now **25** (was 15).

The accept lane takes its slots off the TOP of `dailyQuota`; whatever is left
splits by `--warm-share` (0.6). At quota 50 the mix is now:

| pending accepts | accept | warm | cold |
|---|---|---|---|
| ≥25 | 25 | 15 | 10 |
| 10  | 10 | 24 | 16 |

**Why raised.** The original 15 was inherited from the old STEP 2 follow-up
budget, not from measured demand. By 2026-09-08 the backlog of accepted
connections with no first DM had reached **124 and was climbing**: Greg's manual
invite lane produces far more acceptances per day than the CRM-tracked lane, and
15/day could not drain it. An acceptance is the strongest intent signal this
channel produces, and it decays — a "Thanks for connecting!" three weeks late
reads worse than the cold re-intro it displaced. `--accept-days` (30) also means
a slot not used inside the window is lost outright, not deferred.

**Cost.** The cold lane absorbs the squeeze (16 → 10/day at full accept load),
lengthening cold-lane drain. That is the right trade: cold contacts keep, accepts
do not. Revisit if the backlog clears and the accept lane starts running short of
its 25.

## CPC is NOT a competitor signal — do not add that rule

`Erik Kalstad, CPC` (Gecko Hospitality) was excluded as a staffing competitor on
2026-09-08, which makes the "CPC" (Certified Personnel Consultant) suffix look
like a cheap classifier signal. It is not. All four CPC-suffixed contacts in the
book were checked: the other three are **in-house talent acquisition at
operators** (Sodexo, Sunbelt Solomon) — i.e. exactly the buyers the ICP layer
deliberately rescues, plus one unknown needing live verification. A blanket CPC
exclusion would kill real buyers. The employer decides, not the credential; see
the standing rule that recruiting titles are only excluded when the *employer* is
itself a staffing firm.
