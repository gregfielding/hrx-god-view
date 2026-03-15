/**
 * Order Details defaults (Compliance & Requirements + Company Contacts).
 * Used on Account and Location Order Defaults tab. Data flows: National → Child → Job Order or Standalone → Location → Job Order.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Chip,
  Divider,
} from '@mui/material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import type { RecruiterAccount } from '../../types/recruiter/account';
import { experienceOptions, educationOptions } from '../../data/experienceOptions';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../../data/screeningsOptions';
import { getOptionsForField } from '../../utils/fieldOptions';
import { getRequirementPackIds, JOB_REQUIREMENT_PACKS } from '../../data/jobRequirementPacks';

const PHYSICAL_OPTIONS = [
  'Standing', 'Walking', 'Sitting', 'Lifting 25 lbs', 'Lifting 50 lbs', 'Lifting 75 lbs', 'Lifting 100+ lbs',
  'Carrying 25 lbs', 'Carrying 50 lbs', 'Pushing', 'Pulling', 'Climbing', 'Reaching', 'Handling', 'Outdoor Work', 'Indoor Work', 'Other',
];
const PPE_OPTIONS = [
  'Hard Hat', 'Safety Glasses', 'Steel-Toe Boots', 'High-Visibility Vest', 'Hearing Protection', 'Respirator', 'Other',
];
const DRESS_CODE_OPTIONS = [
  'Business Casual', 'Casual', 'Uniform Provided', 'Steel-Toe Boots', 'Non-Slip Shoes', 'Scrubs', 'Other',
];

export interface OrderDetailsData {
  backgroundCheckPackages?: string[];
  drugScreeningPanels?: string[];
  additionalScreenings?: string[];
  licensesCerts?: string[];
  experienceRequired?: string;
  educationRequired?: string;
  languagesRequired?: string[];
  skillsRequired?: string[];
  physicalRequirements?: string[];
  ppeRequirements?: string[];
  ppeProvidedBy?: string;
  requirementPackId?: string;
  dressCode?: string[];
  customUniformRequirements?: string;
  decisionMaker?: string;
  hrContactId?: string;
  operationsContactId?: string;
  procurementContactId?: string;
  billingContactId?: string;
  safetyContactId?: string;
  invoiceContactId?: string;
}

export interface AccountOrderDetailsFormProps {
  account: RecruiterAccount | null;
  accountId: string;
  tenantId: string;
  userId: string;
  locationKey?: string;
  locationDefaults?: Record<string, unknown> | null;
  onRefreshLocation?: () => void | Promise<void>;
  /** Contacts for Company Contact dropdowns (e.g. location contacts or account company contacts). May have id + label, or id + fullName/name/email. */
  contacts: Array<{ id: string; label?: string; fullName?: string; name?: string; firstName?: string; lastName?: string; email?: string; title?: string }>;
}

const emptyOrderDetails: OrderDetailsData = {
  backgroundCheckPackages: [],
  drugScreeningPanels: [],
  additionalScreenings: [],
  licensesCerts: [],
  experienceRequired: '',
  educationRequired: '',
  languagesRequired: [],
  skillsRequired: [],
  physicalRequirements: [],
  ppeRequirements: [],
  ppeProvidedBy: 'company',
  requirementPackId: '',
  dressCode: [],
  customUniformRequirements: '',
  decisionMaker: '',
  hrContactId: '',
  operationsContactId: '',
  procurementContactId: '',
  billingContactId: '',
  safetyContactId: '',
  invoiceContactId: '',
};

function mergeOrderDetails(location: OrderDetailsData | undefined, account: OrderDetailsData | undefined): OrderDetailsData {
  return {
    ...emptyOrderDetails,
    ...account,
    ...location,
    backgroundCheckPackages: location?.backgroundCheckPackages ?? account?.backgroundCheckPackages ?? [],
    drugScreeningPanels: location?.drugScreeningPanels ?? account?.drugScreeningPanels ?? [],
    additionalScreenings: location?.additionalScreenings ?? account?.additionalScreenings ?? [],
    licensesCerts: location?.licensesCerts ?? account?.licensesCerts ?? [],
    languagesRequired: location?.languagesRequired ?? account?.languagesRequired ?? [],
    skillsRequired: location?.skillsRequired ?? account?.skillsRequired ?? [],
    physicalRequirements: location?.physicalRequirements ?? account?.physicalRequirements ?? [],
    ppeRequirements: location?.ppeRequirements ?? account?.ppeRequirements ?? [],
    dressCode: location?.dressCode ?? account?.dressCode ?? [],
  };
}

