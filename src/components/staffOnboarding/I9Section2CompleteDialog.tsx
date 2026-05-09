/**
 * **E.7** — `I9Section2CompleteDialog` — modal that captures the
 * Onboarding Specialist's I-9 Section 2 attestation (employer portion).
 *
 * UX: USCIS requires Section 2 to be completed within 3 business days of
 * the worker's first day of employment, after physically inspecting
 * either ONE List A document OR ONE List B + ONE List C document. The
 * dialog mirrors that legal structure so an Onboarding Specialist
 * cannot accidentally submit an invalid combination (List B without
 * List C, or both List A
 * + List B+C selected). The submit is gated client-side on a valid
 * combination; the server only validates that `documentTypes` is
 * non-empty (it doesn't enforce I-9 legal combination rules — keeping
 * the legal validation in the UI keeps the callable narrow and lets us
 * iterate on the rules without redeploying functions).
 *
 * Document codes are canonical strings the callable stores on
 * `entity_employments.i9Section2DocumentTypes`:
 *   - List A: `list_a_us_passport`, `list_a_permanent_resident_card`,
 *     `list_a_employment_authorization_document`, `list_a_other:<desc>`
 *   - List B: `list_b_drivers_license`, `list_b_state_id`,
 *     `list_b_other:<desc>`
 *   - List C: `list_c_social_security_card`, `list_c_birth_certificate`,
 *     `list_c_other:<desc>`
 *
 * The `:desc` suffix on "Other" entries lets us preserve the
 * Onboarding Specialist's description without inventing a parallel
 * field for it on
 * `entity_employments`. Display surfaces can parse the prefix later;
 * for now the audit trail is human-readable in the raw value.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import type { OnboardingSpecialistActionItem } from '../../types/onboardingSpecialistActionQueue';

export interface I9Section2CompleteDialogProps {
  open: boolean;
  /** The action item that triggered the modal — provides worker / entity context. */
  item: OnboardingSpecialistActionItem | null;
  tenantId: string | undefined;
  onClose: () => void;
  /** Called after a successful submit (for snackbar / refresh hooks). */
  onCompleted?: (entityEmploymentId: string) => void;
}

type ListChoice = 'list_a' | 'list_b_c';

interface ListAState {
  passport: boolean;
  permanentResident: boolean;
  employmentAuth: boolean;
  otherChecked: boolean;
  otherText: string;
}

interface ListBState {
  driversLicense: boolean;
  stateId: boolean;
  otherChecked: boolean;
  otherText: string;
}

interface ListCState {
  ssnCard: boolean;
  birthCertificate: boolean;
  otherChecked: boolean;
  otherText: string;
}

const EMPTY_LIST_A: ListAState = {
  passport: false,
  permanentResident: false,
  employmentAuth: false,
  otherChecked: false,
  otherText: '',
};

const EMPTY_LIST_B: ListBState = {
  driversLicense: false,
  stateId: false,
  otherChecked: false,
  otherText: '',
};

const EMPTY_LIST_C: ListCState = {
  ssnCard: false,
  birthCertificate: false,
  otherChecked: false,
  otherText: '',
};

function formatTimestamp(value: unknown): string | null {
  if (!value) return null;
  let d: Date | null = null;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'object') {
    const obj = value as { toDate?: () => Date };
    if (typeof obj.toDate === 'function') {
      try {
        d = obj.toDate();
      } catch {
        d = null;
      }
    }
  } else if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) d = parsed;
  }
  if (!d) return null;
  return d.toLocaleDateString();
}

function formatRelative(value: unknown): string | null {
  if (!value) return null;
  let ms: number | null = null;
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'object') {
    const obj = value as { toDate?: () => Date; toMillis?: () => number };
    if (typeof obj.toMillis === 'function') {
      try {
        ms = obj.toMillis();
      } catch {
        ms = null;
      }
    } else if (typeof obj.toDate === 'function') {
      try {
        ms = obj.toDate().getTime();
      } catch {
        ms = null;
      }
    }
  } else if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) ms = parsed.getTime();
  }
  if (ms == null) return null;
  const diffMs = Date.now() - ms;
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

export interface ComputeDocumentTypesArgs {
  listChoice: ListChoice;
  listA: ListAState;
  listB: ListBState;
  listC: ListCState;
}

/**
 * Pure helper — produces the canonical `documentTypes` array from the
 * dialog's checkbox state. Exported so unit tests can pin the encoding
 * without rendering MUI.
 */
