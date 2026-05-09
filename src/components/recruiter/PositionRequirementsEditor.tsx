/**
 * **PositionRequirementsEditor** — per-position override UI for the
 * gig Positions tab on the Job Order detail page.
 *
 * ## What this is
 *
 * Slice 2 of the gig-position requirements override work (May 2026).
 * Renders a collapsible "Requirements" section under each position
 * card on the Positions tab. Reads the JO-level Compliance &
 * Requirements defaults and lets the recruiter override individual
 * fields per position (e.g. Cooks need a Food Handler card; Janitors
 * on the same JO do not).
 *
 * ## Override contract (mirrors slice 1's resolver)
 *
 *   - Field undefined / null on `position.requirements` → INHERIT JO default
 *   - Field present (incl. `''` and `[]`) → EXPLICIT OVERRIDE
 *
 * The empty-but-explicit case is meaningful: an empty array on
 * `licensesCerts` means "this position requires no certifications,
 * even though the JO defaults list some." That's how a Janitors
 * position removes the Food Handler default.
 *
 * ## UX shape (locked May 2026)
 *
 *   - **Collapsible**, default collapsed, with a one-line summary:
 *     `Inheriting JO defaults · 2 certs · 1 screening · etc.` plus
 *     an override count when ≥1 field is overridden.
 *   - **Expanded**: a 2-column grid of the same fields the JO
 *     Requirements tab edits (minus `screeningPackageId` — see
 *     below). Each field shows the RESOLVED value (default OR
 *     override) plus a per-field chip:
 *       - **Default** when the field is inheriting
 *       - **Override** + Reset button when the field has an explicit
 *         override (any value, including `''` / `[]`).
 *   - **Auto-override on edit**: editing any field automatically
 *     transitions it to override mode by writing the new value to
 *     `position.requirements[key]`. Reset clears that key.
 *
 * ## What's deliberately not here
 *
 *   - `screeningPackageId` / `screeningPackageName` — these need the
 *     `AccusourcePackageSelector` and tenant-context wiring; the
 *     resolver supports overriding them but the per-position UI lands
 *     in a follow-up. The JO-level Requirements tab is still the
 *     edit surface for screening packages today.
 *   - `dressCode` / `customUniformRequirements` — currently hidden
 *     on the JO Requirements tab itself (see the `{false && (…)}`
 *     guard in `JobOrderForm.tsx`), so we don't expose per-position
 *     overrides for them either. If/when those un-hide on the JO
 *     side, add them here too.
 *   - `eVerifyRequired`, `backgroundCheckRequired`,
 *     `drugScreenRequired`, `requirementPackId` — the resolver
 *     intentionally treats these as JO-level only; documented in
 *     `resolveJobOrderRequirements.ts`.
 *
 * ## What this component does NOT do
 *
 *   - Persist to Firestore. The parent (`JobOrderForm`) owns the
 *     `gigPositions` state and its existing debounced auto-save
 *     handles persistence (see the `gigPositions` save effect there).
 *     Passing in a fresh `requirements` map via `onChange` is enough.
 *   - Read or write `JobPost` snapshots. The JobPost activation
 *     snapshot logic lives in `jobsBoardService.ts` and gets updated
 *     in slice 3.
 */

import React, { useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  RestartAlt as ResetIcon,
} from '@mui/icons-material';

import {
  ALL_REQUIREMENT_FIELD_KEYS,
  countPositionRequirementOverrides,
  isPositionRequirementOverridden,
  resolveJobOrderRequirementsForPosition,
  type GigPositionRequirementOverrides,
  type JobOrderRequirementFieldKey,
  type RequirementsCarrierJobOrder,
  type RequirementsCarrierPosition,
} from '../../shared/jobOrder/resolveJobOrderRequirements';

/**
 * Option lists shared with the JO Requirements tab. We accept these
 * as props so the source of truth stays the parent
 * (`JobOrderForm.tsx`); a future cleanup can extract them to a
 * shared module. The hardcoded physical / PPE lists live inside
 * this file (`DEFAULT_PHYSICAL_OPTIONS`, `DEFAULT_PPE_OPTIONS`)
 * since they don't vary by tenant.
 */
