import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useSearchParams } from "react-router-dom";
import { db, functions } from "../firebase";
import { p } from "../data/firestorePaths";
import { useAuth } from "../contexts/AuthContext";

type StepStatus = "not_started" | "in_progress" | "complete" | "blocked";
type StepApplicability = "required" | "not_required" | "pending";
type StepWorkflowStatus =
  | "not_started"
  | "pending_package"
  | "package_selected"
  | "ordered"
  | "awaiting_worker"
  | "scheduled"
  | "in_progress"
  | "complete"
  | "blocked"
  | "skipped"
  | "failed"
  | "canceled";

const DUMMY_BACKGROUND_PACKAGES = [
  { id: "dummy_bg_1", label: "Dummy Background 1" },
  { id: "dummy_bg_2", label: "Dummy Background 2" },
];
const DUMMY_DRUG_PACKAGES = [
  { id: "dummy_drug_1", label: "Dummy Drug 1" },
  { id: "dummy_drug_2", label: "Dummy Drug 2" },
];

const WORKFLOW_ACTIONS: { value: StepWorkflowStatus; label: string }[] = [
  { value: "ordered", label: "Mark ordered" },
  { value: "complete", label: "Mark complete" },
  { value: "in_progress", label: "In progress" },
  { value: "skipped", label: "Skip" },
  { value: "blocked", label: "Block" },
  { value: "failed", label: "Fail" },
];

interface StepMilestone {
  id: string;
  label: string;
  completed: boolean;
}

interface OnboardingStep {
  id: string;
  title: string;
  status: StepStatus;
  applicability?: StepApplicability;
  selectedPackageId?: string;
  selectedPackageLabel?: string;
  workflowStatus?: StepWorkflowStatus;
  note?: string;
  failureReason?: string;
  milestones?: StepMilestone[];
}

interface OnboardingPipelineRow {
  id: string;
  userId: string;
  userName?: string;
  entityName?: string;
  entityKey?: string;
  status?: string;
  assignmentIds?: string[];
  steps?: OnboardingStep[];
}

interface EntityEmploymentRecord {
  id: string;
  status: string;
  workerType?: string;
  onboardingCompletedAt?: unknown;
  terminatedAt?: unknown;
}

const STATUS_COLOR: Record<StepStatus, "default" | "warning" | "success" | "error"> = {
  not_started: "default",
  in_progress: "warning",
  complete: "success",
  blocked: "error",
};

const APPLICABILITY_COLOR: Record<StepApplicability, "default" | "warning" | "info"> = {
  required: "info",
  not_required: "default",
  pending: "warning",
};

const WORKFLOW_STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  not_started: "default",
  pending_package: "warning",
  package_selected: "info",
  ordered: "info",
  awaiting_worker: "info",
  scheduled: "info",
  in_progress: "warning",
  complete: "success",
  blocked: "error",
  skipped: "default",
  failed: "error",
  canceled: "default",
};

const CRITICAL_STEP_IDS = new Set(["i9", "onboarding_forms", "e_verify", "background_check", "drug_screen"]);

const nextStatusForManualProgress = (status: StepStatus): StepStatus => {
  if (status === "not_started") return "in_progress";
  if (status === "in_progress") return "complete";
  if (status === "complete") return "not_started";
  return "in_progress";
};

const toDisplayLabel = (value: string) => value.replace(/_/g, " ");

const normalizeApplicability = (step: OnboardingStep): StepApplicability => {
  if (step.applicability === "required" || step.applicability === "not_required" || step.applicability === "pending") {
    return step.applicability;
  }
  return "required";
};

