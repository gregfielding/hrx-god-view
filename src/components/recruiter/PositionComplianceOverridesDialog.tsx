/**
 * Per default position: optional compliance & screening overrides stored on
 * `pricing.positions[i].orderDetails` (+ optional screening package fields on the row).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import type { AccountPositionPricing, RecruiterAccount } from '../../types/recruiter/account';
import type { RecruiterOrderDetailsData } from '../../utils/recruiterOrderDetailsMergePure';
import {
  EMPTY_RECRUITER_ORDER_DETAILS,
  mergeRecruiterOrderDetails,
} from '../../utils/recruiterOrderDetailsMergePure';
import { mergeScreeningPackageFromOrderDefaultLayers } from '../../utils/recruiterAccountOrderDefaultsMerge';
import { getOptionsForField } from '../../utils/fieldOptions';
import { additionalScreeningOptions } from '../../data/screeningsOptions';
import onetSkills from '../../data/onetSkills.json';
import { experienceOptions, educationOptions } from '../../data/experienceOptions';
import { getRequirementPackIds, JOB_REQUIREMENT_PACKS } from '../../data/jobRequirementPacks';
import { AccusourcePackageSelector } from './AccusourcePackageSelector';

const PHYSICAL_OPTIONS = [
  'Standing',
  'Walking',
  'Sitting',
  'Lifting 25 lbs',
  'Lifting 50 lbs',
  'Lifting 75 lbs',
  'Lifting 100+ lbs',
  'Carrying 25 lbs',
  'Carrying 50 lbs',
  'Pushing',
  'Pulling',
  'Climbing',
  'Reaching',
  'Handling',
  'Outdoor Work',
  'Indoor Work',
  'Other',
];
const PPE_OPTIONS = [
  'Hard Hat',
  'Safety Glasses',
  'Steel-Toe Boots',
  'High-Visibility Vest',
  'Hearing Protection',
  'Respirator',
  'Other',
];
const DRESS_CODE_OPTIONS = [
  'Business Casual',
  'Casual',
  'Uniform Provided',
  'Steel-Toe Boots',
  'Non-Slip Shoes',
  'Scrubs',
  'Other',
];

const SKILL_OPTIONS = onetSkills.map((s) => s.name);

function mergeFormState(base: RecruiterOrderDetailsData, raw?: Partial<RecruiterOrderDetailsData>): RecruiterOrderDetailsData {
  return {
    ...EMPTY_RECRUITER_ORDER_DETAILS,
    ...base,
    ...raw,
    backgroundCheckPackages: raw?.backgroundCheckPackages ?? base.backgroundCheckPackages ?? [],
    drugScreeningPanels: raw?.drugScreeningPanels ?? base.drugScreeningPanels ?? [],
    additionalScreenings: raw?.additionalScreenings ?? base.additionalScreenings ?? [],
    licensesCerts: raw?.licensesCerts ?? base.licensesCerts ?? [],
    languagesRequired: raw?.languagesRequired ?? base.languagesRequired ?? [],
    skillsRequired: raw?.skillsRequired ?? base.skillsRequired ?? [],
    physicalRequirements: raw?.physicalRequirements ?? base.physicalRequirements ?? [],
    ppeRequirements: raw?.ppeRequirements ?? base.ppeRequirements ?? [],
    dressCode: raw?.dressCode ?? base.dressCode ?? [],
  };
}

/** Persist only non-empty overrides; returns undefined if nothing to store. */
export function compactPositionOrderDetailsForSave(
  od: RecruiterOrderDetailsData,
): Partial<RecruiterOrderDetailsData> | undefined {
  const out: Partial<RecruiterOrderDetailsData> = {};

  const strArrays: (keyof RecruiterOrderDetailsData)[] = [
    'backgroundCheckPackages',
    'drugScreeningPanels',
    'additionalScreenings',
    'licensesCerts',
    'languagesRequired',
    'skillsRequired',
    'physicalRequirements',
    'ppeRequirements',
    'dressCode',
  ];
  for (const k of strArrays) {
    const v = od[k];
    if (Array.isArray(v) && v.length > 0) {
      (out as Record<string, unknown>)[k as string] = [...v];
    }
  }

  const trimStr = (s: string | undefined) => (typeof s === 'string' ? s.trim() : '');
  if (trimStr(od.experienceRequired)) out.experienceRequired = od.experienceRequired!.trim();
  if (trimStr(od.educationRequired)) out.educationRequired = od.educationRequired!.trim();
  if (trimStr(od.customUniformRequirements)) out.customUniformRequirements = od.customUniformRequirements!.trim();
  if (trimStr(od.decisionMaker)) out.decisionMaker = od.decisionMaker!.trim();
  if (trimStr(od.requirementPackId)) out.requirementPackId = od.requirementPackId!.trim();

  const contactKeys = [
    'hrContactId',
    'operationsContactId',
    'procurementContactId',
    'billingContactId',
    'safetyContactId',
    'invoiceContactId',
  ] as const;
  for (const k of contactKeys) {
    if (trimStr(od[k])) out[k] = od[k]!.trim();
  }

  const pe = od.ppeProvidedBy;
  if (Array.isArray(od.ppeRequirements) && od.ppeRequirements.length > 0) {
    if (pe === 'company' || pe === 'worker' || pe === 'both') {
      out.ppeProvidedBy = pe;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/** Fields to persist on the position row only when they differ from account Order Defaults (inherit otherwise). */
function diffOrderDetailsVsAccountDefaults(
  form: RecruiterOrderDetailsData,
  accountBase: RecruiterOrderDetailsData,
): Partial<RecruiterOrderDetailsData> | undefined {
  const arrayKeys: (keyof RecruiterOrderDetailsData)[] = [
    'backgroundCheckPackages',
    'drugScreeningPanels',
    'additionalScreenings',
    'licensesCerts',
    'languagesRequired',
    'skillsRequired',
    'physicalRequirements',
    'ppeRequirements',
    'dressCode',
  ];
  const strKeys: (keyof RecruiterOrderDetailsData)[] = [
    'experienceRequired',
    'educationRequired',
    'customUniformRequirements',
    'decisionMaker',
    'hrContactId',
    'operationsContactId',
    'procurementContactId',
    'billingContactId',
    'safetyContactId',
    'invoiceContactId',
  ];
  const arrEq = (a?: string[], b?: string[]) =>
    JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
  const trimEq = (a?: string, b?: string) =>
    String(a ?? '').trim() === String(b ?? '').trim();

  const out: Partial<RecruiterOrderDetailsData> = {};
  for (const k of arrayKeys) {
    if (!arrEq(form[k] as string[], accountBase[k] as string[])) {
      (out as Record<string, unknown>)[k as string] = form[k];
    }
  }
  for (const k of strKeys) {
    if (!trimEq(form[k] as string | undefined, accountBase[k] as string | undefined)) {
      (out as Record<string, unknown>)[k as string] = form[k];
    }
  }
  const pe = form.ppeProvidedBy;
  const be = accountBase.ppeProvidedBy;
  const formPpe = pe === 'company' || pe === 'worker' || pe === 'both' ? pe : '';
  const basePpe = be === 'company' || be === 'worker' || be === 'both' ? be : 'company';
  const formHasPpe = Array.isArray(form.ppeRequirements) && form.ppeRequirements.length > 0;
  if (formHasPpe && formPpe !== basePpe) {
    out.ppeProvidedBy = pe;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface PositionComplianceOverridesDialogProps {
  open: boolean;
  jobTitle: string;
  /** Raw stored row (`pricing.positions[i]`). */
  sourceRow: AccountPositionPricing;
  /**
   * Cascade-merged row for this title (national template + child), matching Default Positions display.
   * When set, seeds screening/uniform/orderDetails from template + account defaults.
   */
  mergedPricingRow?: AccountPositionPricing | null;
  account: RecruiterAccount | null;
  /** National parent — merged into account Order Defaults for seeding. */
  inheritanceParentAccount?: RecruiterAccount | null;
  onClose: () => void;
  /** Apply patches to state; parent persists via “Save default positions”. */
  onApply: (patch: Partial<AccountPositionPricing>) => void;
}

export function PositionComplianceOverridesDialog({
  open,
  jobTitle,
  sourceRow,
  mergedPricingRow = null,
  account,
  inheritanceParentAccount,
  onClose,
  onApply,
}: PositionComplianceOverridesDialogProps) {
  const emptyCompany = useMemo(() => ({}), []);

  const accountMergedOrderDetails = useMemo(() => {
    const acc = account?.orderDefaults?.orderDetails as RecruiterOrderDetailsData | undefined;
    const par = inheritanceParentAccount?.orderDefaults?.orderDetails as
      | RecruiterOrderDetailsData
      | undefined;
    return inheritanceParentAccount
      ? mergeRecruiterOrderDetails(acc, par)
      : mergeRecruiterOrderDetails(undefined, acc);
  }, [account, inheritanceParentAccount]);

  const accountScreeningDefault = useMemo(
    () =>
      mergeScreeningPackageFromOrderDefaultLayers(
        undefined,
        account?.orderDefaults as Record<string, unknown> | undefined,
        inheritanceParentAccount?.orderDefaults as Record<string, unknown> | undefined,
      ),
    [account, inheritanceParentAccount],
  );

  /** Effective compliance for this title: position template (national+child) over account Order Defaults + uniform text. */
  const seededOrderDetails = useMemo(() => {
    const row = mergedPricingRow ?? sourceRow;
    const posOd = row.orderDetails as RecruiterOrderDetailsData | undefined;
    const merged = mergeRecruiterOrderDetails(posOd, accountMergedOrderDetails);
    /** Job Score pack is position-row only — never inherit account Order Defaults. */
    const requirementPackFromPositionOnly = String(posOd?.requirementPackId ?? '').trim();
    const ur = String(row.uniformRequirements ?? '').trim();
    const withPack = { ...merged, requirementPackId: requirementPackFromPositionOnly };
    if (ur && !String(withPack.customUniformRequirements ?? '').trim()) {
      return { ...withPack, customUniformRequirements: ur };
    }
    return withPack;
  }, [mergedPricingRow, sourceRow, accountMergedOrderDetails]);

  const seededScreeningPackageId = useMemo(() => {
    const row = mergedPricingRow ?? sourceRow;
    const pid = String(row.screeningPackageId ?? '').trim();
    return pid || accountScreeningDefault.id;
  }, [mergedPricingRow, sourceRow, accountScreeningDefault.id]);

  const seededScreeningPackageName = useMemo(() => {
    const row = mergedPricingRow ?? sourceRow;
    const pid = String(row.screeningPackageId ?? '').trim();
    return pid ? String(row.screeningPackageName ?? '').trim() : accountScreeningDefault.name;
  }, [mergedPricingRow, sourceRow, accountScreeningDefault.name]);
  const additionalOptions = useMemo(
    () =>
      getOptionsForField('additionalScreenings', emptyCompany).length > 0
        ? getOptionsForField('additionalScreenings', emptyCompany)
        : additionalScreeningOptions.map((o) => ({ value: o.value, label: o.label })),
    [emptyCompany],
  );
  const licenseOptions = useMemo(() => getOptionsForField('licensesCerts', emptyCompany), [emptyCompany]);

  const [form, setForm] = useState<RecruiterOrderDetailsData>(() =>
    mergeFormState(EMPTY_RECRUITER_ORDER_DETAILS, seededOrderDetails),
  );
  const [screeningPackageId, setScreeningPackageId] = useState('');
  const [screeningPackageName, setScreeningPackageName] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(mergeFormState(EMPTY_RECRUITER_ORDER_DETAILS, seededOrderDetails));
    setScreeningPackageId(seededScreeningPackageId);
    setScreeningPackageName(seededScreeningPackageName);
  }, [
    open,
    seededOrderDetails,
    seededScreeningPackageId,
    seededScreeningPackageName,
    sourceRow,
    mergedPricingRow,
    accountMergedOrderDetails,
  ]);

  const update = (patch: Partial<RecruiterOrderDetailsData>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const hasPpe = Array.isArray(form.ppeRequirements) && form.ppeRequirements.length > 0;

  const handleSave = () => {
    const storedOd = sourceRow.orderDetails as RecruiterOrderDetailsData | undefined;
    const storedPack = String(storedOd?.requirementPackId ?? '').trim();
    const formPack = String(form.requirementPackId ?? '').trim();

    let diffRaw = diffOrderDetailsVsAccountDefaults(form, accountMergedOrderDetails) ?? {};
    if (formPack !== storedPack) {
      diffRaw = { ...diffRaw, requirementPackId: formPack };
    }

    let compactOd = compactPositionOrderDetailsForSave(
      mergeFormState(EMPTY_RECRUITER_ORDER_DETAILS, diffRaw),
    );
    // Clearing pack must persist — compact skips empty strings.
    if (formPack !== storedPack && !formPack) {
      compactOd = { ...(compactOd ?? {}) };
      (compactOd as Record<string, unknown>).requirementPackId = null;
    }
    const sid = screeningPackageId.trim();
    const acctSid = accountScreeningDefault.id.trim();
    const acctSname = accountScreeningDefault.name.trim();
    const nameTrim = screeningPackageName.trim();
    const matchesAccountScreening =
      (!sid && !acctSid) ||
      (sid === acctSid && (nameTrim === acctSname || (!nameTrim && !acctSname)));

    const patch: Partial<AccountPositionPricing> = {
      orderDetails: compactOd ?? {},
    };
    if (matchesAccountScreening) {
      patch.screeningPackageId = null;
      patch.screeningPackageName = null;
    } else if (sid) {
      patch.screeningPackageId = sid;
      patch.screeningPackageName = nameTrim;
    } else {
      patch.screeningPackageId = null;
      patch.screeningPackageName = null;
    }
    onApply(patch);
    onClose();
  };

  const handleClearOverrides = () => {
    onApply({
      orderDetails: {},
      screeningPackageId: null,
      screeningPackageName: null,
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle>Compliance overrides — {jobTitle || 'Position'}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Fields show effective defaults (account Order Defaults and national position template when applicable). Only
          values that differ from account defaults are stored as overrides on this position row. Save the positions
          table after closing this dialog.
        </Typography>

        <Box sx={{ mb: 2 }}>
          <AccusourcePackageSelector
            packageId={screeningPackageId}
            packageName={screeningPackageName}
            onChange={(next) => {
              setScreeningPackageId(next.packageId);
              setScreeningPackageName(next.packageName);
            }}
            helperText="Optional — overrides account-level screening package for this title only."
            selectLabel="Screening package (position override)"
          />
        </Box>

        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              options={additionalOptions.map((o) => o.value)}
              value={form.additionalScreenings ?? []}
              onChange={(_, v) => update({ additionalScreenings: v })}
              renderInput={(params) => <TextField {...params} label="Additional screenings" size="small" />}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              options={licenseOptions.map((o) => o.value)}
              value={form.licensesCerts ?? []}
              onChange={(_, v) => update({ licensesCerts: v })}
              renderInput={(params) => <TextField {...params} label="Licenses & certifications" size="small" />}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={form.languagesRequired ?? []}
              onChange={(_, v) => update({ languagesRequired: v })}
              renderInput={(params) => (
                <TextField {...params} label="Languages required" size="small" placeholder="Type and press Enter" />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              options={SKILL_OPTIONS}
              value={form.skillsRequired ?? []}
              onChange={(_, v) => update({ skillsRequired: v })}
              renderInput={(params) => <TextField {...params} label="Skills required" size="small" />}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              options={PHYSICAL_OPTIONS}
              value={form.physicalRequirements ?? []}
              onChange={(_, v) => update({ physicalRequirements: v })}
              renderInput={(params) => <TextField {...params} label="Physical requirements" size="small" />}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              options={PPE_OPTIONS}
              value={form.ppeRequirements ?? []}
              onChange={(_, v) => {
                const next = v ?? [];
                update({
                  ppeRequirements: next,
                  ppeProvidedBy:
                    next.length > 0
                      ? form.ppeProvidedBy && ['company', 'worker', 'both'].includes(String(form.ppeProvidedBy))
                        ? form.ppeProvidedBy
                        : 'company'
                      : '',
                });
              }}
              renderInput={(params) => <TextField {...params} label="PPE requirements" size="small" />}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small" disabled={!hasPpe}>
              <InputLabel id="ppe-provided-by-label">PPE provided by</InputLabel>
              <Select
                labelId="ppe-provided-by-label"
                displayEmpty
                value={hasPpe ? String(form.ppeProvidedBy || 'company') : ''}
                onChange={(e) => update({ ppeProvidedBy: e.target.value })}
                label="PPE provided by"
                renderValue={
                  hasPpe
                    ? undefined
                    : () => (
                        <Typography variant="body2" color="text.disabled" component="span">
                          Add PPE requirements first
                        </Typography>
                      )
                }
              >
                <MenuItem value="company">Company</MenuItem>
                <MenuItem value="worker">Worker</MenuItem>
                <MenuItem value="both">Both</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Experience</InputLabel>
              <Select
                value={form.experienceRequired ?? ''}
                onChange={(e) => update({ experienceRequired: e.target.value })}
                label="Experience"
              >
                <MenuItem value="">
                  <em>None specified</em>
                </MenuItem>
                {experienceOptions.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Education</InputLabel>
              <Select
                value={form.educationRequired ?? ''}
                onChange={(e) => update({ educationRequired: e.target.value })}
                label="Education"
              >
                <MenuItem value="">
                  <em>None specified</em>
                </MenuItem>
                {educationOptions.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Job Score requirement pack</InputLabel>
              <Select
                value={form.requirementPackId ?? ''}
                onChange={(e) => update({ requirementPackId: e.target.value })}
                label="Job Score requirement pack"
              >
                <MenuItem value="">None</MenuItem>
                {getRequirementPackIds().map((id) => (
                  <MenuItem key={id} value={id}>
                    {JOB_REQUIREMENT_PACKS[id as keyof typeof JOB_REQUIREMENT_PACKS]?.name ?? id}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>Stored on this position row only — not inherited from account Order Defaults.</FormHelperText>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              options={DRESS_CODE_OPTIONS}
              value={form.dressCode ?? []}
              onChange={(_, v) => update({ dressCode: v })}
              renderInput={(params) => <TextField {...params} label="Dress / uniform" size="small" />}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />
                ))
              }
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Custom uniform requirements"
              value={form.customUniformRequirements ?? ''}
              onChange={(e) => update({ customUniformRequirements: e.target.value })}
              multiline
              minRows={2}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button color="warning" onClick={() => void handleClearOverrides()} sx={{ mr: 'auto' }}>
          Clear position overrides
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
