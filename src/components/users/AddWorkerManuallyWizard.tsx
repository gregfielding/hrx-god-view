/**
 * AddWorkerManuallyWizard — recruiter / admin / onboarding-specialist
 * surface for creating a worker's HRX account on their behalf and
 * (optionally) hiring them to an entity in one flow.
 *
 * Use case: workers who don't have a phone, can't navigate the public
 * apply wizard, or are sitting in front of an Onboarding Specialist who
 * has all their info.
 *
 * Flow:
 *   Step 1 — Identity         (firstName, lastName, email, phone, DOB, language)
 *   Step 2 — Address          (street, city, state, ZIP)
 *   Step 3 — Hire & Account   (entity, securityLevel, password mode)
 *               ↓ server call
 *               adminCreateWorker → creates Auth user + users/{uid} doc
 *               + tenant claims + entity_employments/worker_onboarding
 *               (suppressNotifications: true — admin is doing this in person)
 *   Step 4 — Payroll setup    EvereePayrollSetupEmbed mounted with the new
 *               worker's uid. Admin and worker fill SSN / W-4 / direct
 *               deposit / I-9 inside the embed. Skipped if the chosen
 *               entity isn't Everee-enabled.
 *   Step 5 — Result           uid, password (if generated), Everee worker
 *               id, copyable links.
 *
 * Backend: `adminCreateWorker` callable
 * (`functions/src/auth/adminCreateWorker.ts`). Permission gate is
 * server-enforced (mirrors `canManageEveree`); we mirror the same gate
 * client-side just to hide the entry button from users who can't use it.
 *
 * "Already exists" handling: when the email matches an existing user,
 * the first call returns `alreadyExists: true` with no writes. We then
 * prompt the recruiter "open profile" or "load into wizard to fill
 * gaps". Picking the second path re-fires the call with
 * `mergeMode: 'fill_missing_only'` — only writes fields the existing
 * doc lacks.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Autocomplete, useLoadScript } from '@react-google-maps/api';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { collection, getDocs } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../firebase';
import {
  adminCreateWorkerCallable,
  type AdminCreateWorkerRequest,
  type AdminCreateWorkerResult,
  type AdminCreateWorkerSecurityLevel,
} from '../../services/auth/adminCreateWorkerCallable';
import EvereePayrollSetupEmbed from '../everee/EvereePayrollSetupEmbed';

const US_STATES: Array<{ code: string; name: string }> = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

/**
 * Numeric security level per `src/utils/AccessRoles.ts`. This flow always
 * creates an Applicant ('2') — higher levels (Worker, Hired Staff, Flex,
 * Manager/Admin) require an explicit role change via `setTenantRole` after
 * the account exists, not a choice made at manual-creation time.
 */
const WORKER_SECURITY_LEVEL: AdminCreateWorkerSecurityLevel = '2';

/** Identity-stable Places options — an inline object makes the maps
 *  wrapper call setOptions() on every re-render, resetting the
 *  prediction session (see 2026-07-09 Add New Location fix). */
const PLACES_AUTOCOMPLETE_OPTIONS = {
  componentRestrictions: { country: 'us' },
  fields: ['address_components', 'formatted_address', 'geometry', 'place_id'],
  types: ['address'],
};

interface EntityOption {
  id: string;
  name: string;
  evereeEnabled: boolean;
  payrollProvider: string | null;
}

interface IdentityState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  preferredLanguage: 'en' | 'es' | '';
}

interface AddressState {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
}

interface HireState {
  entityId: string;
  workerType: 'w2' | '1099' | 'entity_default';
  securityLevel: AdminCreateWorkerSecurityLevel;
  passwordMode: 'generate' | 'recruiter';
  password: string;
}

const STEP_LABELS = ['Identity', 'Address', 'Hire & account', 'Payroll setup', 'Done'] as const;

export interface AddWorkerManuallyWizardProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  /** Optional: invoked after a successful create so the parent can refresh its user list. */
  onCreated?: (uid: string) => void;
}

