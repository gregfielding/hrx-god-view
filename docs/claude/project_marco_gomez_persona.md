# Marco Gomez — second recruiting persona (works for Rosa; C1 Events minus Oakland Arena)

> Greg 2026-09-11: "Marco Gomez — a 'Natalie' style recruiter that is built to work for Rosa —
> primarily supporting venuesmart, but also every other 'c1 events' account besides oakland arena."

Status: **DECIDED, NOT BUILT** (2026-09-11). Model: [[project_natalie_roadmap]] /
[[reference_slack_natalie_persona]] / [[project_natalie_onboarding_followups]].

## Decisions (Greg, 2026-09-11)
- **Scope = C1 Events accounts (`hiringEntityId == 'c1_events_llc'`) EXCEPT Legends Global / Oakland Arena.**
  Marco **owns them fully**: onboarding + screening follow-ups, confirmation escalations, fill play,
  morning brief for those accounts route to Marco; Natalie stops touching them. A worker must never get
  follow-up texts from both personas.
- **Boss**: Rosa Govea — HRX uid `OqZ0SlWsYqMhFgq9fIxgd9Pm0I62`, Slack `U07KRMRKT1R`.
- **Home channel**: a NEW `#events-recruiting` (Rosa, Mark, Maria + Marco). `#venuesmart` (C07KP7NHL7P)
  has been silent since 2025-07 — not used.
- **Phone**: +1 737 264 6753 (Austin overlay, PN54f9b011…, reserved for this persona since 2026-09-09 —
  see [[reference_twilio_messaging_state]]). Not yet in any messaging service; needs adding to an
  A2P-approved sender pool (MG2dd6557d05d9be9044c996fa568a8a39's Low Volume Mixed campaign matches the
  use case) with per-persona `from` routing so Natalie keeps the 312.
- **Mailbox**: m.gomez@c1staffing.com (Greg creating the Workspace account).
- **Language**: worker texts go out in the worker's `users.preferredLanguage` (ES/EN); replies mirror the
  language the worker writes in.
- **Headshot**: AI-generated square portrait (navy blazer, "Staffing & Recruitment · English | Español"
  office backdrop) supplied by Greg in chat 2026-09-11.

## Scope data (live probe 2026-09-11, `functions/.scratch/marco_scope_probe.ts`)
72 job orders on `c1_events_llc`:

| Account | accountId | JOs (open) | Recruiters on JOs | Marco? |
|---|---|---|---|---|
| Venue Smart, LLC (+ "Venuesmart LLC National" name variant, same id) | `NHc6r1yOVUK6aOqt0EQH` | 45 (26) | Rosa, Mark, Maria Rabadan, Greg | ✅ |
| Black Caviar Catering | `F4u0eLZVwguXfwffOuJa` | 7 (7) | Rosa, Danny | ✅ |
| Contigo Catering | `JAXhZ3wLVkosuoQJbtCH` | 6 (2) | Rosa | ✅ |
| Proof of the Pudding | `KFKxtXFRap3u3JpZrrTT` | 6 (5) | Rosa | ✅ |
| G6 Catering | `nrNHIZqcwRSMakrDsttV` | 1 (1) | Rosa | ✅ |
| Legends Global (Oakland Arena `QGNUkDRD4jMej6RArOO4`) | `pioetKgJXPu19zk2K7Y6` | 7 (1) | Danny | ❌ Danny's |

Note the cadence doc keys Oakland Arena under Legends **National** `uhb5hq4ddyLWtSeJP9Te` +
locationId `QGNUkDRD4jMej6RArOO4`; the JOs carry `pioetKgJXPu19zk2K7Y6`. The exclusion should match
the **locationId** (and both account ids), not one account id.
Black Caviar has Danny on some JOs — its event sites are not Oakland Arena, so it is Marco's.

## Natalie identity facts to mirror
Natalie's user doc: `isAutomationPersona: true`, securityLevel 7, role Admin, jobTitle "Recruiting
Assistant", `recruiter: true`, `integrations.slack` + `tenants/{T}/slackUsers/{slackId}` mapping.
`app_config/natalie` is currently EMPTY at both root and tenant paths — she runs on code defaults.