const RecruiterOnboarding: React.FC = () => {
  const { tenantId } = useAuth();
  const [searchParams] = useSearchParams();
  const pipelineIdFromUrl = searchParams.get("pipelineId") || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OnboardingPipelineRow[]>([]);
  const [employmentByPipelineId, setEmploymentByPipelineId] = useState<Record<string, EntityEmploymentRecord>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string>("");
  const [workflowNote, setWorkflowNote] = useState<{ pipelineId: string; stepId: string; workflowStatus: StepWorkflowStatus } | null>(null);
  const [workflowNoteValue, setWorkflowNoteValue] = useState("");
  const [expandedMilestones, setExpandedMilestones] = useState<Record<string, boolean>>({});

  const [manualUserId, setManualUserId] = useState("");
  const [manualEntityId, setManualEntityId] = useState("");
  const [manualJobOrderId, setManualJobOrderId] = useState("");
  const [manualResult, setManualResult] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = collection(db, "tenants", tenantId, "worker_onboarding");
    const q = query(ref, orderBy("updatedAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          })) as OnboardingPipelineRow[]
        );
        setLoading(false);
      },
      (err) => {
        setError(err.message || "Failed to load onboarding pipelines");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId]);

  const activeRows = useMemo(() => {
    const incomplete = rows.filter((row) => String(row.status || "").toLowerCase() !== "complete");
    if (!entityFilter) return incomplete;
    return incomplete.filter((row) => (row.entityKey || "").toLowerCase() === entityFilter.toLowerCase());
  }, [rows, entityFilter]);

  const entityKeys = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const k = (r.entityKey || "").toLowerCase();
      if (k) set.add(k);
    });
    return Array.from(set).sort();
  }, [rows]);

  useEffect(() => {
    if (!tenantId || rows.length === 0) {
      setEmploymentByPipelineId({});
      return;
    }
    const incomplete = rows.filter((row) => String(row.status || "").toLowerCase() !== "complete");
    const filtered = entityFilter ? incomplete.filter((row) => (row.entityKey || "").toLowerCase() === entityFilter.toLowerCase()) : incomplete;
    const ids = filtered.map((r) => r.id);
    if (ids.length === 0) {
      setEmploymentByPipelineId({});
      return;
    }
    const load = async () => {
      const out: Record<string, EntityEmploymentRecord> = {};
      await Promise.all(
        ids.slice(0, 50).map(async (id) => {
          const ref = doc(db, p.entityEmployment(tenantId, id));
          const snap = await getDoc(ref);
          if (snap.exists()) {
            out[id] = { id: snap.id, ...(snap.data() as Omit<EntityEmploymentRecord, "id">) };
          }
        })
      );
      setEmploymentByPipelineId(out);
    };
    load();
  }, [tenantId, entityFilter, rows.map((r) => r.id).slice(0, 30).join(",")]);

  const updateStepStatus = async (pipelineId: string, step: OnboardingStep) => {
    if (!tenantId) return;
    const key = `${pipelineId}__${step.id}`;
    try {
      setSavingKey(key);
      const callable = httpsCallable(functions, "updateWorkerOnboardingStepStatus");
      await callable({
        tenantId,
        pipelineId,
        stepId: step.id,
        status: nextStatusForManualProgress(step.status),
      });
    } catch (err: any) {
      setError(err?.message || "Failed to update onboarding step");
    } finally {
      setSavingKey(null);
    }
  };

  const triggerManualPipeline = async () => {
    if (!tenantId || !manualUserId.trim()) return;
    try {
      setSavingKey("manual_trigger");
      setManualResult(null);
      const callable = httpsCallable(functions, "triggerWorkerOnboardingPipeline");
      const result = await callable({
        tenantId,
        userId: manualUserId.trim(),
        entityId: manualEntityId.trim() || null,
        jobOrderId: manualJobOrderId.trim() || null,
      });
      const payload = result.data as { pipelineId?: string; created?: boolean };
      setManualResult(
        payload?.pipelineId
          ? `Pipeline ${payload.pipelineId} ${payload.created ? "created" : "updated"}.`
          : "Pipeline trigger completed."
      );
    } catch (err: any) {
      setError(err?.message || "Manual onboarding trigger failed");
    } finally {
      setSavingKey(null);
    }
  };

  const updateStepPackage = async (pipelineId: string, stepId: string, packageId: string | null, packageLabel: string | null) => {
    if (!tenantId) return;
    const key = `${pipelineId}__${stepId}_pkg`;
    try {
      setSavingKey(key);
      const callable = httpsCallable(functions, "updateWorkerOnboardingStepPackage");
      await callable({ tenantId, pipelineId, stepId, packageId, packageLabel });
    } catch (err: any) {
      setError(err?.message || "Failed to update step package");
    } finally {
      setSavingKey(null);
    }
  };

  const updateStepWorkflow = async (pipelineId: string, stepId: string, workflowStatus: StepWorkflowStatus, note?: string, failureReason?: string) => {
    if (!tenantId) return;
    const key = `${pipelineId}__${stepId}_wf`;
    try {
      setSavingKey(key);
      setWorkflowNote(null);
      setWorkflowNoteValue("");
      const callable = httpsCallable(functions, "updateWorkerOnboardingStepWorkflow");
      await callable({ tenantId, pipelineId, stepId, workflowStatus, note: note || null, failureReason: failureReason || null });
    } catch (err: any) {
      setError(err?.message || "Failed to update step workflow");
    } finally {
      setSavingKey(null);
    }
  };

  const openWorkflowNote = (pipelineId: string, stepId: string, workflowStatus: StepWorkflowStatus) => {
    setWorkflowNote({ pipelineId, stepId, workflowStatus });
    setWorkflowNoteValue("");
  };

  const submitWorkflowNote = () => {
    if (!workflowNote) return;
    updateStepWorkflow(
      workflowNote.pipelineId,
      workflowNote.stepId,
      workflowNote.workflowStatus,
      workflowNoteValue,
      ["failed", "blocked"].includes(workflowNote.workflowStatus) ? workflowNoteValue : undefined
    );
  };

  const updateMilestone = async (pipelineId: string, stepId: string, milestoneId: string, completed: boolean) => {
    if (!tenantId) return;
    const key = `${pipelineId}__${stepId}__${milestoneId}`;
    try {
      setSavingKey(key);
      const callable = httpsCallable(functions, "updateWorkerOnboardingStepMilestone");
      await callable({ tenantId, pipelineId, stepId, milestoneId, completed });
    } catch (err: any) {
      setError(err?.message || "Failed to update milestone");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          New Hires / Onboarding
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Track onboarding progress by worker and entity. Manual step updates are enabled for launch v1.
        </Typography>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {manualResult ? <Alert severity="success">{manualResult}</Alert> : null}

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Trigger onboarding manually
              </Typography>
              <TextField
                label="Worker UID"
                value={manualUserId}
                onChange={(e) => setManualUserId(e.target.value)}
                size="small"
              />
              <TextField
                label="Entity ID (optional)"
                value={manualEntityId}
                onChange={(e) => setManualEntityId(e.target.value)}
                size="small"
              />
              <TextField
                label="Job Order ID (optional)"
                value={manualJobOrderId}
                onChange={(e) => setManualJobOrderId(e.target.value)}
                size="small"
              />
              <Button
                variant="contained"
                onClick={triggerManualPipeline}
                disabled={!manualUserId.trim() || savingKey === "manual_trigger"}
              >
                {savingKey === "manual_trigger" ? "Triggering..." : "Trigger onboarding"}
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Entity</InputLabel>
              <Select
                value={entityFilter}
                label="Entity"
                onChange={(e) => setEntityFilter(e.target.value)}
              >
                <MenuItem value="">All</MenuItem>
                {entityKeys.map((k) => (
                  <MenuItem key={k} value={k}>{k}</MenuItem>
                ))}
              </Select>
            </FormControl>

        {loading ? (
          <Box sx={{ py: 6, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {activeRows.length === 0 ? (
              <Alert severity="info">No active onboarding pipelines found.</Alert>
            ) : null}
            {activeRows.map((row) => {
              const employment = employmentByPipelineId[row.id];
              const steps = row.steps || [];
              const completeCount = steps.filter((s) => s.status === "complete").length;
              const progressLabel = `${completeCount} / ${steps.length} steps`;
              return (
                <Card key={row.id} variant="outlined">
                  <CardContent>
                    <Stack spacing={1.5}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {row.userName || row.userId}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {row.entityName || "Entity"} · {row.entityKey || "—"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {row.userId}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                          <Chip
                            label={employment?.status ?? "onboarding"}
                            color={employment?.status === "active" ? "success" : employment?.status === "terminated" ? "error" : "warning"}
                            size="small"
                          />
                          <Chip label={employment?.workerType ?? "—"} size="small" variant="outlined" />
                          <Chip label={progressLabel} size="small" variant="outlined" />
                          {(row.assignmentIds?.length || 0) > 0 && (
                            <Chip label="Assignment linked" color="success" size="small" variant="outlined" />
                          )}
                        </Stack>
                      </Stack>
                      <Divider />
                      {steps.map((step) => {
                        const key = `${row.id}__${step.id}`;
                        const keyPkg = `${row.id}__${step.id}_pkg`;
                        const keyWf = `${row.id}__${step.id}_wf`;
                        const applicability = normalizeApplicability(step);
                        const isBg = step.id === "background_check";
                        const isDrug = step.id === "drug_screen";
                        const packages = isBg ? DUMMY_BACKGROUND_PACKAGES : isDrug ? DUMMY_DRUG_PACKAGES : [];
                        const hasMilestones = Array.isArray(step.milestones) && step.milestones.length > 0;
                        const milestoneKey = `${row.id}__${step.id}_m`;
                        const milestonesOpen = expandedMilestones[milestoneKey];
                        return (
                          <Box key={step.id} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                            <Stack spacing={1}>
                              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                                <Typography variant="body2" fontWeight={600}>{step.title}</Typography>
                                <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                                  {step.selectedPackageLabel && (
                                    <Chip label={step.selectedPackageLabel} size="small" color="primary" sx={{ fontWeight: 600 }} />
                                  )}
                                  <Chip
                                    label={toDisplayLabel(step.workflowStatus || step.status)}
                                    color={WORKFLOW_STATUS_COLOR[step.workflowStatus || ""] || STATUS_COLOR[step.status]}
                                    size="small"
                                  />
                                  <Chip label={toDisplayLabel(applicability)} color={APPLICABILITY_COLOR[applicability]} size="small" variant="outlined" />
                                </Stack>
                              </Stack>
                              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                                {packages.length > 0 && (
                                  <FormControl size="small" sx={{ minWidth: 140 }}>
                                    <Select
                                      value={step.selectedPackageId || ""}
                                      displayEmpty
                                      disabled={savingKey === keyPkg}
                                      onChange={(e) => {
                                        const id = e.target.value as string;
                                        const pkg = packages.find((p) => p.id === id);
                                        updateStepPackage(row.id, step.id, id || null, pkg?.label ?? null);
                                      }}
                                    >
                                      <MenuItem value="">Select package</MenuItem>
                                      {packages.map((p) => (
                                        <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                )}
                                {WORKFLOW_ACTIONS.map((action) => (
                                  <Button
                                    key={action.value}
                                    size="small"
                                    variant={action.value === "complete" ? "contained" : "outlined"}
                                    disabled={savingKey === keyWf}
                                    onClick={() => {
                                      if (["skipped", "blocked", "failed"].includes(action.value)) {
                                        openWorkflowNote(row.id, step.id, action.value);
                                      } else {
                                        updateStepWorkflow(row.id, step.id, action.value);
                                      }
                                    }}
                                  >
                                    {action.label}
                                  </Button>
                                ))}
                                <Button size="small" variant="outlined" onClick={() => updateStepStatus(row.id, step)} disabled={savingKey === key}>
                                  Cycle status
                                </Button>
                              </Stack>
                              {(step.workflowStatus === "skipped" || step.workflowStatus === "blocked" || step.workflowStatus === "failed") && (step.note || step.failureReason) && (
                                <Box sx={{ pl: 0.5, py: 0.5, bgcolor: "action.hover", borderRadius: 1, px: 1 }}>
                                  <Typography variant="caption" color="text.secondary" component="span" sx={{ fontWeight: 600 }}>Reason: </Typography>
                                  <Typography variant="caption" color="text.secondary" component="span">{step.failureReason || step.note}</Typography>
                                </Box>
                              )}
                              {hasMilestones && (
                                <>
                                  <Stack direction="row" alignItems="center" sx={{ pl: 0.5 }}>
                                    <IconButton size="small" onClick={() => setExpandedMilestones((p) => ({ ...p, [milestoneKey]: !p[milestoneKey] }))} aria-label={milestonesOpen ? "Collapse milestones" : "Expand milestones"}>
                                      {milestonesOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                    </IconButton>
                                    <Typography variant="caption" color="text.secondary" onClick={() => setExpandedMilestones((p) => ({ ...p, [milestoneKey]: !p[milestoneKey] }))} sx={{ cursor: "pointer" }}>
                                      Milestones ({step.milestones!.filter((m) => m.completed).length}/{step.milestones!.length})
                                    </Typography>
                                  </Stack>
                                  <Collapse in={milestonesOpen}>
                                    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ pl: 5, pt: 0.5, pb: 0.5, bgcolor: "action.selected", borderRadius: 1, mx: 0.5 }}>
                                      {step.milestones!.map((m) => (
                                        <Stack key={m.id} direction="row" alignItems="center">
                                          <Checkbox
                                            size="small"
                                            checked={m.completed}
                                            disabled={savingKey === `${row.id}__${step.id}__${m.id}`}
                                            onChange={(_, checked) => updateMilestone(row.id, step.id, m.id, checked)}
                                          />
                                          <Typography variant="caption">{m.label}</Typography>
                                        </Stack>
                                      ))}
                                    </Stack>
                                  </Collapse>
                                </>
                              )}
                            </Stack>
                          </Box>
                        );
                      })}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
        <Alert severity="info">
          Step applicability path is now reserved on each step as <code>steps[].applicability</code> with values <code>required</code>, <code>not_required</code>, and <code>pending</code>. If absent, UI defaults to <code>required</code>.
        </Alert>

        <Dialog open={!!workflowNote} onClose={() => setWorkflowNote(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Note / reason</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              multiline
              minRows={2}
              label={workflowNote && ["failed", "blocked"].includes(workflowNote.workflowStatus) ? "Failure / block reason" : "Note"}
              value={workflowNoteValue}
              onChange={(e) => setWorkflowNoteValue(e.target.value)}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setWorkflowNote(null)}>Cancel</Button>
            <Button variant="contained" onClick={submitWorkflowNote}>Submit</Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Box>
  );
};

export default RecruiterOnboarding;
