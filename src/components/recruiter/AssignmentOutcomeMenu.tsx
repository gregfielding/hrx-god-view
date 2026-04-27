/**
 * Assignment outcome kebab menu — Phase 4 of
 * `docs/WORKFORCE_DOMAIN_MODEL.md`.
 *
 * Renders a small ⋮ button on any assignment row. The menu items let a
 * recruiter mark the shift outcome (or undo one already set). Status/timing
 * gates which items are enabled:
 *   - Shift hasn't started yet → only Cancel (business / worker) are enabled.
 *   - Shift has started or passed → Complete / No-show / Left early / Cancel
 *     are all enabled.
 *   - Assignment already has an outcome → "Undo outcome" is enabled instead
 *     of appearing under a separate submenu; the recruiter can also pick a
 *     different outcome to change it.
 *
 * Submitting opens a lightweight notes dialog (notes optional for all
 * actions) before calling `setAssignmentOutcome`.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import {
  ASSIGNMENT_OUTCOME_LABELS,
  type AssignmentOutcomeStatus,
  type SetAssignmentOutcomeInput,
  type SetAssignmentOutcomeResult,
} from '../../shared/assignmentOutcome';

const setAssignmentOutcomeCallable = httpsCallable<
  SetAssignmentOutcomeInput,
  SetAssignmentOutcomeResult
>(functions, 'setAssignmentOutcome');

/** Statuses that mean the outcome can be undone. */
const OUTCOME_STATUSES: AssignmentOutcomeStatus[] = [
  'completed',
  'no_show',
  'left_early',
  'cancelled_business',
  'cancelled_worker',
];

export interface AssignmentOutcomeMenuProps {
  tenantId: string;
  assignmentId: string;
  /**
   * Current assignment status. Used to decide whether "Undo" is an
   * option and which item should appear checked.
   */
  currentStatus: string;
  /**
   * Shift start datetime. When null/missing we assume the shift has
   * started (i.e. allow all outcome actions) — keeps the menu useful
   * even on legacy rows.
   */
  shiftStart?: Date | null;
  /** Called after a successful write so the parent can refresh. */
  onOutcomeChanged: () => void | Promise<void>;
  /** Optional: disable the whole menu (e.g. viewer lacks permission). */
  disabled?: boolean;
}

type MenuAction =
  | { kind: 'set'; outcomeStatus: AssignmentOutcomeStatus }
  | { kind: 'undo' };

const AssignmentOutcomeMenu: React.FC<AssignmentOutcomeMenuProps> = ({
  tenantId,
  assignmentId,
  currentStatus,
  shiftStart,
  onOutcomeChanged,
  disabled,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [pendingAction, setPendingAction] = useState<MenuAction | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasStarted = useMemo(() => {
    if (!shiftStart) return true; // treat missing start as "has started" so menu works on legacy rows
    return shiftStart.getTime() <= Date.now();
  }, [shiftStart]);

  const lowerStatus = (currentStatus || '').toLowerCase();
  const hasOutcome = (OUTCOME_STATUSES as readonly string[]).includes(lowerStatus);

  const closeMenu = useCallback(() => setAnchorEl(null), []);
  const openMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  }, []);

  const startAction = useCallback((action: MenuAction) => {
    setPendingAction(action);
    setNotes('');
    setError(null);
    setAnchorEl(null);
  }, []);

  const cancelDialog = useCallback(() => {
    if (submitting) return;
    setPendingAction(null);
    setNotes('');
    setError(null);
  }, [submitting]);

  const submit = useCallback(async () => {
    if (!pendingAction) return;
    setSubmitting(true);
    setError(null);
    try {
      await setAssignmentOutcomeCallable({
        tenantId,
        assignmentId,
        outcomeStatus: pendingAction.kind === 'undo' ? null : pendingAction.outcomeStatus,
        notes: notes.trim() || undefined,
      });
      setPendingAction(null);
      setNotes('');
      await onOutcomeChanged();
    } catch (err: unknown) {
      setError(formatFirebaseHttpsError(err));
    } finally {
      setSubmitting(false);
    }
  }, [pendingAction, tenantId, assignmentId, notes, onOutcomeChanged]);

  const dialogTitle = useMemo(() => {
    if (!pendingAction) return '';
    if (pendingAction.kind === 'undo') return 'Undo outcome';
    return `Mark as ${ASSIGNMENT_OUTCOME_LABELS[pendingAction.outcomeStatus]}`;
  }, [pendingAction]);

  const renderMenuItem = (status: AssignmentOutcomeStatus, locked: boolean) => (
    <MenuItem
      key={status}
      disabled={locked}
      selected={lowerStatus === status}
      onClick={() => startAction({ kind: 'set', outcomeStatus: status })}
    >
      {ASSIGNMENT_OUTCOME_LABELS[status]}
    </MenuItem>
  );

  return (
    <>
      <Tooltip title="Mark outcome">
        <span>
          <IconButton
            size="small"
            onClick={openMenu}
            disabled={disabled}
            aria-label="Mark outcome"
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={closeMenu}
        onClick={(e) => e.stopPropagation()}
      >
        {renderMenuItem('completed', !hasStarted)}
        {renderMenuItem('no_show', !hasStarted)}
        {renderMenuItem('left_early', !hasStarted)}
        <Divider />
        {renderMenuItem('cancelled_business', false)}
        {renderMenuItem('cancelled_worker', false)}
        {hasOutcome && <Divider />}
        {hasOutcome && (
          <MenuItem onClick={() => startAction({ kind: 'undo' })}>
            Undo outcome
          </MenuItem>
        )}
      </Menu>

      {pendingAction && (
        <Dialog open onClose={cancelDialog} maxWidth="sm" fullWidth>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              {pendingAction.kind === 'undo'
                ? "Reverts this assignment's status to 'confirmed' and clears the outcome. Counters will be adjusted automatically."
                : 'Notes are optional and visible to recruiters / admins for audit.'}
            </DialogContentText>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            <TextField
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={2}
              fullWidth
              autoFocus
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={cancelDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} variant="contained" disabled={submitting}>
              {submitting ? (
                <CircularProgress size={22} />
              ) : pendingAction.kind === 'undo' ? (
                'Undo'
              ) : (
                'Save'
              )}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
};

export default AssignmentOutcomeMenu;
