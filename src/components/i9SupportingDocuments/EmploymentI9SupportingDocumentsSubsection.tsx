/**
 * Compact I-9 supporting documents block for Employment → Tax and identity (primary action surface).
 */
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import SmsIcon from '@mui/icons-material/Sms';
import EmailIcon from '@mui/icons-material/Email';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AddIcon from '@mui/icons-material/Add';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import { viewerCanStaffManageI9SupportingDocuments } from '../../utils/i9SupportingDocumentsUi';
import { buildI9SupportingDocumentsEmploymentViewModel } from '../../utils/i9SupportingDocumentsViewModel';
import { useWorkerI9SupportingDocumentsRows } from '../../hooks/useWorkerI9SupportingDocumentsRows';
import {
  I9_ADMIN_BTN_REVIEW_DOCUMENTS,
  I9_ADMIN_MANUAL_ROW_TEXT,
  I9_ADMIN_RESEND_LINK_EMAIL,
  I9_ADMIN_SEND_REMINDER_SMS,
  I9_DIALOG_BODY_ADD_I9_SLOTS,
  I9_DIALOG_TITLE_ADD_I9_SLOTS,
  I9_EMPLOYMENT_ADMIN_AUDIT_FOOTNOTE,
  I9_EMPLOYMENT_ADMIN_INTRO,
  I9_EMPLOYMENT_OPTIONAL_WHEN_I9_VERIFIED,
  I9_EMPLOYMENT_PURPOSE,
  I9_HELPER_REQUIREMENT_HEADING,
  I9_HELPER_REQUIREMENT_HEADING_WHEN_I9_PENDING,
  I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY,
  I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY_DEEPLINK,
  I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT,
  I9_MESSAGE_REQUEST_UPLOAD_SMS,
  I9_MESSAGE_REQUEST_UPLOAD_SMS_DEEPLINK,
  I9_REQUEST_CREATED_STAFF_HINT_V2,
} from '../../constants/i9SupportingDocumentsEmploymentStrings';
import { callCreateWorkerI9SupportingDocumentRequest } from '../../services/i9SupportingDocumentCallables';
import I9SupportingDocumentsDetailDrawer from './I9SupportingDocumentsDetailDrawer';
import { LIST_A_TYPES, LIST_B_TYPES, LIST_C_TYPES } from './I9SupportingDocumentsWorkspace';
import { filterI9RowsForEntityEmployment, workerMyEmploymentAbsoluteUrl } from '../../utils/workerEmploymentWorkerSurface';

export interface EmploymentI9SupportingDocumentsSubsectionProps {
  tenantId: string;
  profileUserId: string;
  requestedForEntityId?: string | null;
  /** Tab entity key (e.g. select / workforce) — scopes I-9 rows and suppresses C1 Events. */
  employmentEntityKey?: string | null;
  /** Firestore `entity_employments` doc id for worker My Employment deeplinks. */
  workerEmploymentRecordId?: string | null;
  hiringEntityDisplayName?: string | null;
  onRefresh?: () => void;
  onOpenWorkerNotificationComposer?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void;
  /** When set, I-9 reminder SMS/email send immediately (same APIs as MessageDrawer). */
  onSendWorkerNotificationDirect?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void | Promise<void>;
  /** Payroll / TempWorks I-9 verified — supporting uploads are not part of completion gates. */
  i9EmployeeSectionComplete?: boolean;
}

function substatusChipColor(
  s: string,
): 'default' | 'primary' | 'success' | 'warning' | 'error' {
  switch (s) {
    case 'complete':
      return 'success';
    case 'under_review':
      return 'primary';
    case 'action_needed':
      return 'warning';
    case 'not_started':
      return 'default';
    default:
      return 'default';
  }
}

