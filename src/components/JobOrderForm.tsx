import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Stack,
  FormControlLabel,
  Checkbox,
  Chip,
  OutlinedInput,
  Divider,
  Autocomplete,
  IconButton,
  Switch,
  InputAdornment,
  Tabs,
  Tab,
  Tooltip,
} from '@mui/material';
import {
  Save as SaveIcon,
  Cancel as CancelIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  orderBy,
  deleteField,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { experienceOptions, educationOptions } from '../data/experienceOptions';
import { additionalScreeningOptions } from '../data/screeningsOptions';
import { JobOrder, JobOrderContact } from '../types/recruiter/jobOrder';
import { getFieldDef } from '../fields/useFieldDef';
import { toNumberSafe, toISODate, coerceSelect } from '../utils/fieldCoercions';
import { getRegistryPath, setDeep, getRegistryIdForField } from '../utils/registryHelpers';
import { getOptionsForField } from '../utils/fieldOptions';
import jobTitlesList from '../data/onetJobTitles.json';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';
import {
  dedupeUserGroupsForUi,
  autoAddGroupsPickerValue,
  type UserGroupRow,
} from '../utils/dedupeUserGroupsForUi';
import { ensureCityInSmartGroups } from '../services/smartGroupMetroSync';
import { getRequirementPackIds, JOB_REQUIREMENT_PACKS } from '../data/jobRequirementPacks';
import { useWorkersCompRatesByJobTitle } from '../hooks/useWorkersCompRatesByJobTitle';
import {
  pickWorkersCompJobTitleLookup,
  resolveWorkersCompModifierAccountId,
} from '../utils/workersCompRateMaps';
import { AccusourcePackageSelector } from './recruiter/AccusourcePackageSelector';
import PositionRequirementsEditor, {
  type PositionRequirementsOptions,
} from './recruiter/PositionRequirementsEditor';
import { useEntity } from '../hooks/useEntity';
import {
  normalizeStateCode,
  getSutaRateByState,
  getFutaRateByState,
} from '../utils/unemploymentRates';
import {
  fetchResolvedAccountPricingPositions,
  buildPricingByJobTitle,
} from '../utils/accountPricingForJobOrder';
import { fetchMergedRecruiterOrderDefaultsForJobOrder } from '../utils/recruiterAccountOrderDefaultsMerge';
import type { AccountPositionPricing } from '../types/recruiter/account';
import {
  getEffectiveJobOrderField,
  type JobOrderForEffectiveRead,
} from '../shared/jobOrder/getEffectiveJobOrderField';

/** Apply account Pricing row (exact job title match) to career job order form fields. */
function mergeCareerFormWithPricingPreset(
  prev: Record<string, unknown>,
  title: string,
  map: Map<string, AccountPositionPricing>
): Record<string, unknown> {
  const trimmed = String(title).trim();
  const preset = trimmed ? map.get(trimmed) : undefined;
  const next: Record<string, unknown> = { ...prev, jobTitle: title };
  if (!preset) return next;
  if (preset.payRate != null && Number.isFinite(Number(preset.payRate))) {
    next.payRate = String(preset.payRate);
  }
  if (preset.markupPercent != null && Number.isFinite(Number(preset.markupPercent))) {
    next.markup = String(preset.markupPercent);
    const pay = parseFloat(String(next.payRate)) || 0;
    const m = Number(preset.markupPercent);
    if (!Number.isNaN(m) && m > 0 && pay > 0) {
      const br = Number((pay * (1 + m / 100)).toFixed(2));
      next.billRate = String(br);
      next.calculatedBillRate = String(br);
    }
  } else if (preset.billRate != null && Number.isFinite(Number(preset.billRate))) {
    next.billRate = String(preset.billRate);
  }
  if (preset.workersCompCode) next.workersCompClassCode = String(preset.workersCompCode);
  if (preset.workersCompRate != null) next.workersCompRate = String(preset.workersCompRate);
  const jd = (preset.jobDescriptionFromClient || '').trim();
  if (jd) next.jobDescriptionFromClient = jd;
  return next;
}

/**
 * Cascade an account Pricing row's `orderDetails` into a gig
 * position's `requirements` override map when the recruiter selects
 * (or commits) that pricing row's job title.
 *
 * ## Scope
 *
 * Every per-position-overridable field in `GigPositionRequirementOverrides`
 * (see `src/shared/jobOrder/resolveJobOrderRequirements.ts`) that
 * also has a 1:1 counterpart in `RecruiterOrderDetailsData`:
 *
 *   string[] fields:
 *     - `additionalScreenings`
 *     - `licensesCerts`
 *     - `physicalRequirements`
 *     - `ppeRequirements`
 *     - `skillsRequired`
 *     - `languagesRequired`
 *     - `dressCode`
 *
 *   string fields:
 *     - `experienceRequired`
 *     - `educationRequired`
 *     - `ppeProvidedBy`
 *     - `customUniformRequirements`
 *
 * Fields deliberately NOT cascaded here (handled JO-level only):
 *   - `screeningPackageId` / `screeningPackageName` — picked at the
 *     JO level via the screening package selector
 *   - `requirementPackId`, `backgroundCheckPackages`,
 *     `drugScreeningPanels` — bundled-pack identifiers, not
 *     per-position overrides
 *
 * ## Precedence rules
 *
 *   1. `preset.orderDetails.<field>` — structured value (set via
 *      `PositionComplianceOverridesDialog` on the Account Pricing
 *      tab). Maps 1:1 onto `position.requirements.<field>`.
 *
 *   2. `preset.uniformRequirements` — LEGACY freeform string at the
 *      top of the pricing row (the older single-field "Uniform
 *      Requirements" input on Account Pricing). Folds into
 *      `customUniformRequirements` ONLY when
 *      `preset.orderDetails.customUniformRequirements` is empty —
 *      same precedence `PositionComplianceOverridesDialog` uses on
 *      its seeding branch (see `seededOrderDetails` in that file,
 *      ~line 260).
 *
 * ## Seeding policy (preserves recruiter edits)
 *
 * For every cascaded field we only write into `position.requirements`
 * when the position is currently empty:
 *
 *   - string[] field: missing OR `[]` counts as empty → seed
 *   - string field: missing OR `''` (after trim) counts as empty → seed
 *
 * This means the recruiter can pick the job title, then refine
 * individual fields without worrying that re-selecting the same job
 * title (or blurring back into the field) will clobber their edits.
 * Conversely, if every cascaded field still has its preset value, no
 * write happens — `requirements` is removed from the row when it
 * would be empty so we don't generate spurious dirty positions.
 */
function applyAccountRequirementsCascadeToPositionRow(
  row: Record<string, any>,
  preset: AccountPositionPricing | undefined,
): Record<string, any> {
  if (!preset) return row;

  const presetOrderDetails = (preset.orderDetails ?? {}) as Partial<{
    additionalScreenings: string[];
    licensesCerts: string[];
    physicalRequirements: string[];
    ppeRequirements: string[];
    skillsRequired: string[];
    languagesRequired: string[];
    dressCode: string[];
    experienceRequired: string;
    educationRequired: string;
    ppeProvidedBy: string;
    customUniformRequirements: string;
  }>;

  const arrayFields: Array<
    | 'additionalScreenings'
    | 'licensesCerts'
    | 'physicalRequirements'
    | 'ppeRequirements'
    | 'skillsRequired'
    | 'languagesRequired'
    | 'dressCode'
  > = [
    'additionalScreenings',
    'licensesCerts',
    'physicalRequirements',
    'ppeRequirements',
    'skillsRequired',
    'languagesRequired',
    'dressCode',
  ];
  const stringFields: Array<
    'experienceRequired' | 'educationRequired' | 'ppeProvidedBy'
  > = ['experienceRequired', 'educationRequired', 'ppeProvidedBy'];

  const existingReqs =
    (row.requirements && typeof row.requirements === 'object' && row.requirements) ||
    {};
  const nextReqs: Record<string, unknown> = { ...existingReqs };
  let didSeed = false;

  for (const key of arrayFields) {
    const presetValue = Array.isArray(presetOrderDetails[key])
      ? (presetOrderDetails[key] as string[])
      : [];
    if (presetValue.length === 0) continue;
    const existing = Array.isArray((existingReqs as any)[key])
      ? ((existingReqs as any)[key] as string[])
      : [];
    if (existing.length === 0) {
      nextReqs[key] = presetValue;
      didSeed = true;
    }
  }

  for (const key of stringFields) {
    const presetValue = String(presetOrderDetails[key] ?? '').trim();
    if (!presetValue) continue;
    const existing = String((existingReqs as any)[key] ?? '').trim();
    if (!existing) {
      nextReqs[key] = presetValue;
      didSeed = true;
    }
  }

  // customUniformRequirements: orderDetails first, legacy
  // `preset.uniformRequirements` as fallback.
  const presetCustomFromDetails = String(
    presetOrderDetails.customUniformRequirements ?? '',
  ).trim();
  const presetCustomLegacy = String(preset.uniformRequirements ?? '').trim();
  const presetCustom = presetCustomFromDetails || presetCustomLegacy;
  if (presetCustom) {
    const existingCustom = String(
      (existingReqs as any).customUniformRequirements ?? '',
    ).trim();
    if (!existingCustom) {
      nextReqs.customUniformRequirements = presetCustom;
      didSeed = true;
    }
  }

  if (!didSeed) return row;
  return { ...row, requirements: nextReqs };
}

/** Persist SUTA/FUTA as numbers on each gig position (matches account `pricing.positions`). */
function normalizeGigPositionsForPersist(
  positions: Array<Record<string, unknown> & { sutaRate?: string; futaRate?: string }>,
) {
  const parseOptPct = (v: string | undefined) => {
    if (v == null || String(v).trim() === '') return undefined;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  };
  return positions.map((pos) => ({
    ...pos,
    sutaRate: parseOptPct(pos.sutaRate),
    futaRate: parseOptPct(pos.futaRate),
  }));
}

/**
 * Standard dress-code / uniform options for the per-position
 * Uniform Requirements field (rendered inline below the JD on each
 * gig position card, May 2026). Mirrors the hardcoded list in the
 * (currently hidden) JO-level Uniform Requirements Autocomplete
 * around line 4570 — keep both in sync if the list ever changes.
 * Hosted at module scope so the array reference is stable across
 * renders (avoids re-mounting the Autocomplete on every keystroke).
 */
const POSITION_DRESS_CODE_OPTIONS: ReadonlyArray<string> = [
  'Business Casual',
  'Business Professional',
  'Black Bistro',
  'Casual',
  'Scrubs',
  'Uniform Provided',
  'Black Pants',
  'White Shirt',
  'Polo Shirt',
  'Button-Down Shirt',
  'Black Button-Down Shirt',
  'Dress Shirt',
  'Khaki Pants',
  'Dress Pants',
  'Jeans (Dark)',
  'Jeans (No Holes)',
  'Slacks',
  'Skirt/Dress',
  'Blouse',
  'Sweater',
  'Cardigan',
  'Blazer',
  'Suit',
  'Tie Required',
  'No Tie',
  'Closed-Toe Shoes',
  'Steel-Toe Boots',
  'Non-Slip Shoes',
  'Dress Shoes',
  'Sneakers',
  'Boots',
  'Sandals Allowed',
  'No Sandals',
  'No Flip-Flops',
  'No Shorts',
  'No Tank Tops',
  'No Graphic Tees',
  'No Hoodies',
  'No Sweatpants',
  'No Leggings',
  'No Yoga Pants',
  'No Athletic Wear',
  'No Ripped Clothing',
  'No Visible Tattoos',
  'No Facial Piercings',
  'Minimal Jewelry',
  'No Jewelry',
  'Hair Tied Back',
  'Clean Shaven',
  'Facial Hair Allowed',
  'Hair Color Restrictions',
  'No Hair Color Restrictions',
  'Coveralls',
  'Safety Vest',
  'Hard Hat',
  'Reflective Clothing',
  'Weather-Appropriate',
  'Seasonal Attire',
  'Formal Occasions',
  'Customer-Facing',
  'Back Office',
  'Laboratory',
  'Kitchen',
  'Warehouse',
  'Construction',
  'Healthcare',
  'Food Service',
  'Retail',
  'Office',
  'Other',
];

// Helper function to remove undefined values from objects (Firestore doesn't allow undefined)
const removeUndefinedValues = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedValues).filter(item => item !== undefined);
  }
  
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = removeUndefinedValues(value);
      }
    }
    return cleaned;
  }
  
  return obj;
};