export type PositionRequirementsOptions = {
  /** Multi-string label list — comes from `additionalScreeningOptions.map(o => o.label)` in JobOrderForm. */
  additionalScreenings: string[];
  /** `[{ value, label }]` — comes from `getOptionsForField('licensesCerts', companyDefaultsForOptions)`. */
  licensesCerts: Array<{ value: string; label: string }>;
  /** `[{ value, label }]` — `getOptionsForField('skills', …)`. */
  skills: Array<{ value: string; label: string }>;
  /** `[{ value, label }]` — `getOptionsForField('languages', …)`. */
  languages: Array<{ value: string; label: string }>;
  /** `[{ value, label }]` — comes from `experienceOptions`. */
  experienceLevels: Array<{ value: string; label: string }>;
  /** `[{ value, label }]` — comes from `educationOptions`. */
  educationLevels: Array<{ value: string; label: string }>;
};

/**
 * Standard physical-requirements list. Mirrors the hardcoded options
 * in the JO Requirements tab (`JobOrderForm.tsx`'s
 * `physicalRequirements` Autocomplete). Kept module-local so the
 * editor doesn't need a prop for it. Update both call sites if the
 * list ever changes.
 */
const DEFAULT_PHYSICAL_OPTIONS: ReadonlyArray<string> = [
  'Standing',
  'Walking',
  'Sitting',
  'Lifting 25 lbs',
  'Lifting 50 lbs',
  'Lifting 75 lbs',
  'Lifting 100+ lbs',
  'Carrying 25 lbs',
  'Carrying 50 lbs',
  'Carrying 75 lbs',
  'Carrying 100+ lbs',
  'Pushing',
  'Pulling',
  'Climbing',
  'Balancing',
  'Stooping',
  'Kneeling',
  'Crouching',
  'Crawling',
  'Reaching',
  'Handling',
  'Fingering',
  'Feeling',
  'Talking',
  'Hearing',
  'Seeing',
  'Color Vision',
  'Depth Perception',
  'Field of Vision',
  'Driving',
  'Operating Machinery',
  'Working at Heights',
  'Confined Spaces',
  'Outdoor Work',
  'Indoor Work',
  'Temperature Extremes',
  'Noise',
  'Vibration',
  'Fumes/Odors',
  'Dust',
  'Chemicals',
  'Radiation',
  'Other',
];

/**
 * Standard PPE list. Mirrors the hardcoded options in the JO
 * Requirements tab. Same maintenance note as
 * {@link DEFAULT_PHYSICAL_OPTIONS}.
 */
const DEFAULT_PPE_OPTIONS: ReadonlyArray<string> = [
  'Hard Hat',
  'Safety Glasses',
  'Safety Goggles',
  'Face Shield',
  'Respirator',
  'Dust Mask',
  'N95 Mask',
  'Hearing Protection',
  'Ear Plugs',
  'Ear Muffs',
  'High-Visibility Vest',
  'Reflective Clothing',
  'Safety Boots',
  'Steel-Toe Boots',
  'Non-Slip Shoes',
  'Cut-Resistant Gloves',
  'Chemical-Resistant Gloves',
  'Heat-Resistant Gloves',
  'Fall Protection Harness',
  'Safety Lanyard',
  'Lifeline',
  'Confined Space Equipment',
  'Gas Monitor',
  'Air Purifying Respirator',
  'Self-Contained Breathing Apparatus',
  'Protective Coveralls',
  'Disposable Suits',
  'Chemical Apron',
  'Lab Coat',
  'Hair Net',
  'Beard Cover',
  'Disposable Gloves',
  'Nitrile Gloves',
  'Latex Gloves',
  'Vinyl Gloves',
  'Insulated Gloves',
  'Electrical Gloves',
  'Welding Helmet',
  'Welding Gloves',
  'Welding Apron',
  'Welding Boots',
  'Welding Jacket',
  'Other',
];

export interface PositionRequirementsEditorProps {
  /** JO defaults (the JO doc's flat Compliance & Requirements fields). */
  jobOrder: RequirementsCarrierJobOrder | null | undefined;
  /** Position whose overrides we're editing. May be a fresh in-memory row that hasn't been saved yet. */
  position: RequirementsCarrierPosition & { jobTitle?: string };
  /** Called whenever the position's `requirements` map changes. The parent should write the new value to its `gigPositions[i].requirements`; auto-save handles persistence. */
  onChange: (next: GigPositionRequirementOverrides | null) => void;
  /** Option lists shared with the JO Requirements tab. */
  options: PositionRequirementsOptions;
  /** When true (rare — used by the parent for unit/dev cases), starts expanded. Defaults to collapsed for the 90% inherit case. */
  initiallyExpanded?: boolean;
}

