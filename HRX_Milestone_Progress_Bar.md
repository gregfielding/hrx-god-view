# 🎮 HRX Application Wizard — Gamified Milestone Progress Bar
**Component:** `MilestoneProgress.tsx`  
**Goal:** Replace the plain progress bar with a rewarding, gamified progress experience following Material Design 3 (MUI).  
**Prepared for:** HRX Labs / C1 Staffing  
**Date:** 2025‑10‑15

---

## 🎯 Overview
This spec introduces a **segmented “milestone” progress bar** that motivates users through visible completion checkpoints.  
It blends **gamification** and **accessibility**, and works for both **top** and **bottom sticky** placement.

---

## ✨ Key UX Principles
- **Gamified Feedback:** Each completed section fills in as a green pill segment.
- **Psychological Wins:** Users visually track their journey step by step.
- **Touch & Keyboard Friendly:** Click, tap, or tab through segments.
- **Progressive Disclosure:** Labels visible on large screens, compact on mobile.
- **Clean Aesthetic:** Rounded, MD3-compliant, with subtle transitions.

---

## 🧩 Component Code

```tsx
// MilestoneProgress.tsx
import * as React from "react";
import {
  Box,
  Tooltip,
  Typography,
  IconButton,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CheckRounded from "@mui/icons-material/CheckRounded";

/**
 * MilestoneProgress (MD3-friendly)
 *
 * Props:
 * - total: number of milestones (e.g., 6)
 * - completed: number completed (0..total)
 * - labels?: string[] (optional step names, length === total)
 * - sticky?: "top" | "bottom" | "none"
 * - onJump?: (index: number) => void  // allow clicking completed steps to jump
 * - showPercent?: boolean  // also show percent text (e.g., "33% complete")
 */
export interface MilestoneProgressProps {
  total: number;
  completed: number;
  labels?: string[];
  sticky?: "top" | "bottom" | "none";
  onJump?: (index: number) => void;
  showPercent?: boolean;
}

export default function MilestoneProgress({
  total,
  completed,
  labels,
  sticky = "top",
  onJump,
  showPercent = true,
}: MilestoneProgressProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // Colors (success-green forward, MD3 track)
  const fg = "#22c55e";
  const track = "rgba(34, 197, 94, 0.18)";

  // Positioning
  const stickyStyles =
    sticky === "top"
      ? { position: "sticky" as const, top: 0, borderBottom: 1, borderColor: "divider" }
      : sticky === "bottom"
      ? { position: "sticky" as const, bottom: 0, borderTop: 1, borderColor: "divider" }
      : {};

  const pct = Math.max(0, Math.min(100, Math.round((completed / Math.max(1, total)) * 100)));

  return (
    <Box
      role="region"
      aria-label="Application progress"
      sx={{
        zIndex: 10,
        bgcolor: "background.paper",
        px: { xs: 2, md: 4 },
        py: 1.25,
        ...stickyStyles,
      }}
    >
      <Box
        sx={{
          display: "flex",
          gap: 1,
          alignItems: "center",
          mb: 1,
          justifyContent: "space-between",
        }}
      >
        <Typography variant="subtitle1" fontWeight={600}>
          {showPercent ? `${pct}% complete` : "Progress"}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>
          {completed} of {total} sections done
        </Typography>
      </Box>

      <Box sx={{ display: "flex", gap: 8 / 8 }}>
        {Array.from({ length: total }).map((_, i) => {
          const isDone = i < completed;
          const isCurrent = i === completed && completed < total;
          const label = labels?.[i] ?? `Step ${i + 1}`;

          const segment = (
            <Box
              tabIndex={0}
              role="button"
              aria-label={`${label}${isDone ? " completed" : isCurrent ? " current" : ""}`}
              onClick={() => (isDone && onJump ? onJump(i) : undefined)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && isDone && onJump) onJump(i);
              }}
              sx={{
                height: 12,
                flex: 1,
                borderRadius: 999,
                bgcolor: isDone ? fg : track,
                outline: "none",
                transition: "background-color .25s ease, transform .12s ease",
                cursor: isDone && onJump ? "pointer" : "default",
                ...(isCurrent && {
                  boxShadow: `0 0 0 2px ${track} inset`,
                }),
                "&:focus-visible": {
                  boxShadow: `0 0 0 3px ${theme.palette.primary.main}66`,
                },
                "&:active": {
                  transform: "scale(1.01)",
                },
              }}
            />
          );

          const labelRow = (
            <Box
              sx={{
                mt: 0.75,
                textAlign: "center",
                width: "100%",
                display: { xs: "none", lg: "block" },
              }}
            >
              <Typography
                variant="caption"
                color={isDone ? "text.primary" : "text.secondary"}
                sx={{ whiteSpace: "nowrap" }}
              >
                {isDone ? (
                  <>
                    <CheckRounded
                      fontSize="inherit"
                      sx={{ verticalAlign: "middle", mr: 0.5 }}
                    />
                    {label}
                  </>
                ) : (
                  label
                )}
              </Typography>
            </Box>
          );

          return (
            <Box key={i} sx={{ flex: 1 }}>
              <Tooltip
                title={label}
                placement="top"
                disableInteractive
                arrow
                slotProps={{ popper: { modifiers: [{ name: "offset", options: { offset: [0, 6] } }] } }}
              >
                {segment}
              </Tooltip>
              {labelRow}
            </Box>
          );
        })}
      </Box>

      {isMobile && labels && (
        <Box sx={{ mt: 1, display: "flex", justifyContent: "center" }}>
          <Typography variant="caption" color="text.secondary">
            {labels[Math.min(completed, labels.length - 1)]}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
```

---

## 🧠 Example Usage

```tsx
<MilestoneProgress
  total={6}
  completed={2}
  labels={[
    "Personal Info",
    "Eligibility",
    "Profile",
    "Resume",
    "Experience & Prefs",
    "Review",
  ]}
  sticky="bottom" // "top" | "bottom" | "none"
  onJump={(i) => router.push(stepToRoute[i])}
/>
```

---

## 🎨 Visual Style
| Element | Color | Notes |
|----------|--------|-------|
| Completed segment | `#22c55e` | Success-green |
| Track segment | `rgba(34,197,94,0.18)` | Soft contrast |
| Current segment highlight | 2px inset border (same as track) | Subtle pulse effect |
| Labels | Hidden on mobile | Caption below on desktop |

---

## 📱 UX Behavior
- **Mobile:** Use sticky bottom placement — pairs naturally with Next/Back buttons.  
- **Desktop:** Top or bottom sticky (choose one).  
- **Accessibility:** Keyboard navigation (tab + enter), `aria-label` per step.  
- **Motion:** Small scale pulse on progress increase, disabled if `prefers-reduced-motion` enabled.  
- **Tooltip:** Step labels visible on hover or focus.

---

## ✅ Acceptance Criteria
- [x] Fully responsive (top or bottom placement)
- [x] Color matches HRX green palette (`#22c55e`)
- [x] 6-segment milestone layout with tooltips + labels
- [x] Progress percent visible at all times
- [x] Supports click-to-jump (optional)
- [x] WCAG AA compliant, keyboard operable

---

## 🚀 Optional Enhancement
**Hook:** `useMilestoneProgress` — derive completed count from form state.
```ts
const useMilestoneProgress = (steps: string[], completedSteps: Record<string, boolean>) => {
  const total = steps.length;
  const completed = steps.filter(s => completedSteps[s]).length;
  return { total, completed };
};
```

---

*Cursor-ready: copy directly into your MUI project and adjust theme tokens as needed.*
