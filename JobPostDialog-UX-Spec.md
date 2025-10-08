# HRX / C1 Job Post Dialog — UX & Implementation Spec

**Goal:** Make the job detail dialog **clear, modern, and skimmable**—aligned with Indeed/LinkedIn patterns—while staying flexible so sections appear only when populated.

This spec covers **content order, layout, components, conditional rendering, accessibility, and code snippets**. Use it to update the existing modal dialog.

---

## 1) Information Architecture (order & visibility)

> Show the most decision‑making info above the fold; collapse the rest into well-labeled sections.

**Header (always):**
1. **Job Title** (e.g., “Entry Level Janitor”) + **JobType Pill** (Gig / Career)
2. **Company (optional)** • **Location city, state** • **Distance (if known)**
3. **Primary Pay** (big, colored): `$17/hr` • **Pay unit** • **Payout timing** (if gig)

**Key Facts row (chips/badges):** (render only if present)
- **Start date** or **Shift date(s)** (Gig), or **Typical hours** (Career)
- **Shift**: `1st shift`, `Nights`, `Weekends`, `8‑hour shift`
- **Openings**: `Openings: 3`
- **Employment type**: Full‑time / Part‑time / Temporary
- **Benefits** (brief): `Medical`, `401(k)` (Career)

**Tabs or Accordions (collapsed by default):**
- **About the Role** (Job Description)
- **Qualifications** (skills + experience + education)
- **Credentials** (Licenses & Certifications)
- **Safety & Compliance** (Physical Requirements, Uniform, Required PPE)
- **Screenings** (Background, Drug, Additional Medical)
- **Logistics** (Gig check-in instructions, parking/dock, attire reminder)

**Footer (sticky):**
- Left: Secondary actions (Save, Share)
- Right: **Primary CTA** — `Apply Now` (full-width on mobile)

---

## 2) Visual Design Guidelines

- **Typography:** Title `text-2xl md:text-3xl` / Section headers `text-lg font-semibold` / Body `text-sm md:text-base`
- **Spacing:** Use 16–24px vertical rhythm (`space-y-4` between blocks; `space-y-2` inside blocks).
- **Chips:** Rounded (`rounded-full`), subtle background, medium weight text.
- **Icons:** Lucide (or Heroicons) for Location, Calendar, Dollar, Shield, Clipboard, Flask (drug), Check Circle.
- **Pay Highlight:** Accent color (`text-primary`) and increased size; keep unit small (e.g., `$17` **/hr**).
- **Dividers:** Soft separators (`border-border/40`) not heavy rules.
- **Cardized sections:** Use `Card` with subtle shadow for secondary groups (Safety, Screenings).

---

## 3) Conditional Rendering Rules

Render a section **only if it has content**. Recommended grouping:

- **Qualifications** shows if any of: skills, experience, education
- **Credentials** shows if any of: licenses_certifications > 0
- **Safety & Compliance** shows if any of: physical_requirements, uniform_requirements, required_ppe
- **Screenings** shows if any of: background_check OR drug_screening OR additional_screenings > 0
- **Logistics** shows for **Gig** when check-in/parking/attire notes exist

Empty sections should be **omitted**, not disabled.

---

## 4) Gig vs Career layout nuances

**Gig (dated shifts):**
- Replace “Start Date” with **Shift list**: render each date/time as a chip or a simple list (supports calendar add).
- Show **check-in instructions** in “Logistics” (with a location pin icon).
- If multiple shifts, show `+N more` expander.

**Career (recurring schedule):**
- Show **Typical Hours** and **Shift pattern** chips (`1st shift`, `Some weekends`).
- Keep **start date** chip if provided (e.g., “Hiring ASAP” / “Starts 10/19/2025”).

---

## 5) Section Content Patterns

### About the Role
- Show 4–6 line clamp with “Read more” expand; preserve bullets.

### Qualifications
- **Skills**: chip list.
- **Experience**: inline line (e.g., `Experience: 1–2 Years (Associate)`)
- **Education**: inline line (e.g., `Education: High School / GED`)

### Credentials
- Chip list from the master credentials library.

### Safety & Compliance
- **Physical Requirements** chips (e.g., Standing long periods, Lifting 25 lbs).
- **Uniform Requirements** chips (e.g., Black button‑down, Non-slip shoes).
- **Required PPE** chips (e.g., Hard Hat, Safety Glasses).

