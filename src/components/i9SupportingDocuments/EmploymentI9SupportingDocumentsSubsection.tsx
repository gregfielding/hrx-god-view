/**
 * Compact I-9 supporting documents block for Employment → Tax and identity (primary action surface).
 */
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  Link,
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
  I9_EMPLOYMENT_PURPOSE,
  I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY,
  I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT,
  I9_MESSAGE_REQUEST_UPLOAD_SMS,
  I9_REQUEST_CREATED_STAFF_HINT,
} from '../../constants/i9SupportingDocumentsEmploymentStrings';
import { callCreateWorkerI9SupportingDocumentRequest } from '../../services/i9SupportingDocumentCallables';
import I9SupportingDocumentsDetailDrawer from './I9SupportingDocumentsDetailDrawer';
import { LIST_A_TYPES, LIST_B_TYPES, LIST_C_TYPES } from './I9SupportingDocumentsWorkspace';

export interface EmploymentI9SupportingDocumentsSubsectionProps {
  tenantId: string;
  profileUserId: string;
  requestedForEntityId?: string | null;
  onRefresh?: () => void;
  onOpenWorkerNotificationComposer?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void;
  /** Switch parent profile tab (e.g. Backgrounds). */
  onNavigateToProfileTab?: (tabLabel: string) => void;
}

function substatusChipColor(
  s: string,
): 'default' | 'primary' | 'success' | 'warning' | 'error' {
  switch (s) {
    case 'complete':
      return 'success';
    case 'under_review':
      return 'primary';
    case 'upload_requested':
      return 'warning';
    case 'rejected':
      return 'error';
    default:
      return 'default';
  }
}

const EmploymentI9SupportingDocumentsSubsection: React.FC<EmploymentI9SupportingDocumentsSubsectionProps> = ({
  tenantId,
  profileUserId,
  requestedForEntityId,
  onRefresh,
  onOpenWorkerNotificationComposer,
  onNavigateToProfileTab,
}) => {
  const { user, isHRX, claimsRoles } = useAuth();
  const viewerUid = user?.uid;
  const staffMode = useMemo(
    () =>
      viewerCanStaffManageI9SupportingDocuments(tenantId, profileUserId, viewerUid, isHRX, claimsRoles),
    [tenantId, profileUserId, viewerUid, isHRX, claimsRoles],
  );
  const workerSelf = viewerUid === profileUserId;

  const { rows, loading, error } = useWorkerI9SupportingDocumentsRows(tenantId, profileUserId, true);
  const vm = useMemo(() => buildI9SupportingDocumentsEmploymentViewModel(rows), [rows]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestPath, setRequestPath] = useState<'a' | 'bc'>('a');
  const [listAType, setListAType] = useState(LIST_A_TYPES[0]?.value ?? 'list_a_us_passport');
  const [listBType, setListBType] = useState(LIST_B_TYPES[0]?.value ?? 'list_b_drivers_license');
  const [listCType, setListCType] = useState(LIST_C_TYPES[0]?.value ?? 'list_c_ssn_card');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestErr, setRequestErr] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);

  const openBackgroundsLink = () => {
    onNavigateToProfileTab?.('Backgrounds');
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
      setRequestSuccess(I9_REQUEST_CREATED_STAFF_HINT);
      onRefresh?.();
    } catch (e) {
      setRequestErr(formatFirebaseHttpsError(e));
    } finally {
      setRequestBusy(false);
    }
  };

  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
        I-9 supporting documents
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, lineHeight: 1.5 }}>
        {I9_EMPLOYMENT_PURPOSE}
      </Typography>

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
              variant={vm.substatus === 'not_requested' ? 'outlined' : 'filled'}
            />
          </Stack>

          <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.35 }}>
            Required to complete I-9:
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
          {vm.latestRejectionReason && vm.substatus === 'rejected' ? (
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
            {staffMode && onOpenWorkerNotificationComposer ? (
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<SmsIcon />}
                  onClick={() =>
                    onOpenWorkerNotificationComposer({ channel: 'sms', body: I9_MESSAGE_REQUEST_UPLOAD_SMS })
                  }
                >
                  Send SMS
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EmailIcon />}
                  onClick={() =>
                    onOpenWorkerNotificationComposer({
                      channel: 'email',
                      body: I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY,
                      subject: I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT,
                    })
                  }
                >
                  Send email
                </Button>
              </Stack>
            ) : null}
          </Stack>
        </Alert>
      )}

      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5 }} useFlexGap>
        {staffMode && (
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setRequestErr(null);
              setRequestOpen(true);
            }}
          >
            Request I-9 documents (List A or List B + C)
          </Button>
        )}
        <Button
          size="small"
          variant="outlined"
          startIcon={<OpenInNewIcon />}
          onClick={() => setDrawerOpen(true)}
          disabled={loading || Boolean(error)}
        >
          View &amp; review
        </Button>
        {(staffMode || workerSelf) && (
          <Link
            component="button"
            type="button"
            variant="body2"
            onClick={openBackgroundsLink}
            sx={{ alignSelf: 'center', typography: 'caption' }}
          >
            Detailed history in Backgrounds &amp; compliance
          </Link>
        )}
      </Stack>

      <Dialog open={requestOpen} onClose={() => !requestBusy && setRequestOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Request I-9 documents</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose which documents the worker should upload. List B + C creates two requests (two uploads).
          </Typography>
          <FormControl component="fieldset" variant="standard" fullWidth sx={{ mb: 2 }}>
            <FormLabel component="legend" sx={{ typography: 'body2', fontWeight: 600 }}>
              Document path
            </FormLabel>
            <RadioGroup value={requestPath} onChange={(_, v) => setRequestPath(v as 'a' | 'bc')}>
              <FormControlLabel value="a" control={<Radio size="small" />} label="List A (one request)" />
              <FormControlLabel value="bc" control={<Radio size="small" />} label="List B + List C (two requests)" />
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
            {requestBusy ? 'Creating…' : 'Create request(s)'}
          </Button>
        </DialogActions>
      </Dialog>

      <I9SupportingDocumentsDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        tenantId={tenantId}
        workerUserId={profileUserId}
        rows={rows}
        loading={loading}
        error={error}
        requestedForEntityId={requestedForEntityId}
      />
    </Box>
  );
};

export default EmploymentI9SupportingDocumentsSubsection;
