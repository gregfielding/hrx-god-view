# C1 Staffing Worker UI — Design System (2027 Look-and-Feel)

**Scope:** Worker view only (securityLevel 0–4). Non-destructive UI modernization: improve presentation only; preserve all buttons, cards, panels, sections, fields, routes, and functionality.

**See also:** [Worker Interaction System](./WORKER_INTERACTION_SYSTEM.md) — toasts, button/card feedback, page transitions, bottom sheets, skeletons, success states.

**Goals:** Modern, premium, simple, mobile-friendly. Consumer-grade polish. Strong hierarchy, spacing, typography. Softer cards, clearer grouping. Obvious primary vs secondary actions. Premium status badges. Mobile-first. Clear empty states and icons.

---

## 1. Typography scale

| Token        | Use                     | Size  | Weight | Line height |
|-------------|-------------------------|-------|--------|-------------|
| `hero`      | Page hero / welcome     | 28px  | 700    | 1.2         |
| `h1`        | Page title              | 24px  | 700    | 1.25        |
| `h2`        | Section title           | 20px  | 600    | 1.3         |
| `h3`        | Card title / subsection | 18px  | 600    | 1.35        |
| `h4`        | Small heading           | 16px  | 600    | 1.4         |
| `body1`     | Primary body            | 16px  | 400    | 1.5         |
| `body2`     | Secondary body           | 14px  | 400    | 1.5         |
| `caption`   | Labels, meta, hints      | 12px  | 500    | 1.4         |
| `overline`  | Section labels           | 11px  | 600    | 1.3         |
| `button`    | Button label             | 15px  | 600    | 1.2         |

- **Font stack:** `'Inter', 'SF Pro Text', system-ui, -apple-system, sans-serif` (worker-facing; can keep Poppins for headings if desired).
- **Letter-spacing:** Headings -0.02em; body 0; caption 0.02em.

---

## 2. Spacing system

Base unit: **4px**. Use multiples for consistency.

| Token   | Value  | Use                                      |
|---------|--------|------------------------------------------|
| `xs`    | 4px    | Icon gaps, tight inline spacing          |
| `sm`    | 8px    | In-card padding, list item gaps          |
| `md`    | 16px   | Between related elements, form rows      |
| `lg`    | 24px   | Section internal padding, card padding  |
| `xl`    | 32px   | Between sections, page content padding  |
| `xxl`   | 48px   | Between major page blocks                |
| `pageY` | 24px   | Vertical padding of main content area    |
| `pageX` | 24px   | Horizontal padding (16px on small)       |

- **Section spacing:** At least `lg` (24px) between sections on a page.
- **Card internal:** Padding `lg` (24px); reduce to `md` (16px) on small breakpoints.

---

## 3. Border radius system

| Token    | Value  | Use                          |
|----------|--------|------------------------------|
| `none`   | 0      | Full-bleed / dividers        |
| `sm`     | 8px    | Chips, small controls        |
| `md`     | 12px   | Cards, inputs, buttons       |
| `lg`     | 16px   | Hero card, large panels      |
| `xl`     | 20px   | Modals, bottom sheets        |
| `pill`   | 9999px | Pills, full-round chips       |

- **Cards:** `md` (12px) default; hero / feature cards can use `lg` (16px).
- **Buttons:** `md` (12px) for contained/outlined; pill only when explicitly “pill” style.

---

## 4. Shadow system

| Token     | Value                          | Use                          |
|-----------|---------------------------------|------------------------------|
| `none`    | none                            | Flat cards in low-emphasis   |
| `card`    | 0 1px 3px rgba(0,0,0,0.06)      | Default card lift            |
| `cardHover`| 0 4px 12px rgba(0,0,0,0.08)     | Card hover                   |
| `elevated`| 0 4px 20px rgba(0,0,0,0.08)     | Dropdowns, popovers          |
| `modal`   | 0 12px 40px rgba(0,0,0,0.12)    | Modals, dialogs              |

- Prefer **soft shadows**; avoid harsh borders. Use `border: 1px solid rgba(0,0,0,0.06)` for subtle definition when needed.

