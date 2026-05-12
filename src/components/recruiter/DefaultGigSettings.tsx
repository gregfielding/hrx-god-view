/**
 * **F.4 (CC.A audit, locked 2026-04-30) — Default Gig settings.**
 *
 * Two seed fields stored on the National Account doc that the
 * `gigJobOrderFromChildAccount` builder consumes when auto-spawning
 * a draft Gig JO under an auto-created child account:
 *
 *   - `defaultGigJobTitle` — on the account Cascading Data tab, chosen from
 *     **Default Positions** (`pricing.positions` job titles) via `gigJobTitleOptions`.
 *     When `gigJobTitleOptions` is omitted (tests / legacy), falls back to ONET
 *     Autocomplete with free solo.
 *   - `defaultGigJobDescription` — multi-line free-text textarea.
 *
 * Save semantics:
 *   - Title: Select commits on change; legacy Autocomplete on selection / blur.
 *   - When `positionJobDescriptionByTitle` is set (from Pricing positions), choosing a title
 *     fills and saves the matching client JD on the same change event.
 *   - Manual edits to the description textarea still commit on blur.
 */
import React, { useMemo } from 'react';
import {
  Autocomplete,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
  TextField,
  Typography,
} from '@mui/material';

import { useTenantJobTitleOptions } from '../../hooks/useTenantJobTitles';

interface DefaultGigSettingsProps {
  title: string;
  description: string;
  saving: boolean;
  /** When provided, title is a strict select of these strings (national default positions). */
  gigJobTitleOptions?: string[];
  /**
   * Lowercase job title → `jobDescriptionFromClient` from account `pricing.positions`.
   * Used when the user picks a title so the default gig description mirrors that row.
   */
  positionJobDescriptionByTitle?: Record<string, string>;
  onSaveTitle: (next: string) => void;
  onSaveDescription: (next: string) => void;
}

function normalize(input: string | null | undefined): string {
  if (input == null) return '';
  return input.replace(/\s+/g, ' ').trim();
}

export const DefaultGigSettings: React.FC<DefaultGigSettingsProps> = ({
  title,
  description,
  saving,
  gigJobTitleOptions,
  positionJobDescriptionByTitle,
  onSaveTitle,
  onSaveDescription,
}) => {
  const jobTitlesData = useTenantJobTitleOptions();
  const titleOptionsOnet = useMemo(() => jobTitlesData as string[], [jobTitlesData]);
  const trimmedTitle = title.trim();

  const mergedPositionTitleOptions = useMemo(() => {
    if (gigJobTitleOptions === undefined) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (s: string) => {
      const t = s.trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(t);
    };
    gigJobTitleOptions.forEach(push);
    push(trimmedTitle);
    return out.sort((a, b) => a.localeCompare(b));
  }, [gigJobTitleOptions, trimmedTitle]);

  const isInOnetCatalog = useMemo(() => {
    if (trimmedTitle === '') return true;
    const needle = trimmedTitle.toLowerCase();
    return titleOptionsOnet.some((opt) => opt.toLowerCase() === needle);
  }, [trimmedTitle, titleOptionsOnet]);

  const usePositionSelect = gigJobTitleOptions !== undefined;

  const applyDescriptionForTitle = (nextTitle: string) => {
    if (!positionJobDescriptionByTitle || Object.keys(positionJobDescriptionByTitle).length === 0) return;
    const nextDesc = nextTitle ? (positionJobDescriptionByTitle[nextTitle.toLowerCase()] ?? '') : '';
    if (nextDesc.trim() !== description.trim()) {
      onSaveDescription(nextDesc);
    }
  };

  const handleTitleSelectChange = (e: SelectChangeEvent<string>) => {
    const v = normalize(e.target.value);
    if (v === trimmedTitle) return;
    onSaveTitle(v);
    applyDescriptionForTitle(v);
  };

  return (
    <Box
      data-testid="default-gig-settings"
      sx={{
        mt: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        maxWidth: { xs: '100%', sm: 480 },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {usePositionSelect ? (
          <>
            <FormControl
              fullWidth
              size="small"
              disabled={saving}
              data-testid="default-gig-job-title-select"
            >
              <InputLabel id="default-gig-job-title-label">Default Gig Job Title</InputLabel>
              <Select
                labelId="default-gig-job-title-label"
                id="default-gig-job-title-select"
                label="Default Gig Job Title"
                value={mergedPositionTitleOptions.some((o) => o === trimmedTitle) ? trimmedTitle : ''}
                displayEmpty
                renderValue={(selected) =>
                  selected ? (
                    String(selected)
                  ) : (
                    <Typography component="span" sx={{ color: 'text.secondary' }}>
                      {mergedPositionTitleOptions.length === 0
                        ? 'Add default positions under Positions & Pricing first'
                        : 'Select a position'}
                    </Typography>
                  )
                }
                onChange={handleTitleSelectChange}
                inputProps={{ 'aria-label': 'Default gig job title' }}
              >
                <MenuItem value="">
                  <em>
                    {mergedPositionTitleOptions.length === 0
                      ? 'Add default positions under Positions & Pricing first'
                      : 'Select a position'}
                  </em>
                </MenuItem>
                {mergedPositionTitleOptions.map((opt) => (
                  <MenuItem key={opt} value={opt}>
                    {opt}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {gigJobTitleOptions.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
                Add titles in Positions &amp; Pricing above, then choose one here for auto-created gig job orders.
              </Typography>
            ) : null}
          </>
        ) : (
          <>
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
              options={titleOptionsOnet}
              value={trimmedTitle === '' ? null : trimmedTitle}
              onChange={(_, next) => {
                const value = normalize(typeof next === 'string' ? next : '');
                if (value !== trimmedTitle) {
                  onSaveTitle(value);
                  applyDescriptionForTitle(value);
                }
              }}
              onBlur={(e) => {
                const v = normalize((e.target as HTMLInputElement).value ?? '');
                if (v !== trimmedTitle) {
                  onSaveTitle(v);
                  applyDescriptionForTitle(v);
                }
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
            {trimmedTitle !== '' && !isInOnetCatalog && (
              <Typography
                data-testid="default-gig-title-not-in-catalog"
                sx={{ fontSize: '0.7rem', color: 'warning.main' }}
              >
                This title isn’t in your catalog; consider adding it so it shows up across the rest of the system.
              </Typography>
            )}
          </>
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
          key={`gig-desc-${description}`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== description.trim()) onSaveDescription(v);
          }}
          inputProps={{ 'aria-label': 'Default gig job description' }}
          placeholder="What workers do on a typical shift. Recruiters can override per-JO on activation."
        />
      </Box>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', lineHeight: 1.4 }}>
        These defaults apply to gig job orders auto-created for child accounts under this national account. Recruiters
        can override per-JO on activation.
      </Typography>
    </Box>
  );
};

export default DefaultGigSettings;