export function computeDocumentTypes(args: ComputeDocumentTypesArgs): string[] {
  const out: string[] = [];
  if (args.listChoice === 'list_a') {
    if (args.listA.passport) out.push('list_a_us_passport');
    if (args.listA.permanentResident) out.push('list_a_permanent_resident_card');
    if (args.listA.employmentAuth) out.push('list_a_employment_authorization_document');
    if (args.listA.otherChecked) {
      const t = args.listA.otherText.trim();
      out.push(t ? `list_a_other:${t}` : 'list_a_other');
    }
  } else {
    if (args.listB.driversLicense) out.push('list_b_drivers_license');
    if (args.listB.stateId) out.push('list_b_state_id');
    if (args.listB.otherChecked) {
      const t = args.listB.otherText.trim();
      out.push(t ? `list_b_other:${t}` : 'list_b_other');
    }
    if (args.listC.ssnCard) out.push('list_c_social_security_card');
    if (args.listC.birthCertificate) out.push('list_c_birth_certificate');
    if (args.listC.otherChecked) {
      const t = args.listC.otherText.trim();
      out.push(t ? `list_c_other:${t}` : 'list_c_other');
    }
  }
  return out;
}

/**
 * Pure helper — validates the (List A) XOR (List B + List C) shape so
 * the submit button can disable until the Onboarding Specialist's
 * selection is legal.
 *
 * Returns `null` when valid, or a human-readable error message
 * otherwise. Exported for tests + dialog inline rendering.
 */
export function validateDocumentSelection(args: ComputeDocumentTypesArgs): string | null {
  if (args.listChoice === 'list_a') {
    const anyA =
      args.listA.passport ||
      args.listA.permanentResident ||
      args.listA.employmentAuth ||
      args.listA.otherChecked;
    if (!anyA) return 'Select at least one List A document.';
    if (args.listA.otherChecked && args.listA.otherText.trim().length === 0) {
      return 'Describe the "Other" List A document.';
    }
    return null;
  }
  // List B + List C — need at least one of each.
  const anyB =
    args.listB.driversLicense || args.listB.stateId || args.listB.otherChecked;
  const anyC =
    args.listC.ssnCard || args.listC.birthCertificate || args.listC.otherChecked;
  if (!anyB) return 'Select at least one List B (identity) document.';
  if (!anyC) return 'Select at least one List C (work authorization) document.';
  if (args.listB.otherChecked && args.listB.otherText.trim().length === 0) {
    return 'Describe the "Other" List B document.';
  }
  if (args.listC.otherChecked && args.listC.otherText.trim().length === 0) {
    return 'Describe the "Other" List C document.';
  }
  return null;
}