### Screenings
- **Background:** e.g., `Basic National Criminal Check`
- **Drug:** e.g., `4‑Panel (No THC)`
- **Additional:** chips (e.g., `TB Skin Test (PPD)`, `MMR Titer`)

### Logistics (Gig only)
- `Check-in at Door 4 by 3:45 PM`
- Parking/dock info; attire reminder; site contact (if allowed).

---

## 6) Accessibility & Behavior

- **Dialog:** Trap focus; `Esc` closes; clicking overlay closes (confirm on forms); `aria-labelledby` & `aria-describedby` set.
- **Keyboard:** `Tab` order; `Enter` on CTA; quick close with `Esc`.
- **Screen readers:** Use headings (`h2/h3`) and list semantics for chips.
- **Contrast:** Buttons/chips meet WCAG AA.
- **Loading:** Skeleton placeholder for title, pay, badges (1–2s shimmer).

---

## 7) Analytics Events

- `job_dialog_opened` (jobId, jobType, sourceCardIndex)
- `apply_clicked` (jobId, jobType, payRate, location)
- `section_expanded` (sectionId)
- `save_clicked`, `share_clicked`

---

## 8) Code Snippets (React + Tailwind + shadcn/ui)

### Header

```tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin } from "lucide-react";

function JobHeader({ job }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-2xl md:text-3xl font-semibold leading-tight">
          {job.title}
        </h2>
        <Badge variant="secondary" className="shrink-0">
          {job.jobType === "gig" ? "Gig" : "Career"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
        {job.company && <span>{job.company}</span>}
        {job.location?.city && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-4 w-4" /> {job.location.city}, {job.location.state}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-primary text-2xl md:text-3xl font-semibold">
          ${job.pay.rate}
        </span>
        <span className="text-muted-foreground">/{job.pay.unit}</span>
        {job.pay.payoutTiming && (
          <Badge className="ml-2" variant="outline">{job.pay.payoutTiming.replace("_", " ")}</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {job.shift?.career?.duration && (
          <Badge variant="outline">
            {job.shift.career.duration.replace("_", " ").replace("hour", "‑hour")}
          </Badge>
        )}
        {job.shift?.career?.schedule?.map((s) => (
          <Badge key={s} variant="outline">{s.replaceAll("_", " ")}</Badge>
        ))}
        {job.shift?.gig?.shifts?.[0] && (
          <Badge variant="outline" className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {new Date(job.shift.gig.shifts[0].startDateTime).toLocaleString()}
          </Badge>
        )}
        {typeof job.openings === "number" && (
          <Badge variant="outline">Openings: {job.openings}</Badge>
        )}
      </div>
    </div>
  );
}
```

### Section wrapper (accordion)

```tsx
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

function Section({ id, title, children }) {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value={id}>
        <AccordionTrigger className="text-lg font-semibold">{title}</AccordionTrigger>
        <AccordionContent className="pt-2">{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
```

### Chips

```tsx
function ChipList({ items }: { items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t) => (
        <span key={t} className="px-3 py-1 rounded-full bg-muted text-sm">
          {t}
        </span>
      ))}
    </div>
  );
}
```

### Footer

```tsx
function DialogFooterActions({ onApply }) {
  return (
    <div className="sticky bottom-0 left-0 right-0 bg-background border-t mt-4 pt-4 flex items-center justify-between gap-2">
      <div className="flex gap-2">
        <Button variant="outline">Save</Button>
        <Button variant="outline">Share</Button>
      </div>
      <Button onClick={onApply} size="lg">Apply Now</Button>
    </div>
  );
}
```

---

## 9) Copy & Micro‑Interactions

- Use **Openings: N** badge instead of “Workers Needed: N” sentence.
- Convert long paragraphs to bullets; add a “Read more” expander past ~6 lines.
- On expand/collapse, push analytics events and maintain scroll position.
- Show tiny inline icons for **Background / Drug / Additional** once selected.

---

## 10) Mobile Responsiveness

- Dialog full-screen on mobile; sticky top header with title + close.
- Sticky bottom Apply button (full width).
- Collapsible sections to minimize scroll.
- Ensure chip rows wrap cleanly (`flex-wrap`).

---

## 11) Acceptance Checklist

- [ ] Above-the-fold shows: title, type pill, company, location, pay, core badges.
- [ ] Only sections with content are rendered.
- [ ] Accordion interaction + analytics implemented.
- [ ] Keyboard & SR accessibility verified.
- [ ] Gig shifts render as dated list; Career renders schedule chips.

---

**End of File**