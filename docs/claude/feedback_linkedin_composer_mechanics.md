# LinkedIn daily session: composer mechanics (the throughput bottleneck)

**Verified 2026-08-26**, the session that sent 47 book DMs in ~30 minutes
(prior sessions: 10 on 08-13, 24 on 08-25). Everything below was observed
live; it supersedes the coordinate guidance in local Claude memory.

## Coordinate scale is a ratio, not a constant

An older note says "screenshots are 1.4% off JS rects (×0.986)". That is a
*sample*, not a rule. The real conversion is:

```
screenshot_xy = js_rect_xy * (screenshot_width / window.innerWidth)
```

On 2026-08-26: screenshot 1553px wide, `window.innerWidth` 1705 → **×0.911**,
not ×0.986. Using 0.986 put every click ~9% low and missed the target. If you
compute coordinates from JS at all, read `window.innerWidth` in the same call
and derive the ratio; never hardcode it.

## The Message button's y moves with the headline

The profile top-card grows with the headline's line count, so the Message
button lands anywhere in **y ≈ 470–545** (observed: 471, 487, 490, 493, 505,
512, 523, 542). There is no safe fixed y. **Screenshot the profile and read the
button position before clicking it.** A missed click silently does nothing and
costs a full retry cycle.

## Clicking Message opens ONE OF TWO composers, unpredictably

This is the single biggest source of "the type didn't register" failures. Both
layouts appear on the same account, same session, same kind of profile:

| | docked overlay (bottom-right) | full messaging page |
|---|---|---|
| where | floats over the profile | navigates to `/messaging/thread/new/?recipient=…` |
| box click | **(1010, 678)** with history, **(1010, 550)** without | **(744, 630)** |
| Send | **(1180, 760)** | **(891, 723)** |

You cannot predict which one you get. **Screenshot after clicking Message and
before typing**, then pick coordinates from what you actually see. Typing into
the wrong layout's coordinates fails silently — the box stays empty and the
screenshot after the type is the only thing that catches it.

Do not try to "click both candidate boxes" to cover the two cases: clicking the
other layout's coordinate lands on the page behind the overlay (or the empty
right rail) and blurs the input you just focused.

## After a send, the next composer opens on the LEFT

Once a send completes, the finished thread stays docked on the right and the
*next* Message click opens a second composer beside it:

- left composer: box **(540, 550)**, Send **(710, 760)**
- right (previous, already sent) composer: X to close at **(1232, 171)**

Close the right one each cycle, or the two-composer layout persists and the
coordinates keep alternating. The upside: the right-hand pane shows the
previous contact's message with its delivery timestamp, so **each batch
confirms the previous send for free** — no separate verification pass needed.

**Closing it is not optional (2026-08-28).** Skipping the close sent contact
N's message into contact N−1's still-open composer — Katelin Markham received a
note addressed "Hi Keith". The text goes to the wrong person and *sends*; there
is no undo. Close the previous composer before every new Message click, and if
it does happen, send a one-line correction in that thread immediately rather
than leaving it.

## The urn shortcut is dead

Navigating straight to `/messaging/thread/new/?recipient=<urn>` would give one
deterministic layout, but the Message link's `href` now comes back as
`[BLOCKED: Cookie/query string data]` from the browser tool's data guard —
100% redacted on 2026-08-26, not the ~40% the task file records. Treat the urn
route as unavailable and drive the Message button.

## The first type after a navigation still fails

Unchanged and still true: the first click+type after loading a page often does
not register, and the retry must be a **separate tool call**. Budget ~2–3 calls
per contact. Always screenshot after typing, and never re-type without
confirming the box is empty (that is how duplicates happen).

## Invitation notes are unlimited on Premium

The "Add a note to your invitation?" dialog states **"You have unlimited notes
with Premium"**, and the note editor shows a **300-character** cap. This closes
the UNVERIFIED question in the scheduled task — send a note on every invite
worth personalising; there is no remaining-notes budget to ration.

That dialog has two heights, and the buttons move with it:

- 2-line body → "Add a note" at **y = 220**
- 3-line body → "Add a note" at **y = 242**

Screenshot it rather than assuming; a miss here types the note into nothing and
the invite goes out bare.

## Related

- Sends are lost unless the session stamps: [feedback_linkedin_unstamped_session.md](feedback_linkedin_unstamped_session.md)
- Queue/ICP/skip semantics: the `linkedin-daily-session` scheduled task
