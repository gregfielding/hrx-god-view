/**
 * **F.4 (CC.A audit, locked 2026-04-30) — Default Gig settings.**
 *
 * Two seed fields stored on the National Account doc that the
 * `gigJobOrderFromChildAccount` builder consumes when auto-spawning
 * a draft Gig JO under an auto-created child account:
 *
 *   - `defaultGigJobTitle` — autocomplete from the global ONET title
 *     catalog (`src/data/onetJobTitles.json`). Free-text entry is
 *     allowed (a recruiter typing a title not in the catalog gets a
 *     small advisory notice).
 *   - `defaultGigJobDescription` — multi-line free-text textarea.
 *
 * Save semantics:
 *   - Title commits on `Autocomplete` `onChange` (i.e. the moment a
 *     user picks a value or presses Enter on free-text). Save-on-blur
 *     would feel wrong for a select-style control.
 *   - Description commits on blur (matches the dialog text-field
 *     pattern used elsewhere in this file).
 *
 * The component is render-only — the parent (`RecruiterAccountDetails`)
 * owns the gating (`accountType === 'national' && autoCreateGigJobOrders`)
 * and the persistence path (`updateAccountField`). That keeps this
 * component trivially testable with React Testing Library: feed in
 * `title`, `description`, and assert `onSaveTitle` / `onSaveDescription`
 * callbacks fire with the right values.
 */
import React, { useMemo } from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';

import jobTitlesData from '../../data/onetJobTitles.json';

interface DefaultGigSettingsProps {
  title: string;
  description: string;
  saving: boolean;
  onSaveTitle: (next: string) => void;
  onSaveDescription: (next: string) => void;
}

/**
 * Trim + collapse internal whitespace. Persisting whitespace-only or
 * trailing-space strings creates ugly diffs on the JO doc later, so we
 * normalize at the edge.
 */
function normalize(input: string | null | undefined): string {
  if (input == null) return '';
  return input.replace(/\s+/g, ' ').trim();
}

export const DefaultGigSettings: React.FC<DefaultGigSettingsProps> = ({
  title,
  description,
  saving,
  onSaveTitle,
  onSaveDescription,
}) => {
  const titleOptions = useMemo(() => jobTitlesData as string[], []);
  const trimmedTitle = title.trim();
  // Catalog membership is case-insensitive — recruiters often type
  // "warehouse associate" lowercase. We don't auto-normalize the
  // stored value (preserves recruiter casing intent) but we use this
  // flag to decide whether to show the "not in catalog" notice.
  const isInCatalog = useMemo(() => {
    if (trimmedTitle === '') return true;
    const needle = trimmedTitle.toLowerCase();
    return titleOptions.some((opt) => opt.toLowerCase() === needle);
  }, [trimmedTitle, titleOptions]);

  return (
    <Box
      data-testid="default-gig-settings"
      sx={{
        mt: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        // Keep the section visually anchored under the toggle row but
        // bounded so it doesn't push the header layout out of shape.
        maxWidth: { xs: '100%', sm: 480 },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography
          component="label"
          htmlFor="default-gig-job-title-input"
          sx={{ fontSize: '0.74rem', fontWeight: 500, color: 'text.secondary' }}
        >
          Default Gig Job Title
        </Typography>
        <Autocomplete
          freeSolo
          size="small"
          disabled={saving}
          options={titleOptions}
          value={trimmedTitle === '' ? null : trimmedTitle}
          // `onChange` fires when a user picks an option or presses
          // Enter on a typed value. `onInputChange` fires on every
          // keystroke — we use `onChange` so we only persist the
          // committed selection, not every interim character.
          onChange={(_, next) => {
            const value = normalize(typeof next === 'string' ? next : '');
            if (value !== trimmedTitle) {
              onSaveTitle(value);
            }
          }}
          // Save-on-blur for the free-text path: a recruiter who types
          // a title and tabs away expects it to stick, even though
          // they didn't press Enter. We compare against the stored
          // value to avoid duplicate writes.
          onBlur={(e) => {
            const v = normalize(
              (e.target as HTMLInputElement).value ?? '',
            );
            if (v !== trimmedTitle) onSaveTitle(v);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              id="default-gig-job-title-input"
              placeholder="e.g. Warehouse Associate"
              inputProps={{
                ...params.inputProps,
                'aria-label': 'Default gig job title',
              }}
            />
          )}
        />
        {trimmedTitle !== '' && !isInCatalog && (
          <Typography
            data-testid="default-gig-title-not-in-catalog"
            sx={{ fontSize: '0.7rem', color: 'warning.main' }}
          >
            This title isn’t in your catalog; consider adding it so it
            shows up across the rest of the system.
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography
          component="label"
          htmlFor="default-gig-job-description-input"
          sx={{ fontSize: '0.74rem', fontWeight: 500, color: 'text.secondary' }}
        >
          Default Gig Job Description
        </Typography>
        <TextField
          id="default-gig-job-description-input"
          size="small"
          fullWidth
          multiline
          rows={3}
          disabled={saving}
          defaultValue={description}
          // `defaultValue` + `onBlur` is the uncontrolled pattern other
          // text fields in `RecruiterAccountDetails` use. Re-keying on
          // the prop ensures incoming server values overwrite local
          // edits when a different account is loaded into the page.
          key={`gig-desc-${description}`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== description.trim()) onSaveDescription(v);
          }}
          inputProps={{ 'aria-label': 'Default gig job description' }}
          placeholder="What workers do on a typical shift. Recruiters can override per-JO on activation."
        />
      </Box>
      <Typography
        sx={{ fontSize: '0.7rem', color: 'text.secondary', lineHeight: 1.4 }}
      >
        These defaults apply to gig job orders auto-created for child
        accounts under this national account. Recruiters can override
        per-JO on activation.
      </Typography>
    </Box>
  );
};

export default DefaultGigSettings;
