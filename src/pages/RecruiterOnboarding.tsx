import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { useAuth } from "../contexts/AuthContext";

type StepStatus = "not_started" | "in_progress" | "complete" | "blocked";
type StepApplicability = "required" | "not_required" | "pending";

interface OnboardingStep {
  id: string;
  title: string;
  status: StepStatus;
  applicability?: StepApplicability;
}

interface OnboardingPipelineRow {
  id: string;
  userId: string;
  userName?: string;
  entityName?: string;
  status?: string;
  assignmentIds?: string[];
  steps?: OnboardingStep[];
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OnboardingPipelineRow[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);

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

  const activeRows = useMemo(
    () => rows.filter((row) => String(row.status || "").toLowerCase() !== "complete"),
    [rows]
  );

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

        {loading ? (
          <Box sx={{ py: 6, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {activeRows.length === 0 ? (
              <Alert severity="info">No active onboarding pipelines found.</Alert>
            ) : null}
            {activeRows.map((row) => (
              <Card key={row.id} variant="outlined">
                <CardContent>
                  <Stack spacing={1.25}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {row.userName || row.userId}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.entityName || "Entity"} - {row.userId}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                        <Chip
                          label={(row.assignmentIds?.length || 0) > 0 ? "Confirmed assignment" : "No assignment linked"}
                          color={(row.assignmentIds?.length || 0) > 0 ? "success" : "default"}
                          size="small"
                          variant={(row.assignmentIds?.length || 0) > 0 ? "filled" : "outlined"}
                        />
                        <Chip
                          label={String(row.status || "not_started").toLowerCase() === "complete" ? "Onboarding complete" : "Onboarding in progress"}
                          color={String(row.status || "").toLowerCase() === "complete" ? "success" : "warning"}
                          size="small"
                        />
                        {(() => {
                          const criticalSteps = (row.steps || []).filter((step) => CRITICAL_STEP_IDS.has(step.id));
                          const blockedCritical = criticalSteps.some((step) => step.status === "blocked");
                          const pendingCriticalCount = criticalSteps.filter(
                            (step) => normalizeApplicability(step) !== "not_required" && step.status !== "complete"
                          ).length;
                          if (blockedCritical) {
                            return <Chip label="Blocked critical step" color="error" size="small" />;
                          }
                          if (pendingCriticalCount > 0) {
                            return <Chip label={`${pendingCriticalCount} critical pending`} color="warning" size="small" variant="outlined" />;
                          }
                          return null;
                        })()}
                      </Stack>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Pipelines are assignment-linked and entity-specific. Critical step status is surfaced for launch operations.
                    </Typography>
                    <Divider />
                    <Stack spacing={0.75}>
                      {(row.steps || []).map((step) => {
                        const key = `${row.id}__${step.id}`;
                        const applicability = normalizeApplicability(step);
                        return (
                          <Stack
                            key={step.id}
                            direction="row"
                            justifyContent="space-between"
                            alignItems="center"
                            spacing={1}
                          >
                            <Typography variant="body2">{step.title}</Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Chip
                                label={toDisplayLabel(applicability)}
                                color={APPLICABILITY_COLOR[applicability]}
                                size="small"
                                variant="outlined"
                              />
                              <Chip label={toDisplayLabel(step.status)} color={STATUS_COLOR[step.status]} size="small" />
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => updateStepStatus(row.id, step)}
                                disabled={savingKey === key}
                              >
                                {savingKey === key ? "Saving..." : "Update"}
                              </Button>
                            </Stack>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
        <Alert severity="info">
          Step applicability path is now reserved on each step as <code>steps[].applicability</code> with values <code>required</code>, <code>not_required</code>, and <code>pending</code>. If absent, UI defaults to <code>required</code>.
        </Alert>
      </Stack>
    </Box>
  );
};

export default RecruiterOnboarding;