/** Gig financials: gross profit = estimated value − (estimated value ÷ (1 + markup%)). E.g. $1,000 @ 25% → $200. */
function formatGigGrossProfit(estimatedValueStr: string, markupPctStr: string): string {
  const ev = parseFloat(String(estimatedValueStr ?? '').replace(/,/g, ''));
  const m = parseFloat(String(markupPctStr ?? ''));
  if (!Number.isFinite(ev) || ev <= 0) return '';
  if (!Number.isFinite(m) || m < 0) return '';
  const denom = 1 + m / 100;
  if (denom <= 0) return '';
  const gp = ev - ev / denom;
  if (!Number.isFinite(gp)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(gp);
}

interface Company {
  id: string;
  companyName: string;
  name: string;
}

interface Location {
  id: string;
  nickname: string;
  name: string;
  companyId?: string;
}

interface Contact {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  title?: string;
}

interface JobOrderFormProps {
  jobOrderId?: string; // If provided, we're editing; if not, we're creating
  dealId?: string; // If provided, we can load associated contacts from the deal
  onSave?: () => void; // Optional callback after successful save
  onCancel?: () => void; // Optional callback for cancel
  // Additional props for compatibility with recruiter components
  tenantId?: string; // Optional tenant ID (will use from auth context if not provided)
  createdBy?: string; // Optional created by user ID (will use from auth context if not provided)
  jobOrder?: any; // Optional job order data for editing
  initialData?: any; // Optional initial form data
  loading?: boolean; // Optional loading state
  companies?: any[]; // Optional companies list
  locations?: any[]; // Optional locations list
  recruiters?: any[]; // Optional recruiters list
  jobTitles?: string[]; // Optional job titles list
  groups?: any[]; // Optional groups list
  /** When creating from Account Details, persist this so Job Orders tab can scope by account (and child by worksite). */
  recruiterAccountId?: string | null;
  /**
   * When true (e.g. Jobs hub modal / New Job Order page), user must pick a recruiter Account first;
   * Company is limited to that account’s linked companies and auto-filled when only one.
   */
  requireAccountSelection?: boolean;
  /**
   * Which section(s) of the form to render. Used by RecruiterJobOrderDetail
   * to split the form across the Overview / Positions / Requirements
   * tabs. Defaults to `'all'` so other consumers (NewJobOrder modal,
   * AddJobOrderModal, etc.) keep rendering the full form.
   *
   * - `'overview'` — Basic Information block + Financials
   * - `'positions'` — Career job-title/pay/markup/WC/shift/JD fields
   *                    and the Gig multi-position editor
   * - `'requirements'` — Compliance & Requirements block
   * - `'all'` — render every section (default; legacy behavior)
   */
  section?: 'overview' | 'positions' | 'requirements' | 'all';
  /**
   * Optional callback to jump to the Positions tab. When provided
   * (e.g. by `RecruiterJobOrderDetail.tsx` wiring it to
   * `setActiveTab('positions')`), the override-summary banner on
   * the Requirements tab becomes a clickable link that switches
   * tabs. Without the callback the banner still renders but is
   * non-interactive. Slice 2 (May 2026) of the per-position
   * requirements override work.
   */
  onJumpToPositionsTab?: () => void;
  /**
   * When true, suppress the Compliance & Requirements section even
   * if it would otherwise render under `section='all'` /
   * `section='requirements'`. Used by `AddJobOrderModal.tsx`
   * (May 2026) to keep the create-new-JO dialog focused on the
   * minimum-viable fields — recruiters fill in compliance/
   * requirements after the JO exists, on the JO detail page's
   * "Default Requirements" tab (and per-position overrides on the
   * "Positions" tab). Defaults to `false` so existing callers
   * (`NewJobOrder.tsx`, `RecruiterJobOrderDetail.tsx` Requirements
   * tab, etc.) keep their current behavior.
   */
  hideRequirementsSection?: boolean;
}

const JobOrderForm: React.FC<JobOrderFormProps> = ({ 
  jobOrderId, 
  dealId,
  onSave, 
  onCancel,
  tenantId: propTenantId,
  createdBy: propCreatedBy,
  jobOrder,
  initialData,
  loading: propLoading,
  companies: propCompanies,
  locations: propLocations,
  recruiters: propRecruiters,
  jobTitles: propJobTitles,
  groups: propGroups,
  recruiterAccountId: propRecruiterAccountId,
  requireAccountSelection = false,
  section = 'all',
  onJumpToPositionsTab,
  hideRequirementsSection = false,
}) => {
  const showOverview = section === 'overview' || section === 'all';
  const showPositions = section === 'positions' || section === 'all';
  // `hideRequirementsSection` (May 2026): per-modal opt-out so the
  // create-new-JO dialog can skip the Compliance & Requirements
  // block entirely. The Requirements tab on the JO detail page does
  // NOT pass this flag, so its behavior is unchanged.
  const showRequirements =
    !hideRequirementsSection &&
    (section === 'requirements' || section === 'all');
  const { tenantId: authTenantId, user: authUser } = useAuth();
  const navigate = useNavigate();
  
  // Use props if provided, otherwise fall back to auth context
  const tenantId = propTenantId || authTenantId;
  const user = propCreatedBy ? { uid: propCreatedBy } : authUser;
  const wcMaps = useWorkersCompRatesByJobTitle(tenantId);

  /** Account Pricing tab positions (child → national fallback); empty ⇒ use O*NET unless propJobTitles overrides */
  const [resolvedAccountPositions, setResolvedAccountPositions] = useState<AccountPositionPricing[]>([]);
  const pricingByJobTitle = useMemo(
    () => buildPricingByJobTitle(resolvedAccountPositions),
    [resolvedAccountPositions]
  );

  /** Detect when pricing rows (titles + client JD text) change, not only row count. */
  const pricingPositionsSyncKey = useMemo(
    () =>
      resolvedAccountPositions
        .map((p) => `${String(p.jobTitle ?? '').trim()}\t${String(p.jobDescriptionFromClient ?? '').trim()}`)
        .join('\n'),
    [resolvedAccountPositions]
  );

  const jobTitleOptions = useMemo(() => {
    if (propJobTitles && propJobTitles.length > 0) return propJobTitles;
    if (resolvedAccountPositions.length > 0) {
      const titles = resolvedAccountPositions.map((p) => String(p.jobTitle || '').trim()).filter(Boolean);
      return [...new Set(titles)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    return jobTitlesList as string[];
  }, [propJobTitles, resolvedAccountPositions]);

  const [loading, setLoading] = useState(propLoading ?? !!jobOrderId); // Loading if editing
  const [saving, setSaving] = useState(false);
  const [loadedJobOrderData, setLoadedJobOrderData] = useState<any>(null); // Store loaded job order for preserving associations

  type PickerAccount = {
    id: string;
    name: string;
    /** Display line in dropdown (e.g. sub-account + parent). */
    label: string;
    companyIds: string[];
    hiringEntityId: string | null;
    parentAccountId: string | null;
    /** Child account worksites from associations.locations (companyId + locationId). */
    linkedLocations: Array<{ companyId: string; locationId: string }>;
  };
  /** Full list (e.g. optional “Linked recruiter account” on edit can include national parents). */
  const [recruiterAccountsAll, setRecruiterAccountsAll] = useState<PickerAccount[]>([]);
  const [recruiterAccountsForPicker, setRecruiterAccountsForPicker] = useState<PickerAccount[]>([]);
  const [pickedRecruiterAccountId, setPickedRecruiterAccountId] = useState<string | null>(null);

  const effectiveRecruiterAccountId = useMemo(
    () =>
      pickedRecruiterAccountId ||
      propRecruiterAccountId ||
      (loadedJobOrderData as any)?.recruiterAccountId ||
      (jobOrder as any)?.recruiterAccountId ||
      null,
    [pickedRecruiterAccountId, propRecruiterAccountId, loadedJobOrderData, jobOrder]
  );

  /** National or standalone recruiter account id for WC rules scoped by account modifier (child venues → parent). */
  const wcModifierAccountId = useMemo(() => {
    const aid = effectiveRecruiterAccountId;
    if (!aid) return null;
    const acc =
      recruiterAccountsForPicker.find((a) => a.id === aid) ||
      recruiterAccountsAll.find((a) => a.id === aid);
    return resolveWorkersCompModifierAccountId(acc || null);
  }, [effectiveRecruiterAccountId, recruiterAccountsForPicker, recruiterAccountsAll]);

  /** Hiring entity from the job order's linked recruiter account (fixes stale job orders created before the account had hiringEntityId). */
  const recruiterAccountHiringEntityId = useMemo(() => {
    const accId = effectiveRecruiterAccountId;
    if (!accId) return null;
    const acc =
      recruiterAccountsForPicker.find((a) => a.id === accId) ||
      recruiterAccountsAll.find((a) => a.id === accId);
    return acc?.hiringEntityId ? String(acc.hiringEntityId) : null;
  }, [effectiveRecruiterAccountId, recruiterAccountsForPicker, recruiterAccountsAll]);

  /** Hiring Entity (Employer of Record): E-Verify comes from here (read-only downstream). */
  // R.16.2a — for an existing JO, the activation snapshot wins over the
  // live `jobOrder.hiringEntityId` once captured. Recruiter-account /
  // initialData / loaded-JO chain stays the fallback so drafts and
  // pre-§16.1 active JOs without a snapshot keep their current behaviour.
  const hiringEntityIdForForm = useMemo(
    () => {
      const fallback =
        recruiterAccountHiringEntityId ??
        initialData?.hiringEntityId ??
        jobOrder?.hiringEntityId ??
        (loadedJobOrderData as any)?.hiringEntityId ??
        null;
      const joForRead =
        (jobOrder as JobOrderForEffectiveRead | undefined) ??
        (loadedJobOrderData as JobOrderForEffectiveRead | undefined) ??
        null;
      const { value } = getEffectiveJobOrderField<string | null>(
        joForRead,
        'hiringEntityId',
        { fallback },
      );
      return (value as string | null) ?? null;
    },
    [recruiterAccountHiringEntityId, initialData?.hiringEntityId, jobOrder, loadedJobOrderData]
  );
  const { entity: formEntity } = useEntity(tenantId ?? null, hiringEntityIdForForm);
  /** Same hiring entities as Account → Pricing (SUTA/FUTA on pay for margin). */
  const showSutaFutaOnGigPositions = useMemo(
    () => /C1 Workforce|C1 Select/i.test(formEntity?.name || ''),
    [formEntity?.name],
  );
  const [gigPositions, setGigPositions] = useState<
    Array<{
      jobTitle: string;
      workersNeeded: number;
      payRate: string;
      workersCompClassCode?: string;
      workersCompRate?: string;
      sutaRate?: string;
      futaRate?: string;
      /** Per-position client-provided job description. Each position gets
       *  its own — a "Food Servers" position's JD shouldn't apply to
       *  "Cooks" sharing the same gig JO. Mirrors how account pricing
       *  stores `pricing.positions[i].jobDescriptionFromClient`. */
      jobDescriptionFromClient?: string;
      /** Per-position Compliance & Requirements overrides — see
       *  `src/shared/jobOrder/resolveJobOrderRequirements.ts` for the
       *  contract. Slice 1 (May 2026): the field is in state and round-
       *  trips to Firestore via `normalizeGigPositionsForPersist` (the
       *  spread preserves it), but no UI binds to it yet. Slice 2 adds
       *  the per-position editor on the Positions tab; slice 3 flips
       *  the readers (Apply / orchestrator / onboarding) to read via
       *  the resolver. Keeping this in state up front means the form
       *  schema doesn't move twice. */
      requirements?: import(
        '../shared/jobOrder/resolveJobOrderRequirements'
      ).GigPositionRequirementOverrides | null;
    }>
  >([{ jobTitle: '', workersNeeded: 1, payRate: '' }]); // For gig-type jobs with multiple positions
  /**
   * Which gig position is active in the Positions-tab sub-nav. Mirrors
   * the per-position `<Tabs>` strip on the Jobs Board tab — one sub-tab
   * per `gigPositions[i]`, active position renders below. Career JOs
   * don't use this. Index is 0-based and clamped on `gigPositions`
   * length changes (see effect below) so deleting the active position
   * doesn't leave the strip pointing at a non-existent index.
   */
  const [positionsSubTab, setPositionsSubTab] = useState(0);
  /** Draft text for career Job Title Autocomplete (value commits on blur / pick / Enter — avoids save+re-render each keystroke). */
  const [careerJobTitleInput, setCareerJobTitleInput] = useState('');
  const careerJobTitleInputRef = useRef('');
  careerJobTitleInputRef.current = careerJobTitleInput;
  /** Supersedes stale async merges when account/company/worksite changes quickly */
  const orderDefaultsMergeSeqRef = useRef(0);
  const [companies, setCompanies] = useState<Company[]>(propCompanies || []);
  const [locations, setLocations] = useState<Location[]>(propLocations || []);
  const [filteredLocations, setFilteredLocations] = useState<Location[]>([]);
  // User groups for the "Auto-Add to User Groups" Autocomplete on the
  // Overview section (created modal + JO detail Overview tab). Loaded
  // once per tenant on mount; mirrors the pattern used by
  // `JobPostForm.tsx` (`loadUserGroups`). Stored values land on the JO
  // doc as `autoAddToUserGroups: string[]`. The post-creation cascade
  // (`JobsBoardService.createPostsForGigJobOrderPositions`) reads the
  // JO field and seeds each new post's own `autoAddToUserGroups`.
  const [userGroupsList, setUserGroupsList] = useState<UserGroupRow[]>([]);
  const [loadingUserGroupsList, setLoadingUserGroupsList] = useState(false);
  const [associatedContacts, setAssociatedContacts] = useState<Contact[]>([]);
  const [companyContacts, setCompanyContacts] = useState<JobOrderContact[]>([]);
  const [loadedContacts, setLoadedContacts] = useState<any[]>([]);
  const [contactDropdownValue, setContactDropdownValue] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Company Defaults State
  const [backgroundCheckPackages, setBackgroundCheckPackages] = useState<Array<{title: string, description: string}>>([]);
  // R.0d (Apr 2026): drugScreeningPanels state removed — soft-deprecated;
  // no UI binding remained. See docs/READINESS_R0_HANDOFF.md.
  const [uniformRequirements, setUniformRequirements] = useState<Array<{title: string, description: string}>>([]);
  const [ppeOptions, setPpeOptions] = useState<Array<{title: string, description: string}>>([]);
  const [licensesCerts, setLicensesCerts] = useState<Array<{title: string, description: string}>>([]);
  const [experienceLevels, setExperienceLevels] = useState<Array<{title: string, description: string}>>([]);
  const [educationLevels, setEducationLevels] = useState<Array<{title: string, description: string}>>([]);
  const [physicalRequirements, setPhysicalRequirements] = useState<Array<{title: string, description: string}>>([]);
  const [languages, setLanguages] = useState<Array<{title: string, description: string}>>([]);
  const [skills, setSkills] = useState<Array<{title: string, description: string}>>([]);
  const companyDefaultsForOptions = {
    backgroundPackages: backgroundCheckPackages,
    uniformRequirements,
    ppe: ppeOptions,
    licensesCerts: licensesCerts,
    experienceLevels,
    educationLevels,
    physicalRequirements,
    languages,
    skills,
  } as any;

  /**
   * Option bundle for the per-position requirements override editor
   * (`PositionRequirementsEditor` on the Positions tab). Memo'd so we
   * don't rebuild on every render — `getOptionsForField` allocates
   * on each call. The editor uses these for its multi-select fields
   * (licensesCerts, skills, languages); hardcoded physical / PPE
   * lists live inside the editor itself, so we don't pass those.
   */
  const positionRequirementsOptions = useMemo<PositionRequirementsOptions>(
    () => ({
      additionalScreenings: Array.isArray(additionalScreeningOptions)
        ? additionalScreeningOptions.map((o) => o.label)
        : [],
      licensesCerts:
        (getOptionsForField('licensesCerts', companyDefaultsForOptions) as Array<{
          value: string;
          label: string;
        }>) ?? [],
      skills:
        (getOptionsForField('skills', companyDefaultsForOptions) as Array<{
          value: string;
          label: string;
        }>) ?? [],
      languages:
        (getOptionsForField('languages', companyDefaultsForOptions) as Array<{
          value: string;
          label: string;
        }>) ?? [],
      experienceLevels: experienceOptions as Array<{ value: string; label: string }>,
      educationLevels: educationOptions as Array<{ value: string; label: string }>,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- companyDefaultsForOptions is rebuilt on every render but its underlying state only changes when the dependent option arrays change; tracking those leaves directly avoids stale closures.
    [licensesCerts, skills, languages, experienceLevels, educationLevels],
  );

  const [formData, setFormData] = useState({
    // Basic Information
    jobOrderNumber: '',
    jobOrderName: '',
    jobTitle: '',
    description: '',
    jobDescriptionFromClient: '',
    companyId: '',
    worksiteId: '',
    status: 'draft',
    jobType: 'career' as 'gig' | 'career',
    workersNeeded: 1,
    payRate: '',
    markup: '',
    billRate: '',
    calculatedBillRate: '',
    startDate: '',
    endDate: '',
    requirements: '',
    notes: '',
    /**
     * User groups whose members get auto-added when an applicant is
     * hired off this JO. Mirrors `JobsBoardPost.autoAddToUserGroups`
     * — the post-creation cascade
     * (`JobsBoardService.createPostsForGigJobOrderPositions` and
     * `customData.autoAddToUserGroups`) seeds new posts with this
     * value so the recruiter only sets it once on the JO. Empty
     * array means "no extra groups beyond the auto-created group
     * stamped by `onJobOrderCreatedAttachAutoUserGroup`".
     */
    autoAddToUserGroups: [] as string[],
    /** Gig Financials (preliminary event budget) */
    poNumber: '',
    gigEstimatedValue: '',
    gigAverageMarkup: '',
    gigEstimatedStartDate: '',
    gigEstimatedEndDate: '',
    
    // Discovery Stage Fields
    currentStaffCount: '',
    currentAgencyCount: '',
    currentSatisfactionLevel: '',
    currentStruggles: '',
    hasUsedAgenciesBefore: false,
    lastAgencyUsed: '',
    reasonStoppedUsingAgencies: '',
    openToUsingAgenciesAgain: false,
    additionalJobTitles: '',
    shiftTimes: '',
    employmentType: '',
    onsiteSupervisionRequired: false,
    experienceLevel: '',
    priority: '',
    shiftType: '',
    
    // Qualification Stage Fields
    mustHaveRequirements: '',
    mustAvoidRequirements: '',
    potentialObstacles: '',
    expectedStartDate: '',
    initialHeadcount: '',
    headcountAfter30Days: '',
    headcountAfter90Days: '',
    headcountAfter180Days: '',
    expectedPayRate: '',
    expectedMarkup: '',
    
    // Scoping Stage Fields
    replacingExistingAgency: false,
    rolloverExistingStaff: false,
    backgroundCheckPackages: [],
    // R.0d (Apr 2026): drugScreeningPanels removed from form state init.
    additionalScreenings: [],
    eVerifyRequired: false,
    dressCode: [],
    customUniformRequirements: '',
    showCustomUniformRequirements: false,
    timeclockSystem: '',
    disciplinePolicy: '',
    poRequired: false,
    paymentTerms: '',
    invoiceDeliveryMethod: '',
    invoiceFrequency: '',
    
    // Compliance Fields
    backgroundCheckRequired: false,
    drugScreenRequired: false,
    licensesCerts: [],
    experienceRequired: '',
    educationRequired: '',
    languagesRequired: [],
    skillsRequired: [],
    physicalRequirements: [],
    ppeRequirements: [],
    ppeProvidedBy: '',
    requirementPackId: '',
    workersCompClassCode: '',
    workersCompRate: '',
    /**
     * Career-only top-level SUTA / FUTA rates. Gig orders persist these
     * per-position on `gigPositions[i]`; career orders flatten them onto
     * the JO doc the same way Pay Rate / Markup / WC are flattened. The
     * field name matches the legacy reader in `EditShiftForm`'s career
     * fallback (`jobOrder.sutaRate ?? jobOrder.suta`).
     */
    sutaRate: '',
    futaRate: '',
    screeningPackageId: '',
    screeningPackageName: '',
    
    // Customer Rules
    attendancePolicy: '',
    noShowPolicy: '',
    overtimePolicy: '',
    callOffPolicy: '',
    injuryHandlingPolicy: '',
    
    // Agreement Fields
    verbalAgreementContact: '',
    verbalAgreementDate: '',
    verbalAgreementMethod: '',
    conditionsToFulfill: '',
    approvalsNeeded: '',
    insuranceSubmitted: false,
    
    // Contract Fields
    contractSignedDate: '',
    contractExpirationDate: '',
    rateSheetOnFile: false,
    msaSigned: false,
    
    // HR Contact
    hrContactId: '',
    
    // Decision Maker
    decisionMaker: '',
    
    // Additional Contact Roles
    operationsContactId: '',
    procurementContactId: '',
    billingContactId: '',
    safetyContactId: '',
    invoiceContactId: '',
  });

  const isEditing = !!jobOrderId;

  // Keep career job title draft aligned when loaded data or external updates change `formData.jobTitle`.
  useEffect(() => {
    setCareerJobTitleInput(String(formData.jobTitle ?? ''));
  }, [formData.jobTitle]);

  // Load the tenant's user groups once (for the "Auto-Add to User
  // Groups" Autocomplete above Financials). Mirrors `loadUserGroups`
  // in `JobPostForm.tsx`. Permission-denied → empty list, no error
  // toast (the field is optional and the modal should still load).
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingUserGroupsList(true);
        const userGroupsRef = collection(db, 'tenants', tenantId, 'userGroups');
        const snapshot = await getDocs(userGroupsRef);
        if (cancelled) return;
        const rows: UserGroupRow[] = snapshot.docs.map((d) => {
          const data = d.data() as {
            title?: string;
            name?: string;
            type?: string;
            autoCreatedFrom?: unknown;
          };
          // Mirrors `isAutoUserGroup` used in `RecruiterUserGroups.tsx`:
          // canonical = `type === 'auto'` OR an `autoCreatedFrom` audit
          // object exists. Surfaced as the "Auto" chip.
          const isAuto =
            data.type === 'auto' ||
            (data.autoCreatedFrom != null && typeof data.autoCreatedFrom === 'object');
          return {
            id: d.id,
            name: data.title || data.name || 'Unnamed Group',
            isAuto,
          };
        });
        setUserGroupsList(rows);
      } catch (err: any) {
        if (err?.code === 'permission-denied') {
          if (!cancelled) setUserGroupsList([]);
        } else {
          console.error('Error loading user groups for JobOrderForm:', err);
          if (!cancelled) setUserGroupsList([]);
        }
      } finally {
        if (!cancelled) setLoadingUserGroupsList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const userGroupsListForUi = useMemo(
    () => dedupeUserGroupsForUi(userGroupsList),
    [userGroupsList],
  );

  // Load account Pricing positions for gig job title options (after formData / loadedJobOrderData exist)
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    const rid = effectiveRecruiterAccountId;
    const cid = formData.companyId || null;
    (async () => {
      try {
        const positions = await fetchResolvedAccountPricingPositions(tenantId, {
          recruiterAccountId: rid,
          companyId: cid,
        });
        if (!cancelled) setResolvedAccountPositions(positions);
      } catch {
        if (!cancelled) setResolvedAccountPositions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, effectiveRecruiterAccountId, formData.companyId]);

  // Recruiter accounts: required picker (new job, Jobs hub) OR optional linker (edit / account-scoped create)
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const ref = collection(db, p.recruiterAccounts(tenantId));
        const snap = await getDocs(query(ref, orderBy('name', 'asc')));
        if (cancelled) return;
        const byId = new Map(snap.docs.map((d) => [d.id, d]));

        const list: PickerAccount[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            if (data.active === false) return null;
            const assoc = data.associations as
              | { companyIds?: string[]; locations?: unknown[] }
              | undefined;
            let companyIds = Array.isArray(assoc?.companyIds)
              ? assoc!.companyIds!.filter((x): x is string => typeof x === 'string' && !!x.trim())
              : [];
            const parentIdRaw = data.parentAccountId;
            const parentAccountId =
              typeof parentIdRaw === 'string' && parentIdRaw.trim() ? parentIdRaw.trim() : null;
            if (!companyIds.length && parentAccountId) {
              const parentDoc = byId.get(parentAccountId);
              const pa = parentDoc?.data()?.associations as { companyIds?: string[] } | undefined;
              if (Array.isArray(pa?.companyIds)) {
                companyIds = pa!.companyIds!.filter((x): x is string => typeof x === 'string' && !!x.trim());
              }
            }
            const he = data.hiringEntityId;
            const name = String(data.name ?? '').trim() || 'Unnamed account';
            const parentName = parentAccountId
              ? String(byId.get(parentAccountId)?.data()?.name ?? '').trim()
              : '';
            const label = parentName ? `${name} — ${parentName}` : name;
            const locRaw = assoc?.locations;
            const linkedLocations = Array.isArray(locRaw)
              ? locRaw
                  .filter(
                    (x: unknown): x is { companyId: string; locationId: string } =>
                      !!x &&
                      typeof x === 'object' &&
                      typeof (x as { companyId?: unknown }).companyId === 'string' &&
                      typeof (x as { locationId?: unknown }).locationId === 'string' &&
                      String((x as { companyId: string }).companyId).trim() !== '' &&
                      String((x as { locationId: string }).locationId).trim() !== '',
                  )
                  .map((x) => ({
                    companyId: String(x.companyId).trim(),
                    locationId: String(x.locationId).trim(),
                  }))
              : [];
            return {
              id: d.id,
              name,
              label,
              companyIds,
              hiringEntityId: he != null && String(he).trim() ? String(he) : null,
              parentAccountId,
              linkedLocations,
            };
          })
          .filter((x): x is PickerAccount => x != null);

        const accountIdsThatAreParents = new Set<string>();
        snap.docs.forEach((docSnap) => {
          const pid = (docSnap.data() as { parentAccountId?: unknown }).parentAccountId;
          if (typeof pid === 'string' && pid.trim()) accountIdsThatAreParents.add(pid.trim());
        });

        const listForNewJobRequiredAccount = list.filter((row) => {
          if (accountIdsThatAreParents.has(row.id)) return false;
          const raw = byId.get(row.id)?.data() as
            | { childAccountIds?: unknown; accountType?: unknown }
            | undefined;
          const childIds = raw?.childAccountIds;
          if (Array.isArray(childIds) && childIds.length > 0) return false;
          if (raw?.accountType === 'national') return false;
          return true;
        });

        setRecruiterAccountsAll(list);
        setRecruiterAccountsForPicker(listForNewJobRequiredAccount);
      } catch (e) {
        console.error('JobOrderForm: load recruiter accounts', e);
        if (!cancelled) {
          setRecruiterAccountsAll([]);
          setRecruiterAccountsForPicker([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  /** Optional bottom link only when creating without required account pick; edit mode uses Account in Basic Information instead. */
  const showOptionalRecruiterAccountLink = !isEditing && !requireAccountSelection;

  // Load companies (only when not provided, e.g. from account-scoped modal) and company defaults
  useEffect(() => {
    if (tenantId) {
      if (!propCompanies?.length) {
        loadCompanies();
      }
      loadCompanyDefaults();
      if (isEditing && jobOrderId) {
        loadJobOrder();
      }
      if (dealId) {
        loadAssociatedContacts();
      }
    }
  }, [tenantId, jobOrderId, dealId]);

  // When account-scoped companies are passed (e.g. from Account > New Job Order), use only those
  useEffect(() => {
    if (propCompanies?.length) {
      setCompanies(propCompanies as Company[]);
    }
  }, [propCompanies]);

  // Dedupe companies by id so Autocomplete never has duplicate keys (fixes "two children with the same key")
  const companiesDeduped = React.useMemo(() => {
    const seen = new Set<string>();
    return (companies || []).filter((c) => {
      if (!c?.id || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [companies]);

  /**
   * Account driving Company/Worksite when Account-first flow is on: explicit picker choice, or page context
   * (e.g. Account Details → New Order) when that account is a valid picker option (child/standalone, not national-only).
   */
  const scopeRecruiterAccountId = useMemo(() => {
    if (pickedRecruiterAccountId) return pickedRecruiterAccountId;
    if (
      requireAccountSelection &&
      !isEditing &&
      propRecruiterAccountId &&
      recruiterAccountsForPicker.some((a) => a.id === propRecruiterAccountId)
    ) {
      return propRecruiterAccountId;
    }
    return null;
  }, [pickedRecruiterAccountId, requireAccountSelection, isEditing, propRecruiterAccountId, recruiterAccountsForPicker]);

  const accountLinkedCompanyIds = useMemo(() => {
    if (!scopeRecruiterAccountId) return null;
    const acc =
      recruiterAccountsForPicker.find((a) => a.id === scopeRecruiterAccountId) ||
      recruiterAccountsAll.find((a) => a.id === scopeRecruiterAccountId);
    if (!acc) return null;
    const accountDrivesCompany =
      (requireAccountSelection && !isEditing) || isEditing;
    if (!accountDrivesCompany) return null;
    if (acc.parentAccountId && acc.linkedLocations.length === 1) {
      return [acc.linkedLocations[0].companyId];
    }
    const ids = (acc.companyIds || []).filter(Boolean);
    return ids.length ? ids : null;
  }, [
    requireAccountSelection,
    isEditing,
    scopeRecruiterAccountId,
    recruiterAccountsForPicker,
    recruiterAccountsAll,
  ]);

  const singleCompanyIdForAccount = useMemo(
    () => (accountLinkedCompanyIds?.length === 1 ? accountLinkedCompanyIds[0] : null),
    [accountLinkedCompanyIds]
  );

  const accountOptions = useMemo(
    () => (recruiterAccountsAll.length ? recruiterAccountsAll : recruiterAccountsForPicker),
    [recruiterAccountsAll, recruiterAccountsForPicker],
  );

  /** Child account with exactly one linked worksite on the account record — user cannot pick a different worksite. */
  const childWorksiteLocked = useMemo(() => {
    if (!scopeRecruiterAccountId) return false;
    const acc =
      recruiterAccountsForPicker.find((a) => a.id === scopeRecruiterAccountId) ||
      recruiterAccountsAll.find((a) => a.id === scopeRecruiterAccountId);
    if (!acc?.parentAccountId) return false;
    return acc.linkedLocations.length === 1;
  }, [scopeRecruiterAccountId, recruiterAccountsForPicker, recruiterAccountsAll]);

  const companiesForCompanyField = useMemo(() => {
    if (!requireAccountSelection || isEditing) return companiesDeduped;
    if (!accountLinkedCompanyIds?.length) return [];
    const idSet = new Set(accountLinkedCompanyIds);
    return companiesDeduped.filter((c) => idSet.has(c.id));
  }, [requireAccountSelection, isEditing, companiesDeduped, accountLinkedCompanyIds]);

  useEffect(() => {
    const accountDrivesCompanyWorksite =
      (requireAccountSelection && !isEditing) || isEditing;
    if (!accountDrivesCompanyWorksite) return;
    if (!scopeRecruiterAccountId) {
      if (isEditing) return;
      setFormData((prev) => {
        if (!prev.companyId && !prev.worksiteId) return prev;
        return { ...prev, companyId: '', worksiteId: '' };
      });
      return;
    }
    const acc =
      recruiterAccountsForPicker.find((a) => a.id === scopeRecruiterAccountId) ||
      recruiterAccountsAll.find((a) => a.id === scopeRecruiterAccountId);
    if (!acc) return;

    // Child venue account: use the single CRM worksite linked on the account (associations.locations).
    if (acc.parentAccountId && acc.linkedLocations.length === 1) {
      const { companyId: cid, locationId: lid } = acc.linkedLocations[0];
      setFormData((prev) => {
        if (prev.companyId === cid && prev.worksiteId === lid) return prev;
        return { ...prev, companyId: cid, worksiteId: lid };
      });
      return;
    }

    const ids = acc.companyIds.filter(Boolean);
    setFormData((prev) => {
      if (ids.length === 1) {
        // Preserve worksiteId whenever companyId already matches the
        // single allowed company. The previous short-circuit only kept
        // `prev` when `prev.worksiteId === ''`, which silently wiped a
        // saved worksite the moment `pickedRecruiterAccountId` resolved
        // during `loadJobOrder` — that's the "Worksite doesn't save"
        // symptom on JOs whose recruiter-account expands to exactly one
        // CRM company (the most common case).
        if (prev.companyId === ids[0]) return prev;
        return { ...prev, companyId: ids[0], worksiteId: '' };
      }
      if (ids.length > 1) {
        if (prev.companyId && ids.includes(prev.companyId)) return prev;
        return { ...prev, companyId: '', worksiteId: '' };
      }
      return { ...prev, companyId: '', worksiteId: '' };
    });
  }, [
    requireAccountSelection,
    isEditing,
    scopeRecruiterAccountId,
    recruiterAccountsForPicker,
    recruiterAccountsAll,
  ]);

  // National → child account → location_defaults → pre-fill compliance when creating a job order
  useEffect(() => {
    if (!tenantId || isEditing) return;
    const rid = effectiveRecruiterAccountId;
    if (!rid) return;
    const mergeSeq = ++orderDefaultsMergeSeqRef.current;
    let cancelled = false;
    (async () => {
      try {
        const jobTitleForCompliance =
          formData.jobType === 'gig'
            ? String(gigPositions[0]?.jobTitle ?? '').trim()
            : String(formData.jobTitle ?? '').trim();
        const merged = await fetchMergedRecruiterOrderDefaultsForJobOrder(tenantId, {
          recruiterAccountId: rid,
          companyId: formData.companyId || null,
          worksiteId: formData.worksiteId || null,
          jobTitle: jobTitleForCompliance || null,
        });
        if (cancelled || !merged || mergeSeq !== orderDefaultsMergeSeqRef.current) return;
        const od = merged.orderDetails;
        const bgLen = od.backgroundCheckPackages?.length ?? 0;
        // R.0d (Apr 2026): `od.drugScreeningPanels` is reading a soft-deprecated
        // field. Kept for now so legacy account-defaults docs continue to derive
        // `drugScreenRequired` correctly during the 90-day audit window.
        // Remove during R.0d hard-remove follow-up.
        const drugLen = od.drugScreeningPanels?.length ?? 0;
        const hasScreeningPackage = Boolean(
          merged.screeningPackageId != null && String(merged.screeningPackageId).trim() !== '',
        );
        setFormData((prev) => ({
          ...prev,
          screeningPackageId: merged.screeningPackageId,
          screeningPackageName: merged.screeningPackageName,
          eVerifyRequired: merged.eVerifyRequired,
          /* R.0d (Apr 2026): Legacy free-text BG/drug dropdowns retired —
             use AccuSource package + Additional Screenings. drugScreeningPanels
             write removed; backgroundCheckPackages still cleared explicitly
             during this transition. */
          backgroundCheckPackages: [] as string[],
          additionalScreenings: od.additionalScreenings ?? [],
          licensesCerts: od.licensesCerts ?? [],
          experienceRequired: od.experienceRequired ?? '',
          educationRequired: od.educationRequired ?? '',
          languagesRequired: od.languagesRequired ?? [],
          skillsRequired: od.skillsRequired ?? [],
          physicalRequirements: od.physicalRequirements ?? [],
          ppeRequirements: od.ppeRequirements ?? [],
          ppeProvidedBy:
            (od.ppeRequirements?.length ?? 0) > 0 ? (od.ppeProvidedBy ?? 'company') : '',
          requirementPackId: od.requirementPackId ?? '',
          dressCode: od.dressCode ?? [],
          customUniformRequirements: od.customUniformRequirements ?? '',
          decisionMaker: od.decisionMaker ?? '',
          hrContactId: od.hrContactId ?? '',
          operationsContactId: od.operationsContactId ?? '',
          procurementContactId: od.procurementContactId ?? '',
          billingContactId: od.billingContactId ?? '',
          safetyContactId: od.safetyContactId ?? '',
          invoiceContactId: od.invoiceContactId ?? '',
          backgroundCheckRequired: hasScreeningPackage || bgLen > 0,
          drugScreenRequired: drugLen > 0,
        }));
      } catch (e) {
        console.warn('JobOrderForm: merged recruiter order defaults failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    tenantId,
    isEditing,
    effectiveRecruiterAccountId,
    formData.companyId,
    formData.worksiteId,
    formData.jobType,
    formData.jobTitle,
    gigPositions[0]?.jobTitle,
  ]);

  const gigGrossProfitDisplay = useMemo(
    () => formatGigGrossProfit(formData.gigEstimatedValue, formData.gigAverageMarkup),
    [formData.gigEstimatedValue, formData.gigAverageMarkup]
  );

  const hasPpeRequirementsForJo = useMemo(
    () => Array.isArray(formData.ppeRequirements) && formData.ppeRequirements.length > 0,
    [formData.ppeRequirements],
  );

  // When opening New Job Order from an account/location, pre-fill Company and Worksite
  useEffect(() => {
    if (requireAccountSelection && !isEditing && !propRecruiterAccountId) return;
    if (!isEditing && (initialData?.companyId || initialData?.worksiteId)) {
      setFormData((prev) => {
        const next = { ...prev };
        if (initialData?.companyId && !prev.companyId) next.companyId = initialData.companyId;
        if (initialData?.worksiteId && !prev.worksiteId) next.worksiteId = initialData.worksiteId;
        return next;
      });
    }
  }, [initialData?.companyId, initialData?.worksiteId, isEditing, requireAccountSelection, propRecruiterAccountId]);

  // When Hiring Entity is set, E-Verify comes from entity (source of truth)
  useEffect(() => {
    if (formEntity) {
      setFormData((prev) => ({ ...prev, eVerifyRequired: formEntity.everifyRequired }));
    }
  }, [formEntity?.id, formEntity?.everifyRequired]);

  // Load locations when company changes
  useEffect(() => {
    if (formData.companyId) {
      loadLocations(formData.companyId);
    } else {
      setLocations([]);
      setFilteredLocations([]);
    }
  }, [formData.companyId]);

  // Set filtered locations (now they're already company-specific)
  useEffect(() => {
    
    // If we have a worksiteId but it's not in the current locations, we need to include it
    const finalLocations = formData.worksiteId && !locations.find(loc => loc.id === formData.worksiteId)
      ? [
          ...locations,
          {
            id: formData.worksiteId,
            name: 'Current Location',
            nickname: 'Current Location',
            companyId: formData.companyId
          }
        ]
      : [...locations];
    
    if (formData.worksiteId && !locations.find(loc => loc.id === formData.worksiteId)) {
    }
    
    setFilteredLocations(finalLocations);
  }, [locations, formData.worksiteId, formData.companyId]);

  /**
   * Worksite state for SUTA/FUTA (same as Account Pricing).
   *
   * Resolution order (most specific → most denormalized):
   *   1. The picked worksite location object inside `filteredLocations`.
   *   2. The JO's stored `worksiteAddress.state` (loaded directly from the
   *      JO doc). Required because cross-account worksites (e.g. JO under
   *      Account "Proof of the Pudding" with a worksite that lives under
   *      a child account or a different parent) get rendered with a stub
   *      `{ id, name: 'Current Location' }` that has no state — see the
   *      `setFilteredLocations` effect above. Without this fallback the
   *      "Apply SUTA/FUTA" button stays disabled even though the JO clearly
   *      has a TX/CA/etc. address on file.
   *   3. `worksiteAddress.address.state` (older imports nested it).
   *   4. Top-level `state` field (legacy JO docs).
   */
  const worksiteStateCodeForPricing = useMemo(() => {
    const selectedLocation = filteredLocations.find((loc) => loc.id === formData.worksiteId) as
      | (Location & { state?: string; address?: { state?: string } })
      | undefined;
    const fromLocation = selectedLocation?.state ?? selectedLocation?.address?.state;
    const fromLocationCode = normalizeStateCode(fromLocation).trim().toUpperCase();
    if (fromLocationCode) return fromLocationCode;

    const wa = (loadedJobOrderData as any)?.worksiteAddress;
    const fromJo =
      (wa && typeof wa === 'object'
        ? wa.state ?? wa.address?.state ?? wa.stateCode
        : undefined) ?? (loadedJobOrderData as any)?.state;
    return normalizeStateCode(fromJo).trim().toUpperCase();
  }, [filteredLocations, formData.worksiteId, loadedJobOrderData]);

  const applySutaFutaFromWorksiteState = () => {
    if (!worksiteStateCodeForPricing) return;
    const suta = getSutaRateByState(worksiteStateCodeForPricing);
    const futa = getFutaRateByState(worksiteStateCodeForPricing);
    if (formData.jobType === 'career') {
      // Force-overwrite the career top-level rates so the recruiter has
      // a one-click "reset to state defaults" path symmetric to the gig
      // multi-row fan-out below. Persists immediately when editing an
      // existing JO, mirroring how WC code/rate auto-apply persists.
      setFormData((prev) => {
        const next = {
          ...prev,
          ...(suta != null ? { sutaRate: String(suta) } : {}),
          futaRate: String(futa),
        };
        if (isEditing && jobOrderId) {
          if (suta != null) {
            void saveFieldToFirestore('sutaRate', String(suta), next);
          }
          void saveFieldToFirestore('futaRate', String(futa), next);
        }
        return next;
      });
      return;
    }
    setGigPositions((prev) =>
      prev.map((pos) => ({
        ...pos,
        ...(suta != null ? { sutaRate: String(suta) } : {}),
        futaRate: String(futa),
      })),
    );
  };

  // Load company contacts when companyId is present in formData
  useEffect(() => {
    if (formData.companyId && tenantId) {
      loadCompanyContacts(formData.companyId);
    }
  }, [formData.companyId, tenantId]);

  // Auto-apply WC code/rate from master when job title + worksite state match (Settings > Workers Comp Rates).
  // If Account Pricing only stored class code, fill rate from master by state+code (same as Account Pricing tab).
  useEffect(() => {
    if (
      !formData.worksiteId ||
      (Object.keys(wcMaps.byStateAndJobTitle).length === 0 &&
        Object.keys(wcMaps.byStateJobTitleAndModifierAccount).length === 0 &&
        Object.keys(wcMaps.wcRatesByStateAndCode).length === 0)
    )
      return;
    const selectedLocation = filteredLocations.find((loc) => loc.id === formData.worksiteId) as (Location & { state?: string; address?: { state?: string } }) | undefined;
    const stateRaw = selectedLocation?.state ?? selectedLocation?.address?.state;
    const stateCode = normalizeStateCode(stateRaw).trim().toUpperCase();
    if (!stateCode) return;

    if (formData.jobType === 'gig') {
      let updated = false;
      const next = gigPositions.map((pos) => {
        const jobTitle = (pos.jobTitle ?? '').trim();
        if (jobTitle) {
          const lookup = pickWorkersCompJobTitleLookup(wcMaps, stateCode, jobTitle, wcModifierAccountId);
          if (lookup) {
            if (pos.workersCompClassCode === lookup.code && String(pos.workersCompRate ?? '') === String(lookup.rate)) return pos;
            updated = true;
            return { ...pos, workersCompClassCode: lookup.code, workersCompRate: String(lookup.rate) };
          }
        }
        const code = (pos.workersCompClassCode ?? '').trim();
        if (code) {
          const rate = wcMaps.wcRatesByStateAndCode[`${stateCode}_${code}`];
          if (rate != null && !Number.isNaN(rate) && String(pos.workersCompRate ?? '') !== String(rate)) {
            updated = true;
            return { ...pos, workersCompRate: String(rate) };
          }
        }
        return pos;
      });
      if (updated) setGigPositions(next);
      return;
    }

    const jobTitle = (formData.jobTitle ?? '').trim();
    if (jobTitle) {
      const lookup = pickWorkersCompJobTitleLookup(wcMaps, stateCode, jobTitle, wcModifierAccountId);
      if (lookup) {
        setFormData((prev) => {
          if (prev.workersCompClassCode === lookup.code && String(prev.workersCompRate ?? '') === String(lookup.rate)) return prev;
          return { ...prev, workersCompClassCode: lookup.code, workersCompRate: String(lookup.rate) };
        });
        return;
      }
    }
    const code = (formData.workersCompClassCode ?? '').trim();
    if (code) {
      const rate = wcMaps.wcRatesByStateAndCode[`${stateCode}_${code}`];
      if (rate != null && !Number.isNaN(rate)) {
        setFormData((prev) => {
          if (String(prev.workersCompRate ?? '') === String(rate)) return prev;
          return { ...prev, workersCompRate: String(rate) };
        });
      }
    }
  }, [
    formData.worksiteId,
    formData.jobTitle,
    formData.jobType,
    formData.workersCompClassCode,
    gigPositions,
    filteredLocations,
    wcMaps,
    wcModifierAccountId,
  ]);

  /**
   * Auto-apply SUTA / FUTA from worksite state — gig positions only.
   *
   * Default policy (Greg, 2026-04-30): for hiring entities that pay
   * unemployment tax on payroll (today: C1 Workforce / C1 Select LLC,
   * gated by `showSutaFutaOnGigPositions`), once a gig position has
   * BOTH pay rate AND bill rate AND a worksite location with a
   * resolvable state code, the new-employer SUTA + state-effective
   * FUTA should propagate without the recruiter having to click the
   * explicit "Apply SUTA/FUTA from worksite state" button.
   *
   * **Fill-only-when-empty semantics** — if a recruiter has manually
   * typed a custom SUTA rate (e.g. an experience-rated value that
   * differs from the new-employer estimate), we leave it alone. The
   * explicit Apply button still serves as the "force overwrite" path
   * for resetting a row back to state defaults. Same for FUTA.
   *
   * Mirrors the WC-rate auto-apply effect above so the codebase has
   * a consistent pattern for "tax-rate auto-fill from registry data".
   */
  useEffect(() => {
    if (formData.jobType !== 'gig') return;
    if (!showSutaFutaOnGigPositions) return;
    if (!worksiteStateCodeForPricing) return;

    const sutaForState = getSutaRateByState(worksiteStateCodeForPricing);
    const futaForState = getFutaRateByState(worksiteStateCodeForPricing);
    // SUTA can return null for an unrecognised state code (defensive —
    // the registry covers 50+DC, but the lookup tolerates user-entered
    // garbage). FUTA always returns a value (0.6% standard).
    if (sutaForState == null && futaForState == null) return;

    let updated = false;
    const next = gigPositions.map((pos) => {
      // Pre-conditions per Greg's spec: position has both pay AND bill
      // (a "real" pricing row, not just a placeholder), and the SUTA
      // or FUTA cell is currently empty.
      const pay = parseFloat(String((pos as { payRate?: string }).payRate ?? ''));
      const bill = parseFloat(String((pos as { billRate?: string }).billRate ?? ''));
      if (!Number.isFinite(pay) || pay <= 0) return pos;
      if (!Number.isFinite(bill) || bill <= 0) return pos;

      const sutaEmpty =
        pos.sutaRate == null || String(pos.sutaRate).trim() === '';
      const futaEmpty =
        pos.futaRate == null || String(pos.futaRate).trim() === '';
      if (!sutaEmpty && !futaEmpty) return pos;

      const patch: { sutaRate?: string; futaRate?: string } = {};
      if (sutaEmpty && sutaForState != null) {
        patch.sutaRate = String(sutaForState);
      }
      if (futaEmpty) {
        patch.futaRate = String(futaForState);
      }
      if (Object.keys(patch).length === 0) return pos;
      updated = true;
      return { ...pos, ...patch };
    });
    if (updated) setGigPositions(next);
  }, [
    formData.jobType,
    showSutaFutaOnGigPositions,
    worksiteStateCodeForPricing,
    gigPositions,
  ]);

  /**
   * Career counterpart to the gig-position auto-fill above. Same
   * "fill-only-when-empty + only when the row has real pricing"
   * semantics, just against `formData.sutaRate / futaRate` instead of
   * `gigPositions[i]`. Pricing is "real" when payRate > 0 AND either
   * a typed billRate > 0 or a markup > 0 (`calculatedBillRate` follows).
   * Recruiter-edited custom values are never overwritten — the explicit
   * Apply button is the force-reset path.
   */
  useEffect(() => {
    if (formData.jobType !== 'career') return;
    if (!showSutaFutaOnGigPositions) return;
    if (!worksiteStateCodeForPricing) return;

    const pay = parseFloat(String(formData.payRate ?? ''));
    if (!Number.isFinite(pay) || pay <= 0) return;
    const bill = parseFloat(String(formData.billRate ?? ''));
    const markup = parseFloat(String(formData.markup ?? ''));
    const hasPricing =
      (Number.isFinite(bill) && bill > 0) ||
      (Number.isFinite(markup) && markup > 0);
    if (!hasPricing) return;

    const sutaForState = getSutaRateByState(worksiteStateCodeForPricing);
    const futaForState = getFutaRateByState(worksiteStateCodeForPricing);
    if (sutaForState == null && futaForState == null) return;

    const sutaEmpty =
      formData.sutaRate == null || String(formData.sutaRate).trim() === '';
    const futaEmpty =
      formData.futaRate == null || String(formData.futaRate).trim() === '';
    if (!sutaEmpty && !futaEmpty) return;

    const patch: { sutaRate?: string; futaRate?: string } = {};
    if (sutaEmpty && sutaForState != null) patch.sutaRate = String(sutaForState);
    if (futaEmpty && futaForState != null) patch.futaRate = String(futaForState);
    if (Object.keys(patch).length === 0) return;

    setFormData((prev) => {
      const next = { ...prev, ...patch };
      // Persist immediately when editing — matches the WC auto-apply pattern
      // for career and avoids the recruiter losing the auto-filled rate if
      // they navigate away without explicitly hitting Save.
      if (isEditing && jobOrderId) {
        if (patch.sutaRate != null) {
          void saveFieldToFirestore('sutaRate', patch.sutaRate, next);
        }
        if (patch.futaRate != null) {
          void saveFieldToFirestore('futaRate', patch.futaRate, next);
        }
      }
      return next;
    });
  }, [
    formData.jobType,
    formData.payRate,
    formData.billRate,
    formData.markup,
    formData.sutaRate,
    formData.futaRate,
    showSutaFutaOnGigPositions,
    worksiteStateCodeForPricing,
    isEditing,
    jobOrderId,
  ]);

  /**
   * Auto-save gig positions to Firestore on change.
   *
   * Other fields auto-save via `handleInputChange` / `handleFieldBlur`,
   * but gig positions live in their own state array (`gigPositions`) and
   * mutate via `setGigPositions` directly — so without this effect they
   * would only persist when the user clicks the Save button. With Save
   * removed (UI is fully blur-driven), this effect closes the loop.
   *
   * The effect debounces by 600ms to coalesce rapid keystrokes, and
   * tracks the last persisted signature in a ref so the load-time
   * `setGigPositions(loaded)` call doesn't immediately re-save the same
   * data back to Firestore.
   */
  const gigPositionsLastSavedSigRef = useRef<string | null>(null);
  const gigPositionsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  useEffect(() => {
    if (!isEditing || !jobOrderId) return;
    if (formData.jobType !== 'gig') return;
    const sig = JSON.stringify(normalizeGigPositionsForPersist(gigPositions as any));
    // Seed on first observation (initial mount or load) so we don't
    // re-save the freshly loaded array.
    if (gigPositionsLastSavedSigRef.current === null) {
      gigPositionsLastSavedSigRef.current = sig;
      return;
    }
    if (sig === gigPositionsLastSavedSigRef.current) return;
    if (gigPositionsSaveTimerRef.current) {
      clearTimeout(gigPositionsSaveTimerRef.current);
    }
    gigPositionsSaveTimerRef.current = setTimeout(() => {
      gigPositionsLastSavedSigRef.current = sig;
      void saveFieldToFirestore('gigPositions', gigPositions, formDataRef.current);
    }, 600);
    return () => {
      if (gigPositionsSaveTimerRef.current) {
        clearTimeout(gigPositionsSaveTimerRef.current);
      }
    };
    // saveFieldToFirestore captures latest state via formDataRef; only
    // trigger on real position / mode changes, not on every formData edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gigPositions, isEditing, jobOrderId, formData.jobType]);

  /**
   * Keep the Positions-tab sub-nav index valid when the position list
   * grows / shrinks. Without this, deleting the currently-active
   * position would leave the strip pointing at a stale index and the
   * panel below would render nothing. We clamp to the last position;
   * "Add Position" elsewhere explicitly jumps the strip to the new
   * tail so the recruiter lands on the position they just created.
   */
  useEffect(() => {
    const last = Math.max(0, gigPositions.length - 1);
    setPositionsSubTab((prev) => {
      if (gigPositions.length === 0) return 0;
      if (prev > last) return last;
      return prev;
    });
  }, [gigPositions.length]);

  const loadCompanies = async () => {
    try {
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const companiesSnapshot = await getDocs(companiesRef);
      const companiesData = companiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Company[];
      setCompanies(companiesData);
    } catch (error) {
      console.error('Error loading companies:', error);
    }
  };

  const loadLocations = async (companyId?: string) => {
    if (!companyId) {
      setLocations([]);
      return;
    }
    
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const locationsSnapshot = await getDocs(locationsRef);
      const locationsData = locationsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Location[];
      setLocations(locationsData);
      console.log(`Loaded ${locationsData.length} locations for company ${companyId}:`, locationsData);
    } catch (error) {
      console.error('Error loading locations:', error);
      setLocations([]);
    }
  };

  const loadCompanyDefaults = async () => {
    try {
      const docRef = doc(db, 'tenants', tenantId, 'settings', 'company-defaults');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setBackgroundCheckPackages(data.backgroundPackages || []);
        // R.0d (Apr 2026): setDrugScreeningPanels removed (state was already
        // dropped above). The screeningPanels collection on company-defaults
        // is no longer surfaced anywhere.
        setUniformRequirements(data.uniformRequirements || []);
        setPpeOptions(data.ppe || []);
        setLicensesCerts(data.licensesCerts || []);
        setExperienceLevels(data.experienceLevels || []);
        setEducationLevels(data.educationLevels || []);
        setPhysicalRequirements(data.physicalRequirements || []);
        setLanguages(data.languages || []);
        setSkills(data.skills || []);
      }
    } catch (error) {
      console.error('Error loading company defaults:', error);
    }
  };

  const loadAndApplyCompanyDefaults = async (companyId: string, currentFormData: any) => {
    if (!companyId || !tenantId) return;
    
    try {
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      const companySnap = await getDoc(companyRef);
      
      if (!companySnap.exists()) return;
      
      const companyData = companySnap.data();
      const defaults = companyData.defaults || {};
      const rules = defaults.rules || {};
      const eVerify = defaults.eVerify || {};
      const billing = defaults.billing || {};
      
      const updates: any = {};
      
      // For NEW job orders: Always apply company defaults (overwrite existing values)
      // For EXISTING job orders: Only apply defaults if fields are empty (preserve existing values)
      const shouldApplyDefault = (fieldValue: any, defaultValue: any) => {
        if (!isEditing) {
          // New job order: always apply if default exists
          return defaultValue !== undefined;
        } else {
          // Existing job order: only apply if field is empty and default exists
          return !fieldValue && defaultValue !== undefined;
        }
      };
      
      if (shouldApplyDefault(currentFormData.replacingExistingAgency, rules.replacingExistingAgency)) {
        updates.replacingExistingAgency = rules.replacingExistingAgency;
      }
      if (shouldApplyDefault(currentFormData.rolloverExistingStaff, rules.rolloverExistingStaff)) {
        updates.rolloverExistingStaff = rules.rolloverExistingStaff;
      }
      if (shouldApplyDefault(currentFormData.timeclockSystem, rules.timeclockSystem)) {
        updates.timeclockSystem = rules.timeclockSystem;
      }
      if (shouldApplyDefault(currentFormData.attendancePolicy, rules.attendancePolicy)) {
        updates.attendancePolicy = rules.attendancePolicy;
      }
      if (shouldApplyDefault(currentFormData.noShowPolicy, rules.noShowPolicy)) {
        updates.noShowPolicy = rules.noShowPolicy;
      }
      if (shouldApplyDefault(currentFormData.overtimePolicy, rules.overtimePolicy)) {
        updates.overtimePolicy = rules.overtimePolicy;
      }
      if (shouldApplyDefault(currentFormData.callOffPolicy, rules.callOffPolicy)) {
        updates.callOffPolicy = rules.callOffPolicy;
      }
      if (shouldApplyDefault(currentFormData.injuryHandlingPolicy, rules.injuryHandlingPolicy)) {
        updates.injuryHandlingPolicy = rules.injuryHandlingPolicy;
      }
      if (shouldApplyDefault(currentFormData.disciplinePolicy, rules.disciplinePolicy)) {
        updates.disciplinePolicy = rules.disciplinePolicy;
      }
      if (shouldApplyDefault(currentFormData.eVerifyRequired, eVerify.eVerifyRequired)) {
        updates.eVerifyRequired = eVerify.eVerifyRequired;
      }
      if (shouldApplyDefault(currentFormData.poRequired, billing.poRequired)) {
        updates.poRequired = billing.poRequired;
      }
      if (shouldApplyDefault(currentFormData.paymentTerms, billing.paymentTerms)) {
        updates.paymentTerms = billing.paymentTerms;
      }
      if (shouldApplyDefault(currentFormData.invoiceDeliveryMethod, billing.invoiceDeliveryMethod)) {
        updates.invoiceDeliveryMethod = billing.invoiceDeliveryMethod;
      }
      if (shouldApplyDefault(currentFormData.invoiceFrequency, billing.invoiceFrequency)) {
        updates.invoiceFrequency = billing.invoiceFrequency;
      }
      
      // Apply updates to formData if any
      if (Object.keys(updates).length > 0) {
        setFormData((prev: any) => ({ ...prev, ...updates }));
        
        // If editing, save to Firestore
        if (isEditing && jobOrderId) {
          // Save each field individually to Firestore
          for (const [field, value] of Object.entries(updates)) {
            await saveFieldToFirestore(field, value, { ...currentFormData, ...updates });
          }
        }
      }
    } catch (error) {
      console.error('Error loading company defaults:', error);
    }
  };

  const loadCompanyContacts = async (companyId: string) => {
    if (!companyId || !tenantId) return;
    
    console.log('🔍 Loading company contacts for company:', companyId);
    
    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const contactsQuery = query(contactsRef, where('companyId', '==', companyId));
      const contactsSnapshot = await getDocs(contactsQuery);
      const contactsData = contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      console.log('🔍 Loaded contacts for company', companyId, ':', contactsData.length, 'contacts');
      console.log('🔍 Contact details:', contactsData.map((c: any) => ({ 
        id: c.id, 
        name: c.contactName || c.fullName || c.firstName + ' ' + c.lastName,
        companyName: c.companyName,
        dealRole: c.dealRole
      })));
      
      // Load worksite information for each contact
      const contactsWithWorksites = await Promise.all(
        contactsData.map(async (contact: any) => {
          const worksites = [];
          
          // Check if contact has locationId
          if (contact.locationId) {
            try {
              const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', contact.locationId);
              const locationDoc = await getDoc(locationRef);
              if (locationDoc.exists()) {
                worksites.push({
                  id: contact.locationId,
                  name: locationDoc.data().nickname || locationDoc.data().name || contact.locationName || 'Unknown Location'
                });
              }
            } catch (error) {
              console.warn('Error loading location for contact:', contact.id, error);
            }
          }
          
          // Check if contact has associations.locations
          if (contact.associations?.locations) {
            for (const locationId of contact.associations.locations) {
              try {
                const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId);
                const locationDoc = await getDoc(locationRef);
                if (locationDoc.exists()) {
                  worksites.push({
                    id: locationId,
                    name: locationDoc.data().nickname || locationDoc.data().name || 'Unknown Location'
                  });
                }
              } catch (error) {
                console.warn('Error loading associated location for contact:', contact.id, locationId, error);
              }
            }
          }
          
          return {
            ...contact,
            worksites
          };
        })
      );
      
      setLoadedContacts(contactsWithWorksites);
      console.log('🔍 Set loaded contacts with worksites:', contactsWithWorksites);
      
    } catch (error) {
      console.error('Error loading company contacts:', error);
      setLoadedContacts([]);
    }
  };

  const loadAssociatedContacts = async () => {
    if (!dealId || !tenantId) {
      console.log('🔍 JobOrderForm: Cannot load contacts - missing dealId or tenantId:', { dealId, tenantId });
      return;
    }
    
    console.log('🔍 JobOrderForm: Loading associated contacts for deal:', dealId);
    
    try {
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      const dealSnap = await getDoc(dealRef);
      
      if (dealSnap.exists()) {
        const dealData = dealSnap.data();
        console.log('🔍 JobOrderForm: Deal data:', dealData);
        
        // Check for contacts in different possible locations
        let contactIds: string[] = [];
        
        // Try different possible structures
        if (dealData.associatedContacts && Array.isArray(dealData.associatedContacts)) {
          contactIds = dealData.associatedContacts;
        } else if (dealData.associations?.contacts && Array.isArray(dealData.associations.contacts)) {
          contactIds = dealData.associations.contacts.map((contact: any) => 
            typeof contact === 'string' ? contact : contact.id
          );
        } else if (dealData.contactRoles?.hr?.id) {
          // If there's an HR contact role, include it
          contactIds = [dealData.contactRoles.hr.id];
        }
        
        console.log('🔍 JobOrderForm: Found contact IDs in deal:', contactIds);
        
        if (contactIds.length > 0) {
          const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
          const contactsSnapshot = await getDocs(contactsRef);
          const contacts = contactsSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(contact => contactIds.includes(contact.id)) as Contact[];
          
          console.log('🔍 JobOrderForm: Loaded contacts:', contacts);
          setAssociatedContacts(contacts);
          
          // Auto-select Melissa Mellett as the default HR contact if no HR contact is currently set
          if (!formData.hrContactId && contacts.length > 0) {
            const melissaMellett = contacts.find(contact => 
              contact.fullName?.toLowerCase().includes('melissa') && 
              contact.fullName?.toLowerCase().includes('mellett')
            );
            
            if (melissaMellett) {
              console.log('🔍 JobOrderForm: Auto-selecting Melissa Mellett as default HR contact:', melissaMellett);
              setFormData(prev => ({
                ...prev,
                hrContactId: melissaMellett.id
              }));
            }
          }
        } else {
          console.log('🔍 JobOrderForm: No contact IDs found in deal data');
          setAssociatedContacts([]);
        }
        
        // Also check if there's an existing HR contact in the job order that we should include
        if (formData.hrContactId && !contactIds.includes(formData.hrContactId)) {
          console.log('🔍 JobOrderForm: Loading existing HR contact:', formData.hrContactId);
          try {
            const hrContactRef = doc(db, 'tenants', tenantId, 'crm_contacts', formData.hrContactId);
            const hrContactSnap = await getDoc(hrContactRef);
            if (hrContactSnap.exists()) {
              const hrContact = { id: hrContactSnap.id, ...hrContactSnap.data() } as Contact;
              setAssociatedContacts(prev => {
                const exists = prev.some(c => c.id === hrContact.id);
                return exists ? prev : [...prev, hrContact];
              });
              console.log('🔍 JobOrderForm: Added existing HR contact to list:', hrContact);
            }
          } catch (error) {
            console.error('Error loading existing HR contact:', error);
          }
        }
      } else {
        console.log('🔍 JobOrderForm: Deal not found:', dealId);
        setAssociatedContacts([]);
      }
    } catch (error) {
      console.error('Error loading associated contacts:', error);
    }
  };

  const loadJobOrder = async () => {
    if (!jobOrderId || !tenantId) return;
    
    setLoading(true);
    try {
      // Try tenant-scoped path first
      const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
      let jobOrderSnap = await getDoc(jobOrderRef);
      
      if (!jobOrderSnap.exists()) {
        // Fallback to top-level collection
        const topLevelJobOrderRef = doc(db, 'jobOrders', jobOrderId);
        jobOrderSnap = await getDoc(topLevelJobOrderRef);
      }
      
      if (jobOrderSnap.exists()) {
        const data = jobOrderSnap.data() as JobOrder;
        // Store the loaded job order data for preserving associations
        setLoadedJobOrderData(data);
        
        // Check for stageData in both top-level and embedded deal object
        const stageData = (data as any).stageData || (data as any).deal?.stageData || {};

        // R.16.2c — snapshot precedence for the JO-form display reads.
        // After Push-to-Active writes `jo.snapshot.physicalRequirements`
        // (or `customUniformRequirements`), the form must show the
        // snapshot value rather than the raw JO field — otherwise the
        // operator pushes from the parent, sees "0 affected" gone away,
        // then opens a JO and the form looks empty / stale, contradicting
        // what the push dialog reported.
        //
        // Mirrors the `hiringEntityIdForForm` wrap above (R.16.2a).
        // `data` IS the JO doc, so it carries `snapshot.*` if the JO has
        // been activated. Drafts + pre-§16.1 active JOs without a
        // snapshot fall back to the existing read order.
        const joForFormRead = data as unknown as JobOrderForEffectiveRead;
        const rawPhysical = Array.isArray((data as any).physicalRequirements)
          ? ((data as any).physicalRequirements as string[])
          : ((stageData.scoping?.compliance?.physicalRequirements as string[] | undefined) || []);
        const { value: physicalRequirementsForForm } = getEffectiveJobOrderField<string[] | string>(
          joForFormRead,
          'physicalRequirements',
          { fallback: rawPhysical },
        );
        const physicalRequirementsResolved = Array.isArray(physicalRequirementsForForm)
          ? physicalRequirementsForForm
          : typeof physicalRequirementsForForm === 'string' && physicalRequirementsForForm.trim() !== ''
          ? [physicalRequirementsForForm]
          : [];
        const rawCustomUniform =
          (data as any).customUniformRequirements ||
          stageData.scoping?.customUniformRequirements ||
          '';
        const { value: customUniformForForm } = getEffectiveJobOrderField<string>(
          joForFormRead,
          'customUniformRequirements',
          { fallback: rawCustomUniform as string },
        );
        const customUniformResolved =
          typeof customUniformForForm === 'string' ? customUniformForForm : '';

        // Worksite / Company resolution mirrors `RecruiterJobOrderDetail`'s
        // sidebar Location card. Older JOs (created before the
        // `JobOrderForm` create path was fixed to denormalize
        // `companyId` / `worksiteId` / `companyName` / `worksiteName` onto
        // the JO doc) only persist some of these:
        //   - `accountId` / `locationId` (the "new" mirror fields), or
        //   - `deal.companyId` / `deal.worksiteId`, or
        //   - `deal.locations[0].id` (legacy multi-location deals).
        // Without this fallback, the Worksite Autocomplete on a perfectly
        // valid JO renders empty even though the right-sidebar Location
        // card resolves the location fine — exactly the symptom the user
        // saw on the "Distribution Hall Gigs" JO. We hydrate from any
        // available source so the form mirrors the rest of the UI.
        const dealEmbedded = (data as any).deal as Record<string, any> | undefined;
        const dealLocations = Array.isArray(dealEmbedded?.locations) ? dealEmbedded?.locations : [];
        const firstDealLocation = (dealLocations as any[])[0] as Record<string, any> | undefined;
        const resolvedCompanyId =
          (data as any).companyId ||
          (data as any).accountId ||
          dealEmbedded?.companyId ||
          firstDealLocation?.companyId ||
          '';
        const resolvedWorksiteId =
          (data as any).worksiteId ||
          (data as any).locationId ||
          dealEmbedded?.worksiteId ||
          firstDealLocation?.id ||
          firstDealLocation?.locationId ||
          '';

        setFormData({
          // Basic Information
          jobOrderNumber: data.jobOrderNumber || '',
          jobOrderName: data.jobOrderName || '',
          jobTitle: (data as any).jobTitle || (stageData.discovery?.jobTitles?.[0] || ''),
          description: data.jobOrderDescription || '',
          jobDescriptionFromClient: (data as any).jobDescriptionFromClient || '',
          companyId: resolvedCompanyId,
          worksiteId: resolvedWorksiteId,
          status: data.status || 'draft',
          jobType: (data as any).jobType || 'career',
          workersNeeded: data.workersNeeded || 1,
          payRate: (data as any).payRate || '',
          markup: (data as any).markup || '',
          billRate: (data as any).billRate || '',
          calculatedBillRate: (() => {
            const pay = parseFloat(String((data as any).payRate || '')) || 0;
            const m = parseFloat(String((data as any).markup || '')) || 0;
            const calc = (data as any).calculatedBillRate;
            if (typeof calc === 'number' && calc > 0) return String(calc);
            if (m > 0 && pay > 0) return String(Number((pay * (1 + m / 100)).toFixed(2)));
            return '';
          })(),
          priority: (data as any).priority || '',
          shiftType: (data as any).shiftType || '',
          startDate: (data as any).startDate || '',
          endDate: (data as any).endDate || '',
          requirements: (data as any).requirements || '',
          notes: (data as any).notes || '',
          
          // Discovery Stage Fields - from stageData.discovery
          currentStaffCount: stageData.discovery?.currentStaffCount?.toString() || '',
          currentAgencyCount: stageData.discovery?.currentAgencyCount?.toString() || '',
          currentSatisfactionLevel: stageData.discovery?.currentSatisfactionLevel || '',
          currentStruggles: stageData.discovery?.currentStruggles?.join(', ') || '',
          hasUsedAgenciesBefore: stageData.discovery?.hasUsedAgenciesBefore || false,
          lastAgencyUsed: stageData.discovery?.lastAgencyUsed || '',
          reasonStoppedUsingAgencies: stageData.discovery?.reasonStoppedUsingAgencies || '',
          openToUsingAgenciesAgain: stageData.discovery?.openToUsingAgenciesAgain || false,
          additionalJobTitles: stageData.discovery?.additionalJobTitles?.join(', ') || '',
          shiftTimes: stageData.discovery?.shiftTimes?.join(', ') || '',
          employmentType: stageData.discovery?.employmentType || '',
          onsiteSupervisionRequired: stageData.discovery?.onsiteSupervisionRequired || false,
          
          // Qualification Stage Fields - from stageData.qualification
          mustHaveRequirements: stageData.qualification?.mustHaveRequirements || '',
          mustAvoidRequirements: stageData.qualification?.mustAvoidRequirements || '',
          potentialObstacles: stageData.qualification?.potentialObstacles?.join(', ') || '',
          expectedStartDate: stageData.qualification?.expectedStartDate || '',
          initialHeadcount: stageData.qualification?.staffPlacementTimeline?.starting?.toString() || '',
          headcountAfter30Days: stageData.qualification?.staffPlacementTimeline?.after30Days?.toString() || '',
          headcountAfter90Days: stageData.qualification?.staffPlacementTimeline?.after90Days?.toString() || '',
          headcountAfter180Days: stageData.qualification?.staffPlacementTimeline?.after180Days?.toString() || '',
          expectedPayRate: stageData.qualification?.expectedAveragePayRate?.toString() || '',
          expectedMarkup: stageData.qualification?.expectedAverageMarkup?.toString() || '',
          experienceLevel: stageData.qualification?.experienceLevel || '',
          
          // Scoping Stage Fields - from stageData.scoping
          replacingExistingAgency: stageData.scoping?.replacingExistingAgency || false,
          rolloverExistingStaff: stageData.scoping?.rolloverExistingStaff || false,
          /* R.0d (Apr 2026): drugScreeningPanels write removed; legacy data
             on the JO doc is preserved untouched. backgroundCheckPackages
             still cleared explicitly during the AccuSource transition. */
          backgroundCheckPackages: [] as string[],
          additionalScreenings: Array.isArray((data as any).additionalScreenings)
            ? (data as any).additionalScreenings
            : (stageData.scoping?.compliance?.additionalScreenings || []),
          eVerifyRequired: stageData.scoping?.compliance?.eVerify || false,
          dressCode: Array.isArray((data as any).dressCode)
            ? (data as any).dressCode
            : stageData.scoping?.uniformRequirements || [],
          // R.16.2c — snapshot precedence (see `customUniformResolved` above).
          customUniformRequirements: customUniformResolved,
          showCustomUniformRequirements: (data as any).showCustomUniformRequirements || stageData.scoping?.showCustomUniformRequirements || false,
          timeclockSystem: stageData.scoping?.timeclockSystem || '',
          disciplinePolicy: stageData.scoping?.disciplinePolicy || '',
          poRequired: stageData.scoping?.poRequired || false,
          paymentTerms: stageData.scoping?.paymentTerms || '',
          invoiceDeliveryMethod: stageData.scoping?.invoiceDeliveryMethod || '',
          invoiceFrequency: stageData.scoping?.invoiceFrequency || '',
          
          // Compliance Fields - from stageData.scoping.compliance
          backgroundCheckRequired: stageData.scoping?.compliance?.backgroundCheck || false,
          drugScreenRequired: stageData.scoping?.compliance?.drugScreen || false,
          licensesCerts: Array.isArray((data as any).licensesCerts)
            ? (data as any).licensesCerts
            : (stageData.scoping?.compliance?.licensesCerts || []),
          experienceRequired: stageData.scoping?.compliance?.experience || '',
          educationRequired: stageData.scoping?.compliance?.education || '',
          languagesRequired: Array.isArray((data as any).languagesRequired)
            ? (data as any).languagesRequired
            : (stageData.scoping?.compliance?.languages || []),
          skillsRequired: Array.isArray((data as any).skillsRequired)
            ? (data as any).skillsRequired
            : (stageData.scoping?.compliance?.skills || []),
          // R.16.2c — snapshot precedence (see `physicalRequirementsResolved` above).
          physicalRequirements: physicalRequirementsResolved,
          ppeRequirements: (() => {
            const r = Array.isArray((data as any).ppeRequirements)
              ? (data as any).ppeRequirements
              : (stageData.scoping?.compliance?.ppe || []);
            return Array.isArray(r) ? r : [];
          })(),
          ppeProvidedBy: (() => {
            const r = Array.isArray((data as any).ppeRequirements)
              ? (data as any).ppeRequirements
              : (stageData.scoping?.compliance?.ppe || []);
            const list = Array.isArray(r) ? r : [];
            return list.length > 0
              ? stageData.scoping?.compliance?.ppeProvidedBy || (data as any).ppeProvidedBy || 'company'
              : '';
          })(),
          requirementPackId: (data as any).requirementPackId || '',
          workersCompClassCode: (data as any).workersCompClassCode || '',
          workersCompRate: (data as any).workersCompRate != null ? String((data as any).workersCompRate) : '',
          // Career-only top-level SUTA/FUTA. Tolerate the legacy
          // `suta`/`futa` keys a few imported career JOs use.
          sutaRate: (() => {
            const v = (data as any).sutaRate ?? (data as any).suta;
            return v != null && v !== '' ? String(v) : '';
          })(),
          futaRate: (() => {
            const v = (data as any).futaRate ?? (data as any).futa;
            return v != null && v !== '' ? String(v) : '';
          })(),
          screeningPackageId: String((data as any).screeningPackageId ?? '').trim(),
          screeningPackageName: String((data as any).screeningPackageName ?? '').trim(),
          
          // Customer Rules - from stageData.scoping.customerRules
          attendancePolicy: stageData.scoping?.customerRules?.attendance || '',
          noShowPolicy: stageData.scoping?.customerRules?.noShows || '',
          overtimePolicy: stageData.scoping?.customerRules?.overtime || '',
          callOffPolicy: stageData.scoping?.customerRules?.callOffs || '',
          injuryHandlingPolicy: stageData.scoping?.customerRules?.injuryHandling || '',
          
          // Agreement Fields - from stageData.verbalAgreement
          verbalAgreementContact: stageData.verbalAgreement?.contact || '',
          verbalAgreementDate: stageData.verbalAgreement?.date || '',
          verbalAgreementMethod: stageData.verbalAgreement?.method || '',
          conditionsToFulfill: stageData.verbalAgreement?.conditionsToFulfill?.join(', ') || '',
          approvalsNeeded: stageData.verbalAgreement?.approvalsNeeded?.join(', ') || '',
          insuranceSubmitted: stageData.verbalAgreement?.insuranceSubmitted || false,
          
          // Contract Fields - from stageData.closedWon
          contractSignedDate: stageData.closedWon?.contractSignedDate || '',
          contractExpirationDate: stageData.closedWon?.contractExpirationDate || '',
          rateSheetOnFile: stageData.closedWon?.rateSheetOnFile || false,
          msaSigned: stageData.closedWon?.msaSigned || false,
          
          // HR Contact
          hrContactId: (data as any).hrContactId || (data as any).deal?.hrContactId || '',
          
          // Decision Maker
          decisionMaker: (data as any).decisionMaker || stageData.qualification?.decisionMaker?.id || '',
          
          // Additional Contact Roles
          operationsContactId: (data as any).operationsContactId || (data as any).deal?.operationsContactId || '',
          procurementContactId: (data as any).procurementContactId || (data as any).deal?.procurementContactId || '',
          billingContactId: (data as any).billingContactId || (data as any).deal?.billingContactId || '',
          safetyContactId: (data as any).safetyContactId || (data as any).deal?.safetyContactId || '',
          invoiceContactId: (data as any).invoiceContactId || (data as any).deal?.invoiceContactId || '',
          
          // Gig Financials
          poNumber: (data as any).poNumber ?? '',
          gigEstimatedValue:
            (data as any).gigEstimatedValue != null && (data as any).gigEstimatedValue !== ''
              ? String((data as any).gigEstimatedValue)
              : '',
          gigAverageMarkup:
            (data as any).gigAverageMarkup != null && (data as any).gigAverageMarkup !== ''
              ? String((data as any).gigAverageMarkup)
              : '',
          gigEstimatedStartDate: toISODate((data as any).gigEstimatedStartDate) || '',
          gigEstimatedEndDate: toISODate((data as any).gigEstimatedEndDate) || '',
          autoAddToUserGroups: Array.isArray((data as any).autoAddToUserGroups)
            ? ((data as any).autoAddToUserGroups as string[]).filter(
                (id) => typeof id === 'string' && id.trim() !== '',
              )
            : [],
        });

        const rid = (data as any).recruiterAccountId;
        setPickedRecruiterAccountId(
          typeof rid === 'string' && rid.trim() ? rid.trim() : null
        );
        
        // Load gig positions if job type is gig
        if ((data as any).jobType === 'gig' && (data as any).gigPositions) {
          // Top-level `jobDescriptionFromClient` is the legacy single-field
          // version; pre-existing JOs created before per-position descriptions
          // shipped only have it set on the JO doc. Migrate it to position[0]
          // on first load so the recruiter sees their description in-place
          // rather than blank. Subsequent saves persist per-position.
          const legacyTopLevelJd = String((data as any).jobDescriptionFromClient || '').trim();
          const loaded = ((data as any).gigPositions as any[]).map((p: any, idx: number) => {
            const persistedJd = String(p.jobDescriptionFromClient ?? '').trim();
            const jd = persistedJd || (idx === 0 ? legacyTopLevelJd : '');
            return {
              jobTitle: p.jobTitle ?? '',
              workersNeeded: p.workersNeeded ?? 1,
              payRate: String(p.payRate ?? ''),
              markup: p.markup,
              billRate: p.billRate,
              workersCompClassCode: p.workersCompClassCode ?? '',
              workersCompRate: p.workersCompRate != null ? String(p.workersCompRate) : '',
              sutaRate: p.sutaRate != null && p.sutaRate !== '' ? String(p.sutaRate) : '',
              futaRate: p.futaRate != null && p.futaRate !== '' ? String(p.futaRate) : '',
              jobDescriptionFromClient: jd || undefined,
              /*
               * Per-position Compliance & Requirements override map
               * (slice 1, May 2026). Round-trip the stored value
               * verbatim so the inline Uniform Requirements +
               * Custom Uniform Requirements fields (and the
               * collapsible PositionRequirementsEditor below them)
               * survive a reload. Without this, saved values would
               * appear to "not save on blur" — they ARE persisted
               * by the gigPositions auto-save, but every reload
               * dropped them because this explicit field-by-field
               * reconstruction never copied the map across.
               */
              requirements:
                p && typeof p.requirements === 'object' && p.requirements !== null
                  ? p.requirements
                  : undefined,
            };
          });
          setGigPositions(loaded);
        } else if ((data as any).jobType === 'gig') {
          // If gig type but no positions saved, initialize with data from main fields
          setGigPositions([{
            jobTitle: (data as any).jobTitle || '',
            workersNeeded: data.workersNeeded || 1,
            payRate: String((data as any).payRate || ''),
            markup: String((data as any).markup || ''),
            billRate: String((data as any).billRate || ''),
            workersCompClassCode: (data as any).workersCompClassCode ?? '',
            workersCompRate: (data as any).workersCompRate != null ? String((data as any).workersCompRate) : '',
            sutaRate: '',
            futaRate: '',
            jobDescriptionFromClient: (data as any).jobDescriptionFromClient || undefined,
          } as any]);
        }
        
        // Load locations for the company. Use the same fallback chain as
        // the form-state hydration above — a legacy JO that only has
        // `accountId` / `deal.companyId` would otherwise leave the
        // locations list empty and the Worksite dropdown would never
        // resolve a real entry (only the "Current Location" stub from
        // `setFilteredLocations`).
        const companyForLocations = resolvedCompanyId || (data as any).companyId;
        if (companyForLocations) {
          await loadLocations(companyForLocations);
        }
      } else {
        setError('Job order not found');
      }
    } catch (error: any) {
      console.error('Error loading job order:', error);
      setError(error.message || 'Failed to load job order');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = async (field: string, value: any) => {
    let updatedFormData: any = {
      ...formData,
      [field]: value
    };

    if (field === 'ppeRequirements') {
      const arr = Array.isArray(value) ? value : [];
      const nextHad = arr.length > 0;
      const prevHad = Array.isArray(formData.ppeRequirements) && formData.ppeRequirements.length > 0;
      const curBy = String(formData.ppeProvidedBy ?? '').trim();
      const validBy = curBy === 'company' || curBy === 'worker' || curBy === 'both';
      let nextProvidedBy = '';
      if (nextHad) {
        nextProvidedBy = prevHad && validBy ? curBy : 'company';
      }
      updatedFormData = {
        ...updatedFormData,
        ppeRequirements: arr,
        ppeProvidedBy: nextProvidedBy,
      };
    }

    // Auto-calculate calculatedBillRate when markup or payRate changes
    if (field === 'markup' || field === 'payRate') {
      const numericPay = parseFloat(
        field === 'payRate' ? String(value) : String(formData.payRate || 0)
      ) || 0;
      const numericMarkup = parseFloat(
        field === 'markup' ? String(value) : String(formData.markup || 0)
      ) || 0;
      const computed = numericMarkup > 0 && numericPay > 0 ? (numericPay * (1 + numericMarkup / 100)) : 0;
      updatedFormData = {
        ...updatedFormData,
        calculatedBillRate: computed ? String(Number(computed.toFixed(2))) : '',
        ...(numericMarkup > 0 ? { billRate: computed ? String(Number(computed.toFixed(2))) : '' } : {})
      };
    }

    // Load company contacts when company is selected
    if (field === 'companyId' && value) {
      await loadCompanyContacts(value);
      // Load and apply company defaults
      await loadAndApplyCompanyDefaults(value, updatedFormData);
    }
    
    setFormData(updatedFormData);
    
    // Auto-save on change (skip auto-save for startDate and endDate to avoid conflicts)
      if (isEditing && jobOrderId && field !== 'startDate' && field !== 'endDate') {
        await saveFieldToFirestore(field, value, updatedFormData);
      }
  };

  const handleFieldBlur = async (field: string, value: any) => {
    // Auto-save on blur for additional safety (skip auto-save for startDate and endDate)
    if (isEditing && jobOrderId && field !== 'startDate' && field !== 'endDate') {
      await saveFieldToFirestore(field, value, formData);
    }
  };

  const saveFieldToFirestore = async (field: string, value: any, currentFormData?: any) => {
    if (!tenantId || !user || !jobOrderId) return;

    // Use the passed form data or fall back to current state
    const dataToUse = currentFormData || formData;
    
    try {
      // Resolve company and location names (and parent account) for lookup fields
      const cid = dataToUse.companyId || (field === 'companyId' ? value : '');
      const wid = dataToUse.worksiteId || (field === 'worksiteId' ? value : '');
      let companyName = '';
      let worksiteName = '';
      let parentAccountId: string | null = null;
      let parentAccountName: string | null = null;

      if (cid) {
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', cid);
        const companySnap = await getDoc(companyRef);
        if (companySnap.exists()) {
          const companyData = companySnap.data() as any;
          companyName = companyData.companyName || companyData.name || '';
          const parentId = companyData.companyStructure?.parentId ?? companyData.parentCompany ?? (typeof companyData.parentId === 'string' ? companyData.parentId : null);
          if (parentId) {
            parentAccountId = typeof parentId === 'object' && parentId?.id ? parentId.id : parentId;
            const parentRef = doc(db, 'tenants', tenantId, 'crm_companies', parentAccountId);
            const parentSnap = await getDoc(parentRef);
            if (parentSnap.exists()) {
              const parentData = parentSnap.data() as any;
              parentAccountName = parentData.companyName || parentData.name || null;
            }
          }
        }
      }

      if (wid && cid) {
        const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', cid, 'locations', wid);
        const locationSnap = await getDoc(locationRef);
        if (locationSnap.exists()) {
          const locationData = locationSnap.data() as any;
          worksiteName = locationData.nickname || locationData.name || '';
        }
      }

      // Build flattened updates using the latest dataToUse
      const stageDataUpdate: any = {
        discovery: {
          currentStaffCount: parseInt((dataToUse as any).currentStaffCount) || undefined,
          currentAgencyCount: parseInt((dataToUse as any).currentAgencyCount) || undefined,
          currentSatisfactionLevel: (dataToUse as any).currentSatisfactionLevel || undefined,
          hasUsedAgenciesBefore: (dataToUse as any).hasUsedAgenciesBefore || undefined,
          additionalJobTitles: (dataToUse as any).additionalJobTitles ? (dataToUse as any).additionalJobTitles.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          shiftTimes: (dataToUse as any).shiftTimes ? (dataToUse as any).shiftTimes.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          employmentType: (dataToUse as any).employmentType || undefined,
          onsiteSupervisionRequired: (dataToUse as any).onsiteSupervisionRequired || undefined,
          lastAgencyUsed: (dataToUse as any).lastAgencyUsed || undefined,
          reasonStoppedUsingAgencies: (dataToUse as any).reasonStoppedUsingAgencies || undefined,
          openToUsingAgenciesAgain: (dataToUse as any).openToUsingAgenciesAgain || undefined,
          currentStruggles: (dataToUse as any).currentStruggles ? (dataToUse as any).currentStruggles.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
        },
        qualification: {
          mustHaveRequirements: (dataToUse as any).mustHaveRequirements || undefined,
          mustAvoidRequirements: (dataToUse as any).mustAvoidRequirements || undefined,
          potentialObstacles: (dataToUse as any).potentialObstacles ? (dataToUse as any).potentialObstacles.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          expectedStartDate: (dataToUse as any).expectedStartDate || undefined,
          staffPlacementTimeline: {
            starting: parseInt((dataToUse as any).initialHeadcount) || undefined,
            after30Days: parseInt((dataToUse as any).headcountAfter30Days) || undefined,
            after90Days: parseInt((dataToUse as any).headcountAfter90Days) || undefined,
            after180Days: parseInt((dataToUse as any).headcountAfter180Days) || undefined,
          },
          expectedAveragePayRate: parseFloat((dataToUse as any).expectedPayRate) || undefined,
          expectedAverageMarkup: parseFloat((dataToUse as any).expectedMarkup) || undefined,
        },
        scoping: {
          replacingExistingAgency: (dataToUse as any).replacingExistingAgency || undefined,
          rolloverExistingStaff: (dataToUse as any).rolloverExistingStaff || undefined,
            compliance: {
            backgroundCheck: (dataToUse as any).backgroundCheckRequired || undefined,
            backgroundCheckPackages: [],
            drugScreen: (dataToUse as any).drugScreenRequired || undefined,
            // R.0d (Apr 2026): drugScreeningPanels write removed from compliance save.
            additionalScreenings: (dataToUse as any).additionalScreenings || [],
            eVerify: (dataToUse as any).eVerifyRequired || undefined,
            licensesCerts: (dataToUse as any).licensesCerts || [],
            experience: (dataToUse as any).experienceRequired || undefined,
            education: (dataToUse as any).educationRequired || undefined,
            languages: (dataToUse as any).languagesRequired || [],
            skills: (dataToUse as any).skillsRequired || [],
            physicalRequirements: (dataToUse as any).physicalRequirements || undefined,
            ppe: (dataToUse as any).ppeRequirements || undefined,
            ppeProvidedBy: (dataToUse as any).ppeProvidedBy || undefined,
          },
          uniformRequirements: (dataToUse as any).dressCode || undefined,
          customUniformRequirements: (dataToUse as any).customUniformRequirements || undefined,
          showCustomUniformRequirements: (dataToUse as any).showCustomUniformRequirements || undefined,
          timeclockSystem: (dataToUse as any).timeclockSystem || undefined,
          disciplinePolicy: (dataToUse as any).disciplinePolicy || undefined,
          poRequired: (dataToUse as any).poRequired || undefined,
          paymentTerms: (dataToUse as any).paymentTerms || undefined,
          invoiceDeliveryMethod: (dataToUse as any).invoiceDeliveryMethod || undefined,
          invoiceFrequency: (dataToUse as any).invoiceFrequency || undefined,
          customerRules: {
            attendance: (dataToUse as any).attendancePolicy || undefined,
            noShows: (dataToUse as any).noShowPolicy || undefined,
            overtime: (dataToUse as any).overtimePolicy || undefined,
            callOffs: (dataToUse as any).callOffPolicy || undefined,
            injuryHandling: (dataToUse as any).injuryHandlingPolicy || undefined,
          },
        },
        verbalAgreement: {
          contact: (dataToUse as any).verbalAgreementContact || undefined,
          date: (dataToUse as any).verbalAgreementDate || undefined,
          method: (dataToUse as any).verbalAgreementMethod || undefined,
          conditionsToFulfill: (dataToUse as any).conditionsToFulfill ? (dataToUse as any).conditionsToFulfill.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          approvalsNeeded: (dataToUse as any).approvalsNeeded ? (dataToUse as any).approvalsNeeded.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          insuranceSubmitted: (dataToUse as any).insuranceSubmitted || undefined,
        },
        closedWon: {
          contractSignedDate: (dataToUse as any).contractSignedDate || undefined,
          contractExpirationDate: (dataToUse as any).contractExpirationDate || undefined,
          rateSheetOnFile: (dataToUse as any).rateSheetOnFile || undefined,
          msaSigned: (dataToUse as any).msaSigned || undefined,
        },
      };

      // Also set by registry path if the changed field has an explicit path
      const path = getRegistryPath(getRegistryIdForField(field));
      if (path) {
        setDeep(stageDataUpdate as any, path, value);
      }

      // Use dates as simple strings - no parsing needed
      const startDateParsed = dataToUse.startDate || null;
      const endDateParsed = dataToUse.endDate || null;
      

      // Compute calculated bill rate if markup/payRate present.
      // May 2026 — when markup is empty/0 but the recruiter typed a manual
      // billRate (the "no-markup, direct bill rate" pricing model — common
      // for events / food-service accounts), `calculatedBillRate` should
      // mirror the explicit billRate, NOT 0. The Finances & Budgeting page
      // uses `calculatedBillRate` as a derived cache; persisting 0 there
      // makes the bill column render as $0 and the gross go strongly
      // negative (−payTotal). Treat `calculatedBillRate` as "effective bill
      // rate" so downstream consumers don't need to know about the markup
      // path vs. the explicit-rate path.
      const numericPay = toNumberSafe((dataToUse as any).payRate) ?? 0;
      const numericMarkup = toNumberSafe((dataToUse as any).markup) ?? 0;
      const explicitBill = toNumberSafe((dataToUse as any).billRate) ?? 0;
      const markupComputedBill =
        numericMarkup > 0 && numericPay > 0
          ? Number((numericPay * (1 + numericMarkup / 100)).toFixed(2))
          : 0;
      const computedBill = markupComputedBill > 0 ? markupComputedBill : explicitBill;

      // For gigs, per-position descriptions live on `gigPositions[i]`; the
      // top-level field is mirrored from position[0] so legacy consumers
      // (`RecruiterJobOrderDetail` summary, `JobOrderChecklist`,
      // `useActiveShifts`) keep rendering a description without per-consumer
      // changes. For careers, the top-level field IS the source of truth.
      const topLevelJdFromClient =
        (dataToUse as any).jobType === 'gig'
          ? (String(gigPositions[0]?.jobDescriptionFromClient || '').trim() || undefined)
          : (dataToUse.jobDescriptionFromClient || undefined);

      const updates = {
        tenantId,
        jobOrderName: dataToUse.jobOrderName,
        jobOrderDescription: dataToUse.description,
        jobDescriptionFromClient: topLevelJdFromClient,
        status: dataToUse.status,
        jobType: dataToUse.jobType || 'career',
        workersNeeded: toNumberSafe(dataToUse.workersNeeded) ?? 1,
        payRate: toNumberSafe(dataToUse.payRate) ?? 0,
        markup: toNumberSafe(dataToUse.markup) ?? 0,
        // If markup present, persist computed bill; otherwise use manual billRate
        billRate: (numericMarkup > 0 ? computedBill : (toNumberSafe(dataToUse.billRate) ?? 0)) as number,
        calculatedBillRate: computedBill,
        startDate: startDateParsed,
        endDate: endDateParsed,
        companyId: dataToUse.companyId || '',
        companyName,
        worksiteId: dataToUse.worksiteId || '',
        worksiteName,
        accountId: cid || undefined,
        parentAccountId: parentAccountId ?? undefined,
        locationId: wid || undefined,
        accountName: companyName || undefined,
        parentAccountName: parentAccountName ?? undefined,
        locationName: worksiteName || undefined,
        poNumber:
          (dataToUse as any).jobType === 'gig' ? (dataToUse as any).poNumber || undefined : undefined,
        gigEstimatedValue:
          (dataToUse as any).jobType === 'gig'
            ? (() => {
                const v = toNumberSafe((dataToUse as any).gigEstimatedValue);
                return v != null && v >= 0 ? v : undefined;
              })()
            : undefined,
        gigAverageMarkup:
          (dataToUse as any).jobType === 'gig'
            ? (() => {
                const v = toNumberSafe((dataToUse as any).gigAverageMarkup);
                return v != null && v >= 0 ? v : undefined;
              })()
            : undefined,
        gigEstimatedStartDate:
          (dataToUse as any).jobType === 'gig'
            ? (dataToUse as any).gigEstimatedStartDate || null
            : undefined,
        gigEstimatedEndDate:
          (dataToUse as any).jobType === 'gig'
            ? (dataToUse as any).gigEstimatedEndDate || null
            : undefined,
        // Per-JO Auto-Add to User Groups (May 2026). The on-blur path
        // mirrors the bulk save in `handleSave` — empty array is a
        // valid "clear" (don't strip with `undefined` so removing the
        // last chip actually clears the field on Firestore).
        autoAddToUserGroups: Array.isArray((dataToUse as any).autoAddToUserGroups)
          ? ((dataToUse as any).autoAddToUserGroups as unknown[]).filter(
              (id): id is string => typeof id === 'string' && id.trim() !== '',
            )
          : [],
        estimatedRevenue: (() => {
          if ((dataToUse as any).jobType === 'gig') {
            const ev = toNumberSafe((dataToUse as any).gigEstimatedValue);
            if (ev != null && ev >= 0) return ev;
            return 0;
          }
          // Career: Bill Rate × 2080 hours × Workers Needed
          const billRate = toNumberSafe(dataToUse.billRate) || toNumberSafe(dataToUse.calculatedBillRate) || 0;
          const workersNeeded = parseInt(dataToUse.workersNeeded?.toString() || '1') || 1;
          return billRate * 2080 * workersNeeded;
        })(),
        notes: dataToUse.notes,
        hrContactId: dataToUse.hrContactId || '',
        decisionMaker: dataToUse.decisionMaker || '',
        operationsContactId: dataToUse.operationsContactId || '',
        procurementContactId: dataToUse.procurementContactId || '',
        billingContactId: dataToUse.billingContactId || '',
        safetyContactId: dataToUse.safetyContactId || '',
        invoiceContactId: dataToUse.invoiceContactId || '',
        customUniformRequirements: dataToUse.customUniformRequirements || undefined,
        screeningPackageId: String((dataToUse as any).screeningPackageId ?? '').trim() || null,
        screeningPackageName: String((dataToUse as any).screeningPackageName ?? '').trim() || null,
        // Career-only top-level SUTA / FUTA. Gig orders persist these
        // per-position via `gigPositions[]` (handled in the spread above).
        // `removeUndefinedValues` strips empty fields so we never overwrite
        // a previously saved value with `undefined` when the input is blank.
        ...((dataToUse as any).jobType !== 'gig'
          ? {
              sutaRate:
                (dataToUse as any).sutaRate != null &&
                String((dataToUse as any).sutaRate).trim() !== ''
                  ? toNumberSafe((dataToUse as any).sutaRate)
                  : undefined,
              futaRate:
                (dataToUse as any).futaRate != null &&
                String((dataToUse as any).futaRate).trim() !== ''
                  ? toNumberSafe((dataToUse as any).futaRate)
                  : undefined,
            }
          : {}),
        jobTitle:
          (dataToUse as any).jobType === 'gig'
            ? String(gigPositions[0]?.jobTitle ?? '')
            : String((dataToUse as any).jobTitle ?? ''),
        ...( (dataToUse as any).jobType === 'gig'
          ? { gigPositions: normalizeGigPositionsForPersist(gigPositions as any) }
          : {}),
        stageData: stageDataUpdate,
        updatedAt: new Date(),
        updatedBy: user.uid,
      } as any;

      // Remove undefined values from the data before saving to Firestore
      const cleanJobOrderData = removeUndefinedValues(updates);
      
      
      const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
      let statusBeforeWrite: string | undefined;
      if (field === 'status') {
        const priorSnap = await getDoc(jobOrderRef);
        if (priorSnap.exists()) {
          statusBeforeWrite = (priorSnap.data() as { status?: string })?.status;
        }
      }
      await updateDoc(jobOrderRef, cleanJobOrderData);

      if (field === 'status') {
        try {
          await JobsBoardService.getInstance().syncLinkedJobPostingsToJobOrderStatus(
            tenantId,
            jobOrderId,
            value,
            statusBeforeWrite,
          );
        } catch (error) {
          console.error('Error updating connected job posts status:', error);
        }
      }
      
    } catch (error) {
      console.error('Error auto-saving field:', error);
      // Don't show error to user for auto-save failures
    }
  };

  /** Commit career job title from draft (pricing preset, form state, Firestore). Not used on every keystroke. */
  const commitCareerJobTitle = (title: string) => {
    setFormData((prev) => {
      if (String(prev.jobTitle ?? '') === title) return prev;
      const merged = mergeCareerFormWithPricingPreset(prev as any, title, pricingByJobTitle) as any;
      if (isEditing && jobOrderId) {
        void saveFieldToFirestore('jobTitle', title, merged as any);
      }
      return merged as any;
    });
    setCareerJobTitleInput(title);
  };

  // When account Pricing loads or updates, backfill Job description from client for career orders that still have it empty.
  useEffect(() => {
    if (!isEditing || !jobOrderId || formData.jobType !== 'career') return;
    if (String(formData.jobDescriptionFromClient || '').trim()) return;
    const t = String(formData.jobTitle || '').trim();
    if (!t) return;
    const preset = pricingByJobTitle.get(t);
    const jd = (preset?.jobDescriptionFromClient || '').trim();
    if (!jd) return;
    let mergedSnapshot: Record<string, unknown> | null = null;
    setFormData((prev) => {
      if (String(prev.jobDescriptionFromClient || '').trim()) return prev;
      mergedSnapshot = mergeCareerFormWithPricingPreset(prev as any, t, pricingByJobTitle) as any;
      return mergedSnapshot as any;
    });
    if (mergedSnapshot) {
      void saveFieldToFirestore('jobDescriptionFromClient', jd, mergedSnapshot);
    }
  }, [
    pricingPositionsSyncKey,
    formData.jobTitle,
    formData.jobType,
    formData.jobDescriptionFromClient,
    isEditing,
    jobOrderId,
    pricingByJobTitle,
  ]);

  const handleSave = async () => {
    if (!tenantId || !user) return;

    setSaving(true);
    setError(null);
    
    try {
      if (!isEditing && requireAccountSelection) {
        if (!scopeRecruiterAccountId) {
          setError('Please select an account.');
          setSaving(false);
          return;
        }
        const accPick = recruiterAccountsForPicker.find((a) => a.id === scopeRecruiterAccountId);
        if (!accPick) {
          setError('Please select an account.');
          setSaving(false);
          return;
        }
        const allowedIds = new Set((accPick.companyIds || []).filter(Boolean));
        accPick.linkedLocations.forEach((l) => {
          if (l.companyId) allowedIds.add(l.companyId);
        });
        if (allowedIds.size === 0) {
          setError(
            'This account has no linked companies or worksites. Link at least one company on the account before creating a job order.'
          );
          setSaving(false);
          return;
        }
        if (!formData.companyId || !allowedIds.has(formData.companyId)) {
          setError('Select a company for this account.');
          setSaving(false);
          return;
        }
      }

      // Get company and location names (and worksite city/state for Smart Groups metro sync)
      // Also resolve parent account (national) for account/parent/location lookup fields
      let companyName = '';
      let worksiteName = '';
      let worksiteCity = '';
      let worksiteState = '';
      let parentAccountId: string | null = null;
      let parentAccountName: string | null = null;

      if (formData.companyId) {
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', formData.companyId);
        const companySnap = await getDoc(companyRef);
        if (companySnap.exists()) {
          const companyData = companySnap.data() as any;
          companyName = companyData.companyName || companyData.name || '';
          const parentId = companyData.companyStructure?.parentId ?? companyData.parentCompany ?? (typeof companyData.parentId === 'string' ? companyData.parentId : null);
          if (parentId) {
            parentAccountId = typeof parentId === 'object' && parentId?.id ? parentId.id : parentId;
            const parentRef = doc(db, 'tenants', tenantId, 'crm_companies', parentAccountId);
            const parentSnap = await getDoc(parentRef);
            if (parentSnap.exists()) {
              const parentData = parentSnap.data() as any;
              parentAccountName = parentData.companyName || parentData.name || null;
            }
          }
        }
      }

      if (formData.worksiteId) {
        const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', formData.companyId, 'locations', formData.worksiteId);
        const locationSnap = await getDoc(locationRef);
        if (locationSnap.exists()) {
          const locationData = locationSnap.data() as any;
          worksiteName = locationData.nickname || locationData.name || '';
          worksiteCity = locationData.city || locationData.address?.city || '';
          worksiteState = locationData.state || locationData.address?.state || '';
        }
      }

      // Build the updated deal data structure
      const updatedDealData: any = {
        // Basic deal information
        name: formData.jobOrderName,
        companyId: formData.companyId,
        companyName,
        locationId: formData.worksiteId,
        locationName: worksiteName,
        estimatedRevenue: (() => {
          if (formData.jobType === 'gig') {
            const v = parseFloat(String(formData.gigEstimatedValue || ''));
            return !Number.isNaN(v) && v >= 0 ? v : 0;
          }
          const billRate = parseFloat(formData.billRate) || parseFloat(formData.calculatedBillRate) || 0;
          const workersNeeded = parseInt(formData.workersNeeded.toString()) || 1;
          return billRate * 2080 * workersNeeded;
        })(),
        notes: formData.notes,
      };

      // Only include stageData if job order is created from a deal (has dealId) or updating existing job order with dealId
      // Standalone job orders don't need stageData
      const hasDealId = dealId || jobOrder?.dealId;
      if (hasDealId) {
        updatedDealData.stageData = {
          discovery: {
            currentStaffCount: parseInt(formData.currentStaffCount) || undefined,
            currentAgencyCount: parseInt(formData.currentAgencyCount) || undefined,
            currentSatisfactionLevel: formData.currentSatisfactionLevel || undefined,
            currentStruggles: formData.currentStruggles ? formData.currentStruggles.split(',').map(s => s.trim()).filter(s => s) : undefined,
            hasUsedAgenciesBefore: formData.hasUsedAgenciesBefore,
            lastAgencyUsed: formData.lastAgencyUsed || undefined,
            reasonStoppedUsingAgencies: formData.reasonStoppedUsingAgencies || undefined,
            openToUsingAgenciesAgain: formData.openToUsingAgenciesAgain,
            additionalJobTitles: formData.additionalJobTitles ? formData.additionalJobTitles.split(',').map(s => s.trim()).filter(s => s) : undefined,
            shiftTimes: formData.shiftTimes ? formData.shiftTimes.split(',').map(s => s.trim()).filter(s => s) : undefined,
            employmentType: formData.employmentType || undefined,
            onsiteSupervisionRequired: formData.onsiteSupervisionRequired,
          },
          qualification: {
            mustHaveRequirements: formData.mustHaveRequirements || undefined,
            mustAvoidRequirements: formData.mustAvoidRequirements || undefined,
            potentialObstacles: formData.potentialObstacles ? formData.potentialObstacles.split(',').map(s => s.trim()).filter(s => s) : undefined,
            expectedStartDate: formData.expectedStartDate || undefined,
            staffPlacementTimeline: {
              starting: parseInt(formData.initialHeadcount) || undefined,
              after30Days: parseInt(formData.headcountAfter30Days) || undefined,
              after90Days: parseInt(formData.headcountAfter90Days) || undefined,
              after180Days: parseInt(formData.headcountAfter180Days) || undefined,
            },
            expectedAveragePayRate: parseFloat(formData.expectedPayRate) || undefined,
            expectedAverageMarkup: parseFloat(formData.expectedMarkup) || undefined,
          },
          scoping: {
            replacingExistingAgency: formData.replacingExistingAgency,
            rolloverExistingStaff: formData.rolloverExistingStaff,
            compliance: {
              backgroundCheck: formData.backgroundCheckRequired,
              backgroundCheckPackages: [],
              drugScreen: formData.drugScreenRequired,
              // R.0d (Apr 2026): drugScreeningPanels write removed from compliance save.
              additionalScreenings: formData.additionalScreenings,
              eVerify: formEntity ? formEntity.everifyRequired : formData.eVerifyRequired,
              licensesCerts: formData.licensesCerts,
              experience: formData.experienceRequired || undefined,
              education: formData.educationRequired || undefined,
              languages: formData.languagesRequired,
              skills: formData.skillsRequired,
              physicalRequirements: formData.physicalRequirements || undefined,
              ppe: formData.ppeRequirements || undefined,
              ppeProvidedBy: formData.ppeProvidedBy,
            },
            uniformRequirements: formData.dressCode || undefined,
            customUniformRequirements: formData.customUniformRequirements || undefined,
            showCustomUniformRequirements: formData.showCustomUniformRequirements || undefined,
            timeclockSystem: formData.timeclockSystem || undefined,
            disciplinePolicy: formData.disciplinePolicy || undefined,
            poRequired: formData.poRequired,
            paymentTerms: formData.paymentTerms || undefined,
            invoiceDeliveryMethod: formData.invoiceDeliveryMethod || undefined,
            invoiceFrequency: formData.invoiceFrequency || undefined,
            customerRules: {
              attendance: formData.attendancePolicy || undefined,
              noShows: formData.noShowPolicy || undefined,
              overtime: formData.overtimePolicy || undefined,
              callOffs: formData.callOffPolicy || undefined,
              injuryHandling: formData.injuryHandlingPolicy || undefined,
            },
          },
          verbalAgreement: {
            contact: formData.verbalAgreementContact || undefined,
            date: formData.verbalAgreementDate || undefined,
            method: formData.verbalAgreementMethod || undefined,
            conditionsToFulfill: formData.conditionsToFulfill ? formData.conditionsToFulfill.split(',').map(s => s.trim()).filter(s => s) : undefined,
            approvalsNeeded: formData.approvalsNeeded ? formData.approvalsNeeded.split(',').map(s => s.trim()).filter(s => s) : undefined,
            insuranceSubmitted: formData.insuranceSubmitted,
          },
          closedWon: {
            contractSignedDate: formData.contractSignedDate || undefined,
            contractExpirationDate: formData.contractExpirationDate || undefined,
            rateSheetOnFile: formData.rateSheetOnFile,
            msaSigned: formData.msaSigned,
          },
        };
      }
      // For standalone job orders (not from a deal), don't include stageData at all
      // The removeUndefinedValues function will ensure no undefined values slip through
      
      // CRITICAL: Preserve existing associations (contacts, salespeople, locations, etc.)
      // Do NOT overwrite associations that were added via Deal Contacts dialog
      updatedDealData.associations = loadedJobOrderData?.deal?.associations || jobOrder?.deal?.associations || {};
      
      // Update timestamp
      updatedDealData.updatedAt = new Date();

      // Compute bill rate consistency
      const numericPayForCreate = parseFloat(String(formData.payRate || '')) || 0;
      const numericMarkupForCreate = parseFloat(String(formData.markup || '')) || 0;
      const computedBillForCreate = numericMarkupForCreate > 0 && numericPayForCreate > 0
        ? Number((numericPayForCreate * (1 + numericMarkupForCreate / 100)).toFixed(2))
        : 0;

      // Top-level JD from client mirrors position[0] for gigs so legacy
      // consumers reading the JO doc directly (Detail summary, Checklist,
      // active-shifts hook) keep working without per-consumer changes.
      // Per-position descriptions are also persisted on `gigPositions[i]`
      // via `normalizeGigPositionsForPersist` (spread preserves the new field).
      const topLevelJdFromClient =
        formData.jobType === 'gig'
          ? (String(gigPositions[0]?.jobDescriptionFromClient || '').trim() || undefined)
          : (formData.jobDescriptionFromClient || undefined);

      const jobOrderData = {
        // Job Order specific fields
        tenantId,
        jobOrderName: formData.jobOrderName,
        jobTitle: formData.jobType === 'gig' ? (gigPositions[0]?.jobTitle || '') : formData.jobTitle,
        jobOrderDescription: formData.description,
        jobDescriptionFromClient: topLevelJdFromClient,
        status: formData.status,
        jobType: formData.jobType || 'career',
        workersNeeded: formData.jobType === 'gig' 
          ? gigPositions.reduce((sum, pos) => sum + (pos.workersNeeded || 0), 0) 
          : (parseInt(formData.workersNeeded.toString()) || 1),
        companyId: formData.companyId || '',
        worksiteId: formData.worksiteId || '',
        // Denormalize the company + worksite names directly onto the JO
        // doc. The Detail page Overview, the JO Checklist, the Shifts
        // table, and `useActiveShifts` all read `companyName` /
        // `worksiteName` first — without these the Overview shows no
        // worksite even though the underlying `worksiteId` is correct
        // and the JO list (which falls back to `deal.locationName`) does
        // render it. The edit path already writes both names; mirror it
        // here so create + edit produce the same shape.
        companyName: companyName || undefined,
        worksiteName: worksiteName || undefined,
        accountId: formData.companyId || undefined,
        parentAccountId: parentAccountId ?? undefined,
        locationId: formData.worksiteId || undefined,
        accountName: companyName || undefined,
        parentAccountName: parentAccountName ?? undefined,
        locationName: worksiteName || undefined,
        payRate: formData.jobType === 'gig' 
          ? (parseFloat(gigPositions[0]?.payRate || '0') || 0)
          : (parseFloat(formData.payRate) || 0),
        markup: formData.jobType === 'gig'
          ? (parseFloat((gigPositions[0] as any)?.markup || '0') || 0)
          : (parseFloat(formData.markup) || 0),
        billRate: formData.jobType === 'gig'
          ? (() => {
              const payRate = parseFloat(gigPositions[0]?.payRate || '0') || 0;
              const markup = parseFloat((gigPositions[0] as any)?.markup || '0') || 0;
              return markup > 0 && payRate > 0 ? Number((payRate * (1 + markup / 100)).toFixed(2)) : (parseFloat((gigPositions[0] as any)?.billRate || '0') || 0);
            })()
          : (numericMarkupForCreate > 0 ? computedBillForCreate : (parseFloat(formData.billRate) || 0)),
        // May 2026 — `calculatedBillRate` mirrors the *effective* bill rate
        // (markup-derived OR explicit). Persisting 0 when the recruiter
        // priced by direct bill rate (no markup) caused Finances &
        // Budgeting to render Bill = $0 with Gross = −payTotal. See
        // `buildGigPositionsForFinance` in FinancesBudgetingPage.tsx.
        calculatedBillRate: formData.jobType === 'gig'
          ? (() => {
              const payRate = parseFloat(gigPositions[0]?.payRate || '0') || 0;
              const markup = parseFloat((gigPositions[0] as any)?.markup || '0') || 0;
              const explicit = parseFloat((gigPositions[0] as any)?.billRate || '0') || 0;
              const computed =
                markup > 0 && payRate > 0
                  ? Number((payRate * (1 + markup / 100)).toFixed(2))
                  : 0;
              return computed > 0 ? computed : explicit;
            })()
          : (computedBillForCreate > 0
              ? computedBillForCreate
              : (parseFloat(formData.billRate) || 0)),
        startDate: formData.startDate || null,
        endDate: formData.endDate || null,
        
        // Gig positions array (only for gig type); SUTA/FUTA as numbers for Firestore (same as account Pricing)
        gigPositions: formData.jobType === 'gig' ? normalizeGigPositionsForPersist(gigPositions as any) : undefined,
        
        // Update the deal data
        deal: updatedDealData,
        
        // HR Contact
        hrContactId: formData.hrContactId || '',

        /** Decision maker contact (Company Contacts section). */
        decisionMaker: formData.decisionMaker || '',
        
        // Additional Contact Roles
        operationsContactId: formData.operationsContactId || '',
        procurementContactId: formData.procurementContactId || '',
        billingContactId: formData.billingContactId || '',
        safetyContactId: formData.safetyContactId || '',
        invoiceContactId: formData.invoiceContactId || '',
        
        // Shift and Employment Details
        shiftType: formData.shiftType || '',
        shiftTimes: formData.shiftTimes || '',
        
        // Additional Form Fields
        requirements: formData.requirements || '',
        notes: formData.notes || '',
        priority: formData.priority || '',
        employmentType: formData.employmentType || '',
        experienceLevel: formData.experienceLevel || '',
        poNumber: formData.jobType === 'gig' ? formData.poNumber || undefined : undefined,
        gigEstimatedValue:
          formData.jobType === 'gig'
            ? (() => {
                const v = parseFloat(String(formData.gigEstimatedValue || ''));
                return !Number.isNaN(v) && v >= 0 ? v : undefined;
              })()
            : undefined,
        gigAverageMarkup:
          formData.jobType === 'gig'
            ? (() => {
                const v = parseFloat(String(formData.gigAverageMarkup || ''));
                return !Number.isNaN(v) && v >= 0 ? v : undefined;
              })()
            : undefined,
        gigEstimatedStartDate:
          formData.jobType === 'gig' ? formData.gigEstimatedStartDate || null : undefined,
        gigEstimatedEndDate:
          formData.jobType === 'gig' ? formData.gigEstimatedEndDate || null : undefined,
        // Per-JO Auto-Add to User Groups (May 2026). Persist even
        // when empty so removing a group on the JO doc clears it
        // (vs. `undefined` which `removeUndefinedValues` strips).
        autoAddToUserGroups: Array.isArray(formData.autoAddToUserGroups)
          ? formData.autoAddToUserGroups.filter(
              (id) => typeof id === 'string' && id.trim() !== '',
            )
          : [],
        estimatedRevenue: (() => {
          if (formData.jobType === 'gig') {
            const v = parseFloat(String(formData.gigEstimatedValue || ''));
            return !Number.isNaN(v) && v >= 0 ? v : 0;
          }
          const billRate = parseFloat(formData.billRate) || parseFloat(formData.calculatedBillRate) || 0;
          const workersNeeded = parseInt(formData.workersNeeded.toString()) || 1;
          return billRate * 2080 * workersNeeded;
        })(),
        
        // Compliance Fields (E-Verify from Hiring Entity when set)
        backgroundCheckRequired: formData.backgroundCheckRequired || false,
        drugScreenRequired: formData.drugScreenRequired || false,
        eVerifyRequired: formEntity ? formEntity.everifyRequired : (formData.eVerifyRequired || false),
        ...(hiringEntityIdForForm ? { hiringEntityId: hiringEntityIdForForm } : {}),
        experienceRequired: formData.experienceRequired || '',
        educationRequired: formData.educationRequired || '',
        licensesCerts: formData.licensesCerts || [],
        languagesRequired: formData.languagesRequired || [],
        skillsRequired: formData.skillsRequired || [],
        physicalRequirements: formData.physicalRequirements || [],
        ppeRequirements: formData.ppeRequirements || [],
        workersCompClassCode: formData.jobType === 'gig'
          ? (gigPositions[0]?.workersCompClassCode || undefined)
          : (formData.workersCompClassCode || undefined),
        workersCompRate: formData.jobType === 'gig'
          ? (gigPositions[0]?.workersCompRate ? parseFloat(gigPositions[0].workersCompRate) : undefined)
          : (formData.workersCompRate ? parseFloat(formData.workersCompRate) : undefined),
        // Career-only top-level SUTA / FUTA — gig orders persist these
        // per-position on `gigPositions`. Numbers (not strings) so the
        // legacy reader in `EditShiftForm` (parseFloat) round-trips
        // cleanly. Empty input → `undefined` so we don't write `0` or
        // `NaN` over a previous value.
        sutaRate: formData.jobType === 'gig'
          ? undefined
          : (formData.sutaRate && String(formData.sutaRate).trim() !== ''
              ? parseFloat(String(formData.sutaRate))
              : undefined),
        futaRate: formData.jobType === 'gig'
          ? undefined
          : (formData.futaRate && String(formData.futaRate).trim() !== ''
              ? parseFloat(String(formData.futaRate))
              : undefined),
        ppeProvidedBy: (() => {
          const reqs = formData.ppeRequirements || [];
          if (!Array.isArray(reqs) || reqs.length === 0) return undefined;
          return formData.ppeProvidedBy || 'company';
        })(),
        customUniformRequirements:
          typeof formData.customUniformRequirements === 'string' && formData.customUniformRequirements.trim()
            ? formData.customUniformRequirements.trim()
            : formData.customUniformRequirements === ''
              ? ''
              : undefined,
        showCustomUniformRequirements: formData.showCustomUniformRequirements,
        /** Uniform Requirements multi-select (library titles); also mirrored in deal.stageData when from a deal. */
        dressCode: Array.isArray(formData.dressCode) ? formData.dressCode : [],
        requirementPackId: formData.requirementPackId || undefined,
        screeningPackageId: String(formData.screeningPackageId ?? '').trim() || null,
        screeningPackageName: String(formData.screeningPackageName ?? '').trim() || null,
        
        // Background / drug screening via AccuSource package + Additional Screenings.
        // R.0d (Apr 2026): drugScreeningPanels top-level write removed.
        backgroundCheckPackages: [],
        additionalScreenings: formData.additionalScreenings || [],
        
        // Customer Rules
        attendancePolicy: formData.attendancePolicy || '',
        noShowPolicy: formData.noShowPolicy || '',
        overtimePolicy: formData.overtimePolicy || '',
        callOffPolicy: formData.callOffPolicy || '',
        injuryHandlingPolicy: formData.injuryHandlingPolicy || '',
        
        // Agreement Fields
        verbalAgreementContact: formData.verbalAgreementContact || '',
        verbalAgreementDate: formData.verbalAgreementDate || '',
        verbalAgreementMethod: formData.verbalAgreementMethod || '',
        conditionsToFulfill: formData.conditionsToFulfill || '',
        approvalsNeeded: formData.approvalsNeeded || '',
        insuranceSubmitted: formData.insuranceSubmitted || false,
        
        // Contract Fields
        contractSignedDate: formData.contractSignedDate || '',
        contractExpirationDate: formData.contractExpirationDate || '',
        rateSheetOnFile: formData.rateSheetOnFile || false,
        msaSigned: formData.msaSigned || false,
        
        // Metadata
        updatedAt: new Date(),
        updatedBy: user.uid,
        ...(effectiveRecruiterAccountId ? { recruiterAccountId: effectiveRecruiterAccountId } : {}),
      };

      if (isEditing && jobOrderId) {
        const newStatus = formData.status;

        // Update existing job order
        const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
        const priorSnap = await getDoc(jobOrderRef);
        const previousStatus = priorSnap.exists()
          ? (priorSnap.data() as { status?: string })?.status
          : undefined;

        // Remove undefined values before saving
        const cleanJobOrderData = removeUndefinedValues(jobOrderData);

        await updateDoc(jobOrderRef, cleanJobOrderData);

        try {
          await JobsBoardService.getInstance().syncLinkedJobPostingsToJobOrderStatus(
            tenantId,
            jobOrderId,
            newStatus,
            previousStatus,
          );
        } catch (error) {
          console.error('Error updating connected job posts status:', error);
        }

        setSuccess('Job order updated successfully!');
        console.log('✅ Job order updated successfully');
        ensureCityInSmartGroups(tenantId, worksiteCity, worksiteState).catch(() => {});
      } else {
        // Create new job order
        const jobOrdersRef = collection(db, p.jobOrders(tenantId));
        const jobOrdersSnapshot = await getDocs(jobOrdersRef);
        const nextJobOrderNumber = jobOrdersSnapshot.size + 1;

        const newJobOrderData = {
          ...jobOrderData,
          jobOrderNumber: nextJobOrderNumber,
          createdBy: user.uid,
          createdAt: new Date(),
          headcountFilled: 0,
        };

        // Remove undefined values before saving (Firestore doesn't allow undefined)
        const cleanJobOrderData = removeUndefinedValues(newJobOrderData);

        await addDoc(jobOrdersRef, cleanJobOrderData);
        setSuccess('Job order created successfully!');
        ensureCityInSmartGroups(tenantId, worksiteCity, worksiteState).catch(() => {});
      }

      // Call onSave callback if provided
      if (onSave) {
        onSave();
      } else {
        // Default behavior: redirect after delay
        setTimeout(() => {
          navigate('/jobs/job-orders');
        }, 1500);
      }
      
    } catch (error: any) {
      console.error('Error saving job order:', error);
      setError(error.message || `Failed to ${isEditing ? 'update' : 'create'} job order`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      navigate('/jobs/job-orders');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Success/Error Messages */}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/*
        Positions-tab gig sub-nav is hoisted ABOVE the outer Card so
        the strip sits on the page background — matches the Jobs Board
        tab layout (`RecruiterJobOrderDetail.tsx` `JobOrderJobsBoardTab`).
        The strip itself + the per-position cards together replace the
        outer Card visually; below, the outer Card is rendered
        transparent in this mode so it doesn't add a duplicate frame.
        Career JOs and the legacy `section="all"` callers keep the
        single-Card layout.
      */}
      {section === 'positions' && formData.jobType === 'gig' && gigPositions.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: 1,
            borderColor: 'divider',
            mb: 2,
          }}
        >
          <Tabs
            value={Math.min(positionsSubTab, Math.max(0, gigPositions.length - 1))}
            onChange={(_, v) => setPositionsSubTab(v)}
            variant="scrollable"
            scrollButtons="auto"
          >
            {gigPositions.map((pos, idx) => (
              <Tab
                key={idx}
                label={String(pos.jobTitle ?? '').trim() || `Position ${idx + 1}`}
                id={`positions-tab-${idx}`}
                aria-controls={`positions-tabpanel-${idx}`}
              />
            ))}
          </Tabs>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => {
              setGigPositions((prev) => [
                ...prev,
                {
                  jobTitle: '',
                  workersNeeded: 1,
                  payRate: '',
                  workersCompClassCode: '',
                  workersCompRate: '',
                  sutaRate: '',
                  futaRate: '',
                  jobDescriptionFromClient: '',
                },
              ]);
              setPositionsSubTab(gigPositions.length);
            }}
            sx={{ flexShrink: 0, ml: 2 }}
          >
            Add Position
          </Button>
        </Box>
      )}

      {/*
        Comprehensive Form with Section Headers.

        For the Positions tab on a gig JO the outer Card is rendered
        flat (no shadow, no background, no border, zero padding) so
        only the per-position Card frames below are visible — see
        the conditional sx blocks. We don't drop the Card entirely
        because that would require duplicating all the inner JSX;
        making it visually inert is enough.
      */}
      <Card
        elevation={0}
        sx={
          section === 'positions' && formData.jobType === 'gig'
            ? {
                boxShadow: 'none',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: 0,
                '&:hover': { boxShadow: 'none' },
              }
            : undefined
        }
      >
        <CardContent
          sx={
            section === 'positions' && formData.jobType === 'gig'
              ? { p: 0, '&:last-child': { pb: 0 } }
              : undefined
          }
        >
          <Grid container spacing={2}>
            {/* Basic Information Section — shown on Overview tab. */}
            {showOverview && (
              <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom sx={{ mt: 2, mb: 2, color: 'primary.main' }}>
                  Basic Information
                </Typography>
              </Grid>
            )}

            {(showOverview || showPositions) && (
            <Grid container spacing={2} sx={{ mb: 3 }}>
            {showOverview && (
              <>
            
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label={getFieldDef('jobOrderName')?.label || 'Job Order Name'}
                  value={formData.jobOrderName}
                  onChange={(e) => handleInputChange('jobOrderName', e.target.value)}
                  onBlur={(e) => handleFieldBlur('jobOrderName', e.target.value)}
                  placeholder="e.g., Warehouse Staff - Q4 2025"
                  required
                />
              </Grid>
              
              <Grid item xs={6} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    onBlur={(e) => handleFieldBlur('status', e.target.value)}
                    label="Status"
                  >
                    <MenuItem value="draft">Draft</MenuItem>
                    <MenuItem value="open">Open</MenuItem>
                    <MenuItem value="on_hold">On Hold</MenuItem>
                    <MenuItem value="cancelled">Cancelled</MenuItem>
                    <MenuItem value="filled">Filled</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={6} md={3}>
                <FormControl fullWidth required>
                  <InputLabel>Job Type</InputLabel>
                  <Select
                    value={formData.jobType}
                    onChange={(e) => handleInputChange('jobType', e.target.value)}
                    onBlur={(e) => handleFieldBlur('jobType', e.target.value)}
                    label="Job Type"
                  >
                    <MenuItem value="gig">Gig</MenuItem>
                    <MenuItem value="career">Career</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {requireAccountSelection && !isEditing && (
                <Grid item xs={12}>
                  <Autocomplete
                    fullWidth
                    options={recruiterAccountsForPicker}
                    getOptionLabel={(option) => option.label || option.name}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    value={recruiterAccountsForPicker.find((a) => a.id === scopeRecruiterAccountId) || null}
                    onChange={(_, newValue) => {
                      setPickedRecruiterAccountId(newValue?.id ?? null);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Account"
                        required
                        helperText="Select a client account (venue child or standalone). National parent accounts with sub-accounts are not listed. Company and worksite follow linked CRM data."
                      />
                    )}
                  />
                </Grid>
              )}

              <Grid item xs={12} md={6}>
                {isEditing ? (
                  <Autocomplete
                    fullWidth
                    options={accountOptions}
                    getOptionLabel={(option) => option.label || option.name}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    value={
                      accountOptions.find(
                        (a) => a.id === (pickedRecruiterAccountId || propRecruiterAccountId || null),
                      ) || null
                    }
                    onChange={async (_, newValue) => {
                      const nextId = newValue?.id ?? null;
                      setPickedRecruiterAccountId(nextId);
                      if (jobOrderId && tenantId && user?.uid) {
                        try {
                          const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
                          await updateDoc(jobOrderRef, {
                            updatedAt: new Date(),
                            updatedBy: user.uid,
                            recruiterAccountId: nextId ? nextId : deleteField(),
                          } as any);
                          setLoadedJobOrderData((prev: any) =>
                            prev ? { ...prev, recruiterAccountId: nextId || undefined } : prev,
                          );
                          setSuccess('Account updated.');
                          setTimeout(() => setSuccess(null), 3000);
                        } catch (e) {
                          console.error('JobOrderForm: recruiter account', e);
                          setError('Could not save account. Try again.');
                          setTimeout(() => setError(null), 5000);
                        }
                      }
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Account"
                        required
                        helperText="Client account (same as New Job Order). Child accounts use the linked worksite below."
                      />
                    )}
                  />
                ) : (
                  <Autocomplete
                    fullWidth
                    options={companiesForCompanyField}
                    getOptionLabel={(option) => option.companyName || option.name || ''}
                    value={companiesForCompanyField.find((company) => company.id === formData.companyId) || null}
                    onChange={(event, newValue) => {
                      handleInputChange('companyId', newValue?.id || '');
                      if (newValue?.id) {
                        handleFieldBlur('companyId', newValue.id);
                      }
                    }}
                    disabled={
                      requireAccountSelection &&
                      (!scopeRecruiterAccountId ||
                        !accountLinkedCompanyIds?.length ||
                        singleCompanyIdForAccount !== null)
                    }
                    renderOption={(props, option) => (
                      <li {...props} key={option.id}>
                        {option.companyName || option.name || ''}
                      </li>
                    )}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Company"
                        required
                        helperText={
                          requireAccountSelection && scopeRecruiterAccountId && !accountLinkedCompanyIds?.length
                            ? 'No companies linked to this account. Add companies on the account record.'
                            : requireAccountSelection && singleCompanyIdForAccount
                              ? 'Set automatically from the selected account.'
                              : undefined
                        }
                        onBlur={(e) => {
                          if (formData.companyId) {
                            handleFieldBlur('companyId', formData.companyId);
                          }
                        }}
                      />
                    )}
                  />
                )}
              </Grid>
            
              <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  options={filteredLocations}
                  getOptionLabel={(option) => option.nickname || option.name || ''}
                  value={filteredLocations.find(location => location.id === formData.worksiteId) || null}
                  onChange={(event, newValue) => {
                    handleInputChange('worksiteId', newValue?.id || '');
                    if (newValue?.id) {
                      handleFieldBlur('worksiteId', newValue.id);
                    }
                  }}
                  disabled={!formData.companyId || childWorksiteLocked}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Worksite"
                      helperText={
                        childWorksiteLocked
                          ? 'Set from the selected child account (linked worksite).'
                          : undefined
                      }
                      onBlur={(e) => {
                        if (formData.worksiteId) {
                          handleFieldBlur('worksiteId', formData.worksiteId);
                        }
                      }}
                    />
                  )}
                />
              </Grid>

              {showOptionalRecruiterAccountLink && (
                <Grid item xs={12}>
                  <Autocomplete
                    fullWidth
                    options={accountOptions}
                    getOptionLabel={(option) => option.label || option.name}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    value={
                      accountOptions.find(
                        (a) => a.id === (pickedRecruiterAccountId || propRecruiterAccountId || null),
                      ) || null
                    }
                    onChange={async (_, newValue) => {
                      const nextId = newValue?.id ?? null;
                      setPickedRecruiterAccountId(nextId);
                      if (!isEditing || !jobOrderId || !tenantId || !user?.uid) return;
                      try {
                        const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
                        const patch: Record<string, unknown> = {
                          updatedAt: new Date(),
                          updatedBy: user.uid,
                          recruiterAccountId: nextId ? nextId : deleteField(),
                        };
                        await updateDoc(jobOrderRef, patch as any);
                        setLoadedJobOrderData((prev: any) =>
                          prev
                            ? {
                                ...prev,
                                recruiterAccountId: nextId || undefined,
                              }
                            : prev
                        );
                        setSuccess('Linked recruiter account updated.');
                        setTimeout(() => setSuccess(null), 3000);
                      } catch (e) {
                        console.error('JobOrderForm: link recruiter account', e);
                        setError('Could not save linked account. Try again.');
                        setTimeout(() => setError(null), 5000);
                      }
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Linked recruiter account"
                        helperText="Optional. Tie this job to a client account (e.g. Maryland Warehouse under CORT) so it appears on Account → Job Orders. Clear to remove the link."
                      />
                    )}
                  />
                </Grid>
              )}

              {/* Gig: estimated event window (below Account or Company / Worksite) */}
              {formData.jobType === 'gig' && (
                <>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Estimated Start Date"
                      type="date"
                      value={formData.gigEstimatedStartDate}
                      onChange={(e) => handleInputChange('gigEstimatedStartDate', e.target.value)}
                      onBlur={(e) => handleFieldBlur('gigEstimatedStartDate', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Estimated End Date"
                      type="date"
                      value={formData.gigEstimatedEndDate}
                      onChange={(e) => handleInputChange('gigEstimatedEndDate', e.target.value)}
                      onBlur={(e) => handleFieldBlur('gigEstimatedEndDate', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                </>
              )}

              {/* Only show Start/End Date for Career jobs (not for Gig jobs) */}
              {formData.jobType !== 'gig' && (
                <>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label={getFieldDef('startDate')?.label || 'Start Date'}
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => handleInputChange('startDate', e.target.value)}
                      onBlur={(e) => handleFieldBlur('startDate', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label={getFieldDef('endDate')?.label || 'End Date'}
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => handleInputChange('endDate', e.target.value)}
                      onBlur={(e) => handleFieldBlur('endDate', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                </>
              )}

              {/*
                Auto-Add to User Groups (May 2026). Per-JO equivalent of
                `JobsBoardPost.autoAddToUserGroups` — recruiter picks
                groups once on the JO and the post-creation cascade
                (`JobsBoardService.createPostsForGigJobOrderPositions`)
                seeds each new posting with the same list. Independent
                of the auto-created National Account group stamped by
                `onJobOrderCreatedAttachAutoUserGroup` (that one shows
                separately on Auto Messaging / posts; this is for any
                ADDITIONAL groups the recruiter wants to auto-add to).
              */}
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  options={userGroupsListForUi}
                  getOptionLabel={(option) => option.name || 'Unnamed Group'}
                  isOptionEqualToValue={(opt, val) => opt.id === val.id}
                  value={autoAddGroupsPickerValue(
                    formData.autoAddToUserGroups,
                    userGroupsList,
                    userGroupsListForUi,
                  )}
                  onChange={(_, newValue) => {
                    const ids = newValue.map((g) => g.id);
                    // Use the functional setState so we can pass the
                    // freshly-merged form data into
                    // `saveFieldToFirestore`. Otherwise its `dataToUse`
                    // fallback would read the *old* `formData` from
                    // closure and persist the stale array. Mirrors
                    // `commitCareerJobTitle` (~line 2758).
                    setFormData((prev) => {
                      const next = { ...prev, autoAddToUserGroups: ids };
                      if (isEditing && jobOrderId) {
                        void saveFieldToFirestore(
                          'autoAddToUserGroups',
                          ids,
                          next,
                        );
                      }
                      return next;
                    });
                  }}
                  loading={loadingUserGroupsList}
                  noOptionsText={
                    loadingUserGroupsList ? 'Loading...' : 'No user groups available'
                  }
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => {
                      const tagProps = getTagProps({ index });
                      const isAuto = (option as { isAuto?: boolean }).isAuto === true;
                      if (isAuto) {
                        return (
                          <Tooltip
                            key={option.id}
                            title="Auto-attached: created automatically from the National Account's auto-group setting. Removable, but will be re-attached on the next posting sync if the JO's auto-group is still set."
                          >
                            <Chip
                              {...tagProps}
                              label={`${option.name || 'Unnamed Group'} \u00b7 Auto`}
                              size="small"
                              color="success"
                              variant="outlined"
                            />
                          </Tooltip>
                        );
                      }
                      return (
                        <Chip
                          {...tagProps}
                          key={option.id}
                          label={option.name || 'Unnamed Group'}
                          size="small"
                        />
                      );
                    })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Auto-Add to User Groups"
                      placeholder="Search user groups..."
                      helperText="Hires from this job order are automatically added to these user groups."
                    />
                  )}
                />
              </Grid>

              {/* Financials — Gig and Career; placed directly under the
                  date row. Career still uses the same form state fields
                  (`gigEstimatedValue`, `gigAverageMarkup`) — the field
                  names are historical; semantically they're job-order-
                  level financials regardless of type. */}
              {(formData.jobType === 'gig' || formData.jobType === 'career') && (
                <>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom sx={{ mt: 2, mb: 1, color: 'primary.main' }}>
                      Financials
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TextField
                      fullWidth
                      label="PO Number"
                      value={formData.poNumber}
                      onChange={(e) => handleInputChange('poNumber', e.target.value)}
                      onBlur={(e) => handleFieldBlur('poNumber', e.target.value)}
                      placeholder="e.g. PO-2025-001"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TextField
                      fullWidth
                      label="Estimated Value"
                      type="number"
                      value={formData.gigEstimatedValue}
                      onChange={(e) => handleInputChange('gigEstimatedValue', e.target.value)}
                      onBlur={(e) => handleFieldBlur('gigEstimatedValue', e.target.value)}
                      placeholder="0.00"
                      inputProps={{ min: 0, step: 0.01 }}
                      helperText={formData.jobType === 'gig' ? 'Preliminary budget for this event' : 'Preliminary budget for this job order'}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">$</InputAdornment>,
                      }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TextField
                      fullWidth
                      label="Average Markup (%)"
                      type="number"
                      value={formData.gigAverageMarkup}
                      onChange={(e) => handleInputChange('gigAverageMarkup', e.target.value)}
                      onBlur={(e) => handleFieldBlur('gigAverageMarkup', e.target.value)}
                      placeholder="e.g. 25"
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TextField
                      fullWidth
                      label="Gross Profit"
                      value={gigGrossProfitDisplay || '—'}
                      InputProps={{ readOnly: true }}
                      helperText="Estimate − [estimate ÷ (1 + markup%)]"
                    />
                  </Grid>
                </>
              )}
              </>
            )}

            {showPositions && (
              <>
              {/* Career Type: Single Job Title and Workers Needed */}
              {formData.jobType === 'career' && (
                <>
                  <Grid item xs={12} md={6}>
                    <Autocomplete
                      fullWidth
                      freeSolo
                      options={jobTitleOptions}
                      value={formData.jobTitle}
                      inputValue={careerJobTitleInput}
                      onInputChange={(_, newInputValue, reason) => {
                        if (reason === 'input') {
                          setCareerJobTitleInput(newInputValue);
                          careerJobTitleInputRef.current = newInputValue;
                        } else if (reason === 'clear') {
                          setCareerJobTitleInput('');
                          careerJobTitleInputRef.current = '';
                        } else if (reason === 'reset') {
                          setCareerJobTitleInput(newInputValue);
                          careerJobTitleInputRef.current = newInputValue;
                        }
                      }}
                      onChange={(_event, newValue, reason) => {
                        if (reason === 'selectOption' || reason === 'createOption') {
                          commitCareerJobTitle(String(newValue ?? ''));
                          return;
                        }
                        if (reason === 'clear') {
                          commitCareerJobTitle('');
                        }
                      }}
                      onClose={(_, reason) => {
                        if (reason === 'blur') {
                          commitCareerJobTitle(careerJobTitleInputRef.current);
                        }
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={getFieldDef('jobTitle')?.label || 'Job Title'}
                          required
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label={(getFieldDef('workersNeeded')?.label || 'Workers Needed')}
                      type="number"
                      value={formData.workersNeeded}
                      onChange={(e) => handleInputChange('workersNeeded', parseInt(e.target.value) || 1)}
                      onBlur={(e) => handleFieldBlur('workersNeeded', parseInt(e.target.value) || 1)}
                      required
                      inputProps={{ min: 1 }}
                    />
                  </Grid>
                </>
              )}

              {/*
                Gig Type: Multiple Positions
                ----------------------------
                Each gig position lives in its own sub-tab — same UX
                as the Jobs Board tab on the Job Order detail page
                (see `RecruiterJobOrderDetail.tsx` `JobOrderJobsBoardTab`).
                Recruiter clicks a tab to focus that position; the
                "Add Position" button on the right of the strip
                appends a new position and jumps the active tab to it.
                Career JOs don't use this — they have a single
                Job Title / Workers Needed pair, no positions array.
              */}
              {formData.jobType === 'gig' && (
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {showSutaFutaOnGigPositions && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={applySutaFutaFromWorksiteState}
                          disabled={!worksiteStateCodeForPricing}
                        >
                          Apply SUTA/FUTA from worksite state
                        </Button>
                        <Typography variant="caption" color="text.secondary">
                          {worksiteStateCodeForPricing
                            ? `Estimated new-employer SUTA and FUTA for ${worksiteStateCodeForPricing} (same as Account → Pricing).`
                            : 'Select a worksite with a state to apply rates.'}
                        </Typography>
                      </Box>
                    )}

                    {/*
                      Per-position sub-nav. For the dedicated
                      Positions tab (`section === 'positions'`) the
                      strip is rendered ABOVE the outer Card (see
                      block higher up in this component) so it sits
                      on the page background — matches the Jobs Board
                      tab. For legacy `section === 'all'` callers
                      (NewJobOrder modal etc.) we still need the
                      strip in-line; that case is rendered here.
                      Untitled positions get a "Position N" fallback
                      label so the tab is always clickable while the
                      recruiter is mid-typing the title. We use the
                      array index as key so editing the title doesn't
                      unmount / remount the active tab on every
                      keystroke.
                    */}
                    {section !== 'positions' && (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: 1,
                          borderColor: 'divider',
                        }}
                      >
                        <Tabs
                          value={Math.min(positionsSubTab, Math.max(0, gigPositions.length - 1))}
                          onChange={(_, v) => setPositionsSubTab(v)}
                          variant="scrollable"
                          scrollButtons="auto"
                        >
                          {gigPositions.map((pos, idx) => (
                            <Tab
                              key={idx}
                              label={String(pos.jobTitle ?? '').trim() || `Position ${idx + 1}`}
                              id={`positions-tab-${idx}`}
                              aria-controls={`positions-tabpanel-${idx}`}
                            />
                          ))}
                        </Tabs>
                        <Button
                          size="small"
                          startIcon={<AddIcon />}
                          onClick={() => {
                            setGigPositions((prev) => [
                              ...prev,
                              {
                                jobTitle: '',
                                workersNeeded: 1,
                                payRate: '',
                                workersCompClassCode: '',
                                workersCompRate: '',
                                sutaRate: '',
                                futaRate: '',
                                jobDescriptionFromClient: '',
                              },
                            ]);
                            setPositionsSubTab(gigPositions.length);
                          }}
                          sx={{ flexShrink: 0, ml: 2 }}
                        >
                          Add Position
                        </Button>
                      </Box>
                    )}

                    {gigPositions.map((position, index) => (
                      <div
                        key={index}
                        role="tabpanel"
                        hidden={positionsSubTab !== index}
                        id={`positions-tabpanel-${index}`}
                        aria-labelledby={`positions-tab-${index}`}
                      >
                        {positionsSubTab === index && (
                      // Per-position panel. On the dedicated Positions
                      // tab the active position sits below the
                      // external sub-nav as a single flat panel —
                      // white bg, rounded, thin border, NO shadow
                      // and NO hover effect (the outer Card wrapper
                      // is also rendered visually inert in this mode,
                      // so a shadow here would read as the second
                      // half of a card-within-a-card frame). Legacy
                      // `section === 'all'` callers keep the original
                      // bordered-Box look (used in the NewJobOrder
                      // modal etc., where multiple positions render
                      // inline under one outer wrapping Card).
                      <Box
                        sx={
                          section === 'positions'
                            ? {
                                display: 'flex',
                                gap: 2,
                                alignItems: 'flex-start',
                                p: 3,
                                mb: 2,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider',
                                boxShadow: 'none',
                                '&:hover': { boxShadow: 'none', borderColor: 'divider' },
                              }
                            : {
                                display: 'flex',
                                gap: 2,
                                alignItems: 'flex-start',
                                p: 2,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                              }
                        }
                      >
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {/* Row 1: Job Title (Workers Needed removed for Gig type) */}
                          <Box sx={{ display: 'flex', gap: 2 }}>
                            <Box sx={{ flex: '1 1 400px' }}>
                              <Autocomplete
                                fullWidth
                                freeSolo
                                options={jobTitleOptions}
                                value={position.jobTitle}
                                onChange={(_event, newValue) => {
                                  const title = newValue ?? '';
                                  const preset = String(title).trim()
                                    ? pricingByJobTitle.get(String(title).trim())
                                    : undefined;
                                  const jdFromPreset = (preset?.jobDescriptionFromClient || '').trim();
                                  const selectedLoc = filteredLocations.find((loc) => loc.id === formData.worksiteId) as
                                    | (Location & { state?: string; address?: { state?: string } })
                                    | undefined;
                                  const pricingStateCode = normalizeStateCode(
                                    selectedLoc?.state ?? selectedLoc?.address?.state,
                                  )
                                    .trim()
                                    .toUpperCase();
                                  setGigPositions((prev) => {
                                    const updated = [...prev];
                                    const row: any = { ...updated[index], jobTitle: title };
                                    if (preset) {
                                      row.payRate =
                                        preset.payRate != null ? String(preset.payRate) : row.payRate;
                                      const m = preset.markupPercent;
                                      row.markup =
                                        m != null && !Number.isNaN(Number(m)) ? String(m) : row.markup;
                                      const payNum = parseFloat(row.payRate) || 0;
                                      const mNum = parseFloat(String(row.markup || '')) || 0;
                                      if (mNum > 0 && payNum > 0) {
                                        row.billRate = String(Number((payNum * (1 + mNum / 100)).toFixed(2)));
                                      } else if (preset.billRate != null) {
                                        row.billRate = String(preset.billRate);
                                      }
                                      if (preset.workersCompCode) {
                                        row.workersCompClassCode = String(preset.workersCompCode);
                                      }
                                      const wcCode = (preset.workersCompCode ?? '').toString().trim();
                                      if (preset.workersCompRate != null && !Number.isNaN(Number(preset.workersCompRate))) {
                                        row.workersCompRate = String(preset.workersCompRate);
                                      } else if (pricingStateCode && wcCode) {
                                        const r = wcMaps.wcRatesByStateAndCode[`${pricingStateCode}_${wcCode}`];
                                        if (r != null && !Number.isNaN(r)) {
                                          row.workersCompRate = String(r);
                                        }
                                      }
                                      if (preset.sutaRate != null && !Number.isNaN(Number(preset.sutaRate))) {
                                        row.sutaRate = String(preset.sutaRate);
                                      }
                                      if (preset.futaRate != null && !Number.isNaN(Number(preset.futaRate))) {
                                        row.futaRate = String(preset.futaRate);
                                      }
                                      // Per-position JD from account pricing. Only seed when the
                                      // position's JD is empty so we don't clobber recruiter edits
                                      // when they re-select the same preset later.
                                      if (jdFromPreset && !String(row.jobDescriptionFromClient || '').trim()) {
                                        row.jobDescriptionFromClient = jdFromPreset;
                                      }
                                    }
                                    // Cascade account Pricing → position requirements
                                    // (May 2026). Covers uniform + screenings + licenses +
                                    // physical / PPE / skills / languages / experience /
                                    // education. Same "only seed when empty" rule as the JD
                                    // branch above so the recruiter doesn't lose tweaks when
                                    // they reselect the title.
                                    const rowAfterReqs = applyAccountRequirementsCascadeToPositionRow(row, preset);
                                    updated[index] = rowAfterReqs as typeof updated[number];
                                    return updated;
                                  });
                                }}
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    label="Job Title"
                                    size="small"
                                    required
                                    helperText={
                                      resolvedAccountPositions.length > 0
                                        ? 'From account Pricing; type any title if yours is not listed.'
                                        : undefined
                                    }
                                    onBlur={(e) => {
                                      const title = String(e.target.value ?? '');
                                      const preset = String(title).trim()
                                        ? pricingByJobTitle.get(String(title).trim())
                                        : undefined;
                                      const jdFromPreset = (preset?.jobDescriptionFromClient || '').trim();
                                      const selectedLoc = filteredLocations.find((loc) => loc.id === formData.worksiteId) as
                                        | (Location & { state?: string; address?: { state?: string } })
                                        | undefined;
                                      const pricingStateCode = normalizeStateCode(
                                        selectedLoc?.state ?? selectedLoc?.address?.state,
                                      )
                                        .trim()
                                        .toUpperCase();
                                      setGigPositions((prev) => {
                                        const updated = [...prev];
                                        const row: any = { ...updated[index], jobTitle: title };
                                        if (preset) {
                                          row.payRate =
                                            preset.payRate != null ? String(preset.payRate) : row.payRate;
                                          const m = preset.markupPercent;
                                          row.markup =
                                            m != null && !Number.isNaN(Number(m))
                                              ? String(m)
                                              : row.markup;
                                          const payNum = parseFloat(row.payRate) || 0;
                                          const mNum = parseFloat(String(row.markup || '')) || 0;
                                          if (mNum > 0 && payNum > 0) {
                                            row.billRate = String(
                                              Number((payNum * (1 + mNum / 100)).toFixed(2))
                                            );
                                          } else if (preset.billRate != null) {
                                            row.billRate = String(preset.billRate);
                                          }
                                          if (preset.workersCompCode) {
                                            row.workersCompClassCode = String(preset.workersCompCode);
                                          }
                                          const wcCode = (preset.workersCompCode ?? '').toString().trim();
                                          if (preset.workersCompRate != null && !Number.isNaN(Number(preset.workersCompRate))) {
                                            row.workersCompRate = String(preset.workersCompRate);
                                          } else if (pricingStateCode && wcCode) {
                                            const r = wcMaps.wcRatesByStateAndCode[`${pricingStateCode}_${wcCode}`];
                                            if (r != null && !Number.isNaN(r)) {
                                              row.workersCompRate = String(r);
                                            }
                                          }
                                          if (preset.sutaRate != null && !Number.isNaN(Number(preset.sutaRate))) {
                                            row.sutaRate = String(preset.sutaRate);
                                          }
                                          if (preset.futaRate != null && !Number.isNaN(Number(preset.futaRate))) {
                                            row.futaRate = String(preset.futaRate);
                                          }
                                          // Same per-position seeding rule as the `onChange` branch above.
                                          if (jdFromPreset && !String(row.jobDescriptionFromClient || '').trim()) {
                                            row.jobDescriptionFromClient = jdFromPreset;
                                          }
                                        }
                                        // Mirror the onChange branch — cascade account
                                        // Pricing → position requirements (uniform +
                                        // screenings + licenses + physical / PPE / skills /
                                        // languages / experience / education) when the
                                        // recruiter free-types a job title and tabs out.
                                        const rowAfterReqs = applyAccountRequirementsCascadeToPositionRow(row, preset);
                                        updated[index] = rowAfterReqs as typeof updated[number];
                                        return updated;
                                      });
                                    }}
                                  />
                                )}
                              />
                            </Box>
                          </Box>

                          {/* Row 2: Pay Rate, Markup, Bill Rate */}
                          <Box sx={{ display: 'flex', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Pay Rate"
                                value={position.payRate}
                                onChange={(e) => {
                                  const updated = [...gigPositions];
                                  updated[index].payRate = e.target.value;
                                  setGigPositions(updated);
                                }}
                                placeholder="e.g., 15"
                                required
                              />
                            </Box>
                            <Box sx={{ flex: 1 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Markup (%)"
                                value={(position as any).markup || ''}
                                onChange={(e) => {
                                  const updated = [...gigPositions];
                                  (updated[index] as any).markup = e.target.value;
                                  setGigPositions(updated);
                                }}
                                placeholder="e.g., 25"
                              />
                            </Box>
                            <Box sx={{ flex: 1 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Bill Rate"
                                value={(() => {
                                  const payRate = parseFloat(position.payRate) || 0;
                                  const markup = parseFloat((position as any).markup || '0') || 0;
                                  if (markup > 0 && payRate > 0) {
                                    return (payRate * (1 + markup / 100)).toFixed(2);
                                  }
                                  return (position as any).billRate || '';
                                })()}
                                onChange={(e) => {
                                  const updated = [...gigPositions];
                                  (updated[index] as any).billRate = e.target.value;
                                  setGigPositions(updated);
                                }}
                                placeholder="e.g., 26.25"
                                InputProps={{ 
                                  readOnly: !!((position as any).markup && parseFloat((position as any).markup) > 0)
                                }}
                              />
                            </Box>
                          </Box>

                          {/* Row 3: Workers Comp Class Code, Workers Comp Rate */}
                          <Box sx={{ display: 'flex', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Workers Comp Class Code"
                                value={position.workersCompClassCode ?? ''}
                                onChange={(e) => {
                                  const updated = [...gigPositions];
                                  updated[index] = { ...updated[index], workersCompClassCode: e.target.value };
                                  setGigPositions(updated);
                                }}
                                placeholder="e.g. 9015"
                                helperText="From Settings > Onboarding Library > WC Class Codes"
                              />
                            </Box>
                            <Box sx={{ flex: 1 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Workers Comp Rate"
                                value={position.workersCompRate ?? ''}
                                onChange={(e) => {
                                  const updated = [...gigPositions];
                                  updated[index] = { ...updated[index], workersCompRate: e.target.value };
                                  setGigPositions(updated);
                                }}
                                placeholder="e.g. 2.34"
                                type="number"
                                inputProps={{ step: 0.01, min: 0 }}
                              />
                            </Box>
                          </Box>

                          {showSutaFutaOnGigPositions && (
                            <Box sx={{ display: 'flex', gap: 2 }}>
                              <Box sx={{ flex: 1 }}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="SUTA %"
                                  value={(position as any).sutaRate ?? ''}
                                  onChange={(e) => {
                                    const updated = [...gigPositions];
                                    (updated[index] as any).sutaRate = e.target.value;
                                    setGigPositions(updated);
                                  }}
                                  placeholder="e.g. 2.7"
                                  type="number"
                                  inputProps={{ step: 0.01, min: 0 }}
                                  helperText="State unemployment on pay (C1 Workforce / C1 Select)"
                                />
                              </Box>
                              <Box sx={{ flex: 1 }}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="FUTA %"
                                  value={(position as any).futaRate ?? ''}
                                  onChange={(e) => {
                                    const updated = [...gigPositions];
                                    (updated[index] as any).futaRate = e.target.value;
                                    setGigPositions(updated);
                                  }}
                                  placeholder="e.g. 0.6"
                                  type="number"
                                  inputProps={{ step: 0.01, min: 0 }}
                                  helperText="Federal unemployment on pay"
                                />
                              </Box>
                            </Box>
                          )}

                          {/*
                            Per-position client-provided job description.
                            Auto-seeded from the account's
                            `pricing.positions[i].jobDescriptionFromClient`
                            when the recruiter picks a job title preset
                            (see the Autocomplete onChange / onBlur above);
                            free-form editable so a recruiter can tailor
                            the language for this specific gig.
                          */}
                          <TextField
                            fullWidth
                            size="small"
                            label="Job Description from Client"
                            value={(position as any).jobDescriptionFromClient ?? ''}
                            onChange={(e) => {
                              const updated = [...gigPositions];
                              (updated[index] as any).jobDescriptionFromClient = e.target.value;
                              setGigPositions(updated);
                            }}
                            multiline
                            rows={4}
                            placeholder="Enter the client-provided description for this position..."
                          />

                          {/*
                            Per-position Uniform Requirements (May 2026).
                            Hosted inline below the JD because uniforms
                            are inherently per-role on gig events (Cooks
                            wear chef coats, Servers wear black bistro,
                            etc.) — pulling them out of the collapsible
                            override block makes them tactile without
                            forcing the recruiter to expand "Customize"
                            for every position. Both fields write to the
                            same `position.requirements` map slice 1
                            introduced (`dressCode` array,
                            `customUniformRequirements` string) so the
                            existing resolver / Jobs Board snapshot
                            wiring (slice 3) picks them up unchanged.
                          */}
                          <Autocomplete
                            multiple
                            size="small"
                            options={POSITION_DRESS_CODE_OPTIONS}
                            value={
                              Array.isArray((position as any)?.requirements?.dressCode)
                                ? (position as any).requirements.dressCode
                                : []
                            }
                            onChange={(_e, newValue) => {
                              setGigPositions((prev) => {
                                const updated = [...prev];
                                const prevReqs = (updated[index] as any).requirements ?? {};
                                updated[index] = {
                                  ...updated[index],
                                  requirements: {
                                    ...prevReqs,
                                    dressCode: newValue,
                                  },
                                };
                                return updated;
                              });
                            }}
                            renderTags={(value, getTagProps) =>
                              value.map((option: string, idx: number) => {
                                const { key, ...chipProps } = getTagProps({ index: idx });
                                return (
                                  <Chip
                                    key={key}
                                    label={option}
                                    size="small"
                                    variant="outlined"
                                    {...chipProps}
                                  />
                                );
                              })
                            }
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                size="small"
                                label="Uniform Requirements"
                                placeholder="e.g. Black Bistro, Closed-Toe Shoes"
                                helperText="Select the dress code / uniform pieces applicants must wear for this position."
                              />
                            )}
                          />

                          <TextField
                            fullWidth
                            size="small"
                            label="Custom Uniform Requirements"
                            value={
                              typeof (position as any)?.requirements?.customUniformRequirements === 'string'
                                ? (position as any).requirements.customUniformRequirements
                                : ''
                            }
                            onChange={(e) => {
                              setGigPositions((prev) => {
                                const updated = [...prev];
                                const prevReqs = (updated[index] as any).requirements ?? {};
                                updated[index] = {
                                  ...updated[index],
                                  requirements: {
                                    ...prevReqs,
                                    customUniformRequirements: e.target.value,
                                  },
                                };
                                return updated;
                              });
                            }}
                            multiline
                            rows={2}
                            placeholder="Anything not covered by the standard list (e.g. branded apron, specific shoe color)..."
                          />

                          {/*
                            Per-position requirements overrides
                            (slice 2 of the May 2026 work). Reads JO
                            defaults from `formData` and writes
                            position-level overrides to
                            `gigPositions[index].requirements`. The
                            existing debounced auto-save (see
                            `gigPositionsLastSavedSigRef` effect
                            above) persists the change to Firestore
                            ~600ms after the recruiter stops editing
                            — no per-call save needed here.
                          */}
                          <PositionRequirementsEditor
                            jobOrder={formData}
                            position={position}
                            options={positionRequirementsOptions}
                            onChange={(nextRequirements) => {
                              setGigPositions((prev) => {
                                const updated = [...prev];
                                updated[index] = {
                                  ...updated[index],
                                  requirements: nextRequirements,
                                };
                                return updated;
                              });
                            }}
                          />
                        </Box>
                        {gigPositions.length > 1 && (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              setGigPositions(gigPositions.filter((_, i) => i !== index));
                            }}
                            sx={{ mt: 0.5 }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
                        )}
                      </div>
                    ))}
                  </Box>
                </Grid>
              )}

              {/* Pay Rate/Markup/Bill Rate - Only for Career type */}
              {formData.jobType === 'career' && (
                <>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      label={getFieldDef('payRate')?.label || 'Pay Rate'}
                      value={formData.payRate}
                      onChange={(e) => handleInputChange('payRate', e.target.value)}
                      onBlur={(e) => handleFieldBlur('payRate', e.target.value)}
                      placeholder="e.g., $15/hour, $500/week"
                    />
                  </Grid>

                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      label={getFieldDef('markup')?.label || 'Markup (%)'}
                      value={formData.markup}
                      onChange={(e) => handleInputChange('markup', e.target.value)}
                      placeholder="e.g., 25"
                    />
                  </Grid>

                  {(!formData.markup || String(formData.markup).trim() === '' || Number(formData.markup) === 0) ? (
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        label={getFieldDef('billRate')?.label || 'Bill Rate'}
                        value={formData.billRate}
                        onChange={(e) => handleInputChange('billRate', e.target.value)}
                        onBlur={(e) => handleFieldBlur('billRate', e.target.value)}
                        placeholder="e.g., $22.50"
                      />
                    </Grid>
                  ) : (
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        label={getFieldDef('calculatedBillRate')?.label || 'Calculated Bill Rate'}
                        value={formData.calculatedBillRate}
                        InputProps={{ readOnly: true }}
                      />
                    </Grid>
                  )}
                  {/* Row 3: Workers Comp Class Code, Workers Comp Rate */}
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Workers Comp Class Code"
                      value={formData.workersCompClassCode || ''}
                      onChange={(e) => handleInputChange('workersCompClassCode', e.target.value)}
                      placeholder="e.g. 9015"
                      helperText="From Settings > Onboarding Library > WC Class Codes"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Workers Comp Rate"
                      value={formData.workersCompRate || ''}
                      onChange={(e) => handleInputChange('workersCompRate', e.target.value)}
                      placeholder="e.g. 2.34"
                      type="number"
                      inputProps={{ step: 0.01, min: 0 }}
                    />
                  </Grid>

                  {/*
                   * Row 4: SUTA % / FUTA % — only when the JO's hiring entity
                   * pays unemployment tax on payroll (today: C1 Workforce / C1
                   * Select). Mirrors the gig-positions row immediately below
                   * the gig "Add Position" button. Career flattens these onto
                   * the JO doc; gig persists per-position on `gigPositions[i]`.
                   *
                   * The Apply button force-overwrites both fields with the
                   * worksite-state new-employer SUTA + state-effective FUTA
                   * (read from `src/utils/unemploymentRates.ts`). Disabled
                   * when the worksite has no resolvable state code.
                   */}
                  {showSutaFutaOnGigPositions && (
                    <>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="SUTA %"
                          value={formData.sutaRate || ''}
                          onChange={(e) => handleInputChange('sutaRate', e.target.value)}
                          onBlur={(e) => handleFieldBlur('sutaRate', e.target.value)}
                          placeholder="e.g. 2.5"
                          type="number"
                          inputProps={{ step: 0.01, min: 0 }}
                          helperText="State unemployment on pay (C1 Workforce / C1 Select). Worksite state is fixed at the JO level."
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="FUTA %"
                          value={formData.futaRate || ''}
                          onChange={(e) => handleInputChange('futaRate', e.target.value)}
                          onBlur={(e) => handleFieldBlur('futaRate', e.target.value)}
                          placeholder="e.g. 0.6"
                          type="number"
                          inputProps={{ step: 0.01, min: 0 }}
                          helperText="Federal unemployment on pay. Worksite state is fixed at the JO level."
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={applySutaFutaFromWorksiteState}
                            disabled={!worksiteStateCodeForPricing}
                          >
                            Apply SUTA/FUTA from worksite state
                          </Button>
                          <Typography variant="caption" color="text.secondary">
                            {worksiteStateCodeForPricing
                              ? `Estimated new-employer SUTA and FUTA for ${worksiteStateCodeForPricing} (same as Account → Pricing).`
                              : 'Select a worksite with a state to apply rates.'}
                          </Typography>
                        </Box>
                      </Grid>
                    </>
                  )}
                </>
              )}

            {formData.jobType === 'career' && (
              <Grid item xs={12} md={12}>
                <Autocomplete
                  multiple
                  fullWidth
                  options={['Full Time', 'Part Time', 'Temporary', 'On Call', 'First Shift', 'Second Shift', 'Third Shift', 'Day Shift', 'Night Shift', 'Swing Shift', 'Weekends', 'Some Weekends', 'Some Nights', '8 Hour', '10 Hour', '12 Hour']}
                  value={Array.isArray((formData as any).shiftType) ? (formData as any).shiftType : ((formData as any).shiftType ? [(formData as any).shiftType] : [])}
                  onChange={(event, newValue) => {
                    handleInputChange('shiftType', newValue);
                    handleFieldBlur('shiftType', newValue);
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Shift Details"
                      helperText="Select shift requirements for this position"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        variant="outlined"
                        label={option}
                        {...getTagProps({ index })}
                        key={option}
                      />
                    ))
                  }
                />
              </Grid>
            )}

            {/*
              JO-level "Job Description from Client" is career-only.
              Gigs have a per-position description inside each position
              card (see the Positions section above) — a single shared
              field at the JO level meant a "Food Servers" description
              also displayed on a sibling "Cooks" position, which was
              the bug that triggered this refactor.
            */}
            {formData.jobType === 'career' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Job Description from Client"
                  value={formData.jobDescriptionFromClient}
                  onChange={(e) => handleInputChange('jobDescriptionFromClient', e.target.value)}
                  onBlur={(e) => handleFieldBlur('jobDescriptionFromClient', e.target.value)}
                  multiline
                  rows={4}
                  placeholder="Enter the job description provided by the client..."
                />
              </Grid>
            )}
              </>
            )}

            </Grid>
            )}

            {/* Compliance & Requirements Section — shown on Requirements tab. */}
            {showRequirements && (<>
            <Grid item xs={12}>
              {section === 'all' && <Divider sx={{ my: 3 }} />}
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Compliance & Requirements
              </Typography>
              {/*
                Overrides summary banner (slice 2 May 2026). Visible
                only on gig JOs and only when at least one position
                has overrides. Tells the recruiter where to find them
                so the Requirements tab doesn't feel like the only
                source of truth. Career JOs never trigger this banner
                because they don't carry positions at this layer.
                Click jumps to the Positions tab via the optional
                onJumpToPositionsTab callback (page-level wires it
                with `setActiveTab('positions')`); without the
                callback the banner still renders but isn't
                clickable.
              */}
              {formData.jobType === 'gig' && (() => {
                const positionsWithOverrides = (gigPositions || []).filter(
                  (p) =>
                    p?.requirements != null &&
                    Object.values(p.requirements).some((v) => v !== undefined && v !== null),
                ).length;
                if (positionsWithOverrides === 0) return null;
                return (
                  <Alert
                    severity="info"
                    sx={{ mb: 2, cursor: onJumpToPositionsTab ? 'pointer' : 'default' }}
                    onClick={() => onJumpToPositionsTab?.()}
                  >
                    These defaults apply to every position on this order.{' '}
                    <strong>{positionsWithOverrides}</strong> of{' '}
                    <strong>{gigPositions.length}</strong> position
                    {gigPositions.length === 1 ? '' : 's'} have overrides — review on the
                    Positions tab.
                  </Alert>
                );
              })()}
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12}>
                  <AccusourcePackageSelector
                    packageId={formData.screeningPackageId}
                    packageName={formData.screeningPackageName}
                    onChange={(next) => {
                      const merged = { ...formData, screeningPackageId: next.packageId, screeningPackageName: next.packageName };
                      setFormData(merged);
                      if (isEditing && jobOrderId) {
                        void saveFieldToFirestore('screeningPackageId', next.packageId, merged);
                      }
                    }}
                    showDiagnostics
                    emptyMenuLabel="None"
                    helperText="Overrides account and location order defaults for AccuSource screening (merge order: job → location → account)."
                  />
                </Grid>
                <Grid item xs={12}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={Array.isArray(additionalScreeningOptions) ? additionalScreeningOptions.map(option => option.label) : []}
                    value={formData.additionalScreenings}
                    onChange={(event, newValue) => {
                      handleInputChange('additionalScreenings', newValue);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Additional Screenings"
                        helperText="Select required additional screening types (healthcare, credentials, etc.)"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    multiple
                    options={Array.isArray(getOptionsForField('licensesCerts', companyDefaultsForOptions)) ? getOptionsForField('licensesCerts', companyDefaultsForOptions) : []}
                    value={formData.licensesCerts.map(cred => ({ value: cred, label: cred }))}
                    onChange={(_, newValue) => {
                      const credValues = newValue.map(option => option.value);
                      handleInputChange('licensesCerts', credValues);
                    }}
                    getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
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
                        label={getFieldDef('licensesCerts')?.label || 'Licenses & Certifications'}
                        placeholder="Type to search licenses and certifications..."
                        helperText="Start typing to search from 100+ standard credentials"
                      />
                    )}
                    filterSelectedOptions
                    freeSolo={false}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Experience Required</InputLabel>
                    <Select
                      value={formData.experienceRequired}
                      onChange={(e) => handleInputChange('experienceRequired', e.target.value)}
                      label="Experience Required"
                    >
                      {experienceOptions.map((option, index) => (
                        <MenuItem key={index} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Education Required</InputLabel>
                    <Select
                      value={formData.educationRequired}
                      onChange={(e) => handleInputChange('educationRequired', e.target.value)}
                      label="Education Required"
                    >
                      {educationOptions.map((option, index) => (
                        <MenuItem key={index} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  multiple
                  freeSolo
                  fullWidth
                  options={Array.isArray(getOptionsForField('languages', companyDefaultsForOptions)) ? getOptionsForField('languages', companyDefaultsForOptions).map(opt => opt.value) : []}
                  value={formData.languagesRequired}
                  onChange={(event, newValue) => {
                    handleInputChange('languagesRequired', newValue);
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={getFieldDef('languages')?.label || 'Languages Required'}
                      helperText="Select required languages or type to add a custom one"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        variant="outlined"
                        label={option}
                        {...getTagProps({ index })}
                        key={option}
                      />
                    ))
                  }
                />
              </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    multiple
                    options={Array.isArray(getOptionsForField('skills', companyDefaultsForOptions)) ? getOptionsForField('skills', companyDefaultsForOptions) : []}
                    value={formData.skillsRequired.map(skill => ({ value: skill, label: skill }))}
                    onChange={(_, newValue) => {
                      const skillValues = newValue.map(option => option.value);
                      handleInputChange('skillsRequired', skillValues);
                    }}
                    getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
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
                        label={getFieldDef('skills')?.label || 'Skills Required'}
                        placeholder="Type to search skills..."
                        helperText="Start typing to search from 500+ O*NET skills"
                      />
                    )}
                    filterSelectedOptions
                    freeSolo={false}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={[
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
                      'Other'
                    ]}
                    value={formData.physicalRequirements}
                    onChange={(event, newValue) => {
                      handleInputChange('physicalRequirements', newValue);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Physical Requirements"
                        helperText="Select physical requirements for this position"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={[
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
                      'First Aid Kit',
                      'Emergency Shower',
                      'Eye Wash Station',
                      'Fire Extinguisher',
                      'Safety Data Sheets',
                      'Lockout/Tagout Devices',
                      'Barricades',
                      'Warning Signs',
                      'Personal Alarm',
                      'Two-Way Radio',
                      'Flashlight',
                      'Headlamp',
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
                      'Chainsaw Chaps',
                      'Cutting Gloves',
                      'Abrasion-Resistant Clothing',
                      'Flame-Resistant Clothing',
                      'Arc Flash Protection',
                      'Voltage-Rated Gloves',
                      'Rubber Insulating Gloves',
                      'Leather Protectors',
                      'Insulating Blankets',
                      'Insulating Covers',
                      'Hot Sticks',
                      'Voltage Detectors',
                      'Ground Fault Circuit Interrupters',
                      'Other'
                    ]}
                    value={formData.ppeRequirements}
                    onChange={(event, newValue) => {
                      handleInputChange('ppeRequirements', newValue);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={getFieldDef('ppe')?.label || 'PPE Requirements'}
                        helperText="Select required personal protective equipment"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth disabled={!hasPpeRequirementsForJo}>
                    <InputLabel>{getFieldDef('ppeProvidedBy')?.label || 'PPE Provided By'}</InputLabel>
                    <Select
                      displayEmpty
                      value={hasPpeRequirementsForJo ? formData.ppeProvidedBy || 'company' : ''}
                      onChange={(e) => handleInputChange('ppeProvidedBy', e.target.value)}
                      label={getFieldDef('ppeProvidedBy')?.label || 'PPE Provided By'}
                    >
                      {!hasPpeRequirementsForJo && (
                        <MenuItem value="">
                          <em>Add PPE requirements first</em>
                        </MenuItem>
                      )}
                      <MenuItem value="company">Company</MenuItem>
                      <MenuItem value="worker">Worker</MenuItem>
                      <MenuItem value="both">Both</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                {/* Job Score pack + uniform fields — hidden (remove `false &&` to restore). */}
                {false && (
                  <>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Job Score requirement pack</InputLabel>
                    <Select
                      value={formData.requirementPackId || ''}
                      onChange={(e) => handleInputChange('requirementPackId', e.target.value)}
                      label="Job Score requirement pack"
                    >
                      <MenuItem value="">None</MenuItem>
                      {getRequirementPackIds().map((id) => (
                        <MenuItem key={id} value={id}>
                          {JOB_REQUIREMENT_PACKS[id as keyof typeof JOB_REQUIREMENT_PACKS]?.name ?? id}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                  </>
                )}
            </Grid>

            {/* Uniform Requirements — hidden (remove `false &&` to restore). */}
            {false && (
            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={[
                      'Business Casual',
                      'Business Professional',
                      'Black Bistro',
                      'Casual',
                      'Scrubs',
                      'Uniform Provided',
                      'Black Pants',
                      'White Shirt',
                      'Polo Shirt',
                      'Button-Down Shirt',
                      'Black Button-Down Shirt',
                      'Dress Shirt',
                      'Khaki Pants',
                      'Dress Pants',
                      'Jeans (Dark)',
                      'Jeans (No Holes)',
                      'Slacks',
                      'Skirt/Dress',
                      'Blouse',
                      'Sweater',
                      'Cardigan',
                      'Blazer',
                      'Suit',
                      'Tie Required',
                      'No Tie',
                      'Closed-Toe Shoes',
                      'Steel-Toe Boots',
                      'Non-Slip Shoes',
                      'Dress Shoes',
                      'Sneakers',
                      'Boots',
                      'Sandals Allowed',
                      'No Sandals',
                      'No Flip-Flops',
                      'No Shorts',
                      'No Tank Tops',
                      'No Graphic Tees',
                      'No Hoodies',
                      'No Sweatpants',
                      'No Leggings',
                      'No Yoga Pants',
                      'No Athletic Wear',
                      'No Ripped Clothing',
                      'No Visible Tattoos',
                      'No Facial Piercings',
                      'Minimal Jewelry',
                      'No Jewelry',
                      'Hair Tied Back',
                      'Clean Shaven',
                      'Facial Hair Allowed',
                      'Hair Color Restrictions',
                      'No Hair Color Restrictions',
                      'Coveralls',
                      'Safety Vest',
                      'Hard Hat',
                      'Reflective Clothing',
                      'Weather-Appropriate',
                      'Seasonal Attire',
                      'Formal Occasions',
                      'Customer-Facing',
                      'Back Office',
                      'Laboratory',
                      'Kitchen',
                      'Warehouse',
                      'Construction',
                      'Healthcare',
                      'Food Service',
                      'Retail',
                      'Office',
                      'Other'
                    ]}
                    value={formData.dressCode}
                    onChange={(event, newValue) => {
                      handleInputChange('dressCode', newValue);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Uniform Requirements"
                        helperText="Select dress code and uniform requirements"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
            </Grid>
            )}

            {/* Custom Uniform Requirements — hidden (remove `false &&` to restore). */}
            {false && (
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Custom Uniform Requirements"
                  multiline
                  rows={3}
                  value={formData.customUniformRequirements}
                  onChange={(e) => handleInputChange('customUniformRequirements', e.target.value)}
                  placeholder="Enter custom uniform requirements text..."
                  helperText="Enter any additional or custom uniform requirements"
                />
              </Grid>
            </Grid>
            )}
            </>)}

            {/*
              Company Contacts section was removed from this form by request:
              the seven role pickers (Decision Maker, HR, Operations,
              Procurement, Billing, Safety, Invoice) were noisy on the JO
              create surface and recruiters edit them on the Account /
              Contact pages instead. Form-state fields
              (`decisionMaker`, `hrContactId`, `operationsContactId`,
              `procurementContactId`, `billingContactId`,
              `safetyContactId`, `invoiceContactId`) are intentionally kept
              in `formData` and in the create / edit write paths — JOs
              created from a deal still inherit those role IDs from the
              deal doc, and the JO Detail page surfaces them. This is a
              pure UI-only removal.
            */}

            {/*
              Action button row removed — every field auto-saves on
              change/blur (`handleInputChange`/`handleFieldBlur`), and
              gig positions are auto-saved via the debounced effect
              defined alongside `gigPositions` state. The legacy Save /
              Cancel buttons in the create flow are now mounted by the
              callers that still create JOs (NewJobOrder, etc.) outside
              this form's body — see `handleSave` / `handleCancel` which
              remain exported via the form's effects below.
            */}
            {!isEditing && (
              <Grid item xs={12}>
                <Divider sx={{ my: 3 }} />
                <Stack direction="row" spacing={2}>
                  <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={handleSave}
                    disabled={saving}
                    sx={{ minWidth: 120 }}
                  >
                    {saving ? <CircularProgress size={20} /> : 'Create Job Order'}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<CancelIcon />}
                    onClick={handleCancel}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </Stack>
              </Grid>
            )}
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default JobOrderForm;
