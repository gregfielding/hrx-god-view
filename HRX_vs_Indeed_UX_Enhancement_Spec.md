# HRX vs. Indeed — Application Wizard UX Enhancement Spec
**Prepared for:** HRX Labs / C1 Staffing · **Date:** 2025‑10‑15  
**Goal:** Match (and surpass) Indeed’s fluid, low‑friction apply flow while staying true to Material Design 3 (MUI).

---

## 0) Strategy Snapshot
- Replace numeric stepper with **percent progress bar** + conversational screen titles.
- **One concept per screen** where possible; use progressive disclosure for optional fields.
- Resume → **Review Extracted Data** modal with confidence tags.
- Skills → **clickable suggestions + free text** (predefined + custom).
- Sticky **Back / Continue** bar on desktop & mobile.
- Privacy-forward microcopy (e.g., “Not shown to employers”).

---

## 1) Information Architecture (Before → After)

| Current (8) | Proposed (6) | Notes |
|---|---|---|
| Personal Info | Personal Info | Prefill from resume when possible |
| Work Eligibility | Work Eligibility | Collapse EEO into drawer |
| Profile Picture | Profile Setup | Merge with Resume on wide screens |
| Resume |  |  |
| Qualifications | Experience & Preferences | Tabs: Skills / Certs / Preferences |
| Preferences |  |  |
| Requirements | Requirements | Only show if relevant to job |
| Review | Review & Submit | Collapsible cards + edit links |

---

## 2) Progress & Page Framing

### 2.1 Top Progress Bar (MD3)
```tsx
import LinearProgress from '@mui/material/LinearProgress';
import { Box, Typography } from '@mui/material';

export function StepHeader({ pct, title, subtitle }: { pct: number; title: string; subtitle?: string }) {
  return (
    <Box sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', pt: 2, pb: 1, mb: 2 }}>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 999 }} />
      <Typography variant="h5" mt={2}>{title}</Typography>
      {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
    </Box>
  );
}
```
**Copy style examples:**
- “What job are you looking for?”
- “Tell us about the skills that make you stand out.”
- “What pay would feel right for your next role?” *(Not shown to employers.)*

---

## 3) Compensation Screen (Indeed‑style)

```tsx
import { TextField, ToggleButtonGroup, ToggleButton, InputAdornment, Stack, Typography } from '@mui/material';

export function Compensation({ value, period, onChange }) {
  return (
    <Stack spacing={2} maxWidth={520}>
      <Typography variant="caption" color="text.secondary">Not shown to employers. Used only to match you with roles.</Typography>
      <TextField
        label="Minimum base pay"
        type="number"
        inputProps={{ min: 0 }}
        value={value}
        onChange={e => onChange({ value: Number(e.target.value), period })}
        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
      />
      <ToggleButtonGroup
        exclusive
        value={period}
        onChange={(_, v) => v && onChange({ value, period: v })}
      >
        <ToggleButton value="hour">Per hour</ToggleButton>
        <ToggleButton value="year">Per year</ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}
```

---

## 4) Skills & Industries (Clickable + Free Text)

### 4.1 Component
```tsx
import { Autocomplete, Chip, TextField, Stack, Button } from '@mui/material';

const suggested = ['Communication','Teamwork','Forklift','RF Scanner','Inventory','Customer service'];

export function SkillsPicker({ skills, setSkills }) {
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {suggested.map(s => (
          <Chip key={s} label={s} onClick={() => !skills.includes(s) && setSkills([...skills, s])} />
        ))}
      </Stack>
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={skills}
        onChange={(_, v) => setSkills(v)}
        renderInput={(params) => <TextField {...params} label="Add skills (type to add)"/>}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip {...getTagProps({ index })} key={option} label={option} variant="outlined" />
          ))
        }
      />
    </Stack>
  );
}
```

### 4.2 Behavior
- Pre-seed suggestions from parsed resume & selected job family.
- Allow up to **10** skills; show “You can add up to 10” helper text.
- Store skills with `{ name, source: 'predefined'|'custom' }`.

---

## 5) Resume → Review Extracted Data

```tsx
// Modal sections: Contact / Experience / Education / Skills
// Each item shows a confidence chip and Accept / Edit / Skip.
<Chip label="AI 0.84" size="small" color="primary" variant="outlined" />
```
**Rules**
- Accept automatically if confidence ≥ 0.8 *(user can undo)*.
- Below 0.8 → show as suggestions, not committed.

---

## 6) Sticky Navigation Bar

```tsx
import { AppBar, Toolbar, Button, Container } from '@mui/material';

export function StickyNav({ back, nextDisabled, onBack, onNext }) {
  return (
    <AppBar position="fixed" color="default" sx={{ top: 'auto', bottom: 0, borderTop: 1, borderColor: 'divider' }}>
      <Container maxWidth="md">
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button variant="outlined" onClick={onBack}>Back</Button>
          <Button variant="contained" disabled={nextDisabled} onClick={onNext}>Continue</Button>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
```

---

## 7) Privacy & Trust Microcopy
- “Not shown to employers” (compensation)
- “You’re always in control — review before anything is saved.” (resume parse)
- “Optional — helps us recommend better jobs.” (skills/industries)

---

## 8) Accessibility & Motion
- WCAG 2.1 AA contrast for primary/disabled states.
- `aria-current="step"` on progress header.
- Reduce motion setting (`prefers-reduced-motion`) disables animations.

---

## 9) Theme Tokens (MD3)
```ts
export const theme = createTheme({
  shape: { borderRadius: 12 },
  palette: {
    primary: { main: '#287FA0' },
    secondary: { main: '#FFC700' },
    background: { default: '#F8F9FC' },
  },
  typography: {
    fontFamily: 'Poppins, Roboto, Arial, sans-serif',
    h5: { fontWeight: 600 },
    subtitle1: { color: 'rgba(0,0,0,0.65)' },
  },
});
```

---

## 10) Review & Submit Screen
- Collapsible cards: Personal, Eligibility, Profile, Experience, Preferences.
- Each card has an **Edit** action that jumps to that step.
- Final checkbox: “Join the C1 Flex Talent Pool for future roles.” (opt‑in).

---

## 11) Acceptance Criteria
- [ ] Progress bar replaces numeric stepper; shows % complete.
- [ ] Compensation screen includes privacy note + period toggles.
- [ ] Skills screen offers clickable suggestions + free text with 10‑item cap.
- [ ] Resume parse modal with confidence chips and Accept/Edit/Skip.
- [ ] Sticky nav bar on mobile and desktop.
- [ ] Accessibility: ARIA on progress, contrast AA, keyboard navigation.
- [ ] Motion: subtle transitions, disabled via `prefers-reduced-motion`.

---

## 12) Rollout Plan
1. **A/B test**: Old stepper vs. new progress + conversational copy.
2. **KPI targets**: +10% completion, −20% time‑to‑submit, +15% profile completeness.
3. **Guardrails**: Log step abandonment, add retry banner on parse failures.

---

*Cursor‑ready. Drop the snippets into your MUI app and iterate in PRs.*