const AddWorkerManuallyWizard: React.FC<AddWorkerManuallyWizardProps> = ({
  open,
  onClose,
  tenantId,
  onCreated,
}) => {
  const navigate = useNavigate();

  const [activeStep, setActiveStep] = useState(0);
  const [identity, setIdentity] = useState<IdentityState>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    preferredLanguage: '',
  });
  const [address, setAddress] = useState<AddressState>({
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
  });
  const [hire, setHire] = useState<HireState>({
    entityId: '',
    workerType: 'entity_default',
    securityLevel: WORKER_SECURITY_LEVEL,
    passwordMode: 'generate',
    password: '',
  });

  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Server response for the most recent successful submission. */
  const [createResult, setCreateResult] = useState<AdminCreateWorkerResult | null>(null);

  /**
   * Most recent server response that carried `alreadyExists: true` from
   * a `mergeMode: 'fail'` call. When set, the UI shows a chooser:
   * "Open profile" or "Load into this wizard to fill gaps".
   */
  const [duplicateResult, setDuplicateResult] = useState<AdminCreateWorkerResult | null>(null);

  /** Show/hide eye icon on the password input + result reveal. */
  const [revealPassword, setRevealPassword] = useState(false);

  // Google Places autocomplete for the Address step's street field. Unlike
  // the public apply wizard's AddressStep, address here is optional and
  // freely editable (recruiter can type/fix any sub-field by hand) — a
  // Place selection is just a convenience autofill, not a gate.
  const { isLoaded: isGoogleMapsLoaded } = useLoadScript({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places'],
  });
  const autocompleteRef = React.useRef<google.maps.places.Autocomplete | null>(null);
  const handleAutocompleteLoad = useCallback((autocomplete: google.maps.places.Autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);
  const handlePlaceChanged = useCallback(() => {
    const place = autocompleteRef.current?.getPlace();
    const components = place?.address_components;
    if (!place || !Array.isArray(components)) return;
    const getComponent = (types: string[], useShort = false) => {
      const c = components.find((comp) => types.every((t) => comp.types?.includes(t)));
      if (!c) return '';
      return useShort ? c.short_name || '' : c.long_name || '';
    };
    const streetNumber = getComponent(['street_number']);
    const route = getComponent(['route']);
    const street = `${streetNumber} ${route}`.trim();
    const city =
      getComponent(['locality']) ||
      getComponent(['sublocality']) ||
      getComponent(['postal_town']) ||
      getComponent(['administrative_area_level_2']);
    const state = getComponent(['administrative_area_level_1'], true);
    const zip = getComponent(['postal_code']);
    setAddress((prev) => ({
      ...prev,
      addressLine1: street || prev.addressLine1,
      city: city || prev.city,
      state: state || prev.state,
      postalCode: zip || prev.postalCode,
    }));
  }, []);

  // Reset all state when the wizard re-opens. Recruiter is starting fresh.
  useEffect(() => {
    if (!open) return;
    setActiveStep(0);
    setIdentity({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      dateOfBirth: '',
      preferredLanguage: '',
    });
    setAddress({ addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '' });
    setHire({
      entityId: '',
      workerType: 'entity_default',
      securityLevel: WORKER_SECURITY_LEVEL,
      passwordMode: 'generate',
      password: '',
    });
    setSubmitting(false);
    setSubmitError(null);
    setCreateResult(null);
    setDuplicateResult(null);
    setRevealPassword(false);
  }, [open]);

  // Load entities once per open. Cheap query — just reads `tenants/{T}/entities`
  // (a few docs) and filters to ones the wizard can hire to.
  useEffect(() => {
    if (!open || !tenantId) return;
    let cancelled = false;
    setEntitiesLoading(true);
    setEntitiesError(null);
    (async () => {
      try {
        const snap = await getDocs(collection(db, `tenants/${tenantId}/entities`));
        if (cancelled) return;
        const list: EntityOption[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              name: String(data.name || data.legalName || d.id),
              evereeEnabled: data.evereeEnabled === true,
              payrollProvider:
                typeof data.payrollProvider === 'string' ? data.payrollProvider : null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setEntities(list);
      } catch (e) {
        if (!cancelled) setEntitiesError(e instanceof Error ? e.message : 'Failed to load entities');
      } finally {
        if (!cancelled) setEntitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId]);

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === hire.entityId) || null,
    [entities, hire.entityId],
  );

  const isEvereeEntity = selectedEntity?.evereeEnabled === true;

  // ── Step validation gates ───────────────────────────────────────────────

  const step1Valid =
    identity.firstName.trim().length > 0 &&
    identity.lastName.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email.trim()) &&
    (!identity.dateOfBirth || /^\d{4}-\d{2}-\d{2}$/.test(identity.dateOfBirth));

  // Address is OPTIONAL but if the recruiter starts entering it, all required
  // sub-fields must be present (no half-formed address rows in Firestore).
  const anyAddressFieldEntered =
    address.addressLine1.trim() !== '' ||
    address.city.trim() !== '' ||
    address.state.trim() !== '' ||
    address.postalCode.trim() !== '';
  const step2Valid =
    !anyAddressFieldEntered ||
    (address.addressLine1.trim().length > 0 &&
      address.city.trim().length > 0 &&
      address.state.trim().length > 0 &&
      address.postalCode.trim().length >= 3);

  const step3Valid =
    !!hire.securityLevel &&
    (hire.passwordMode === 'generate' ||
      (hire.passwordMode === 'recruiter' && hire.password.length >= 8));

  // ── Submit handler ──────────────────────────────────────────────────────

  const submitCreate = useCallback(
    async (mergeMode: AdminCreateWorkerRequest['mergeMode'] = 'fail') => {
      setSubmitting(true);
      setSubmitError(null);
      setDuplicateResult(null);
      const payload: AdminCreateWorkerRequest = {
        tenantId,
        email: identity.email.trim(),
        firstName: identity.firstName.trim(),
        lastName: identity.lastName.trim(),
        ...(identity.phone.trim() ? { phone: identity.phone.trim() } : {}),
        ...(identity.dateOfBirth ? { dateOfBirth: identity.dateOfBirth } : {}),
        ...(identity.preferredLanguage ? { preferredLanguage: identity.preferredLanguage } : {}),
        ...(anyAddressFieldEntered
          ? {
              address: {
                addressLine1: address.addressLine1.trim(),
                ...(address.addressLine2.trim() ? { addressLine2: address.addressLine2.trim() } : {}),
                city: address.city.trim(),
                state: address.state.trim(),
                postalCode: address.postalCode.trim(),
                country: 'US',
              },
            }
          : {}),
        passwordMode: hire.passwordMode,
        ...(hire.passwordMode === 'recruiter' ? { password: hire.password } : {}),
        role: 'Tenant',
        securityLevel: hire.securityLevel,
        ...(hire.entityId ? { entityId: hire.entityId } : {}),
        ...(hire.entityId && hire.workerType !== 'entity_default'
          ? { workerType: hire.workerType }
          : {}),
        mergeMode,
      };
      try {
        const { data } = await adminCreateWorkerCallable(payload);
        if (data.alreadyExists && mergeMode === 'fail') {
          setDuplicateResult(data);
          setSubmitting(false);
          return;
        }
        setCreateResult(data);
        onCreated?.(data.uid);
        // Advance to payroll step if Everee-enabled, otherwise jump to Done.
        setActiveStep(isEvereeEntity && hire.entityId ? 3 : 4);
      } catch (e: unknown) {
        setSubmitError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [
      tenantId,
      identity,
      address,
      anyAddressFieldEntered,
      hire,
      isEvereeEntity,
      onCreated,
    ],
  );

  // ── Step content renderers ──────────────────────────────────────────────

  const renderStep1 = () => (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="First name"
          value={identity.firstName}
          onChange={(e) => setIdentity({ ...identity, firstName: e.target.value })}
          required
          fullWidth
          autoFocus
        />
        <TextField
          label="Last name"
          value={identity.lastName}
          onChange={(e) => setIdentity({ ...identity, lastName: e.target.value })}
          required
          fullWidth
        />
      </Stack>
      <TextField
        label="Email"
        type="email"
        value={identity.email}
        onChange={(e) => setIdentity({ ...identity, email: e.target.value.toLowerCase() })}
        required
        fullWidth
        helperText="Required. If the worker doesn't have one, help them create a free Gmail account first — placeholders break password reset and notifications."
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Phone"
          value={identity.phone}
          onChange={(e) => setIdentity({ ...identity, phone: e.target.value })}
          fullWidth
          helperText="Optional. Will be normalized to E.164."
        />
        <TextField
          label="Date of birth"
          type="date"
          value={identity.dateOfBirth}
          onChange={(e) => setIdentity({ ...identity, dateOfBirth: e.target.value })}
          fullWidth
          InputLabelProps={{ shrink: true }}
          helperText="Optional but recommended for payroll."
        />
      </Stack>
      <FormControl fullWidth>
        <InputLabel id="preferred-language-label">Preferred language</InputLabel>
        <Select
          labelId="preferred-language-label"
          label="Preferred language"
          value={identity.preferredLanguage}
          onChange={(e) =>
            setIdentity({
              ...identity,
              preferredLanguage: (e.target.value as 'en' | 'es' | '') || '',
            })
          }
        >
          <MenuItem value=""><em>(no preference)</em></MenuItem>
          <MenuItem value="en">English</MenuItem>
          <MenuItem value="es">Español</MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );

  const renderStep2 = () => (
    <Stack spacing={2.5}>
      <Alert severity="info" variant="outlined">
        Address is <strong>optional</strong>, but recommended — Everee will need it for direct-deposit
        and tax filing. If you skip here, the worker can enter it inside the Everee embed in the next
        step.
      </Alert>
      {isGoogleMapsLoaded ? (
        <Autocomplete
          onLoad={handleAutocompleteLoad}
          onPlaceChanged={handlePlaceChanged}
          options={PLACES_AUTOCOMPLETE_OPTIONS}
        >
          <TextField
            label="Street address"
            value={address.addressLine1}
            onChange={(e) => setAddress({ ...address, addressLine1: e.target.value })}
            fullWidth
            autoFocus
            autoComplete="off"
            helperText="Start typing and pick a suggestion to auto-fill city/state/ZIP"
          />
        </Autocomplete>
      ) : (
        <TextField
          label="Street address"
          value={address.addressLine1}
          onChange={(e) => setAddress({ ...address, addressLine1: e.target.value })}
          fullWidth
          autoFocus
        />
      )}
      <TextField
        label="Apt / unit / suite (optional)"
        value={address.addressLine2}
        onChange={(e) => setAddress({ ...address, addressLine2: e.target.value })}
        fullWidth
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="City"
          value={address.city}
          onChange={(e) => setAddress({ ...address, city: e.target.value })}
          fullWidth
        />
        <FormControl sx={{ minWidth: 160 }}>
          <InputLabel id="state-label">State</InputLabel>
          <Select
            labelId="state-label"
            label="State"
            value={address.state}
            onChange={(e) => setAddress({ ...address, state: e.target.value })}
          >
            <MenuItem value=""><em>—</em></MenuItem>
            {US_STATES.map((s) => (
              <MenuItem key={s.code} value={s.code}>
                {s.code} — {s.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="ZIP"
          value={address.postalCode}
          onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
          sx={{ width: { xs: '100%', sm: 140 } }}
        />
      </Stack>
    </Stack>
  );

  const renderStep3 = () => (
    <Stack spacing={2.5}>
      {entitiesError && (
        <Alert severity="warning">Could not load entities — entity hire is optional. ({entitiesError})</Alert>
      )}
      <FormControl fullWidth>
        <InputLabel id="entity-label">Hire to entity (optional)</InputLabel>
        <Select
          labelId="entity-label"
          label="Hire to entity (optional)"
          value={hire.entityId}
          onChange={(e) => setHire({ ...hire, entityId: e.target.value })}
          disabled={entitiesLoading}
        >
          <MenuItem value=""><em>(don't hire — just create the HRX account)</em></MenuItem>
          {entities.map((ent) => (
            <MenuItem key={ent.id} value={ent.id}>
              {ent.name}
              {ent.evereeEnabled ? (
                <Chip
                  size="small"
                  label="Everee"
                  color="success"
                  variant="outlined"
                  sx={{ ml: 1, height: 18, fontSize: '0.65rem' }}
                />
              ) : null}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {hire.entityId ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel id="worker-type-label">Worker type</InputLabel>
            <Select
              labelId="worker-type-label"
              label="Worker type"
              value={hire.workerType}
              onChange={(e) =>
                setHire({ ...hire, workerType: e.target.value as HireState['workerType'] })
              }
            >
              <MenuItem value="entity_default">Use entity default</MenuItem>
              <MenuItem value="w2">W-2 (employee)</MenuItem>
              <MenuItem value="1099">1099 (contractor)</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      ) : null}
      <Box>
        <Typography variant="caption" color="text.secondary" display="block">
          Security level
        </Typography>
        <Chip size="small" label="2 — Applicant" sx={{ mt: 0.5 }} />
      </Box>
      <Divider />
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Account password
        </Typography>
        <RadioGroup
          value={hire.passwordMode}
          onChange={(e) => setHire({ ...hire, passwordMode: e.target.value as 'generate' | 'recruiter' })}
        >
          <FormControlLabel
            value="generate"
            control={<Radio />}
            label="Generate one I can copy and share (recommended)"
          />
          <FormControlLabel
            value="recruiter"
            control={<Radio />}
            label="I'll set the password (min 8 characters)"
          />
        </RadioGroup>
        {hire.passwordMode === 'recruiter' ? (
          <TextField
            label="Password"
            type={revealPassword ? 'text' : 'password'}
            value={hire.password}
            onChange={(e) => setHire({ ...hire, password: e.target.value })}
            fullWidth
            sx={{ mt: 1 }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setRevealPassword((v) => !v)} edge="end" size="small">
                    {revealPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        ) : null}
      </Box>
      {submitError ? (
        <Alert severity="error">
          <AlertTitle>Failed to create worker</AlertTitle>
          {submitError}
        </Alert>
      ) : null}
      {duplicateResult ? (
        <Alert severity="warning">
          <AlertTitle>This email already has an HRX account</AlertTitle>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            <strong>{duplicateResult.summary.displayName}</strong> ({duplicateResult.summary.email})
            — uid <code>{duplicateResult.uid}</code>
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={() => {
                navigate(`/users/${duplicateResult.uid}`);
                onClose();
              }}
            >
              Open profile
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<RestartAltIcon />}
              onClick={() => void submitCreate('fill_missing_only')}
              disabled={submitting}
            >
              Load into wizard (fill missing fields)
            </Button>
          </Stack>
        </Alert>
      ) : null}
    </Stack>
  );

  const renderStep4Embed = () => {
    if (!createResult) return null;
    if (!hire.entityId || !isEvereeEntity) {
      // Defensive — we shouldn't reach here when the entity isn't Everee.
      return (
        <Alert severity="info">
          This entity isn't Everee-enabled. Skipping the payroll step.
        </Alert>
      );
    }
    return (
      <EvereePayrollSetupEmbed
        open
        onClose={() => setActiveStep(4)}
        tenantId={tenantId}
        entityId={hire.entityId}
        userId={createResult.uid}
        workerType={hire.workerType === '1099' ? 'contractor' : 'employee'}
        prefill={{
          email: createResult.summary.email,
          firstName: identity.firstName,
          lastName: identity.lastName,
          ...(identity.phone ? { phone: identity.phone } : {}),
        }}
        onComplete={() => setActiveStep(4)}
        title={`Complete payroll setup — ${createResult.summary.displayName}`}
      />
    );
  };

  const renderStep5Result = () => {
    if (!createResult) return null;
    const { summary, uid, generatedPassword, evereeProvisionWarning, alreadyExists } = createResult;
    return (
      <Stack spacing={2}>
        <Alert severity="success">
          <AlertTitle>{alreadyExists ? 'Existing user updated' : 'Worker created'}</AlertTitle>
          {summary.displayName} — {summary.email}
        </Alert>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            UID
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {uid}
            </Typography>
            <Tooltip title="Copy uid">
              <IconButton
                size="small"
                onClick={() => navigator.clipboard.writeText(uid)}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
        {generatedPassword ? (
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              border: 1,
              borderColor: 'warning.main',
              bgcolor: 'warning.lighter',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" color="warning.dark">
                Temporary password — write this down NOW
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography
                variant="h6"
                sx={{ fontFamily: 'monospace', letterSpacing: 1 }}
              >
                {revealPassword ? generatedPassword : '•'.repeat(generatedPassword.length)}
              </Typography>
              <Tooltip title={revealPassword ? 'Hide' : 'Reveal'}>
                <IconButton size="small" onClick={() => setRevealPassword((v) => !v)}>
                  {revealPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Copy password">
                <IconButton
                  size="small"
                  onClick={() => navigator.clipboard.writeText(generatedPassword)}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Typography variant="caption" color="warning.dark" sx={{ mt: 1, display: 'block' }}>
              The worker can change this later under Account → Security. We won't show it again
              after this dialog closes.
            </Typography>
          </Box>
        ) : null}
        {summary.entityHired ? (
          <Alert severity="info" variant="outlined">
            Hired to <strong>{summary.entityHired.entityName}</strong>.
          </Alert>
        ) : null}
        {evereeProvisionWarning ? (
          <Alert severity="warning">
            <AlertTitle>Everee provisioning note</AlertTitle>
            {evereeProvisionWarning}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap">
          <Button
            variant="contained"
            startIcon={<OpenInNewIcon />}
            onClick={() => {
              navigate(`/users/${uid}`);
              onClose();
            }}
          >
            Open worker profile
          </Button>
          <Button onClick={onClose}>Close</Button>
        </Stack>
      </Stack>
    );
  };

  const handleNext = () => {
    if (activeStep === 0 && step1Valid) setActiveStep(1);
    else if (activeStep === 1 && step2Valid) setActiveStep(2);
    else if (activeStep === 2 && step3Valid && !submitting) void submitCreate('fail');
  };

  const handleBack = () => {
    if (activeStep > 0) setActiveStep((s) => s - 1);
  };

  // The Everee step renders its own dialog — don't show wizard footer there.
  const showWizardFooter = activeStep !== 3;

  return (
    <>
      <Dialog
        open={open && activeStep !== 3}
        onClose={(_, reason) => {
          if (reason === 'backdropClick' && submitting) return;
          if (createResult && activeStep === 4) {
            // Already-created — closing on result step is fine.
            onClose();
            return;
          }
          if (createResult) {
            onClose();
            return;
          }
          // Pre-create — confirm via close button instead of backdrop.
          if (reason !== 'backdropClick') onClose();
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ pr: 6 }}>
          Create worker on behalf
          <IconButton
            onClick={onClose}
            sx={{ position: 'absolute', right: 8, top: 8 }}
            disabled={submitting}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
            {STEP_LABELS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
          {activeStep === 0 && renderStep1()}
          {activeStep === 1 && renderStep2()}
          {activeStep === 2 && renderStep3()}
          {activeStep === 4 && renderStep5Result()}
          {showWizardFooter ? (
            <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 3 }}>
              <Button
                onClick={handleBack}
                disabled={activeStep === 0 || submitting || activeStep === 4}
              >
                Back
              </Button>
              <Stack direction="row" spacing={1}>
                {activeStep === 4 ? null : (
                  <Button
                    variant="contained"
                    onClick={handleNext}
                    disabled={
                      submitting ||
                      (activeStep === 0 && !step1Valid) ||
                      (activeStep === 1 && !step2Valid) ||
                      (activeStep === 2 && !step3Valid)
                    }
                    startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : undefined}
                  >
                    {activeStep === 2 ? 'Create worker' : 'Next'}
                  </Button>
                )}
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>
      {open && activeStep === 3 ? renderStep4Embed() : null}
    </>
  );
};

export default AddWorkerManuallyWizard;
