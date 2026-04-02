import React, { useState, useEffect, useMemo } from 'react';
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
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../data/screeningsOptions';
import { JobOrder, JobOrderContact } from '../types/recruiter/jobOrder';
import { getFieldDef } from '../fields/useFieldDef';
import { toNumberSafe, toISODate, coerceSelect } from '../utils/fieldCoercions';
import { getRegistryPath, setDeep, getRegistryIdForField } from '../utils/registryHelpers';
import { getOptionsForField } from '../utils/fieldOptions';
import jobTitlesList from '../data/onetJobTitles.json';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';
import { ensureCityInSmartGroups } from '../services/smartGroupMetroSync';
import { getRequirementPackIds, JOB_REQUIREMENT_PACKS } from '../data/jobRequirementPacks';
import { useWorkersCompRatesByJobTitle } from '../hooks/useWorkersCompRatesByJobTitle';
import { AccusourcePackageSelector } from './recruiter/AccusourcePackageSelector';
import { useEntity } from '../hooks/useEntity';
import { normalizeStateCode } from '../utils/unemploymentRates';
import {
  fetchResolvedAccountPricingPositions,
  buildPricingByJobTitle,
} from '../utils/accountPricingForJobOrder';
import type { AccountPositionPricing } from '../types/recruiter/account';

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
}) => {
  const { tenantId: authTenantId, user: authUser } = useAuth();
  const navigate = useNavigate();
  
  // Use props if provided, otherwise fall back to auth context
  const tenantId = propTenantId || authTenantId;
  const user = propCreatedBy ? { uid: propCreatedBy } : authUser;
  const wcRatesByStateAndJobTitle = useWorkersCompRatesByJobTitle(tenantId);

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
  };
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

  /** Hiring entity from the job order's linked recruiter account (fixes stale job orders created before the account had hiringEntityId). */
  const recruiterAccountHiringEntityId = useMemo(() => {
    const accId = effectiveRecruiterAccountId;
    if (!accId) return null;
    const acc = recruiterAccountsForPicker.find((a) => a.id === accId);
    return acc?.hiringEntityId ? String(acc.hiringEntityId) : null;
  }, [effectiveRecruiterAccountId, recruiterAccountsForPicker]);

  /** Hiring Entity (Employer of Record): E-Verify comes from here (read-only downstream). */
  const hiringEntityIdForForm = useMemo(
    () =>
      recruiterAccountHiringEntityId ??
      initialData?.hiringEntityId ??
      jobOrder?.hiringEntityId ??
      (loadedJobOrderData as any)?.hiringEntityId ??
      null,
    [recruiterAccountHiringEntityId, initialData?.hiringEntityId, jobOrder?.hiringEntityId, loadedJobOrderData]
  );
  const { entity: formEntity } = useEntity(tenantId ?? null, hiringEntityIdForForm);
  const [gigPositions, setGigPositions] = useState<Array<{jobTitle: string; workersNeeded: number; payRate: string; workersCompClassCode?: string; workersCompRate?: string}>>([
    { jobTitle: '', workersNeeded: 1, payRate: '' }
  ]); // For gig-type jobs with multiple positions
  const [companies, setCompanies] = useState<Company[]>(propCompanies || []);
  const [locations, setLocations] = useState<Location[]>(propLocations || []);
  const [filteredLocations, setFilteredLocations] = useState<Location[]>([]);
  const [associatedContacts, setAssociatedContacts] = useState<Contact[]>([]);
  const [companyContacts, setCompanyContacts] = useState<JobOrderContact[]>([]);
  const [loadedContacts, setLoadedContacts] = useState<any[]>([]);
  const [contactDropdownValue, setContactDropdownValue] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Company Defaults State
  const [backgroundCheckPackages, setBackgroundCheckPackages] = useState<Array<{title: string, description: string}>>([]);
  const [drugScreeningPanels, setDrugScreeningPanels] = useState<Array<{title: string, description: string}>>([]);
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
    screeningPanels: drugScreeningPanels,
    uniformRequirements,
    ppe: ppeOptions,
    licensesCerts: licensesCerts,
    experienceLevels,
    educationLevels,
    physicalRequirements,
    languages,
    skills,
  } as any;

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
    drugScreeningPanels: [],
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
    ppeProvidedBy: 'company',
    requirementPackId: '',
    workersCompClassCode: '',
    workersCompRate: '',
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
            const assoc = data.associations as { companyIds?: string[] } | undefined;
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
            return {
              id: d.id,
              name,
              label,
              companyIds,
              hiringEntityId: he != null && String(he).trim() ? String(he) : null,
              parentAccountId,
            };
          })
          .filter((x): x is PickerAccount => x != null);
        setRecruiterAccountsForPicker(list);
      } catch (e) {
        console.error('JobOrderForm: load recruiter accounts', e);
        if (!cancelled) setRecruiterAccountsForPicker([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const showOptionalRecruiterAccountLink = isEditing || !requireAccountSelection;

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

  const accountLinkedCompanyIds = useMemo(() => {
    if (!requireAccountSelection || isEditing || !pickedRecruiterAccountId) return null;
    const acc = recruiterAccountsForPicker.find((a) => a.id === pickedRecruiterAccountId);
    const ids = (acc?.companyIds || []).filter(Boolean);
    return ids.length ? ids : null;
  }, [requireAccountSelection, isEditing, pickedRecruiterAccountId, recruiterAccountsForPicker]);

  const singleCompanyIdForAccount = useMemo(
    () => (accountLinkedCompanyIds?.length === 1 ? accountLinkedCompanyIds[0] : null),
    [accountLinkedCompanyIds]
  );

  const companiesForCompanyField = useMemo(() => {
    if (!requireAccountSelection || isEditing) return companiesDeduped;
    if (!accountLinkedCompanyIds?.length) return [];
    const idSet = new Set(accountLinkedCompanyIds);
    return companiesDeduped.filter((c) => idSet.has(c.id));
  }, [requireAccountSelection, isEditing, companiesDeduped, accountLinkedCompanyIds]);

  useEffect(() => {
    if (!requireAccountSelection || isEditing) return;
    if (!pickedRecruiterAccountId) {
      setFormData((prev) => {
        if (!prev.companyId && !prev.worksiteId) return prev;
        return { ...prev, companyId: '', worksiteId: '' };
      });
      return;
    }
    const acc = recruiterAccountsForPicker.find((a) => a.id === pickedRecruiterAccountId);
    if (!acc) return;
    const ids = acc.companyIds.filter(Boolean);
    setFormData((prev) => {
      if (ids.length === 1) {
        return prev.companyId === ids[0] && prev.worksiteId === ''
          ? prev
          : { ...prev, companyId: ids[0], worksiteId: '' };
      }
      if (ids.length > 1) {
        if (prev.companyId && ids.includes(prev.companyId)) return prev;
        return { ...prev, companyId: '', worksiteId: '' };
      }
      return { ...prev, companyId: '', worksiteId: '' };
    });
  }, [requireAccountSelection, isEditing, pickedRecruiterAccountId, recruiterAccountsForPicker]);

  const gigGrossProfitDisplay = useMemo(
    () => formatGigGrossProfit(formData.gigEstimatedValue, formData.gigAverageMarkup),
    [formData.gigEstimatedValue, formData.gigAverageMarkup]
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

  // Load company contacts when companyId is present in formData
  useEffect(() => {
    if (formData.companyId && tenantId) {
      loadCompanyContacts(formData.companyId);
    }
  }, [formData.companyId, tenantId]);

  // Auto-apply WC code/rate from master when job title + worksite state match (Settings > Workers Comp Rates)
  useEffect(() => {
    if (!formData.worksiteId || Object.keys(wcRatesByStateAndJobTitle).length === 0) return;
    const selectedLocation = filteredLocations.find((loc) => loc.id === formData.worksiteId) as (Location & { state?: string; address?: { state?: string } }) | undefined;
    const stateRaw = selectedLocation?.state ?? selectedLocation?.address?.state;
    const stateCode = normalizeStateCode(stateRaw).trim().toUpperCase();
    if (!stateCode) return;

    if (formData.jobType === 'gig') {
      let updated = false;
      const next = gigPositions.map((pos) => {
        const jobTitle = (pos.jobTitle ?? '').trim();
        if (!jobTitle) return pos;
        const key = `${stateCode}_${jobTitle.toLowerCase()}`;
        const lookup = wcRatesByStateAndJobTitle[key];
        if (!lookup) return pos;
        if (pos.workersCompClassCode === lookup.code && String(pos.workersCompRate ?? '') === String(lookup.rate)) return pos;
        updated = true;
        return { ...pos, workersCompClassCode: lookup.code, workersCompRate: String(lookup.rate) };
      });
      if (updated) setGigPositions(next);
      return;
    }

    const jobTitle = (formData.jobTitle ?? '').trim();
    if (!jobTitle) return;
    const key = `${stateCode}_${jobTitle.toLowerCase()}`;
    const lookup = wcRatesByStateAndJobTitle[key];
    if (!lookup) return;
    setFormData((prev) => {
      if (prev.workersCompClassCode === lookup.code && String(prev.workersCompRate ?? '') === String(lookup.rate)) return prev;
      return { ...prev, workersCompClassCode: lookup.code, workersCompRate: String(lookup.rate) };
    });
  }, [formData.worksiteId, formData.jobTitle, formData.jobType, gigPositions, filteredLocations, wcRatesByStateAndJobTitle]);

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
        setDrugScreeningPanels(data.screeningPanels || []);
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
        

        setFormData({
          // Basic Information
          jobOrderNumber: data.jobOrderNumber || '',
          jobOrderName: data.jobOrderName || '',
          jobTitle: (data as any).jobTitle || (stageData.discovery?.jobTitles?.[0] || ''),
          description: data.jobOrderDescription || '',
          jobDescriptionFromClient: (data as any).jobDescriptionFromClient || '',
          companyId: (data as any).companyId || '',
          worksiteId: (data as any).worksiteId || '',
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
          backgroundCheckPackages: Array.isArray((data as any).backgroundCheckPackages)
            ? (data as any).backgroundCheckPackages
            : (stageData.scoping?.compliance?.backgroundCheckPackages || []),
          drugScreeningPanels: Array.isArray((data as any).drugScreeningPanels)
            ? (data as any).drugScreeningPanels
            : (stageData.scoping?.compliance?.drugScreeningPanels || []),
          additionalScreenings: Array.isArray((data as any).additionalScreenings)
            ? (data as any).additionalScreenings
            : (stageData.scoping?.compliance?.additionalScreenings || []),
          eVerifyRequired: stageData.scoping?.compliance?.eVerify || false,
          dressCode: stageData.scoping?.uniformRequirements || [],
          customUniformRequirements: (data as any).customUniformRequirements || stageData.scoping?.customUniformRequirements || '',
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
          physicalRequirements: Array.isArray((data as any).physicalRequirements)
            ? (data as any).physicalRequirements
            : (stageData.scoping?.compliance?.physicalRequirements || []),
          ppeRequirements: Array.isArray((data as any).ppeRequirements)
            ? (data as any).ppeRequirements
            : (stageData.scoping?.compliance?.ppe || []),
          ppeProvidedBy: stageData.scoping?.compliance?.ppeProvidedBy || 'company',
          requirementPackId: (data as any).requirementPackId || '',
          workersCompClassCode: (data as any).workersCompClassCode || '',
          workersCompRate: (data as any).workersCompRate != null ? String((data as any).workersCompRate) : '',
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
        });

        const rid = (data as any).recruiterAccountId;
        setPickedRecruiterAccountId(
          typeof rid === 'string' && rid.trim() ? rid.trim() : null
        );
        
        // Load gig positions if job type is gig
        if ((data as any).jobType === 'gig' && (data as any).gigPositions) {
          const loaded = ((data as any).gigPositions as any[]).map((p: any) => ({
            jobTitle: p.jobTitle ?? '',
            workersNeeded: p.workersNeeded ?? 1,
            payRate: String(p.payRate ?? ''),
            markup: p.markup,
            billRate: p.billRate,
            workersCompClassCode: p.workersCompClassCode ?? '',
            workersCompRate: p.workersCompRate != null ? String(p.workersCompRate) : '',
          }));
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
          } as any]);
        }
        
        // Load locations for the company if companyId is set
        const companyForLocations = (data as any).companyId;
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
            backgroundCheckPackages: (dataToUse as any).backgroundCheckPackages || [],
            drugScreen: (dataToUse as any).drugScreenRequired || undefined,
            drugScreeningPanels: (dataToUse as any).drugScreeningPanels || [],
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
      

      // Compute calculated bill rate if markup/payRate present
      const numericPay = toNumberSafe((dataToUse as any).payRate) ?? 0;
      const numericMarkup = toNumberSafe((dataToUse as any).markup) ?? 0;
      const computedBill = numericMarkup > 0 && numericPay > 0 ? Number((numericPay * (1 + numericMarkup / 100)).toFixed(2)) : 0;

      const updates = {
        tenantId,
        jobOrderName: dataToUse.jobOrderName,
        jobOrderDescription: dataToUse.description,
        jobDescriptionFromClient: dataToUse.jobDescriptionFromClient || undefined,
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
        if (!pickedRecruiterAccountId) {
          setError('Please select an account.');
          setSaving(false);
          return;
        }
        const accPick = recruiterAccountsForPicker.find((a) => a.id === pickedRecruiterAccountId);
        const allowedIds = new Set((accPick?.companyIds || []).filter(Boolean));
        if (allowedIds.size === 0) {
          setError(
            'This account has no linked companies. Link at least one company on the account before creating a job order.'
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
              backgroundCheckPackages: formData.backgroundCheckPackages,
              drugScreen: formData.drugScreenRequired,
              drugScreeningPanels: formData.drugScreeningPanels,
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

      const jobOrderData = {
        // Job Order specific fields
        tenantId,
        jobOrderName: formData.jobOrderName,
        jobTitle: formData.jobType === 'gig' ? (gigPositions[0]?.jobTitle || '') : formData.jobTitle,
        jobOrderDescription: formData.description,
        jobDescriptionFromClient: formData.jobDescriptionFromClient || undefined,
        status: formData.status,
        jobType: formData.jobType || 'career',
        workersNeeded: formData.jobType === 'gig' 
          ? gigPositions.reduce((sum, pos) => sum + (pos.workersNeeded || 0), 0) 
          : (parseInt(formData.workersNeeded.toString()) || 1),
        companyId: formData.companyId || '',
        worksiteId: formData.worksiteId || '',
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
        calculatedBillRate: formData.jobType === 'gig'
          ? (() => {
              const payRate = parseFloat(gigPositions[0]?.payRate || '0') || 0;
              const markup = parseFloat((gigPositions[0] as any)?.markup || '0') || 0;
              return markup > 0 && payRate > 0 ? Number((payRate * (1 + markup / 100)).toFixed(2)) : 0;
            })()
          : computedBillForCreate,
        startDate: formData.startDate || null,
        endDate: formData.endDate || null,
        
        // Gig positions array (only for gig type)
        gigPositions: formData.jobType === 'gig' ? gigPositions : undefined,
        
        // Update the deal data
        deal: updatedDealData,
        
        // HR Contact
        hrContactId: formData.hrContactId || '',
        
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
        ppeProvidedBy: formData.ppeProvidedBy || 'company',
        customUniformRequirements:
          typeof formData.customUniformRequirements === 'string' && formData.customUniformRequirements.trim()
            ? formData.customUniformRequirements.trim()
            : formData.customUniformRequirements === ''
              ? ''
              : undefined,
        showCustomUniformRequirements: formData.showCustomUniformRequirements,
        requirementPackId: formData.requirementPackId || undefined,
        screeningPackageId: String(formData.screeningPackageId ?? '').trim() || null,
        screeningPackageName: String(formData.screeningPackageName ?? '').trim() || null,
        
        // Background Check and Drug Screening
        backgroundCheckPackages: formData.backgroundCheckPackages || [],
        drugScreeningPanels: formData.drugScreeningPanels || [],
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

      {/* Comprehensive Form with Section Headers */}
      <Card>
        <CardContent>
          <Grid container spacing={2}>
            {/* Basic Information Section */}
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2, mb: 2, color: 'primary.main' }}>
                Basic Information
              </Typography>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>
            
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
                    value={recruiterAccountsForPicker.find((a) => a.id === pickedRecruiterAccountId) || null}
                    onChange={(_, newValue) => {
                      setPickedRecruiterAccountId(newValue?.id ?? null);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Account"
                        required
                        helperText="Select the client account. Company and worksites follow from linked companies."
                      />
                    )}
                  />
                </Grid>
              )}

              <Grid item xs={12} md={6}>
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
                    !isEditing &&
                    (!pickedRecruiterAccountId ||
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
                        requireAccountSelection && !isEditing && pickedRecruiterAccountId && !accountLinkedCompanyIds?.length
                          ? 'No companies linked to this account. Add companies on the account record.'
                          : requireAccountSelection && !isEditing && singleCompanyIdForAccount
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
                  disabled={!formData.companyId}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Worksite"
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
                    options={recruiterAccountsForPicker}
                    getOptionLabel={(option) => option.label || option.name}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    value={
                      recruiterAccountsForPicker.find(
                        (a) => a.id === (pickedRecruiterAccountId || propRecruiterAccountId || null)
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

              {/* Gig: estimated event window (below Company / Worksite) */}
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

              {/* Career Type: Single Job Title and Workers Needed */}
              {formData.jobType === 'career' && (
                <>
                  <Grid item xs={12} md={6}>
                    <Autocomplete
                      fullWidth
                      freeSolo
                      options={jobTitleOptions}
                      value={formData.jobTitle}
                      onChange={(_event, newValue) => {
                        const title = String(newValue ?? '');
                        let mergedSnapshot: Record<string, unknown> | null = null;
                        setFormData((prev) => {
                          mergedSnapshot = mergeCareerFormWithPricingPreset(
                            prev as any,
                            title,
                            pricingByJobTitle
                          ) as any;
                          return mergedSnapshot as any;
                        });
                        if (isEditing && jobOrderId && mergedSnapshot) {
                          void saveFieldToFirestore('jobTitle', title, mergedSnapshot);
                        }
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={getFieldDef('jobTitle')?.label || 'Job Title'}
                          required
                          onBlur={(e) => {
                            const title = String(e.target.value ?? '');
                            let mergedSnapshot: Record<string, unknown> | null = null;
                            setFormData((prev) => {
                              mergedSnapshot = mergeCareerFormWithPricingPreset(
                                prev as any,
                                title,
                                pricingByJobTitle
                              ) as any;
                              return mergedSnapshot as any;
                            });
                            if (isEditing && jobOrderId && mergedSnapshot) {
                              void saveFieldToFirestore('jobTitle', title, mergedSnapshot);
                            }
                          }}
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

              {/* Financials — Gig only (preliminary event budget); below Basic Information, above Positions & Compliance */}
              {formData.jobType === 'gig' && (
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
                      helperText="Preliminary budget for this event"
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

              {/* Gig Type: Multiple Positions */}
              {formData.jobType === 'gig' && (
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 600 }}>
                        Positions
                      </Typography>
                      <Button
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => {
                          setGigPositions([...gigPositions, { jobTitle: '', workersNeeded: 1, payRate: '', workersCompClassCode: '', workersCompRate: '' }]);
                        }}
                      >
                        Add Position
                      </Button>
                    </Box>

                    {gigPositions.map((position, index) => (
                      <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
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
                                      if (preset.workersCompRate != null) {
                                        row.workersCompRate = String(preset.workersCompRate);
                                      }
                                    }
                                    updated[index] = row;
                                    return updated;
                                  });
                                  if (index === 0 && jdFromPreset) {
                                    setFormData((fd) => {
                                      const next = { ...fd, jobDescriptionFromClient: jdFromPreset };
                                      if (isEditing && jobOrderId) {
                                        void saveFieldToFirestore(
                                          'jobDescriptionFromClient',
                                          jdFromPreset,
                                          next
                                        );
                                      }
                                      return next;
                                    });
                                  }
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
                                          if (preset.workersCompRate != null) {
                                            row.workersCompRate = String(preset.workersCompRate);
                                          }
                                        }
                                        updated[index] = row;
                                        return updated;
                                      });
                                      if (index === 0 && jdFromPreset) {
                                        setFormData((fd) => {
                                          const next = { ...fd, jobDescriptionFromClient: jdFromPreset };
                                          if (isEditing && jobOrderId) {
                                            void saveFieldToFirestore(
                                              'jobDescriptionFromClient',
                                              jdFromPreset,
                                              next
                                            );
                                          }
                                          return next;
                                        });
                                      }
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

            {/* Job Description from Client */}
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

            </Grid>

            {/* Compliance & Requirements Section */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Compliance & Requirements
              </Typography>
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
                    options={Array.isArray(backgroundCheckOptions) ? backgroundCheckOptions.map(option => option.label) : []}
                    value={formData.backgroundCheckPackages}
                    onChange={(event, newValue) => {
                      handleInputChange('backgroundCheckPackages', newValue);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={getFieldDef('backgroundCheckPackages')?.label || 'Background Check Packages'}
                        helperText="Select required background check types"
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
                <Grid item xs={12}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={Array.isArray(drugScreeningOptions) ? drugScreeningOptions.map(option => option.label) : []}
                    value={formData.drugScreeningPanels}
                    onChange={(event, newValue) => {
                      handleInputChange('drugScreeningPanels', newValue);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={getFieldDef('drugScreeningPanels')?.label || 'Drug Screening Panels'}
                        helperText="Select required drug screening panels"
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
                      helperText="Select required languages"
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
                  <FormControl fullWidth>
                    <InputLabel>{getFieldDef('ppeProvidedBy')?.label || 'PPE Provided By'}</InputLabel>
                    <Select
                      value={formData.ppeProvidedBy}
                      onChange={(e) => handleInputChange('ppeProvidedBy', e.target.value)}
                      label={getFieldDef('ppeProvidedBy')?.label || 'PPE Provided By'}
                    >
                      <MenuItem value="company">Company</MenuItem>
                      <MenuItem value="worker">Worker</MenuItem>
                      <MenuItem value="both">Both</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
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
            </Grid>

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

            {/* Custom Uniform Requirements Section */}
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

            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2, mb: 3, color: 'primary.main' }}>
                Company Contacts
              </Typography>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>

            <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  options={loadedContacts}
                  getOptionLabel={(option) => [option.fullName || option.name, option.email].filter(Boolean).join(' · ') || ''}
                  value={loadedContacts.find(contact => contact.id === formData.decisionMaker) || null}
                  onChange={(event, newValue) => handleInputChange('decisionMaker', newValue?.id || '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Decision Maker"
                      placeholder="Search by name or email..."
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props}>
                      {option.fullName || option.name} {option.title && `(${option.title})`}
                    </li>
                  )}
                  disabled={loadedContacts.length === 0}
                />
                {loadedContacts.length === 0 && formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts found for this company. Add contacts to the company first.
                  </Typography>
                )}
                {!formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Select a company to load contacts.
                  </Typography>
                )}
              </Grid>
            </Grid>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  options={loadedContacts}
                  getOptionLabel={(option) => [option.fullName || option.name, option.email].filter(Boolean).join(' · ') || ''}
                  value={loadedContacts.find(contact => contact.id === formData.hrContactId) || null}
                  onChange={(event, newValue) => handleInputChange('hrContactId', newValue?.id || '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="HR Contact"
                      placeholder="Search by name or email..."
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props}>
                      {option.fullName || option.name} {option.title && `(${option.title})`}
                    </li>
                  )}
                  disabled={loadedContacts.length === 0}
                />
                {loadedContacts.length === 0 && formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts found for this company. Add contacts to the company first.
                  </Typography>
                )}
                {!formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Select a company to load contacts.
                  </Typography>
                )}
              </Grid>

              {/* Additional Contact Roles */}
              <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  options={loadedContacts}
                  getOptionLabel={(option) => [option.fullName || option.name, option.email].filter(Boolean).join(' · ') || ''}
                  value={loadedContacts.find(contact => contact.id === formData.operationsContactId) || null}
                  onChange={(event, newValue) => handleInputChange('operationsContactId', newValue?.id || '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Operations Contact"
                      placeholder="Search by name or email..."
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props}>
                      {option.fullName || option.name} {option.title && `(${option.title})`}
                    </li>
                  )}
                  disabled={loadedContacts.length === 0}
                />
                {loadedContacts.length === 0 && formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts found for this company. Add contacts to the company first.
                  </Typography>
                )}
                {!formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Select a company to load contacts.
                  </Typography>
                )}
              </Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  options={loadedContacts}
                  getOptionLabel={(option) => [option.fullName || option.name, option.email].filter(Boolean).join(' · ') || ''}
                  value={loadedContacts.find(contact => contact.id === formData.procurementContactId) || null}
                  onChange={(event, newValue) => handleInputChange('procurementContactId', newValue?.id || '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Procurement Contact"
                      placeholder="Search by name or email..."
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props}>
                      {option.fullName || option.name} {option.title && `(${option.title})`}
                    </li>
                  )}
                  disabled={loadedContacts.length === 0}
                />
                {loadedContacts.length === 0 && formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts found for this company. Add contacts to the company first.
                  </Typography>
                )}
                {!formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Select a company to load contacts.
                  </Typography>
                )}
              </Grid>

              <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  options={loadedContacts}
                  getOptionLabel={(option) => [option.fullName || option.name, option.email].filter(Boolean).join(' · ') || ''}
                  value={loadedContacts.find(contact => contact.id === formData.billingContactId) || null}
                  onChange={(event, newValue) => handleInputChange('billingContactId', newValue?.id || '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Billing Contact"
                      placeholder="Search by name or email..."
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props}>
                      {option.fullName || option.name} {option.title && `(${option.title})`}
                    </li>
                  )}
                  disabled={loadedContacts.length === 0}
                />
                {loadedContacts.length === 0 && formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts found for this company. Add contacts to the company first.
                  </Typography>
                )}
                {!formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Select a company to load contacts.
                  </Typography>
                )}
              </Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  options={loadedContacts}
                  getOptionLabel={(option) => [option.fullName || option.name, option.email].filter(Boolean).join(' · ') || ''}
                  value={loadedContacts.find(contact => contact.id === formData.safetyContactId) || null}
                  onChange={(event, newValue) => handleInputChange('safetyContactId', newValue?.id || '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Safety Contact"
                      placeholder="Search by name or email..."
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props}>
                      {option.fullName || option.name} {option.title && `(${option.title})`}
                    </li>
                  )}
                  disabled={loadedContacts.length === 0}
                />
                {loadedContacts.length === 0 && formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts found for this company. Add contacts to the company first.
                  </Typography>
                )}
                {!formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Select a company to load contacts.
                  </Typography>
                )}
              </Grid>

              <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  options={loadedContacts}
                  getOptionLabel={(option) => [option.fullName || option.name, option.email].filter(Boolean).join(' · ') || ''}
                  value={loadedContacts.find(contact => contact.id === formData.invoiceContactId) || null}
                  onChange={(event, newValue) => handleInputChange('invoiceContactId', newValue?.id || '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Invoice Contact"
                      placeholder="Search by name or email..."
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props}>
                      {option.fullName || option.name} {option.title && `(${option.title})`}
                    </li>
                  )}
                  disabled={loadedContacts.length === 0}
                />
                {loadedContacts.length === 0 && formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts found for this company. Add contacts to the company first.
                  </Typography>
                )}
                {!formData.companyId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Select a company to load contacts.
                  </Typography>
                )}
              </Grid>
            </Grid>


            {/* Action Buttons */}
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
                  {saving ? <CircularProgress size={20} /> : (isEditing ? 'Update Job Order' : 'Create Job Order')}
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
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default JobOrderForm;
