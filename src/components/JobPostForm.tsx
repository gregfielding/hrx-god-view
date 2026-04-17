import React, { useState, useEffect, useRef, useCallback, useMemo, useContext, createContext } from 'react';
import { flushSync } from 'react-dom';
import type { TextFieldProps } from '@mui/material';
import {
  Box,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Switch,
  FormHelperText,
  Autocomplete,
  Chip,
  Typography,
  CircularProgress,
  Alert,
  Stack,
  Snackbar,
} from '@mui/material';
import { Close as CloseIcon, AutoAwesome as AutoAwesomeIcon, ContentCopy as ContentCopyIcon } from '@mui/icons-material';
import JobPostWorksiteCityPlacesField, {
  type JobPostWorksiteCityCommit,
} from './JobPostWorksiteCityPlacesField';
import {
  JobsBoardPost,
  coerceStringArrayField,
  stripReadOnlyJobPostFields,
} from '../services/recruiter/jobsBoardService';
import { useAuth } from '../contexts/AuthContext';
import jobTitlesList from '../data/onetJobTitles.json';
import onetSkills from '../data/onetSkills.json';
import credentialsSeed from '../data/credentialsSeed.json';
import { experienceOptions, educationOptions } from '../data/experienceOptions';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../data/screeningsOptions';
import { collection, getDocs, query, orderBy as firestoreOrderBy, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { geocodeAddress } from '../utils/geocodeAddress';
import { formatCityStateZipInput, parseCityStateZipFromWorksiteName } from '../utils/cityStateZipInput';
import { normalizeStateCode } from '../utils/unemploymentRates';
import { generateJobDescriptionWithAi } from '../utils/jobDescriptionAiGenerate';
import { autoAddGroupsPickerValue, dedupeUserGroupsForUi } from '../utils/dedupeUserGroupsForUi';

function zipFromWorksiteAddress(wa: Record<string, unknown> | undefined): string {
  if (!wa || typeof wa !== 'object') return '';
  const z =
    (wa.zipCode as string) ||
    (wa.zipcode as string) ||
    (wa.zip as string) ||
    '';
  return typeof z === 'string' ? z : '';
}

/**
 * Job order → Jobs Board tab: when user picks a title from Positions, pull pay and client JD from the order.
 */
function buildPatchFromJobOrderTitle(
  jobOrderData: any,
  title: string,
  positionJobDescriptionFromAccount?: string | null,
): Partial<JobsBoardPost> {
  const trimmed = title.trim();
  if (!trimmed) {
    const cleared: Partial<JobsBoardPost> = { jobTitle: '' };
    if (jobOrderData?.jobType === 'gig') {
      cleared.positionJobTitle = undefined;
    }
    return cleared;
  }
  const patch: Partial<JobsBoardPost> = {
    jobTitle: title,
  };
  if (!jobOrderData) {
    return patch;
  }
  if (jobOrderData.jobType === 'gig') {
    patch.positionJobTitle = trimmed;
  }
  const gp = jobOrderData.gigPositions;
  let pos: any;
  if (Array.isArray(gp)) {
    pos = gp.find((p: any) => String(p?.jobTitle ?? '').trim() === trimmed);
  }
  if (pos && pos.payRate != null && String(pos.payRate).trim() !== '') {
    const n = parseFloat(String(pos.payRate));
    if (Number.isFinite(n)) patch.payRate = n;
  } else if (!pos && String(jobOrderData.jobTitle ?? '').trim() === trimmed) {
    const pr = jobOrderData.payRate;
    if (pr != null && String(pr).trim() !== '') {
      const n = parseFloat(String(pr));
      if (Number.isFinite(n)) patch.payRate = n;
    }
  }
  const clientJd =
    String(positionJobDescriptionFromAccount ?? '').trim() ||
    String(jobOrderData.jobDescriptionFromClient ?? '').trim();
  if (trimmed && clientJd) {
    patch.jobDescription = clientJd;
  }
  return patch;
}

/** Flatten nested worksiteAddress + worksiteName so city/state fields work on first paint (edit load). */
function getFlatWorksiteFromInitialJobPost(initialData?: Partial<JobsBoardPost>) {
  if (!initialData) {
    return {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      coordinates: undefined as { lat: number; lng: number } | undefined,
    };
  }
  const worksiteAddress = (initialData.worksiteAddress || {}) as Record<string, unknown>;
  const parsedFromName = parseCityStateZipFromWorksiteName(
    typeof initialData.worksiteName === 'string' ? initialData.worksiteName : ''
  );
  const resolvedZip = zipFromWorksiteAddress(worksiteAddress) || parsedFromName.zipCode || '';
  const rawCity = (worksiteAddress.city as string) || parsedFromName.city || '';
  const rawState = (worksiteAddress.state as string) || parsedFromName.state || '';
  const resolvedCity = (rawCity || '').trim();
  const resolvedState =
    normalizeStateCode(rawState) ||
    (String(rawState).trim().length === 2 ? String(rawState).trim().toUpperCase() : '');
  return {
    street: typeof worksiteAddress.street === 'string' ? worksiteAddress.street : '',
    city: resolvedCity,
    state: resolvedState,
    zipCode: resolvedZip,
    coordinates: worksiteAddress.coordinates as { lat: number; lng: number } | undefined,
  };
}

type JobPostFormAutoSaveContextValue = {
  autoSave: boolean;
  mode: 'create' | 'edit';
  schedulePersist: () => void;
};

const JobPostFormAutoSaveContext = createContext<JobPostFormAutoSaveContextValue>({
  autoSave: false,
  mode: 'create',
  schedulePersist: () => {},
});

/**
 * Must be module-scoped: a TextField wrapper defined inside JobPostForm is a new component type every render,
 * so MUI remounts inputs and the user can only type one character before focus is lost.
 */
function JobPostFormAutoSaveTextField(props: TextFieldProps) {
  const { autoSave, mode, schedulePersist } = useContext(JobPostFormAutoSaveContext);
  const { onBlur, ...rest } = props;
  return (
    <TextField
      {...rest}
      onBlur={(e) => {
        onBlur?.(e);
        if (autoSave && mode === 'edit') {
          window.setTimeout(() => schedulePersist(), 0);
        }
      }}
    />
  );
}

export interface JobPostFormProps {
  initialData?: Partial<JobsBoardPost>;
  onSave: (data: Partial<JobsBoardPost>) => Promise<void>;
  onCancel?: () => void;
  loading?: boolean;
  mode?: 'create' | 'edit';
  hideJobOrderConnection?: boolean; // Hide the "Connect with Job Order" section when used from Job Order detail page
  jobOrderData?: any; // Full job order data for AI generation
  /** Account → Pricing row "Client job description" for this position (job title match); seeds public job description on the posting. */
  positionJobDescriptionFromAccount?: string | null;
  /** When true (edit mode only), persist on TextField blur and on other control change; hides footer buttons. */
  autoSave?: boolean;
  /** Recruiter edit page: merge into header `post` for live syndication icons + location lines while editing. */
  onHeaderPreviewChange?: (patch: Partial<JobsBoardPost>) => void;
}

const JobPostForm: React.FC<JobPostFormProps> = ({
  initialData,
  onSave,
  onCancel,
  loading = false,
  mode = 'create',
  hideJobOrderConnection = false,
  jobOrderData,
  positionJobDescriptionFromAccount = null,
  autoSave = false,
  onHeaderPreviewChange,
}) => {
  const { tenantId, user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [copySnackbarOpen, setCopySnackbarOpen] = useState(false);

  const normalizeGroupIds = (value?: string | string[] | null): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id): id is string => Boolean(id));
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  };

  // Form data — flatten worksiteAddress onto city/state/zip on first paint so edit load does not show empty location
  const [formData, setFormData] = useState(() => {
    const flat = getFlatWorksiteFromInitialJobPost(initialData);
    return {
      postTitle: '',
      jobType: 'gig' as 'gig' | 'career',
      jobTitle: '',
      jobDescription: '',
      jobDescriptionPrompt: '',
      companyId: '',
      companyName: '',
      worksiteId: '',
      worksiteName: '',
      street: '',
      city: '',
      state: '',
      zipCode: '',
      startDate: '',
      endDate: '',
      expDate: '',
      showStart: false,
      showEnd: false,
      payRate: '',
      showPayRate: true,
      workersNeeded: 1,
      showWorkersNeeded: false,
      eVerifyRequired: false,
      backgroundCheckPackages: [] as string[],
      showBackgroundChecks: false,
      drugScreeningPanels: [] as string[],
      showDrugScreening: false,
      additionalScreenings: [] as string[],
      showAdditionalScreenings: false,
      visibility: 'public' as 'public' | 'private' | 'restricted',
      restrictedGroups: [] as string[],
      status: 'draft' as 'draft' | 'active' | 'paused' | 'cancelled' | 'expired',
      jobOrderId: '',
      skills: [] as string[],
      showSkills: false,
      licensesCerts: [] as string[],
      showLicensesCerts: false,
      experienceLevels: [] as string[],
      showExperience: false,
      educationLevels: [] as string[],
      showEducation: false,
      languages: [] as string[],
      showLanguages: false,
      physicalRequirements: [] as string[],
      showPhysicalRequirements: false,
      uniformRequirements: [] as string[],
      showUniformRequirements: false,
      customUniformRequirements: '',
      showCustomUniformRequirements: false,
      requiredPpe: [] as string[],
      showRequiredPpe: false,
      shift: [] as string[],
      showShift: false,
      startTime: '',
      endTime: '',
      showStartTime: false,
      showEndTime: false,
      autoAddToUserGroups: [] as string[],
      coordinates: undefined as { lat: number; lng: number } | undefined,
      ...(initialData || {}),
      ...flat,
      craigslistUrl: typeof initialData?.craigslistUrl === 'string' ? initialData.craigslistUrl : '',
      indeedUrl: typeof initialData?.indeedUrl === 'string' ? initialData.indeedUrl : '',
    };
  });

  /**
   * From job order detail → Jobs Board only: restrict Job Title to Positions on that order (not full O*NET).
   * Standalone / non–job-order posts keep the full list.
   */
  const jobOrderRestrictedJobTitles = useMemo((): string[] | null => {
    if (!hideJobOrderConnection || !jobOrderData) return null;
    const gp = jobOrderData.gigPositions;
    if (Array.isArray(gp) && gp.length > 0) {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const p of gp) {
        const t = String((p as { jobTitle?: string })?.jobTitle ?? '').trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      return out;
    }
    const jt = String(jobOrderData.jobTitle ?? '').trim();
    return jt ? [jt] : [];
  }, [hideJobOrderConnection, jobOrderData]);

  const restrictJobTitleToOrderPositions = jobOrderRestrictedJobTitles !== null;
  /** Include current posting title if it is not yet on the order (legacy / edited) so MUI Autocomplete stays valid. */
  const jobTitleAutocompleteOptions = useMemo(() => {
    if (!restrictJobTitleToOrderPositions) return jobTitlesList;
    const base = [...(jobOrderRestrictedJobTitles as string[])];
    const cur = String(formData.jobTitle ?? '').trim();
    if (cur && !base.includes(cur)) {
      base.push(cur);
    }
    return base;
  }, [restrictJobTitleToOrderPositions, jobOrderRestrictedJobTitles, formData.jobTitle]);
  /** When restricted to the job order’s Positions, do not allow free-typing O*NET titles. */
  const jobTitleAutocompleteFreeSolo = !restrictJobTitleToOrderPositions;

  /** Job description + AI prompt: local strings while typing; commit to formData on blur (avoids heavy re-renders each keystroke). */
  const jobDescriptionFocusRef = useRef(false);
  const jobDescriptionPromptFocusRef = useRef(false);
  const [jobDescriptionLocal, setJobDescriptionLocal] = useState(() =>
    typeof initialData?.jobDescription === 'string' ? initialData.jobDescription : ''
  );
  const [jobDescriptionPromptLocal, setJobDescriptionPromptLocal] = useState(() => {
    const p = (initialData as { jobDescriptionPrompt?: string } | undefined)?.jobDescriptionPrompt;
    return typeof p === 'string' ? p : '';
  });

  /** Account Pricing client JD can load after first paint; fill public description if still empty. */
  useEffect(() => {
    const jd = String(positionJobDescriptionFromAccount ?? '').trim();
    if (!jd) return;
    setFormData((prev) => {
      if (String(prev.jobDescription || '').trim()) return prev;
      return { ...prev, jobDescription: jd };
    });
    setJobDescriptionLocal((prev) => (String(prev).trim() ? prev : jd));
  }, [positionJobDescriptionFromAccount]);

  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const persistChainRef = useRef(Promise.resolve());
  /** When auto-saving edits, parent may refresh `post` after each save; skip re-applying initialData if same document. */
  const lastSyncedAutoSavePostIdRef = useRef<string | null>(null);

  const buildPayloadFromFormData = useCallback((fd: typeof formData): Partial<JobsBoardPost> => {
    const craigslistTrimmed = typeof fd.craigslistUrl === 'string' ? fd.craigslistUrl.trim() : '';
    const indeedTrimmed = typeof fd.indeedUrl === 'string' ? fd.indeedUrl.trim() : '';
    return stripReadOnlyJobPostFields({
      ...fd,
      startDate: fd.startDate ? new Date(fd.startDate) : undefined,
      endDate: fd.endDate ? new Date(fd.endDate) : undefined,
      expDate: fd.expDate ? new Date(fd.expDate) : undefined,
      worksiteAddress: {
        street: fd.street,
        city: fd.city,
        state: fd.state,
        zipCode: fd.zipCode,
        coordinates: fd.coordinates || undefined,
      },
      payRate: fd.payRate ? parseFloat(fd.payRate.toString()) : undefined,
      autoAddToUserGroups: fd.autoAddToUserGroups,
      autoAddToUserGroup: fd.autoAddToUserGroups.length === 1 ? fd.autoAddToUserGroups[0] : undefined,
      craigslistUrl: craigslistTrimmed,
      indeedUrl: indeedTrimmed,
      skills: coerceStringArrayField(fd.skills),
      showSkills: fd.showSkills,
      licensesCerts: coerceStringArrayField(fd.licensesCerts),
      showLicensesCerts: fd.showLicensesCerts,
      experienceLevels: coerceStringArrayField(fd.experienceLevels),
      showExperience: fd.showExperience,
      educationLevels: coerceStringArrayField(fd.educationLevels),
      showEducation: fd.showEducation,
      languages: coerceStringArrayField(fd.languages),
      showLanguages: fd.showLanguages,
      physicalRequirements: coerceStringArrayField(fd.physicalRequirements),
      showPhysicalRequirements: fd.showPhysicalRequirements,
      uniformRequirements: coerceStringArrayField(fd.uniformRequirements),
      showUniformRequirements: fd.showUniformRequirements,
      customUniformRequirements: fd.customUniformRequirements,
      showCustomUniformRequirements: fd.showCustomUniformRequirements,
      requiredPpe: coerceStringArrayField(fd.requiredPpe),
      showRequiredPpe: fd.showRequiredPpe,
      backgroundCheckPackages: coerceStringArrayField(fd.backgroundCheckPackages),
      showBackgroundChecks: fd.showBackgroundChecks,
      drugScreeningPanels: coerceStringArrayField(fd.drugScreeningPanels),
      showDrugScreening: fd.showDrugScreening,
      additionalScreenings: coerceStringArrayField(fd.additionalScreenings),
      showAdditionalScreenings: fd.showAdditionalScreenings,
      shift: coerceStringArrayField(fd.shift),
      showShift: fd.showShift,
    } as Record<string, unknown>) as Partial<JobsBoardPost>;
  }, []);

  const schedulePersist = useCallback(() => {
    if (!autoSave || mode !== 'edit') return;
    persistChainRef.current = persistChainRef.current
      .then(async () => {
        setError(null);
        await onSave(buildPayloadFromFormData(formDataRef.current));
      })
      .catch((err: any) => {
        console.error('Auto-save failed:', err);
        setError(err?.message || 'Failed to save');
      });
  }, [autoSave, mode, onSave, buildPayloadFromFormData]);

  const maybeTickPersist = useCallback(
    (delay = 0) => {
      if (!autoSave || mode !== 'edit') return;
      setTimeout(() => schedulePersist(), delay);
    },
    [autoSave, mode, schedulePersist]
  );

  const handleWorksiteCityCommit = useCallback(
    (patch: JobPostWorksiteCityCommit) => {
      flushSync(() => {
        setFormData((prev) => ({
          ...prev,
          city: patch.city,
          state: patch.state,
          zipCode: patch.zipCode,
          worksiteName: patch.worksiteName,
          coordinates: patch.coordinates,
          ...(patch.street !== undefined ? { street: patch.street } : {}),
        }));
      });
      const street =
        patch.street !== undefined ? patch.street : formDataRef.current.street;
      onHeaderPreviewChange?.({
        worksiteName: patch.worksiteName,
        worksiteAddress: {
          street: street || '',
          city: patch.city,
          state: patch.state,
          zipCode: patch.zipCode,
          coordinates: patch.coordinates ?? formDataRef.current.coordinates,
        },
      });
      if (autoSave && mode === 'edit') {
        window.setTimeout(() => schedulePersist(), 0);
      }
    },
    [autoSave, mode, onHeaderPreviewChange, schedulePersist]
  );

  // Company and location data
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; nickname?: string; address: any }>>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(() =>
    (initialData?.companyId ?? '').toString().trim()
  );
  const [selectedLocationId, setSelectedLocationId] = useState(() =>
    (initialData?.worksiteId ?? '').toString().trim()
  );
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [useCompanyLocation, setUseCompanyLocation] = useState(() => {
    const p = initialData as JobsBoardPost | undefined;
    const cid = (p?.companyId ?? '').toString().trim();
    const wid = (p?.worksiteId ?? '').toString().trim();
    return !!(cid && wid);
  });

  // Job orders and user groups
  const [jobOrders, setJobOrders] = useState<Array<{ id: string; jobOrderName: string; status: string }>>([]);
  const [loadingJobOrders, setLoadingJobOrders] = useState(false);
  const [userGroups, setUserGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingUserGroups, setLoadingUserGroups] = useState(false);

  /** One row per doc id, then one per display name (avoids duplicate labels from legacy/duplicate Firestore user group docs). */
  const userGroupsForUi = useMemo(() => dedupeUserGroupsForUi(userGroups), [userGroups]);

  /** Collapse stored group ids that share the same display name to the canonical doc used in the picker. */
  const autoAddGroupsAutocompleteValue = useMemo(
    () =>
      autoAddGroupsPickerValue(formData.autoAddToUserGroups, userGroups, userGroupsForUi),
    [formData.autoAddToUserGroups, userGroups, userGroupsForUi]
  );

  const canonicalAutoAddGroupIds = useMemo(
    () => autoAddGroupsAutocompleteValue.map((g) => g.id),
    [autoAddGroupsAutocompleteValue]
  );

  /** Keep saved worksiteId visible while CRM locations are loading or if the doc was removed from the subcollection. */
  const locationsForWorksiteSelect = useMemo(() => {
    if (!selectedLocationId) return locations;
    if (locations.some((l) => l.id === selectedLocationId)) return locations;
    const label = (formData.worksiteName || '').trim() || 'Saved worksite';
    return [
      ...locations,
      {
        id: selectedLocationId,
        name: label,
        nickname: formData.worksiteName || label,
        address: {
          street: formData.street,
          city: formData.city,
          state: formData.state,
          zipCode: formData.zipCode,
          coordinates: formData.coordinates,
        },
      },
    ];
  }, [
    locations,
    selectedLocationId,
    formData.worksiteName,
    formData.street,
    formData.city,
    formData.state,
    formData.zipCode,
    formData.coordinates,
  ]);

  /** Collapse duplicate Firestore user group docs in stored `autoAddToUserGroups` to one id per display name. */
  useEffect(() => {
    if (userGroups.length === 0) return;
    const a = [...formData.autoAddToUserGroups].sort().join('\0');
    const b = [...canonicalAutoAddGroupIds].sort().join('\0');
    if (a === b) return;
    setFormData((prev) => ({ ...prev, autoAddToUserGroups: [...canonicalAutoAddGroupIds] }));
    if (autoSave && mode === 'edit') maybeTickPersist(0);
  }, [
    userGroups.length,
    canonicalAutoAddGroupIds,
    formData.autoAddToUserGroups,
    autoSave,
    mode,
    maybeTickPersist,
  ]);

  useEffect(() => {
    if (!jobDescriptionFocusRef.current) {
      setJobDescriptionLocal(formData.jobDescription || '');
    }
  }, [formData.jobDescription]);

  useEffect(() => {
    if (!jobDescriptionPromptFocusRef.current) {
      setJobDescriptionPromptLocal(formData.jobDescriptionPrompt || '');
    }
  }, [formData.jobDescriptionPrompt]);

  const [geocoding, setGeocoding] = useState(false);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);

  // Track original form values before job order connection
  const [originalFormValues, setOriginalFormValues] = useState<any>(null);

  // Shift options for Career job type
  const shiftOptions = [
    'Full Time', 'Part Time', 'Temporary', 'On Call',
    'First Shift', 'Second Shift', 'Third Shift', 'Day Shift', 'Night Shift',
    'Swing Shift', 'Weekends', 'Some Weekends', 'Some Nights',
    '8 Hour', '10 Hour', '12 Hour'
  ];

  // Helper function to safely convert dates to YYYY-MM-DD format for date inputs
  const formatDateForInput = (dateValue: any): string => {
    if (!dateValue) return '';
    
    try {
      if (typeof dateValue === 'string') {
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return dateValue;
        }
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        return dateValue.toDate().toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toISOString === 'function') {
        return dateValue.toISOString().split('T')[0];
      } else {
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      }
    } catch (error) {
      console.warn('Error formatting date:', dateValue, error);
      return '';
    }
  };

  // Check if Google Maps is loaded
  useEffect(() => {
    const checkGoogleMapsLoaded = () => {
      const isLoaded = !!(window as any).google?.maps?.places;
      if (isLoaded) {
        setIsGoogleMapsLoaded(true);
      } else {
        // Retry after 100ms if not loaded
        setTimeout(checkGoogleMapsLoaded, 100);
      }
    };
    checkGoogleMapsLoaded();
  }, []);

  useEffect(() => {
    if (!initialData) return;

    const docId =
      typeof (initialData as JobsBoardPost).id === 'string' ? (initialData as JobsBoardPost).id : null;
    if (autoSave && mode === 'edit' && docId && lastSyncedAutoSavePostIdRef.current === docId) {
      return;
    }

    console.log('🔍 JobPostForm - Processing initialData:', {
        skills: initialData.skills,
        uniformRequirements: initialData.uniformRequirements,
        showSkills: initialData.showSkills,
        showUniformRequirements: initialData.showUniformRequirements,
      });
      // Extract worksiteAddress fields to top-level form fields
      const worksiteAddress = initialData.worksiteAddress || {} as any;
      const parsedFromName = parseCityStateZipFromWorksiteName(
        typeof initialData.worksiteName === 'string' ? initialData.worksiteName : ''
      );
      const resolvedZip =
        zipFromWorksiteAddress(worksiteAddress) || parsedFromName.zipCode || '';
      const rawCity =
        (worksiteAddress.city as string) || parsedFromName.city || '';
      const rawState =
        (worksiteAddress.state as string) || parsedFromName.state || '';
      const resolvedCity = (rawCity || '').trim();
      const resolvedState =
        normalizeStateCode(rawState) ||
        (String(rawState).trim().length === 2 ? String(rawState).trim().toUpperCase() : '');

      const cid = (initialData.companyId || '').toString().trim();
      const wid = (initialData.worksiteId || '').toString().trim();
      // Persisted posts: company + CRM worksite → company location mode; otherwise city/state mode
      setUseCompanyLocation(!!(cid && wid));
      
      // Format dates properly for form inputs
      const { jobOrderPrompt: legacyJobOrderPrompt, ...initialForForm } = initialData as JobsBoardPost & {
        jobOrderPrompt?: string;
      };

      setFormData(prev => ({ 
        ...prev, 
        ...initialForForm,
        startDate: formatDateForInput(initialData.startDate),
        endDate: formatDateForInput(initialData.endDate),
        expDate: formatDateForInput(initialData.expDate),
        payRate: initialData.payRate ? initialData.payRate.toString() : '',
        // Extract worksiteAddress fields to top-level form fields
        street: worksiteAddress.street || prev.street || '',
        city: resolvedCity || prev.city || '',
        state: resolvedState || prev.state || '',
        zipCode: resolvedZip || prev.zipCode || '',
        coordinates: worksiteAddress.coordinates || prev.coordinates,
        worksiteAddress: {
          street: worksiteAddress.street || '',
          city: resolvedCity,
          state: resolvedState,
          zipCode: resolvedZip || '',
        },
        autoAddToUserGroups: normalizeGroupIds(initialData.autoAddToUserGroups ?? initialData.autoAddToUserGroup),
        // Ensure skills and other arrays are properly set
        skills: coerceStringArrayField(
          initialData.skills !== undefined && initialData.skills !== null ? initialData.skills : prev.skills
        ),
        showSkills:
          initialData.showSkills !== undefined
            ? initialData.showSkills
            : coerceStringArrayField(initialData.skills !== undefined ? initialData.skills : prev.skills).length > 0,
        licensesCerts: coerceStringArrayField(
          initialData.licensesCerts !== undefined && initialData.licensesCerts !== null
            ? initialData.licensesCerts
            : prev.licensesCerts
        ),
        showLicensesCerts:
          initialData.showLicensesCerts !== undefined
            ? initialData.showLicensesCerts
            : coerceStringArrayField(
                initialData.licensesCerts !== undefined ? initialData.licensesCerts : prev.licensesCerts
              ).length > 0,
        experienceLevels: coerceStringArrayField(
          initialData.experienceLevels !== undefined && initialData.experienceLevels !== null
            ? initialData.experienceLevels
            : prev.experienceLevels
        ),
        showExperience:
          initialData.showExperience !== undefined
            ? initialData.showExperience
            : coerceStringArrayField(
                initialData.experienceLevels !== undefined ? initialData.experienceLevels : prev.experienceLevels
              ).length > 0,
        educationLevels: coerceStringArrayField(
          initialData.educationLevels !== undefined && initialData.educationLevels !== null
            ? initialData.educationLevels
            : prev.educationLevels
        ),
        showEducation:
          initialData.showEducation !== undefined
            ? initialData.showEducation
            : coerceStringArrayField(
                initialData.educationLevels !== undefined ? initialData.educationLevels : prev.educationLevels
              ).length > 0,
        languages: coerceStringArrayField(
          initialData.languages !== undefined && initialData.languages !== null ? initialData.languages : prev.languages
        ),
        showLanguages:
          initialData.showLanguages !== undefined
            ? initialData.showLanguages
            : coerceStringArrayField(initialData.languages !== undefined ? initialData.languages : prev.languages)
                .length > 0,
        physicalRequirements: coerceStringArrayField(
          initialData.physicalRequirements !== undefined && initialData.physicalRequirements !== null
            ? initialData.physicalRequirements
            : prev.physicalRequirements
        ),
        showPhysicalRequirements:
          initialData.showPhysicalRequirements !== undefined
            ? initialData.showPhysicalRequirements
            : coerceStringArrayField(
                initialData.physicalRequirements !== undefined
                  ? initialData.physicalRequirements
                  : prev.physicalRequirements
              ).length > 0,
        requiredPpe: coerceStringArrayField(
          initialData.requiredPpe !== undefined && initialData.requiredPpe !== null
            ? initialData.requiredPpe
            : prev.requiredPpe
        ),
        showRequiredPpe:
          initialData.showRequiredPpe !== undefined
            ? initialData.showRequiredPpe
            : coerceStringArrayField(initialData.requiredPpe !== undefined ? initialData.requiredPpe : prev.requiredPpe)
                .length > 0,
        uniformRequirements: coerceStringArrayField(
          initialData.uniformRequirements !== undefined && initialData.uniformRequirements !== null
            ? initialData.uniformRequirements
            : prev.uniformRequirements
        ),
        showUniformRequirements:
          initialData.showUniformRequirements !== undefined
            ? initialData.showUniformRequirements
            : coerceStringArrayField(
                initialData.uniformRequirements !== undefined
                  ? initialData.uniformRequirements
                  : prev.uniformRequirements
              ).length > 0,
        customUniformRequirements: initialData.customUniformRequirements !== undefined ? initialData.customUniformRequirements : (prev.customUniformRequirements || ''),
        showCustomUniformRequirements: initialData.showCustomUniformRequirements !== undefined ? initialData.showCustomUniformRequirements : (!!initialData.customUniformRequirements),
        jobDescription: (() => {
          const id: any = initialData;
          const jd = id?.jobDescription;
          const legacy = id?.description;
          if (typeof jd === 'string' && jd.trim()) return jd;
          if (typeof legacy === 'string' && legacy.trim()) return legacy;
          if (typeof prev.jobDescription === 'string' && prev.jobDescription.trim()) return prev.jobDescription;
          return typeof jd === 'string' ? jd : typeof legacy === 'string' ? legacy : prev.jobDescription || '';
        })(),
        jobDescriptionPrompt: (() => {
          const fromDoc =
            typeof (initialData as any).jobDescriptionPrompt === 'string'
              ? String((initialData as any).jobDescriptionPrompt).trim()
              : '';
          const legacy =
            typeof legacyJobOrderPrompt === 'string' ? legacyJobOrderPrompt.trim() : '';
          if (fromDoc) return fromDoc;
          if (legacy) return legacy;
          return prev.jobDescriptionPrompt || '';
        })(),
        craigslistUrl:
          typeof (initialData as any).craigslistUrl === 'string'
            ? (initialData as any).craigslistUrl
            : prev.craigslistUrl || '',
        indeedUrl:
          typeof (initialData as any).indeedUrl === 'string'
            ? (initialData as any).indeedUrl
            : prev.indeedUrl || '',
      }));
      // Set company/location if initial data has them
      if (initialData.companyId) {
        setSelectedCompanyId(initialData.companyId);
        // Load locations and then set the selected location
        loadLocationsForCompany(initialData.companyId).then((locationsData) => {
          if (initialData.worksiteId && locationsData) {
            setSelectedLocationId(initialData.worksiteId);
            // Find the location and populate form data
            const selectedLocation = locationsData.find(l => l.id === initialData.worksiteId);
            if (selectedLocation) {
              setFormData(prev => ({
                ...prev,
                worksiteId: initialData.worksiteId!,
                worksiteName: selectedLocation.nickname || selectedLocation.name,
                // Use location address data if form data is empty, otherwise keep existing form data
                street: prev.street || selectedLocation.address.street || '',
                city: prev.city || selectedLocation.address.city || '',
                state: prev.state || selectedLocation.address.state || '',
                zipCode: prev.zipCode || selectedLocation.address.zipCode || '',
                coordinates: selectedLocation.address.coordinates || prev.coordinates,
              }));
            } else {
              // Location not found in loaded locations, but we have worksiteId
              // Try to fetch it directly
              const worksiteRef = doc(db, 'tenants', tenantId, 'crm_companies', initialData.companyId, 'locations', initialData.worksiteId);
              getDoc(worksiteRef).then((worksiteDoc: any) => {
                if (worksiteDoc.exists()) {
                  const worksiteData = worksiteDoc.data();
                  setFormData(prev => ({
                    ...prev,
                    worksiteId: initialData.worksiteId!,
                    worksiteName: worksiteData.nickname || worksiteData.name || prev.worksiteName || '',
                    street: prev.street || worksiteData.address || '',
                    city: prev.city || worksiteData.city || '',
                    state: prev.state || worksiteData.state || '',
                    zipCode: prev.zipCode || worksiteData.zipCode || worksiteData.zipcode || '',
                    coordinates: worksiteData.coordinates || (worksiteData.latitude && worksiteData.longitude ? {
                      lat: worksiteData.latitude,
                      lng: worksiteData.longitude
                    } : undefined) || prev.coordinates,
                  }));
                }
              }).catch((err: any) => {
                console.warn('Failed to fetch worksite directly:', err);
              });
            }
          }
        });
      } else if (initialData.worksiteId) {
        // If we have worksiteId but no companyId, just set it (shouldn't happen normally)
        setSelectedLocationId(initialData.worksiteId);
      }

    if (autoSave && mode === 'edit' && docId) {
      lastSyncedAutoSavePostIdRef.current = docId;
    }
  }, [initialData, tenantId, autoSave, mode]);

  // Separate useEffect for loading companies, job orders, and user groups (only on mount)
  useEffect(() => {
    loadCompanies();
    loadJobOrders();
    loadUserGroups();
  }, []);

  const loadCompanies = async () => {
    if (!tenantId) return;
    try {
      setLoadingCompanies(true);
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const q = query(companiesRef, firestoreOrderBy('companyName', 'asc'));
      const snapshot = await getDocs(q);
      const companiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().companyName || doc.data().name || 'Unnamed Company'
      }));
      setCompanies(companiesData);
    } catch (err: any) {
      console.error('Error loading companies:', err);
    } finally {
      setLoadingCompanies(false);
    }
  };

  const loadJobOrders = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingJobOrders(true);
      const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
      const q = query(jobOrdersRef, where('status', 'in', ['draft', 'open', 'interviewing', 'offer', 'partially_filled']));
      const querySnapshot = await getDocs(q);
      
      const jobOrdersData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        jobOrderName: doc.data().jobOrderName || 'Unnamed Job Order',
        status: doc.data().status || 'Unknown'
      }));
      
      setJobOrders(jobOrdersData);
    } catch (err: any) {
      if (err.code === 'permission-denied') {
        console.warn('Job orders not accessible - continuing without job order connections');
        setJobOrders([]);
      } else {
        console.error('Error loading job orders:', err);
      }
    } finally {
      setLoadingJobOrders(false);
    }
  };

  const loadUserGroups = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingUserGroups(true);
      const userGroupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const querySnapshot = await getDocs(userGroupsRef);
      
      const userGroupsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().title || doc.data().name || 'Unnamed Group'
      }));
      
      setUserGroups(userGroupsData);
    } catch (err: any) {
      if (err.code === 'permission-denied') {
        console.warn('User groups not accessible - restricted visibility options will be limited');
        setUserGroups([]);
      } else {
        console.error('Error loading user groups:', err);
      }
    } finally {
      setLoadingUserGroups(false);
    }
  };

  const loadLocationsForCompany = async (companyId: string) => {
    if (!tenantId || !companyId) return;
    try {
      setLoadingLocations(true);
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const snapshot = await getDocs(locationsRef);
      const locationsData = snapshot.docs.map(doc => {
        const data = doc.data();
        // Location documents store address fields directly, not nested in an address object
        // Structure: { address: string, city: string, state: string, zipcode: string, ... }
        return {
          id: doc.id,
          name: data.name || 'Unnamed Location',
          nickname: data.nickname,
          address: {
            street: data.address || '', // address is a string field
            city: data.city || '',
            state: data.state || '',
            zipCode: data.zipCode || data.zipcode || '', // Support both zipCode and zipcode
            coordinates: data.coordinates || (data.latitude && data.longitude ? {
              lat: data.latitude,
              lng: data.longitude
            } : undefined)
          }
        };
      });
      setLocations(locationsData);
      return locationsData; // Return locations so we can use them after loading
    } catch (err: any) {
      console.error('Error loading locations:', err);
      return [];
    } finally {
      setLoadingLocations(false);
    }
  };

  const handleCompanyChange = async (companyId: string) => {
    setSelectedCompanyId(companyId);
    setSelectedLocationId('');
    setLocations([]);
    
    const selectedCompany = companies.find(c => c.id === companyId);
    if (selectedCompany) {
      setFormData({
        ...formData,
        companyId,
        companyName: selectedCompany.name,
        worksiteId: '',
        worksiteName: '',
        street: '',
        city: '',
        state: '',
        zipCode: ''
      });
      await loadLocationsForCompany(companyId);
    }
    maybeTickPersist(150);
  };

  const handleLocationChange = (locationId: string) => {
    setSelectedLocationId(locationId);
    const selectedLocation = locations.find(l => l.id === locationId);
    if (selectedLocation) {
      setFormData({
        ...formData,
        worksiteId: locationId,
        worksiteName: selectedLocation.nickname || selectedLocation.name,
        street: selectedLocation.address.street,
        city: selectedLocation.address.city,
        state: selectedLocation.address.state,
        zipCode: selectedLocation.address.zipCode,
        // Store coordinates for distance calculations
        coordinates: selectedLocation.address.coordinates
      });
      onHeaderPreviewChange?.({
        worksiteId: locationId,
        worksiteName: selectedLocation.nickname || selectedLocation.name,
        worksiteAddress: {
          street: selectedLocation.address.street || '',
          city: selectedLocation.address.city || '',
          state: selectedLocation.address.state || '',
          zipCode: selectedLocation.address.zipCode || '',
          coordinates: selectedLocation.address.coordinates,
        },
      });
    }
    maybeTickPersist(0);
  };

  // Geocode city and state to get coordinates
  const geocodeCityState = async (city: string, state: string, zipCode?: string) => {
    if (!city?.trim() || !state?.trim()) {
      return;
    }

    try {
      setGeocoding(true);
      const z = (zipCode || '').trim();
      const address = z ? `${city}, ${state} ${z}` : `${city}, ${state}`;
      const coordinates = await geocodeAddress(address);
      setFormData(prev => ({
        ...prev,
        coordinates,
        worksiteName: prev.worksiteName || `${city}, ${state}`
      }));
    } catch (error) {
      console.warn('Failed to geocode city/state:', error);
      // Continue without coordinates - not critical
    } finally {
      maybeTickPersist(0);
      setGeocoding(false);
    }
  };

  // Auto-geocode when city + full 2-letter state are present (skip while user is still typing "F" → "FL")
  useEffect(() => {
    const st = (formData.state || '').trim();
    if (
      !useCompanyLocation &&
      formData.city?.trim() &&
      st.length === 2 &&
      /^[A-Za-z]{2}$/.test(st) &&
      !formData.coordinates
    ) {
      const timeoutId = setTimeout(() => {
        geocodeCityState(formData.city, formData.state, formData.zipCode);
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.city, formData.state, formData.zipCode, useCompanyLocation, formData.coordinates]);

  const handleJobOrderChange = async (jobOrderId: string) => {
    try {
    if (jobOrderId) {
      setOriginalFormValues({ ...formData });
      
      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        
        const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
        const jobOrderDoc = await getDoc(jobOrderRef);
        
        if (jobOrderDoc.exists()) {
          const jobOrderData = jobOrderDoc.data();
          
          // For Gig jobs, check if gigPositions exist and use first position's job title and pay rate
          const gigPositions = jobOrderData.gigPositions as Array<{jobTitle: string; payRate: string; workersNeeded?: number}> | undefined;
          const isGigJob = jobOrderData.jobType === 'gig';
          const firstPosition = gigPositions && gigPositions.length > 0 ? gigPositions[0] : null;
          
          setFormData({
            ...formData,
            jobOrderId,
            postTitle: formData.postTitle || jobOrderData.jobOrderName || '',
            jobType: jobOrderData.jobType || 'career', // Copy job type from job order
            jobTitle: formData.jobTitle || (isGigJob && firstPosition ? firstPosition.jobTitle : jobOrderData.jobTitle) || '',
            jobDescription: formData.jobDescription,
            jobDescriptionPrompt: formData.jobDescriptionPrompt || '',
            craigslistUrl: '',
            indeedUrl: '',
            companyId: jobOrderData.companyId || '',
            companyName: jobOrderData.companyName || '',
            worksiteId: jobOrderData.worksiteId || '',
            worksiteName: jobOrderData.worksiteName || '',
            street: jobOrderData.worksiteAddress?.street || '',
            city: jobOrderData.worksiteAddress?.city || '',
            state: jobOrderData.worksiteAddress?.state || '',
            zipCode: jobOrderData.worksiteAddress?.zipCode || '',
            startDate: formatDateForInput(jobOrderData.startDate),
            endDate: formatDateForInput(jobOrderData.endDate),
            payRate: formData.payRate || (isGigJob && firstPosition && firstPosition.payRate 
              ? firstPosition.payRate 
              : jobOrderData.payRate?.toString()) || '',
            workersNeeded: jobOrderData.workersNeeded || 1,
            showWorkersNeeded: jobOrderData.showWorkersNeeded !== undefined ? jobOrderData.showWorkersNeeded : false,
            showPayRate: jobOrderData.showPayRate !== undefined ? jobOrderData.showPayRate : true,
            showStart: jobOrderData.showStartDate ?? jobOrderData.showStart ?? false,
            showEnd: jobOrderData.showEnd ?? false,
            expDate: formatDateForInput(jobOrderData.expDate) || formData.expDate || '',
            eVerifyRequired: jobOrderData.eVerifyRequired || false,
            backgroundCheckPackages: jobOrderData.backgroundCheckPackages || [],
            showBackgroundChecks: (jobOrderData.backgroundCheckPackages || []).length > 0,
            drugScreeningPanels: jobOrderData.drugScreeningPanels || [],
            showDrugScreening: (jobOrderData.drugScreeningPanels || []).length > 0,
            additionalScreenings: jobOrderData.additionalScreenings || [],
            showAdditionalScreenings: (jobOrderData.additionalScreenings || []).length > 0,
            // Copy all requirements and qualifications (job order may use licensesCerts or requiredLicenses/requiredCertifications)
            licensesCerts: (jobOrderData.licensesCerts && jobOrderData.licensesCerts.length > 0)
              ? jobOrderData.licensesCerts
              : [...(jobOrderData.requiredLicenses || []), ...(jobOrderData.requiredCertifications || [])],
            showLicensesCerts: ((jobOrderData.licensesCerts && jobOrderData.licensesCerts.length > 0) || (jobOrderData.requiredLicenses && jobOrderData.requiredLicenses.length > 0) || (jobOrderData.requiredCertifications && jobOrderData.requiredCertifications.length > 0)),
            skills: jobOrderData.skillsRequired || [],
            showSkills: (jobOrderData.skillsRequired || []).length > 0,
            languages: jobOrderData.languagesRequired || [],
            showLanguages: (jobOrderData.languagesRequired || []).length > 0,
            experienceLevels: jobOrderData.experienceRequired ? (() => {
              // Map experience value to full label
              const expMap: Record<string, string> = {
                'none': 'No Experience Required',
                'entry': 'Entry-Level (0–1 year)',
                '1-2': '1–2 Years',
                '3-5': '3–5 Years (Mid-Level)',
                '5-7': '5–7 Years (Advanced)',
                '8-10': '8–10 Years (Senior-Level)',
                '10+': '10+ Years (Expert / Executive)'
              };
              return [expMap[jobOrderData.experienceRequired] || jobOrderData.experienceRequired];
            })() : [],
            showExperience: !!jobOrderData.experienceRequired,
            educationLevels: jobOrderData.educationRequired ? (() => {
              // Map education value to full label
              const eduMap: Record<string, string> = {
                'none': 'No Formal Education Required',
                'highschool': 'High School Diploma or Equivalent',
                'associate': 'Associate Degree',
                'bachelor': 'Bachelor\'s Degree',
                'master': 'Master\'s Degree',
                'doctorate': 'Doctorate / PhD'
              };
              return [eduMap[jobOrderData.educationRequired] || jobOrderData.educationRequired];
            })() : [],
            showEducation: !!jobOrderData.educationRequired,
            physicalRequirements: Array.isArray(jobOrderData.physicalRequirements) ? jobOrderData.physicalRequirements : (jobOrderData.physicalRequirements ? [jobOrderData.physicalRequirements] : []),
            showPhysicalRequirements: (Array.isArray(jobOrderData.physicalRequirements) ? jobOrderData.physicalRequirements.length > 0 : !!jobOrderData.physicalRequirements),
            uniformRequirements: Array.isArray(jobOrderData.uniformRequirements) ? jobOrderData.uniformRequirements : (jobOrderData.uniformRequirements ? [jobOrderData.uniformRequirements] : []),
            showUniformRequirements: (Array.isArray(jobOrderData.uniformRequirements) ? jobOrderData.uniformRequirements.length > 0 : !!jobOrderData.uniformRequirements),
            customUniformRequirements: jobOrderData.customUniformRequirements || formData.customUniformRequirements || '',
            showCustomUniformRequirements: !!(jobOrderData.customUniformRequirements || formData.customUniformRequirements),
            requiredPpe: Array.isArray(jobOrderData.ppeRequirements) ? jobOrderData.ppeRequirements : (jobOrderData.ppeRequirements ? [jobOrderData.ppeRequirements] : []),
            showRequiredPpe: (Array.isArray(jobOrderData.ppeRequirements) ? jobOrderData.ppeRequirements.length > 0 : !!jobOrderData.ppeRequirements)
          });
          
          if (jobOrderData.companyId) {
            setSelectedCompanyId(jobOrderData.companyId);
            await loadLocationsForCompany(jobOrderData.companyId);
            if (jobOrderData.worksiteId) {
              setSelectedLocationId(jobOrderData.worksiteId);
              
              // Fetch the actual worksite details to populate address fields
              try {
                const worksiteRef = doc(db, 'tenants', tenantId, 'crm_companies', jobOrderData.companyId, 'locations', jobOrderData.worksiteId);
                const worksiteDoc = await getDoc(worksiteRef);
                
                if (worksiteDoc.exists()) {
                  const worksiteData = worksiteDoc.data();
                  setFormData(prev => ({
                    ...prev,
                    worksiteId: jobOrderData.worksiteId,
                    worksiteName: worksiteData.nickname || worksiteData.name || jobOrderData.worksiteName || '',
                    street: worksiteData.address || worksiteData.street || '',
                    city: worksiteData.city || '',
                    state: worksiteData.state || '',
                    zipCode: worksiteData.zipcode || worksiteData.zipCode || ''
                  }));
                }
              } catch (worksiteErr) {
                console.warn('Failed to load worksite details:', worksiteErr);
                // Fallback to job order data if worksite fetch fails
                setFormData(prev => ({
                  ...prev,
                  worksiteId: jobOrderData.worksiteId,
                  worksiteName: jobOrderData.worksiteName || '',
                  street: jobOrderData.worksiteAddress?.street || '',
                  city: jobOrderData.worksiteAddress?.city || '',
                  state: jobOrderData.worksiteAddress?.state || '',
                  zipCode: jobOrderData.worksiteAddress?.zipCode || ''
                }));
              }
            }
          }
        }
      } catch (err) {
        console.error('Error loading job order data:', err);
      }
    } else {
      setFormData({ ...formData, jobOrderId: '' });
    }
    } finally {
      if (autoSave && mode === 'edit') {
        maybeTickPersist(500);
      }
    }
  };

  const isFormValid = () => {
    if (!formData.postTitle?.trim()) return false;
    if (!formData.jobType) return false;
    const desc = jobDescriptionFocusRef.current ? jobDescriptionLocal : formData.jobDescription;
    // Drafts can be saved without public copy (e.g. job order tab: title, pay, status first). Non-draft must have text.
    if (formData.status !== 'draft' && !desc?.trim()) return false;

    // Location: valid if we have city+state (e.g. from job order worksiteAddress) OR company worksite selected
    // For Gig jobs and event worksites, worksite may not be in company locations subcollection, so city+state is sufficient
    const hasLocationViaAddress = !!(formData.city?.trim() && formData.state?.trim());
    const hasLocationViaWorksite = !!(useCompanyLocation && selectedCompanyId && selectedLocationId);
    if (!hasLocationViaAddress && !hasLocationViaWorksite) return false;
    
    return true;
  };

  const handleGenerateDescription = async () => {
    if (!tenantId) {
      setError('Missing tenant');
      return;
    }
    setGeneratingDescription(true);
    setError(null);

    try {
      const fd = {
        ...formData,
        jobDescription: jobDescriptionFocusRef.current ? jobDescriptionLocal : formData.jobDescription,
        jobDescriptionPrompt: jobDescriptionPromptFocusRef.current
          ? jobDescriptionPromptLocal
          : formData.jobDescriptionPrompt,
      };
      const text = await generateJobDescriptionWithAi({
        tenantId,
        formData: fd,
        jobOrderData: jobOrderData ?? undefined,
      });
      if (text) {
        setFormData((prev) => ({ ...prev, jobDescription: text }));
        setJobDescriptionLocal(text);
        maybeTickPersist(0);
      } else {
        setError('Failed to generate job description');
      }
    } catch (err: any) {
      console.error('Error generating job description:', err);
      setError(err.message || 'Failed to generate job description');
    } finally {
      setGeneratingDescription(false);
    }
  };

  const handleCopyDescription = () => {
    const text = (jobDescriptionFocusRef.current ? jobDescriptionLocal : formData.jobDescription)?.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopySnackbarOpen(true);
    });
  };

  const handleSubmit = async () => {
    setError(null);

    if (!isFormValid()) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      const jobDescriptionSaved = jobDescriptionFocusRef.current
        ? jobDescriptionLocal
        : formData.jobDescription;
      const jobDescriptionPromptSaved = jobDescriptionPromptFocusRef.current
        ? jobDescriptionPromptLocal
        : formData.jobDescriptionPrompt;
      // Convert string dates to Date objects and string payRate to number
      const dataToSave = stripReadOnlyJobPostFields({
        ...formData,
        jobDescription: jobDescriptionSaved,
        jobDescriptionPrompt: jobDescriptionPromptSaved,
        startDate: formData.startDate ? new Date(formData.startDate) : undefined,
        endDate: formData.endDate ? new Date(formData.endDate) : undefined,
        expDate: formData.expDate ? new Date(formData.expDate) : undefined,
        worksiteAddress: {
          street: formData.street,
          city: formData.city,
          state: formData.state,
          zipCode: formData.zipCode,
          coordinates: formData.coordinates || undefined,
        },
        payRate: formData.payRate ? parseFloat(formData.payRate.toString()) : undefined,
        autoAddToUserGroups: formData.autoAddToUserGroups,
        autoAddToUserGroup: formData.autoAddToUserGroups.length === 1 ? formData.autoAddToUserGroups[0] : undefined,
        skills: coerceStringArrayField(formData.skills),
        showSkills: formData.showSkills,
        licensesCerts: coerceStringArrayField(formData.licensesCerts),
        showLicensesCerts: formData.showLicensesCerts,
        experienceLevels: coerceStringArrayField(formData.experienceLevels),
        showExperience: formData.showExperience,
        educationLevels: coerceStringArrayField(formData.educationLevels),
        showEducation: formData.showEducation,
        languages: coerceStringArrayField(formData.languages),
        showLanguages: formData.showLanguages,
        physicalRequirements: coerceStringArrayField(formData.physicalRequirements),
        showPhysicalRequirements: formData.showPhysicalRequirements,
        uniformRequirements: coerceStringArrayField(formData.uniformRequirements),
        showUniformRequirements: formData.showUniformRequirements,
        customUniformRequirements: formData.customUniformRequirements,
        showCustomUniformRequirements: formData.showCustomUniformRequirements,
        requiredPpe: coerceStringArrayField(formData.requiredPpe),
        showRequiredPpe: formData.showRequiredPpe,
        backgroundCheckPackages: coerceStringArrayField(formData.backgroundCheckPackages),
        showBackgroundChecks: formData.showBackgroundChecks,
        drugScreeningPanels: coerceStringArrayField(formData.drugScreeningPanels),
        showDrugScreening: formData.showDrugScreening,
        additionalScreenings: coerceStringArrayField(formData.additionalScreenings),
        showAdditionalScreenings: formData.showAdditionalScreenings,
        shift: coerceStringArrayField(formData.shift),
        showShift: formData.showShift,
      } as Record<string, unknown>) as Partial<JobsBoardPost>;

      await onSave(dataToSave);
    } catch (err: any) {
      setError(err.message || 'Failed to save job post');
    }
  };

  const autoSaveTextFieldContextValue = useMemo(
    () => ({ autoSave, mode, schedulePersist }),
    [autoSave, mode, schedulePersist]
  );

  return (
    <JobPostFormAutoSaveContext.Provider value={autoSaveTextFieldContextValue}>
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        {/* Post Title and Job Type */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <JobPostFormAutoSaveTextField
                label="Post Title"
                value={formData.postTitle}
                onChange={(e) => setFormData({ ...formData, postTitle: e.target.value })}
                fullWidth
                required
                helperText="Title for the job posting (may differ from actual job title)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth required>
                <InputLabel>Job Type</InputLabel>
                <Select
                  value={formData.jobType}
                  label="Job Type"
                  onChange={(e) => {
                    setFormData({ ...formData, jobType: e.target.value as 'gig' | 'career' });
                    maybeTickPersist();
                  }}
                >
                  <MenuItem value="gig">Gig</MenuItem>
                  <MenuItem value="career">Career</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                fullWidth
                freeSolo={jobTitleAutocompleteFreeSolo}
                options={jobTitleAutocompleteOptions}
                value={formData.jobTitle}
                onChange={(event, newValue) => {
                  const title = newValue || '';
                  if (restrictJobTitleToOrderPositions && jobOrderData) {
                    const patch = buildPatchFromJobOrderTitle(
                      jobOrderData,
                      title,
                      positionJobDescriptionFromAccount,
                    );
                    const formPatch = {
                      ...patch,
                      ...(patch.payRate != null && patch.payRate !== undefined
                        ? { payRate: String(patch.payRate) }
                        : {}),
                    };
                    if (typeof patch.jobDescription === 'string' && patch.jobDescription.trim()) {
                      flushSync(() => {
                        setJobDescriptionLocal(patch.jobDescription as string);
                        setFormData((prev) => ({ ...prev, ...formPatch }));
                      });
                    } else {
                      setFormData((prev) => ({ ...prev, ...formPatch }));
                    }
                  } else {
                    setFormData({ ...formData, jobTitle: title });
                  }
                  maybeTickPersist();
                }}
                onInputChange={
                  jobTitleAutocompleteFreeSolo
                    ? (event, newInputValue) => {
                        setFormData({ ...formData, jobTitle: newInputValue });
                      }
                    : undefined
                }
                noOptionsText={
                  restrictJobTitleToOrderPositions && (jobOrderRestrictedJobTitles?.length ?? 0) === 0
                    ? 'Add job titles in the job order Positions section first.'
                    : 'No matches'
                }
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Job Title (Optional)"
                    helperText={
                      restrictJobTitleToOrderPositions
                        ? 'Choose a title from this job order’s Positions. Pay rate and client job description import when you select a title.'
                        : 'Search or enter a job title - leave blank for generic multi-role postings'
                    }
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={formData.status}
                  label="Status"
                  onChange={(e) => {
                    setFormData({ ...formData, status: e.target.value as any });
                    maybeTickPersist();
                  }}
                >
                  <MenuItem value="draft">Draft</MenuItem>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="paused">Paused</MenuItem>
                  <MenuItem value="cancelled">Cancelled</MenuItem>
                  <MenuItem value="expired">Expired</MenuItem>
                  <MenuItem value="complete">Complete</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <JobPostFormAutoSaveTextField
                label="Expiration Date"
                type="date"
                value={formData.expDate || ''}
                onChange={(e) => setFormData({ ...formData, expDate: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
                helperText="When this posting will automatically expire"
              />
            </Grid>
            {formData.jobType !== 'gig' && (
              <Grid item xs={12} sm={6}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <JobPostFormAutoSaveTextField
                    label="Workers Needed"
                    type="number"
                    value={formData.workersNeeded}
                    onChange={(e) => setFormData({ ...formData, workersNeeded: parseInt(e.target.value) || 1 })}
                    fullWidth
                    inputProps={{ min: 1 }}
                    helperText="Number of workers needed"
                  />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      Show Workers Needed on Public Jobs Board
                    </Typography>
                    <Switch
                      checked={formData.showWorkersNeeded}
                      onChange={(e) => {
                      setFormData({ ...formData, showWorkersNeeded: e.target.checked });
                      maybeTickPersist();
                    }}
                    />
                  </Box>
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>

        {!hideJobOrderConnection && (
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={8}>
                <FormControl fullWidth>
                  <InputLabel>Connect with Job Order</InputLabel>
                  <Select
                    value={formData.jobOrderId}
                    label="Connect with Job Order"
                    onChange={(e) => handleJobOrderChange(e.target.value)}
                    disabled={loadingJobOrders}
                  >
                    <MenuItem value="">
                      <em>No Job Order Connection</em>
                    </MenuItem>
                    {loadingJobOrders ? (
                      <MenuItem value="" disabled>Loading job orders...</MenuItem>
                    ) : jobOrders.length === 0 ? (
                      <MenuItem value="" disabled>No available job orders to connect</MenuItem>
                    ) : (
                      jobOrders.map((jobOrder) => (
                        <MenuItem key={jobOrder.id} value={jobOrder.id}>
                          {jobOrder.jobOrderName}
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  onClick={() => {
                    if (originalFormValues) {
                      setFormData({
                        ...formData,
                        jobOrderId: '',
                        ...originalFormValues
                      });
                    } else {
                      setFormData({ ...formData, jobOrderId: '' });
                    }
                    setSelectedCompanyId('');
                    setSelectedLocationId('');
                    setLocations([]);
                    setOriginalFormValues(null);
                    maybeTickPersist(0);
                  }}
                  disabled={!formData.jobOrderId}
                  startIcon={<CloseIcon />}
                  fullWidth
                >
                  Clear Connection
                </Button>
              </Grid>
            </Grid>
          </Box>
        )}

        <TextField
          label="Job Description Prompt"
          value={jobDescriptionPromptLocal}
          onChange={(e) => setJobDescriptionPromptLocal(e.target.value)}
          onFocus={() => {
            jobDescriptionPromptFocusRef.current = true;
          }}
          onBlur={(e) => {
            const v = e.target.value;
            jobDescriptionPromptFocusRef.current = false;
            flushSync(() => {
              setJobDescriptionPromptLocal(v);
              setFormData((prev) => ({ ...prev, jobDescriptionPrompt: v }));
            });
            if (autoSave && mode === 'edit') {
              window.setTimeout(() => schedulePersist(), 0);
            }
          }}
          fullWidth
          multiline
          minRows={3}
          helperText="Extra instructions for AI: used when there is no job order, or combined with the job order description when one is connected. Edits save when you leave this field."
        />

        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <JobPostFormAutoSaveTextField
                label="Pay Rate ($/hr)"
                type="number"
                value={formData.payRate}
                onChange={(e) => setFormData({ ...formData, payRate: e.target.value })}
                fullWidth
                inputProps={{ min: 0, step: 0.01 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Pay Rate</Typography>
                <Switch
                  checked={formData.showPayRate}
                  onChange={(e) => {
                  setFormData({ ...formData, showPayRate: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <JobPostFormAutoSaveTextField
                label="Start Date"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Start</Typography>
                <Switch
                  checked={formData.showStart || false}
                  onChange={(e) => {
                  setFormData({ ...formData, showStart: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
            <Grid item xs={12} sm={4}>
              <JobPostFormAutoSaveTextField
                label="End Date"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show End</Typography>
                <Switch
                  checked={formData.showEnd || false}
                  onChange={(e) => {
                  setFormData({ ...formData, showEnd: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Shift Section - Only show for Career job type */}
        {formData.jobType === 'career' && (
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  multiple
                  fullWidth
                  options={shiftOptions}
                  value={formData.shift}
                  onChange={(event, newValue) => {
                    setFormData({ ...formData, shift: newValue });
                    maybeTickPersist();
                  }}
                  renderInput={(params) => (
                    <JobPostFormAutoSaveTextField
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
              <Grid item xs={12} sm={6}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body1">Show Shift Details on Post</Typography>
                  <Switch
                    checked={formData.showShift}
                    onChange={(e) => {
                    setFormData({ ...formData, showShift: e.target.checked });
                    maybeTickPersist();
                  }}
                  />
                </Box>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* Time Section - Only show for Career job type; GIG uses per-shift times */}
        {formData.jobType === 'career' && (
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={3}>
                <JobPostFormAutoSaveTextField
                  label="Start Time"
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  helperText="Job start time"
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body1">Show Start Time</Typography>
                  <Switch
                    checked={formData.showStartTime}
                    onChange={(e) => {
                    setFormData({ ...formData, showStartTime: e.target.checked });
                    maybeTickPersist();
                  }}
                  />
                </Box>
              </Grid>
              <Grid item xs={12} sm={3}>
                <JobPostFormAutoSaveTextField
                  label="End Time"
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  helperText="Job end time"
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body1">Show End Time</Typography>
                  <Switch
                    checked={formData.showEndTime}
                    onChange={(e) => {
                    setFormData({ ...formData, showEndTime: e.target.checked });
                    maybeTickPersist();
                  }}
                  />
                </Box>
              </Grid>
            </Grid>
          </Box>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body1">Use Company Location</Typography>
          <Switch
            checked={useCompanyLocation}
            onChange={(e) => {
              const on = e.target.checked;
              setUseCompanyLocation(on);
              if (!on) {
                setSelectedCompanyId('');
                setSelectedLocationId('');
                setLocations([]);
                setFormData((prev) => ({
                  ...prev,
                  companyId: '',
                  companyName: '',
                  worksiteId: '',
                  worksiteName:
                    formatCityStateZipInput(prev.city, prev.state, prev.zipCode) || prev.worksiteName || '',
                  // Keep street / city / state / zip / coordinates so the City field still matches the header
                }));
              }
              maybeTickPersist(0);
            }}
            disabled={hideJobOrderConnection}
          />
        </Box>

        {useCompanyLocation && selectedCompanyId ? (
          <>
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    fullWidth
                    options={companies}
                    getOptionLabel={(option) => option.name}
                    value={companies.find(c => c.id === selectedCompanyId) || null}
                    onChange={(event, newValue) => {
                      if (newValue) {
                        handleCompanyChange(newValue.id);
                      } else {
                        setSelectedCompanyId('');
                        setSelectedLocationId('');
                        setLocations([]);
                        setFormData({
                          ...formData,
                          companyId: '',
                          companyName: '',
                          worksiteId: '',
                          worksiteName: '',
                          street: '',
                          city: '',
                          state: '',
                          zipCode: ''
                        });
                        maybeTickPersist(0);
                      }
                    }}
                    loading={loadingCompanies}
                    disabled={hideJobOrderConnection || loadingCompanies}
                    renderInput={(params) => (
                      <JobPostFormAutoSaveTextField
                        {...params}
                        label="Company"
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {loadingCompanies ? <CircularProgress color="inherit" size={20} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth required disabled={hideJobOrderConnection || !selectedCompanyId}>
                    <InputLabel>Worksite</InputLabel>
                    <Select
                      value={selectedLocationId}
                      label="Worksite"
                      onChange={(e) => handleLocationChange(e.target.value)}
                      disabled={hideJobOrderConnection || loadingLocations || !selectedCompanyId}
                    >
                      {loadingLocations ? (
                        <MenuItem value="">Loading locations...</MenuItem>
                      ) : locationsForWorksiteSelect.length === 0 ? (
                        <MenuItem value="">No locations available</MenuItem>
                      ) : (
                        locationsForWorksiteSelect.map((location) => (
                          <MenuItem key={location.id} value={location.id}>
                            {location.nickname || location.name}
                          </MenuItem>
                        ))
                      )}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Box>

            {selectedLocationId && (
              <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                  Selected Location Details:
                </Typography>
                <Typography variant="body2">
                  {formData.street && `${formData.street}, `}
                  {formData.city && formData.state ? `${formData.city}, ${formData.state}` : (formData.city || formData.state || 'Location details not available')}
                  {formData.zipCode && ` ${formData.zipCode}`}
                </Typography>
              </Box>
            )}
          </>
        ) : (
          <>
            {/* Show Company dropdown when toggle is ON but no company selected */}
            {useCompanyLocation && (
              <Box sx={{ mt: 2 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      fullWidth
                      options={companies}
                      getOptionLabel={(option) => option.name}
                      value={companies.find(c => c.id === selectedCompanyId) || null}
                      onChange={(event, newValue) => {
                        if (newValue) {
                          handleCompanyChange(newValue.id);
                        } else {
                          setSelectedCompanyId('');
                          setSelectedLocationId('');
                          setLocations([]);
                          setFormData({
                            ...formData,
                            companyId: '',
                            companyName: '',
                            worksiteId: '',
                            worksiteName: '',
                            street: '',
                            city: '',
                            state: '',
                            zipCode: ''
                          });
                          maybeTickPersist(0);
                        }
                      }}
                      loading={loadingCompanies}
                      disabled={hideJobOrderConnection || loadingCompanies}
                      renderInput={(params) => (
                        <JobPostFormAutoSaveTextField
                          {...params}
                          label="Company"
                          helperText="Select a company, or leave empty to use city/state"
                          InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {loadingCompanies ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.InputProps.endAdornment}
                              </>
                            ),
                          }}
                        />
                      )}
                    />
                  </Grid>
                </Grid>
              </Box>
            )}
            
            {/* Always show City/State when no company is selected */}
            <Box sx={{ mt: 2 }}>
              <JobPostWorksiteCityPlacesField
                mapsReady={isGoogleMapsLoaded}
                committedLine={formatCityStateZipInput(formData.city, formData.state, formData.zipCode)}
                onCommit={handleWorksiteCityCommit}
                required
                placeholder={
                  isGoogleMapsLoaded
                    ? 'Search for a city or type City, ST (ZIP optional)…'
                    : 'City, ST or City, ST ZIP (Maps loading…)'
                }
                helperText={
                  isGoogleMapsLoaded
                    ? 'Use suggestions for coordinates, or type e.g. Orlando, FL — tab out to save and geocode.'
                    : 'Loading Google Maps… you can still type City, ST and tab out.'
                }
              />
              {formData.city && formData.state && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1, mt: 2 }}>
                  {geocoding ? (
                    <>
                      <CircularProgress size={16} />
                      <Typography variant="caption" color="text.secondary">
                        Getting coordinates...
                      </Typography>
                    </>
                  ) : formData.coordinates ? (
                    <>
                      <Typography variant="caption" color="text.secondary">
                        Coordinates: {formData.coordinates.lat.toFixed(6)}, {formData.coordinates.lng.toFixed(6)}
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => geocodeCityState(formData.city, formData.state, formData.zipCode)}
                        sx={{ ml: 'auto' }}
                      >
                        Refresh
                      </Button>
                    </>
                  ) : (
                    <>
                      <Typography variant="caption" color="text.secondary">
                        Coordinates will be fetched automatically
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => geocodeCityState(formData.city, formData.state, formData.zipCode)}
                        sx={{ ml: 'auto' }}
                      >
                        Get Coordinates
                      </Button>
                    </>
                  )}
                </Box>
              )}
            </Box>
          </>
        )}

        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Visibility</InputLabel>
                <Select
                  value={formData.visibility}
                  label="Visibility"
                  onChange={(e) => {
                    const visibility = e.target.value as any;
                    setFormData({
                      ...formData,
                      visibility,
                      restrictedGroups: visibility === 'restricted' ? formData.restrictedGroups : [],
                      autoAddToUserGroups: visibility === 'restricted' ? [] : formData.autoAddToUserGroups,
                    });
                    maybeTickPersist();
                  }}
                >
                  <MenuItem value="public">Public - Visible to everyone</MenuItem>
                  <MenuItem value="restricted">Restricted - Visible to specific user groups</MenuItem>
                  <MenuItem value="private">Private - Internal only</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>User Groups</InputLabel>
                <Select
                  value={formData.restrictedGroups}
                  label="User Groups"
                  onChange={(e) => {
                    setFormData({ ...formData, restrictedGroups: e.target.value as string[] });
                    maybeTickPersist();
                  }}
                  disabled={formData.visibility !== 'restricted' || loadingUserGroups}
                  multiple
                >
                  {loadingUserGroups ? (
                    <MenuItem value="" disabled>Loading user groups...</MenuItem>
                  ) : userGroupsForUi.length === 0 ? (
                    <MenuItem value="" disabled>No user groups available</MenuItem>
                  ) : (
                    userGroupsForUi.map((group) => (
                      <MenuItem key={group.id} value={group.id}>
                        {group.name}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>

        {/* E-Verify Required Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              {/* Empty left column for spacing */}
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">E-Verify Required</Typography>
                <Switch
                  checked={formData.eVerifyRequired}
                  onChange={(e) => {
                  setFormData({ ...formData, eVerifyRequired: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Background Checks Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={backgroundCheckOptions.map(option => option.label)}
                value={formData.backgroundCheckPackages}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, backgroundCheckPackages: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Background Check Packages"
                    helperText="Select required background check packages"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Background Requirements</Typography>
                <Switch
                  checked={formData.showBackgroundChecks}
                  onChange={(e) => {
                  setFormData({ ...formData, showBackgroundChecks: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Drug Screening Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={drugScreeningOptions.map(option => option.label)}
                value={formData.drugScreeningPanels}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, drugScreeningPanels: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Drug Screening Panels"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Drug Screening Requirements</Typography>
                <Switch
                  checked={formData.showDrugScreening}
                  onChange={(e) => {
                  setFormData({ ...formData, showDrugScreening: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Additional Screenings Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={additionalScreeningOptions.map(option => option.label)}
                value={formData.additionalScreenings}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, additionalScreenings: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Additional Screenings"
                    helperText="Select required additional screening types"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Additional Screenings on Post</Typography>
                <Switch
                  checked={formData.showAdditionalScreenings}
                  onChange={(e) => {
                  setFormData({ ...formData, showAdditionalScreenings: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Skills Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={onetSkills.map(skill => skill.name)}
                value={formData.skills}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, skills: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Required Skills"
                    helperText="Select skills required for this position"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Skills on Post</Typography>
                <Switch
                  checked={formData.showSkills}
                  onChange={(e) => {
                  setFormData({ ...formData, showSkills: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Licenses & Certifications Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={credentialsSeed
                  .filter(cred => cred.is_active)
                  .map(cred => `${cred.name} (${cred.type})`)
                }
                value={formData.licensesCerts}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, licensesCerts: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Licenses & Certifications"
                    helperText="Select required licenses and certifications"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Licenses & Certifications on Post</Typography>
                <Switch
                  checked={formData.showLicensesCerts}
                  onChange={(e) => {
                  setFormData({ ...formData, showLicensesCerts: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Experience Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={experienceOptions.map(exp => exp.label)}
                value={formData.experienceLevels}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, experienceLevels: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Experience Levels"
                    helperText="Select required experience levels"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Experience on Post</Typography>
                <Switch
                  checked={formData.showExperience}
                  onChange={(e) => {
                  setFormData({ ...formData, showExperience: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Education Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={educationOptions.map(edu => edu.label)}
                value={formData.educationLevels}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, educationLevels: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Education Levels"
                    helperText="Select required education levels"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Education on Post</Typography>
                <Switch
                  checked={formData.showEducation}
                  onChange={(e) => {
                  setFormData({ ...formData, showEducation: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Languages Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Russian', 'Hindi', 'Dutch', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Polish', 'Czech', 'Hungarian', 'Greek', 'Turkish', 'Hebrew', 'Thai', 'Vietnamese', 'Indonesian', 'Malay', 'Tagalog', 'Other']}
                value={formData.languages}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, languages: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Language Requirements"
                    helperText="Select required languages for this position"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Languages on Post</Typography>
                <Switch
                  checked={formData.showLanguages}
                  onChange={(e) => {
                  setFormData({ ...formData, showLanguages: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Physical Requirements Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Standing', 'Walking', 'Sitting', 'Lifting 25 lbs', 'Lifting 50 lbs', 'Lifting 75 lbs', 'Lifting 100+ lbs',
                  'Carrying 25 lbs', 'Carrying 50 lbs', 'Carrying 75 lbs', 'Carrying 100+ lbs', 'Pushing', 'Pulling',
                  'Climbing', 'Balancing', 'Stooping', 'Kneeling', 'Crouching', 'Crawling', 'Reaching', 'Handling',
                  'Fingering', 'Feeling', 'Talking', 'Hearing', 'Seeing', 'Color Vision', 'Depth Perception',
                  'Field of Vision', 'Driving', 'Operating Machinery', 'Working at Heights', 'Confined Spaces',
                  'Outdoor Work', 'Indoor Work', 'Temperature Extremes', 'Noise', 'Vibration', 'Fumes/Odors',
                  'Dust', 'Chemicals', 'Radiation', 'Other'
                ]}
                value={formData.physicalRequirements}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, physicalRequirements: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Physical Requirements on Post</Typography>
                <Switch
                  checked={formData.showPhysicalRequirements}
                  onChange={(e) => {
                  setFormData({ ...formData, showPhysicalRequirements: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Uniform Requirements Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Business Casual', 'Business Professional', 'Black Bistro', 'Casual', 'Scrubs', 'Uniform Provided',
                  'Black Pants', 'White Shirt', 'Polo Shirt', 'Button-Down Shirt', 'Black Button-Down Shirt', 'Dress Shirt',
                  'Khaki Pants', 'Dress Pants', 'Jeans (Dark)', 'Jeans (No Holes)', 'Slacks',
                  'Skirt/Dress', 'Blouse', 'Sweater', 'Cardigan', 'Blazer', 'Suit', 'Tie Required',
                  'No Tie', 'Closed-Toe Shoes', 'Steel-Toe Boots', 'Non-Slip Shoes', 'Dress Shoes',
                  'Sneakers', 'Boots', 'Sandals Allowed', 'No Sandals', 'No Flip-Flops', 'No Shorts',
                  'No Tank Tops', 'No Graphic Tees', 'No Hoodies', 'No Sweatpants', 'No Leggings',
                  'No Yoga Pants', 'No Athletic Wear', 'No Ripped Clothing', 'No Visible Tattoos',
                  'No Facial Piercings', 'Minimal Jewelry', 'No Jewelry', 'Hair Tied Back',
                  'Clean Shaven', 'Facial Hair Allowed', 'Hair Color Restrictions', 'No Hair Color Restrictions',
                  'Coveralls', 'Safety Vest', 'Hard Hat', 'Reflective Clothing', 'Weather-Appropriate',
                  'Seasonal Attire', 'Formal Occasions', 'Customer-Facing', 'Back Office', 'Laboratory',
                  'Kitchen', 'Warehouse', 'Construction', 'Healthcare', 'Food Service', 'Retail', 'Office', 'Other'
                ]}
                value={formData.uniformRequirements}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, uniformRequirements: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Uniform Requirements on Post</Typography>
                <Switch
                  checked={formData.showUniformRequirements}
                  onChange={(e) => {
                  setFormData({ ...formData, showUniformRequirements: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Custom Uniform Requirements Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <JobPostFormAutoSaveTextField
                fullWidth
                label="Custom Uniform Requirements"
                multiline
                rows={3}
                value={formData.customUniformRequirements}
                onChange={(e) => setFormData({ ...formData, customUniformRequirements: e.target.value })}
                placeholder="Enter custom uniform requirements text..."
                helperText="Enter any additional or custom uniform requirements"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Custom Uniform Requirements on Post</Typography>
                <Switch
                  checked={formData.showCustomUniformRequirements}
                  onChange={(e) => {
                  setFormData({ ...formData, showCustomUniformRequirements: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Required PPE Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Hard Hat', 'Safety Glasses', 'Safety Goggles', 'Face Shield', 'Respirator', 'Dust Mask', 'N95 Mask',
                  'Hearing Protection', 'Ear Plugs', 'Ear Muffs', 'High-Visibility Vest', 'Reflective Clothing',
                  'Safety Boots', 'Steel-Toe Boots', 'Non-Slip Shoes', 'Cut-Resistant Gloves', 'Chemical-Resistant Gloves',
                  'Heat-Resistant Gloves', 'Fall Protection Harness', 'Safety Lanyard', 'Lifeline',
                  'Confined Space Equipment', 'Gas Monitor', 'Air Purifying Respirator', 'Self-Contained Breathing Apparatus',
                  'First Aid Kit', 'Emergency Shower', 'Eye Wash Station', 'Fire Extinguisher', 'Safety Data Sheets',
                  'Lockout/Tagout Devices', 'Barricades', 'Warning Signs', 'Personal Alarm', 'Two-Way Radio',
                  'Flashlight', 'Headlamp', 'Protective Coveralls', 'Disposable Suits', 'Chemical Apron',
                  'Lab Coat', 'Hair Net', 'Beard Cover', 'Disposable Gloves', 'Nitrile Gloves', 'Latex Gloves',
                  'Vinyl Gloves', 'Insulated Gloves', 'Electrical Gloves', 'Welding Helmet', 'Welding Gloves',
                  'Welding Apron', 'Welding Boots', 'Welding Jacket', 'Chainsaw Chaps', 'Cutting Gloves',
                  'Abrasion-Resistant Clothing', 'Flame-Resistant Clothing', 'Arc Flash Protection',
                  'Voltage-Rated Gloves', 'Rubber Insulating Gloves', 'Leather Protectors', 'Insulating Blankets',
                  'Insulating Covers', 'Hot Sticks', 'Voltage Detectors', 'Ground Fault Circuit Interrupters', 'Other'
                ]}
                value={formData.requiredPpe}
                onChange={(event, newValue) => {
                  setFormData({ ...formData, requiredPpe: newValue });
                  maybeTickPersist();
                }}
                renderInput={(params) => (
                  <JobPostFormAutoSaveTextField
                    {...params}
                    label="Required PPE"
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
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Required PPE on Post</Typography>
                <Switch
                  checked={formData.showRequiredPpe}
                  onChange={(e) => {
                  setFormData({ ...formData, showRequiredPpe: e.target.checked });
                  maybeTickPersist();
                }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        <Autocomplete
          multiple
          options={userGroupsForUi}
          getOptionLabel={(option) => option.name || 'Unnamed Group'}
          isOptionEqualToValue={(opt, val) => opt.id === val.id}
          value={autoAddGroupsAutocompleteValue}
          onChange={(_, newValue) => {
            setFormData({ ...formData, autoAddToUserGroups: newValue.map((group) => group.id) });
            maybeTickPersist();
          }}
          disabled={formData.visibility === 'restricted' || loadingUserGroups}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option.id}
                label={option.name || 'Unnamed Group'}
                size="small"
              />
            ))
          }
          renderInput={(params) => (
            <JobPostFormAutoSaveTextField
              {...params}
              label="Auto-Add to User Groups"
              placeholder="Search user groups..."
              helperText={
                formData.visibility === 'restricted'
                  ? 'Auto-add to group is not available when visibility is restricted'
                  : 'Automatically add applicants to these user groups'
              }
            />
          )}
          loading={loadingUserGroups}
          noOptionsText={loadingUserGroups ? 'Loading...' : 'No user groups available'}
        />

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <JobPostFormAutoSaveTextField
            label="Craigslist URL"
            value={formData.craigslistUrl}
            onChange={(e) => {
              const craigslistUrl = e.target.value;
              flushSync(() => {
                setFormData((prev) => ({ ...prev, craigslistUrl }));
              });
              const fd = formDataRef.current;
              onHeaderPreviewChange?.({ craigslistUrl: fd.craigslistUrl, indeedUrl: fd.indeedUrl });
            }}
            fullWidth
            placeholder="https://…"
            helperText="Optional. When set, the Craigslist icon in the post header links here (new tab)."
          />
          <JobPostFormAutoSaveTextField
            label="Indeed URL"
            value={formData.indeedUrl}
            onChange={(e) => {
              const indeedUrl = e.target.value;
              flushSync(() => {
                setFormData((prev) => ({ ...prev, indeedUrl }));
              });
              const fd = formDataRef.current;
              onHeaderPreviewChange?.({ craigslistUrl: fd.craigslistUrl, indeedUrl: fd.indeedUrl });
            }}
            fullWidth
            placeholder="https://…"
            helperText="Optional. When set, the Indeed icon in the post header links here (new tab)."
          />
        </Box>

        <Box sx={{ mb: 1, mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Button
            variant="outlined"
            startIcon={generatingDescription ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
            onClick={handleGenerateDescription}
            disabled={generatingDescription}
            size="small"
          >
            {generatingDescription ? 'Generating...' : 'Generate Job Description'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopyDescription}
            disabled={
              !(jobDescriptionFocusRef.current ? jobDescriptionLocal : formData.jobDescription)?.trim()
            }
            size="small"
          >
            Copy to clipboard
          </Button>
        </Box>

        <TextField
          label="Job Description"
          value={jobDescriptionLocal}
          onChange={(e) => setJobDescriptionLocal(e.target.value)}
          onFocus={() => {
            jobDescriptionFocusRef.current = true;
          }}
          onBlur={(e) => {
            const v = e.target.value;
            jobDescriptionFocusRef.current = false;
            flushSync(() => {
              setJobDescriptionLocal(v);
              setFormData((prev) => ({ ...prev, jobDescription: v }));
            });
            if (autoSave && mode === 'edit') {
              window.setTimeout(() => schedulePersist(), 0);
            }
          }}
          fullWidth
          required={formData.status !== 'draft'}
          multiline
          minRows={6}
          helperText="Public job posting text. Use Generate to draft from the job order (or from your prompts when no order is connected). Drafts can be saved without text; set to Active when ready."
        />

        {!(autoSave && mode === 'edit') && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
            <Button variant="outlined" onClick={onCancel} disabled={loading || !onCancel}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={loading || !isFormValid()}
            >
              {loading
                ? formData.status === 'draft'
                  ? 'Saving...'
                  : 'Creating...'
                : formData.status === 'draft'
                  ? 'Save Draft'
                  : mode === 'edit'
                    ? 'Update Post'
                    : 'Create Post'}
            </Button>
          </Box>
        )}
      </Stack>
      <Snackbar
        open={copySnackbarOpen}
        autoHideDuration={2000}
        onClose={() => setCopySnackbarOpen(false)}
        message="Copied to clipboard"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
    </JobPostFormAutoSaveContext.Provider>
  );
};

export default JobPostForm;