---

## 5. Button variants

- **Primary (contained):** Main action per block. Background primary; white text; radius `md`; min-height 44px (touch-friendly); padding horizontal 20px.
- **Secondary (outlined):** Secondary action. Border 2px primary; transparent bg; primary text; same size as primary.
- **Tertiary (text):** Low emphasis. No border/background; primary or text.secondary; same size.
- **Danger:** Destructive actions. Use error color; same shape as primary.
- **Icon buttons:** Min 44px touch target; radius `md`.
- **Disabled:** Reduced opacity; no interaction feedback.
- **Loading:** Show spinner; keep label; disable click.

Do not remove any existing buttons; restyle only (spacing, radius, weight, hierarchy).

---

## 6. Badge / chip styles

- **Radius:** `pill` (9999px) for status pills; `sm` (8px) for count badges.
- **Height:** 28px default; 24px small.
- **Typography:** 12px or 13px; weight 600.
- **Semantic colors (soft background + text):**
  - Success: bg `success.light`, text `success.main`
  - Warning: bg `warning.light`, text `warning.main`
  - Error: bg `error.light`, text `error.main`
  - Info: bg `info.light`, text `info.main`
  - Neutral: bg `grey.100`, text `grey.700`
- **Status chips:** Same semantics; ensure “premium” look (clear label, consistent padding). Do not remove any status; only restyle.

---

## 7. Card styles

- **Default card:** White background; border `1px solid rgba(0,0,0,0.06)`; radius `md` (12px); shadow `card`; padding `lg` (24px).
- **Hero / feature card:** Same border; radius `lg` (16px); padding `xl` (32px) where space allows.
- **Tonal card (optional):** Background `grey.50` or `primary.light` at low opacity; no heavy border.
- **Hover:** Optional subtle shadow `cardHover` and border darkening; do not remove cards or collapse content.

All existing cards remain; only styling (padding, radius, shadow, border) changes.

---

## 8. Page layout rules

- **Main content:** Max-width 840px for reading comfort on desktop; center when possible. Wider for tables/lists if needed (e.g. 100% with padding).
- **Vertical rhythm:** Page padding vertical `pageY` (24px); horizontal `pageX` (24px; 16px on small).
- **Page header:** One clear title (h1) per page; optional short description (body2, text.secondary). Margin below `lg`.
- **Sections:** Each section has a clear heading (h2 or h3); spacing between sections at least `lg`.
- **Left nav (WorkerNav):** Same items and behavior; polish spacing, active state, icons. Drawer width unchanged; internal padding from spacing scale.

---

## 9. Form styling rules

- **Labels:** `caption` or `body2`; weight 600; color text.secondary or text.primary.
- **Inputs:** Min height 48px for touch; radius `md`; border 1px; focus border primary, optional subtle shadow.
- **Spacing:** 16px between label and input; 24px between fields.
- **Error state:** Border/helper error color; do not remove validation or fields.
- **Grouping:** Related fields in a card or with a subheading; use spacing scale.

All existing fields and validation preserved; only visual styling updated.

---

## 10. Table / mobile card styling rules

- **Desktop table:** Header row: uppercase optional; font weight 600; padding from spacing scale. Row hover: subtle background (e.g. grey.50). Borders: light dividers (e.g. 1px divider). No removal of columns or rows.
- **Mobile / responsive:** Where tables already collapse to cards, keep the same data in card form. Card per row: padding `md`/`lg`; radius `md`; same info, reflowed. If no card view exists, add a responsive card layout that shows the same fields (no consolidation of features; only layout).
- **Empty state:** Clear message + primary action when no rows; use typography and spacing from this system.

---

## Implementation notes

- Implement via a **worker-only theme** (e.g. `workerTheme.tsx`) applied under `C1WorkerLayout` so recruiter/admin UI is unchanged.
- Use MUI `theme` overrides and `sx` with these tokens (or equivalent in theme.shape, theme.spacing, theme.shadows).
- Preserve DOM structure and all existing elements; prefer restyling and re-layout over deletion or simplification.