const I9Section2CompleteDialog: React.FC<I9Section2CompleteDialogProps> = ({
  open,
  item,
  tenantId,
  onClose,
  onCompleted,
}) => {
  const [listChoice, setListChoice] = useState<ListChoice>('list_b_c');
  const [listA, setListA] = useState<ListAState>(EMPTY_LIST_A);
  const [listB, setListB] = useState<ListBState>(EMPTY_LIST_B);
  const [listC, setListC] = useState<ListCState>(EMPTY_LIST_C);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset all form state on open so a second invocation doesn't carry
  // over the previous worker's selection.
  useEffect(() => {
    if (!open) return;
    setListChoice('list_b_c');
    setListA(EMPTY_LIST_A);
    setListB(EMPTY_LIST_B);
    setListC(EMPTY_LIST_C);
    setNotes('');
    setSubmitError(null);
    setSubmitting(false);
  }, [open]);

  const validationError = useMemo(
    () => validateDocumentSelection({ listChoice, listA, listB, listC }),
    [listChoice, listA, listB, listC],
  );

  const handleSubmit = useCallback(async () => {
    if (!item || !tenantId) return;
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const documentTypes = computeDocumentTypes({ listChoice, listA, listB, listC });
      const callable = httpsCallable<
        {
          tenantId: string;
          entityId: string;
          userId: string;
          documentTypes: string[];
          notes: string | null;
        },
        { ok: true; alreadyComplete: boolean; entityEmploymentId: string }
      >(functions, 'csaMarkI9Section2Complete');
      const result = await callable({
        tenantId,
        entityId: item.entityId,
        userId: item.workerUid,
        documentTypes,
        notes: notes.trim() || null,
      });
      onCompleted?.(result.data.entityEmploymentId);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    item,
    tenantId,
    validationError,
    listChoice,
    listA,
    listB,
    listC,
    notes,
    onCompleted,
    onClose,
  ]);

  const hireDateLabel = formatTimestamp(item?.context.hireDate);
  const section1RelativeLabel = formatRelative(item?.context.i9Section1SignedAt);

  return (
    <Dialog
      open={open && item != null}
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="i9-section2-dialog-title"
    >
      <DialogTitle id="i9-section2-dialog-title">Mark I-9 Section 2 complete</DialogTitle>
      <DialogContent dividers>
        {item ? (
          <Stack spacing={2}>
            <Box>
              <Typography variant="body2">
                <strong>Worker:</strong> {item.workerName}
              </Typography>
              <Typography variant="body2">
                <strong>Entity:</strong> {item.entityName}
              </Typography>
              {hireDateLabel ? (
                <Typography variant="body2">
                  <strong>Hire date:</strong> {hireDateLabel}
                </Typography>
              ) : null}
              {section1RelativeLabel ? (
                <Typography variant="body2">
                  <strong>Section 1:</strong> Signed {section1RelativeLabel} (worker via Everee)
                </Typography>
              ) : null}
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Documents inspected
              </Typography>
              <FormControl component="fieldset">
                <RadioGroup
                  row
                  value={listChoice}
                  onChange={(e) => setListChoice(e.target.value as ListChoice)}
                >
                  <FormControlLabel
                    value="list_a"
                    control={<Radio size="small" />}
                    label="List A (one document)"
                  />
                  <FormControlLabel
                    value="list_b_c"
                    control={<Radio size="small" />}
                    label="List B + List C (one of each)"
                  />
                </RadioGroup>
              </FormControl>

              {listChoice === 'list_a' ? (
                <Stack spacing={0.5} sx={{ pl: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={listA.passport}
                        onChange={(e) =>
                          setListA((prev) => ({ ...prev, passport: e.target.checked }))
                        }
                      />
                    }
                    label="U.S. Passport"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={listA.permanentResident}
                        onChange={(e) =>
                          setListA((prev) => ({
                            ...prev,
                            permanentResident: e.target.checked,
                          }))
                        }
                      />
                    }
                    label="Permanent Resident Card"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={listA.employmentAuth}
                        onChange={(e) =>
                          setListA((prev) => ({
                            ...prev,
                            employmentAuth: e.target.checked,
                          }))
                        }
                      />
                    }
                    label="Employment Authorization Document"
                  />
                  <Stack direction="row" spacing={1} alignItems="center">
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={listA.otherChecked}
                          onChange={(e) =>
                            setListA((prev) => ({
                              ...prev,
                              otherChecked: e.target.checked,
                            }))
                          }
                        />
                      }
                      label="Other List A document"
                    />
                    {listA.otherChecked ? (
                      <TextField
                        size="small"
                        placeholder="Describe"
                        value={listA.otherText}
                        onChange={(e) =>
                          setListA((prev) => ({ ...prev, otherText: e.target.value }))
                        }
                      />
                    ) : null}
                  </Stack>
                </Stack>
              ) : (
                <Stack spacing={1.5} sx={{ pl: 1 }}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      List B (identity)
                    </Typography>
                    <Stack spacing={0.5}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={listB.driversLicense}
                            onChange={(e) =>
                              setListB((prev) => ({
                                ...prev,
                                driversLicense: e.target.checked,
                              }))
                            }
                          />
                        }
                        label="Driver's License"
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={listB.stateId}
                            onChange={(e) =>
                              setListB((prev) => ({ ...prev, stateId: e.target.checked }))
                            }
                          />
                        }
                        label="State ID"
                      />
                      <Stack direction="row" spacing={1} alignItems="center">
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={listB.otherChecked}
                              onChange={(e) =>
                                setListB((prev) => ({
                                  ...prev,
                                  otherChecked: e.target.checked,
                                }))
                              }
                            />
                          }
                          label="Other"
                        />
                        {listB.otherChecked ? (
                          <TextField
                            size="small"
                            placeholder="Describe"
                            value={listB.otherText}
                            onChange={(e) =>
                              setListB((prev) => ({ ...prev, otherText: e.target.value }))
                            }
                          />
                        ) : null}
                      </Stack>
                    </Stack>
                  </Box>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      List C (work authorization)
                    </Typography>
                    <Stack spacing={0.5}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={listC.ssnCard}
                            onChange={(e) =>
                              setListC((prev) => ({ ...prev, ssnCard: e.target.checked }))
                            }
                          />
                        }
                        label="Social Security Card"
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={listC.birthCertificate}
                            onChange={(e) =>
                              setListC((prev) => ({
                                ...prev,
                                birthCertificate: e.target.checked,
                              }))
                            }
                          />
                        }
                        label="Birth Certificate"
                      />
                      <Stack direction="row" spacing={1} alignItems="center">
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={listC.otherChecked}
                              onChange={(e) =>
                                setListC((prev) => ({
                                  ...prev,
                                  otherChecked: e.target.checked,
                                }))
                              }
                            />
                          }
                          label="Other"
                        />
                        {listC.otherChecked ? (
                          <TextField
                            size="small"
                            placeholder="Describe"
                            value={listC.otherText}
                            onChange={(e) =>
                              setListC((prev) => ({ ...prev, otherText: e.target.value }))
                            }
                          />
                        ) : null}
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              )}
            </Box>

            <TextField
              label="Notes (optional)"
              multiline
              minRows={2}
              fullWidth
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              helperText="Stored on the audit trail. Useful for unusual cases."
            />

            {validationError ? (
              <Alert severity="info" variant="outlined">
                {validationError}
              </Alert>
            ) : null}
            {submitError ? <Alert severity="error">{submitError}</Alert> : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || !item || !tenantId || validationError != null}
        >
          {submitting ? 'Saving…' : 'Mark Section 2 complete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default I9Section2CompleteDialog;