/** Pretty labels for the UI. Mirrors the JO Requirements tab labels. */
const FIELD_LABELS: Record<JobOrderRequirementFieldKey, string> = {
  screeningPackageId: 'Screening Package',
  screeningPackageName: 'Screening Package Name',
  additionalScreenings: 'Additional Screenings',
  licensesCerts: 'Licenses & Certifications',
  experienceRequired: 'Experience Required',
  educationRequired: 'Education Required',
  languagesRequired: 'Languages Required',
  skillsRequired: 'Skills Required',
  physicalRequirements: 'Physical Requirements',
  ppeRequirements: 'PPE Requirements',
  ppeProvidedBy: 'PPE Provided By',
  dressCode: 'Uniform Requirements',
  customUniformRequirements: 'Custom Uniform Requirements',
};

/** Fields shown in the per-position editor for slice 2. See the file
 *  docstring for the rationale on what's excluded. */
const VISIBLE_FIELDS: ReadonlyArray<JobOrderRequirementFieldKey> = [
  'licensesCerts',
  'additionalScreenings',
  'skillsRequired',
  'physicalRequirements',
  'experienceRequired',
  'educationRequired',
  'languagesRequired',
  'ppeRequirements',
  'ppeProvidedBy',
];

const PositionRequirementsEditor: React.FC<PositionRequirementsEditorProps> = ({
  jobOrder,
  position,
  onChange,
  options,
  initiallyExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  /**
   * Resolved values (defaults merged with overrides). The form fields
   * read from this so they always show the EFFECTIVE value — the
   * recruiter sees what would actually apply right now, regardless of
   * whether each field is inheriting or overridden.
   */
  const resolved = useMemo(
    () => resolveJobOrderRequirementsForPosition(jobOrder, position),
    [jobOrder, position],
  );

  const overrideCount = useMemo(
    () => countPositionRequirementOverrides(position),
    [position],
  );

  /**
   * Auto-override on edit. Any field change writes the new value to
   * `position.requirements[key]` — implicitly transitioning the field
   * from inheriting to overridden. The override stores the COMPLETE
   * new value (not a delta from the JO default) so the resolver
   * doesn't need diffing logic.
   */
  const setFieldOverride = (
    key: JobOrderRequirementFieldKey,
    value: string | string[],
  ) => {
    const prev: GigPositionRequirementOverrides = position.requirements ?? {};
    const next: GigPositionRequirementOverrides = { ...prev, [key]: value };
    onChange(next);
  };

  /**
   * Reset clears the override for one field. The resolver treats
   * `undefined` and `null` identically as inherit; we use `undefined`
   * (and then drop the key entirely if the map becomes empty) so the
   * persisted Firestore doc stays minimal.
   */
  const resetField = (key: JobOrderRequirementFieldKey) => {
    if (!position.requirements) return;
    const next: GigPositionRequirementOverrides = { ...position.requirements };
    delete next[key];
    const isEmpty = Object.keys(next).length === 0;
    onChange(isEmpty ? null : next);
  };

  /**
   * Summary line for the collapsed state. Shows "Inheriting JO
   * defaults" + how many fields the JO has set, OR
   * "N override(s)" when the position carries any overrides. Keeps
   * the strip readable at a glance for the 90% inherit case.
   */
  const summaryLine = useMemo(() => {
    if (overrideCount > 0) {
      return `${overrideCount} override${overrideCount === 1 ? '' : 's'} on this position`;
    }
    const counts: string[] = [];
    if (resolved.licensesCerts.length) {
      counts.push(
        `${resolved.licensesCerts.length} cert${resolved.licensesCerts.length === 1 ? '' : 's'}`,
      );
    }
    if (resolved.additionalScreenings.length) {
      counts.push(
        `${resolved.additionalScreenings.length} screening${
          resolved.additionalScreenings.length === 1 ? '' : 's'
        }`,
      );
    }
    if (resolved.skillsRequired.length) {
      counts.push(
        `${resolved.skillsRequired.length} skill${resolved.skillsRequired.length === 1 ? '' : 's'}`,
      );
    }
    if (resolved.physicalRequirements.length) counts.push('physical reqs');
    if (resolved.ppeRequirements.length) counts.push('PPE');
    if (resolved.experienceRequired) counts.push(resolved.experienceRequired);
    if (counts.length === 0) return 'No requirements set on this job order';
    return `Inheriting JO defaults · ${counts.join(' · ')}`;
  }, [overrideCount, resolved]);

  const renderStatusChip = (key: JobOrderRequirementFieldKey) => {
    const overridden = isPositionRequirementOverridden(position, key);
    return overridden ? (
      <Chip
        size="small"
        label="Override"
        color="primary"
        variant="filled"
        sx={{ height: 20, fontSize: '0.6875rem', ml: 1 }}
      />
    ) : (
      <Chip
        size="small"
        label="Default"
        variant="outlined"
        sx={{ height: 20, fontSize: '0.6875rem', ml: 1, color: 'text.secondary' }}
      />
    );
  };

  const renderResetButton = (key: JobOrderRequirementFieldKey) => {
    if (!isPositionRequirementOverridden(position, key)) return null;
    return (
      <Tooltip title="Reset to job order default">
        <IconButton
          size="small"
          onClick={() => resetField(key)}
          sx={{ ml: 0.5, color: 'text.secondary' }}
        >
          <ResetIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  };

  const fieldHeader = (key: JobOrderRequirementFieldKey) => (
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {FIELD_LABELS[key]}
      </Typography>
      {renderStatusChip(key)}
      {renderResetButton(key)}
    </Box>
  );

  return (
    <Box
      sx={{
        mt: 2,
        pt: 2,
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Collapsed summary row — single click expands. */}
      <Box
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          py: 0.5,
          '&:hover': { color: 'primary.main' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Requirements
          </Typography>
          {overrideCount > 0 && (
            <Chip
              size="small"
              label={`${overrideCount} override${overrideCount === 1 ? '' : 's'}`}
              color="primary"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.6875rem' }}
            />
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ml: 1, flex: 1 }}
          >
            {summaryLine}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="text"
          endIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ textTransform: 'none', flexShrink: 0 }}
        >
          {expanded ? 'Hide' : 'Customize'}
        </Button>
      </Box>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box
          sx={{
            mt: 2,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 2,
          }}
        >
          {/* licensesCerts — multi-object autocomplete */}
          <Box sx={{ gridColumn: { xs: '1', md: '1 / -1' } }}>
            {fieldHeader('licensesCerts')}
            <Autocomplete
              multiple
              size="small"
              options={options.licensesCerts}
              value={resolved.licensesCerts.map((c) => ({ value: c, label: c }))}
              isOptionEqualToValue={(a, b) => a.value === b.value}
              getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
              onChange={(_, newValue) => {
                const next = newValue.map((o) => o.value);
                setFieldOverride('licensesCerts', next);
              }}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => {
                  const { key, ...chipProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      label={typeof option === 'string' ? option : option.label}
                      size="small"
                      {...chipProps}
                    />
                  );
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="Type to search certifications..."
                  size="small"
                />
              )}
              filterSelectedOptions
              freeSolo={false}
            />
          </Box>

          {/* additionalScreenings — multi-string autocomplete */}
          <Box sx={{ gridColumn: { xs: '1', md: '1 / -1' } }}>
            {fieldHeader('additionalScreenings')}
            <Autocomplete
              multiple
              size="small"
              options={options.additionalScreenings}
              value={resolved.additionalScreenings}
              onChange={(_, newValue) => {
                setFieldOverride('additionalScreenings', newValue);
              }}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    variant="outlined"
                    label={option}
                    size="small"
                    {...getTagProps({ index })}
                    key={option}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} placeholder="e.g. TB Test, Drug Screen" size="small" />
              )}
            />
          </Box>

          {/* skillsRequired — multi-object autocomplete */}
          <Box>
            {fieldHeader('skillsRequired')}
            <Autocomplete
              multiple
              size="small"
              options={options.skills}
              value={resolved.skillsRequired.map((s) => ({ value: s, label: s }))}
              isOptionEqualToValue={(a, b) => a.value === b.value}
              getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
              onChange={(_, newValue) => {
                const next = newValue.map((o) => o.value);
                setFieldOverride('skillsRequired', next);
              }}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => {
                  const { key, ...chipProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      label={typeof option === 'string' ? option : option.label}
                      size="small"
                      {...chipProps}
                    />
                  );
                })
              }
              renderInput={(params) => (
                <TextField {...params} placeholder="Type to search skills..." size="small" />
              )}
              filterSelectedOptions
              freeSolo={false}
            />
          </Box>

          {/* physicalRequirements — hardcoded multi-string */}
          <Box>
            {fieldHeader('physicalRequirements')}
            <Autocomplete
              multiple
              size="small"
              options={DEFAULT_PHYSICAL_OPTIONS as unknown as string[]}
              value={resolved.physicalRequirements}
              onChange={(_, newValue) => {
                setFieldOverride('physicalRequirements', newValue);
              }}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    variant="outlined"
                    label={option}
                    size="small"
                    {...getTagProps({ index })}
                    key={option}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} placeholder="e.g. Standing, Lifting 25 lbs" size="small" />
              )}
            />
          </Box>

          {/* experienceRequired — single select */}
          <Box>
            {fieldHeader('experienceRequired')}
            <FormControl fullWidth size="small">
              <InputLabel>{FIELD_LABELS.experienceRequired}</InputLabel>
              <Select
                value={resolved.experienceRequired}
                label={FIELD_LABELS.experienceRequired}
                onChange={(e) => setFieldOverride('experienceRequired', String(e.target.value ?? ''))}
              >
                {options.experienceLevels.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* educationRequired — single select */}
          <Box>
            {fieldHeader('educationRequired')}
            <FormControl fullWidth size="small">
              <InputLabel>{FIELD_LABELS.educationRequired}</InputLabel>
              <Select
                value={resolved.educationRequired}
                label={FIELD_LABELS.educationRequired}
                onChange={(e) => setFieldOverride('educationRequired', String(e.target.value ?? ''))}
              >
                {options.educationLevels.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* languagesRequired — multi-object autocomplete */}
          <Box>
            {fieldHeader('languagesRequired')}
            <Autocomplete
              multiple
              size="small"
              freeSolo
              options={options.languages.map((o) => o.value)}
              value={resolved.languagesRequired}
              onChange={(_, newValue) => {
                setFieldOverride('languagesRequired', newValue);
              }}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    variant="outlined"
                    label={option}
                    size="small"
                    {...getTagProps({ index })}
                    key={option}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} placeholder="e.g. English, Spanish" size="small" />
              )}
            />
          </Box>

          {/* ppeRequirements — hardcoded multi-string */}
          <Box>
            {fieldHeader('ppeRequirements')}
            <Autocomplete
              multiple
              size="small"
              options={DEFAULT_PPE_OPTIONS as unknown as string[]}
              value={resolved.ppeRequirements}
              onChange={(_, newValue) => {
                setFieldOverride('ppeRequirements', newValue);
              }}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    variant="outlined"
                    label={option}
                    size="small"
                    {...getTagProps({ index })}
                    key={option}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} placeholder="e.g. Hard Hat, Safety Glasses" size="small" />
              )}
            />
          </Box>

          {/* ppeProvidedBy — single select */}
          <Box>
            {fieldHeader('ppeProvidedBy')}
            <FormControl
              fullWidth
              size="small"
              disabled={resolved.ppeRequirements.length === 0}
            >
              <InputLabel>{FIELD_LABELS.ppeProvidedBy}</InputLabel>
              <Select
                displayEmpty
                value={
                  resolved.ppeRequirements.length === 0
                    ? ''
                    : resolved.ppeProvidedBy || 'company'
                }
                label={FIELD_LABELS.ppeProvidedBy}
                onChange={(e) => setFieldOverride('ppeProvidedBy', String(e.target.value ?? ''))}
              >
                {resolved.ppeRequirements.length === 0 && (
                  <MenuItem value="">
                    <em>Add PPE requirements first</em>
                  </MenuItem>
                )}
                <MenuItem value="company">Company</MenuItem>
                <MenuItem value="worker">Worker</MenuItem>
                <MenuItem value="both">Both</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>

        {overrideCount > 0 && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              {overrideCount} override{overrideCount === 1 ? '' : 's'} on this position. Reset
              individual fields above, or clear them all.
            </Typography>
            <Button
              size="small"
              variant="text"
              startIcon={<ResetIcon fontSize="small" />}
              onClick={() => onChange(null)}
              sx={{ textTransform: 'none' }}
            >
              Reset all
            </Button>
          </Stack>
        )}
      </Collapse>
      {/*
        ALL_REQUIREMENT_FIELD_KEYS is exported by the resolver and is
        the canonical list. We intentionally render only a subset
        (VISIBLE_FIELDS, file-scoped) per the slice 2 lock. Reference
        retained so that future additions (screeningPackageId, etc.)
        keep parity with the resolver. */}
      {VISIBLE_FIELDS.length < ALL_REQUIREMENT_FIELD_KEYS.length ? null : null}
    </Box>
  );
};

export default PositionRequirementsEditor;