const AccountOrderDetailsForm: React.FC<AccountOrderDetailsFormProps> = ({
  account,
  accountId,
  tenantId,
  userId,
  locationKey,
  locationDefaults,
  onRefreshLocation,
  contacts,
}) => {
  const locationOrderDetails = (locationDefaults as any)?.orderDefaults?.orderDetails as OrderDetailsData | undefined;
  const accountOrderDetails = (account as any)?.orderDefaults?.orderDetails as OrderDetailsData | undefined;
  const effective = mergeOrderDetails(locationOrderDetails, accountOrderDetails);

  const [form, setForm] = useState<OrderDetailsData>(effective);
  const formRef = useRef<OrderDetailsData>(form);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    setForm(mergeOrderDetails(locationOrderDetails, accountOrderDetails));
  }, [locationOrderDetails, accountOrderDetails]);

  const update = useCallback((patch: Partial<OrderDetailsData>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const save = useCallback(async () => {
    const data = formRef.current;
    try {
      const payload = {
        'orderDefaults.orderDetails': data,
        updatedAt: serverTimestamp(),
        ...(locationKey ? { updatedBy: userId || null } : {}),
      };
      if (locationKey) {
        const locationRef = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
        await updateDoc(locationRef, payload);
        await onRefreshLocation?.();
      } else {
        const accountRef = doc(db, p.recruiterAccount(tenantId, accountId));
        await updateDoc(accountRef, payload);
      }
    } catch (err: any) {
      console.error('Save order details error:', err);
    }
  }, [tenantId, accountId, userId, locationKey, onRefreshLocation]);

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      save();
    }, 400);
  }, [save]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const contactOptions = contacts.map((c) => ({
    id: c.id,
    label: c.label || [c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name, c.email].filter(Boolean).join(' · ') || c.id,
  }));
  const getContactById = (id: string) => contactOptions.find((o) => o.id === id) || null;

  const emptyOpts = {};
  const bgOptions = (getOptionsForField('backgroundCheckPackages', emptyOpts) as { value: string; label: string }[])?.length
    ? getOptionsForField('backgroundCheckPackages', emptyOpts)
    : backgroundCheckOptions.map((o) => ({ value: o.value, label: o.label }));
  const drugOptions = (getOptionsForField('drugScreeningPanels', emptyOpts) as { value: string; label: string }[])?.length
    ? getOptionsForField('drugScreeningPanels', emptyOpts)
    : drugScreeningOptions.map((o) => ({ value: o.value, label: o.label }));
  const addlOptions = (getOptionsForField('additionalScreenings', emptyOpts) as { value: string; label: string }[])?.length
    ? getOptionsForField('additionalScreenings', emptyOpts)
    : additionalScreeningOptions.map((o) => ({ value: o.value, label: o.label }));
  const licenseOptions = getOptionsForField('licensesCerts', emptyOpts) as { value: string; label: string }[];
  const languageOptions = (getOptionsForField('languages', emptyOpts) as { value: string; label: string }[])?.map((o) => o.value) || [];
  const skillOptions = getOptionsForField('skills', emptyOpts) as { value: string; label: string }[];

  return (
    <Card>
      <CardContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These defaults flow to job orders. Set at account or location level; job orders can override.
        </Typography>

        <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 1 }}>Compliance & Requirements</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={bgOptions.map((o) => o.label)}
              value={form.backgroundCheckPackages ?? []}
              onChange={(_, v) => update({ backgroundCheckPackages: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Background Check Packages" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={drugOptions.map((o) => o.label)}
              value={form.drugScreeningPanels ?? []}
              onChange={(_, v) => update({ drugScreeningPanels: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Drug Screening Panels" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={addlOptions.map((o) => o.label)}
              value={form.additionalScreenings ?? []}
              onChange={(_, v) => update({ additionalScreenings: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Additional Screenings" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={licenseOptions.map((o) => o.value || o.label)}
              value={form.licensesCerts ?? []}
              onChange={(_, v) => update({ licensesCerts: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Licenses & Certifications" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Experience Required</InputLabel>
              <Select value={form.experienceRequired ?? ''} onChange={(e) => { update({ experienceRequired: e.target.value }); scheduleSave(); }} onClose={scheduleSave} label="Experience Required">
                <MenuItem value="">—</MenuItem>
                {experienceOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Education Required</InputLabel>
              <Select value={form.educationRequired ?? ''} onChange={(e) => { update({ educationRequired: e.target.value }); scheduleSave(); }} onClose={scheduleSave} label="Education Required">
                <MenuItem value="">—</MenuItem>
                {educationOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={languageOptions}
              value={form.languagesRequired ?? []}
              onChange={(_, v) => update({ languagesRequired: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Languages Required" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={skillOptions.map((o) => o.value || o.label)}
              value={form.skillsRequired ?? []}
              onChange={(_, v) => update({ skillsRequired: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Skills Required" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={PHYSICAL_OPTIONS}
              value={form.physicalRequirements ?? []}
              onChange={(_, v) => update({ physicalRequirements: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Physical Requirements" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={PPE_OPTIONS}
              value={form.ppeRequirements ?? []}
              onChange={(_, v) => update({ ppeRequirements: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="PPE Requirements" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>PPE Provided By</InputLabel>
              <Select value={form.ppeProvidedBy ?? 'company'} onChange={(e) => { update({ ppeProvidedBy: e.target.value }); scheduleSave(); }} onClose={scheduleSave} label="PPE Provided By">
                <MenuItem value="company">Company</MenuItem>
                <MenuItem value="worker">Worker</MenuItem>
                <MenuItem value="both">Both</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Job Score requirement pack</InputLabel>
              <Select value={form.requirementPackId ?? ''} onChange={(e) => { update({ requirementPackId: e.target.value }); scheduleSave(); }} onClose={scheduleSave} label="Job Score requirement pack">
                <MenuItem value="">None</MenuItem>
                {getRequirementPackIds().map((id) => (
                  <MenuItem key={id} value={id}>{JOB_REQUIREMENT_PACKS[id as keyof typeof JOB_REQUIREMENT_PACKS]?.name ?? id}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={DRESS_CODE_OPTIONS}
              value={form.dressCode ?? []}
              onChange={(_, v) => update({ dressCode: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Uniform Requirements" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth size="small" label="Custom Uniform Requirements" multiline rows={2} value={form.customUniformRequirements ?? ''} onChange={(e) => update({ customUniformRequirements: e.target.value })} onBlur={scheduleSave} />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Company Contacts</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Default contact roles for job orders at this account/location.</Typography>
        <Grid container spacing={2}>
          {(['decisionMaker', 'hrContactId', 'operationsContactId', 'procurementContactId', 'billingContactId', 'safetyContactId', 'invoiceContactId'] as const).map((key) => {
            const labels: Record<string, string> = {
              decisionMaker: 'Decision Maker',
              hrContactId: 'HR Contact',
              operationsContactId: 'Operations Contact',
              procurementContactId: 'Procurement Contact',
              billingContactId: 'Billing Contact',
              safetyContactId: 'Safety Contact',
              invoiceContactId: 'Invoice Contact',
            };
            const value = form[key] ?? '';
            return (
              <Grid item xs={12} md={6} key={key}>
                <Autocomplete
                  fullWidth
                  size="small"
                  options={contactOptions}
                  value={getContactById(value)}
                  onChange={(_, v) => update({ [key]: v?.id ?? '' })}
                  onBlur={scheduleSave}
                  getOptionLabel={(o) => o.label}
                  isOptionEqualToValue={(o, v) => o.id === v?.id}
                  renderInput={(params) => <TextField {...params} label={labels[key]} placeholder="Select contact..." onBlur={scheduleSave} />}
                />
              </Grid>
            );
          })}
        </Grid>
      </CardContent>
    </Card>
  );
};

export default AccountOrderDetailsForm;