const EmploymentI9SupportingDocumentsSubsection: React.FC<EmploymentI9SupportingDocumentsSubsectionProps> = ({
  tenantId,
  profileUserId,
  requestedForEntityId,
  employmentEntityKey,
  workerEmploymentRecordId,
  hiringEntityDisplayName,
  onRefresh,
  onOpenWorkerNotificationComposer,
  onSendWorkerNotificationDirect,
  i9EmployeeSectionComplete = false,
}) => {
  const { user, isHRX, claimsRoles, tenantRolesFromProfile, legacyUserSecurityLevel, legacyUserRole } = useAuth();
  const viewerUid = user?.uid;
  const staffMode = useMemo(
    () =>
      viewerCanStaffManageI9SupportingDocuments(
        tenantId,
        profileUserId,
        viewerUid,
        isHRX,
        claimsRoles,
        tenantRolesFromProfile,
        legacyUserSecurityLevel,
        legacyUserRole,
      ),
    [
      tenantId,
      profileUserId,
      viewerUid,
      isHRX,
      claimsRoles,
      tenantRolesFromProfile,
      legacyUserSecurityLevel,
      legacyUserRole,
    ],
  );
  const workerSelf = viewerUid === profileUserId;

  const { rows, loading, error } = useWorkerI9SupportingDocumentsRows(tenantId, profileUserId, true);

  const scopedRows = useMemo(() => {
    if (!requestedForEntityId?.trim()) return rows;
    return filterI9RowsForEntityEmployment(
      rows,
      { entityId: requestedForEntityId, entityKey: employmentEntityKey ?? null },
      99,
    );
  }, [rows, requestedForEntityId, employmentEntityKey]);

  const vm = useMemo(
    () =>
      buildI9SupportingDocumentsEmploymentViewModel(scopedRows, {
        i9EmployeeSectionComplete,
      }),
    [scopedRows, i9EmployeeSectionComplete],
  );

  const workerEmploymentAbsoluteUrl = useMemo(() => {
    const id = workerEmploymentRecordId?.trim();
    if (!id || typeof window === 'undefined') return '';
    return workerMyEmploymentAbsoluteUrl(window.location.origin, id);
  }, [workerEmploymentRecordId]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestPath, setRequestPath] = useState<'a' | 'bc'>('a');
  const [listAType, setListAType] = useState(LIST_A_TYPES[0]?.value ?? 'list_a_us_passport');
  const [listBType, setListBType] = useState(LIST_B_TYPES[0]?.value ?? 'list_b_drivers_license');
  const [listCType, setListCType] = useState(LIST_C_TYPES[0]?.value ?? 'list_c_ssn_card');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestErr, setRequestErr] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const [directSmsBusy, setDirectSmsBusy] = useState(false);
  const [directEmailBusy, setDirectEmailBusy] = useState(false);

  const i9ReminderSmsBody = useMemo(() => {
    return workerEmploymentAbsoluteUrl.trim().length > 0
      ? I9_MESSAGE_REQUEST_UPLOAD_SMS_DEEPLINK(workerEmploymentAbsoluteUrl, hiringEntityDisplayName ?? undefined)
      : I9_MESSAGE_REQUEST_UPLOAD_SMS;
  }, [workerEmploymentAbsoluteUrl, hiringEntityDisplayName]);

  const i9ReminderEmailBody = useMemo(() => {
    return workerEmploymentAbsoluteUrl.trim().length > 0
      ? I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY_DEEPLINK(
          workerEmploymentAbsoluteUrl,
          hiringEntityDisplayName ?? undefined,
        )
      : I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY;
  }, [workerEmploymentAbsoluteUrl, hiringEntityDisplayName]);

  const openAddSlotsDialog = () => {
    setRequestErr(null);
    setRequestOpen(true);
  };

  const submitRequest = async () => {
    setRequestBusy(true);
    setRequestErr(null);
    try {
      const base = {
        tenantId,
        userId: profileUserId,
        ...(requestedForEntityId ? { requestedForEntityId } : {}),
      };
      if (requestPath === 'a') {
        await callCreateWorkerI9SupportingDocumentRequest(functions, {
          ...base,
          documentType: listAType,
        });
      } else {
        await callCreateWorkerI9SupportingDocumentRequest(functions, {
          ...base,
          documentType: listBType,
        });
        await callCreateWorkerI9SupportingDocumentRequest(functions, {
          ...base,
          documentType: listCType,
        });
      }
      setRequestOpen(false);
      setRequestSuccess(I9_REQUEST_CREATED_STAFF_HINT_V2);
      onRefresh?.();
    } catch (e) {
      setRequestErr(formatFirebaseHttpsError(e));
    } finally {
      setRequestBusy(false);
    }
  };

  const runReminderSms = async () => {
    if (onSendWorkerNotificationDirect) {
      setDirectSmsBusy(true);
      try {
        await onSendWorkerNotificationDirect({ channel: 'sms', body: i9ReminderSmsBody });
      } finally {
        setDirectSmsBusy(false);
      }
      return;
    }
    if (onOpenWorkerNotificationComposer) {
      onOpenWorkerNotificationComposer({ channel: 'sms', body: i9ReminderSmsBody });
    }
  };

  const runReminderEmail = async () => {
    if (onSendWorkerNotificationDirect) {
      setDirectEmailBusy(true);
      try {
        await onSendWorkerNotificationDirect({
          channel: 'email',
          body: i9ReminderEmailBody,
          subject: I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT,
        });
      } finally {
        setDirectEmailBusy(false);
      }
      return;
    }
    if (onOpenWorkerNotificationComposer) {
      onOpenWorkerNotificationComposer({
        channel: 'email',
        body: i9ReminderEmailBody,
        subject: I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT,
      });
    }
  };

  const successAlertSmsEmail = () => {
    if (!onSendWorkerNotificationDirect && !onOpenWorkerNotificationComposer) return null;
    return (
      <Stack direction="row" flexWrap="wrap" gap={1}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<SmsIcon />}
          disabled={directSmsBusy}
          onClick={() => void runReminderSms()}
        >
          {I9_ADMIN_SEND_REMINDER_SMS}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<EmailIcon />}
          disabled={directEmailBusy}
          onClick={() => void runReminderEmail()}
        >
          {I9_ADMIN_RESEND_LINK_EMAIL}
        </Button>
      </Stack>
    );
  };

  const canNotifyWorker = Boolean(onSendWorkerNotificationDirect || onOpenWorkerNotificationComposer);

  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
        I-9 supporting documents
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.5 }}>
        {staffMode ? I9_EMPLOYMENT_ADMIN_INTRO : I9_EMPLOYMENT_PURPOSE}
      </Typography>
      {i9EmployeeSectionComplete ? (
        <Alert severity="info" sx={{ mb: 1.25 }}>
          <Typography variant="body2" sx={{ lineHeight: 1.45 }}>
            {I9_EMPLOYMENT_OPTIONAL_WHEN_I9_VERIFIED}
          </Typography>
        </Alert>
      ) : null}

      {loading ? (
        <Typography variant="caption" color="text.secondary">
          Loading document status…
        </Typography>
      ) : error ? (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      ) : (
        <>
          <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Status:
            </Typography>
            <Chip
              size="small"
              label={vm.substatusLabel}
              color={substatusChipColor(vm.substatus)}
              variant={vm.substatus === 'not_started' ? 'outlined' : 'filled'}
            />
          </Stack>

          {vm.compactContextLines.length > 0 ? (
            <Box sx={{ mb: 1 }}>
              {vm.compactContextLines.map((line) => (
                <Typography
                  key={line}
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ lineHeight: 1.45, fontStyle: 'italic' }}
                >
                  {line}
                </Typography>
              ))}
            </Box>
          ) : null}

          <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.35 }}>
            {i9EmployeeSectionComplete ? I9_HELPER_REQUIREMENT_HEADING : I9_HELPER_REQUIREMENT_HEADING_WHEN_I9_PENDING}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75, lineHeight: 1.45 }}>
            Upload 1 List A document, or 1 List B document and 1 List C document.
          </Typography>

          {vm.stillNeededLines.map((line) => (
            <Typography key={line} variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.45 }}>
              {line}
            </Typography>
          ))}
          {vm.uploadedSummaryLines.length > 0 ? (
            <Box sx={{ mt: 0.75 }}>
              {vm.uploadedSummaryLines.map((line) => (
                <Typography key={line} variant="caption" display="block" sx={{ lineHeight: 1.45 }}>
                  {line}
                </Typography>
              ))}
            </Box>
          ) : null}

          <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Last upload: {vm.latestUploadedAtLabel}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Last review: {vm.latestReviewedAtLabel}
            </Typography>
          </Stack>
          {vm.latestRejectionReason && vm.substatus === 'action_needed' ? (
            <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
              Latest rejection: {vm.latestRejectionReason}
            </Typography>
          ) : null}
        </>
      )}

      {requestSuccess && (
        <Alert severity="success" sx={{ mt: 1 }} onClose={() => setRequestSuccess(null)}>
          <Stack spacing={1}>
            <Typography variant="body2">{requestSuccess}</Typography>
            {staffMode ? successAlertSmsEmail() : null}
          </Stack>
        </Alert>
      )}

      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5 }} useFlexGap alignItems="center">
        {staffMode ? (
          <>
            <Button
              size="small"
              variant="contained"
              startIcon={<OpenInNewIcon />}
              onClick={() => setDrawerOpen(true)}
              disabled={loading || Boolean(error)}
            >
              {I9_ADMIN_BTN_REVIEW_DOCUMENTS}
            </Button>
            {canNotifyWorker ? (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={directSmsBusy ? <CircularProgress color="inherit" size={14} /> : <SmsIcon />}
                  onClick={() => void runReminderSms()}
                  disabled={loading || Boolean(error) || directSmsBusy || directEmailBusy}
                >
                  {I9_ADMIN_SEND_REMINDER_SMS}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={directEmailBusy ? <CircularProgress color="inherit" size={14} /> : <EmailIcon />}
                  onClick={() => void runReminderEmail()}
                  disabled={loading || Boolean(error) || directSmsBusy || directEmailBusy}
                >
                  {I9_ADMIN_RESEND_LINK_EMAIL}
                </Button>
              </>
            ) : null}
            <Button
              size="small"
              variant="text"
              color="inherit"
              startIcon={<AddIcon />}
              onClick={openAddSlotsDialog}
              disabled={loading || Boolean(error)}
              sx={{ fontSize: '0.75rem', textTransform: 'none' }}
            >
              {I9_ADMIN_MANUAL_ROW_TEXT}
            </Button>
          </>
        ) : workerSelf ? (
          <Button
            size="small"
            variant="contained"
            startIcon={<OpenInNewIcon />}
            onClick={() => setDrawerOpen(true)}
            disabled={loading || Boolean(error)}
          >
            {I9_ADMIN_BTN_REVIEW_DOCUMENTS}
          </Button>
        ) : null}
      </Stack>

      {(staffMode || workerSelf) && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.25, lineHeight: 1.45 }}>
          {I9_EMPLOYMENT_ADMIN_AUDIT_FOOTNOTE}
        </Typography>
      )}

      <Dialog open={requestOpen} onClose={() => !requestBusy && setRequestOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{I9_DIALOG_TITLE_ADD_I9_SLOTS}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {I9_DIALOG_BODY_ADD_I9_SLOTS}
          </Typography>
          <FormControl component="fieldset" variant="standard" fullWidth sx={{ mb: 2 }}>
            <FormLabel component="legend" sx={{ typography: 'body2', fontWeight: 600 }}>
              Document path
            </FormLabel>
            <RadioGroup value={requestPath} onChange={(_, v) => setRequestPath(v as 'a' | 'bc')}>
              <FormControlLabel value="a" control={<Radio size="small" />} label="List A (one slot)" />
              <FormControlLabel value="bc" control={<Radio size="small" />} label="List B + List C (two slots)" />
            </RadioGroup>
          </FormControl>

          {requestPath === 'a' ? (
            <FormControl fullWidth size="small" sx={{ mb: 1 }}>
              <InputLabel id="emp-i9-req-list-a">List A document type</InputLabel>
              <Select
                labelId="emp-i9-req-list-a"
                label="List A document type"
                value={listAType}
                onChange={(e) => setListAType(e.target.value)}
              >
                {LIST_A_TYPES.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <Stack spacing={1.5}>
              <FormControl fullWidth size="small">
                <InputLabel id="emp-i9-req-list-b">List B document type</InputLabel>
                <Select
                  labelId="emp-i9-req-list-b"
                  label="List B document type"
                  value={listBType}
                  onChange={(e) => setListBType(e.target.value)}
                >
                  {LIST_B_TYPES.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="emp-i9-req-list-c">List C document type</InputLabel>
                <Select
                  labelId="emp-i9-req-list-c"
                  label="List C document type"
                  value={listCType}
                  onChange={(e) => setListCType(e.target.value)}
                >
                  {LIST_C_TYPES.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          )}

          {requestErr ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {requestErr}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRequestOpen(false)} disabled={requestBusy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void submitRequest()} disabled={requestBusy}>
            {requestBusy ? 'Creating…' : 'Create slot(s)'}
          </Button>
        </DialogActions>
      </Dialog>

      <I9SupportingDocumentsDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        tenantId={tenantId}
        workerUserId={profileUserId}
        rows={scopedRows}
        loading={loading}
        error={error}
        requestedForEntityId={requestedForEntityId}
        employmentEntityKey={employmentEntityKey}
      />
    </Box>
  );
};

export default EmploymentI9SupportingDocumentsSubsection;
