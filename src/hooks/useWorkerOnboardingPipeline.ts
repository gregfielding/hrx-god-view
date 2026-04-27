import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { everifyUiAppliesToEntityKey } from "../utils/c1EntityWorkAuthorizationUi";

export type WorkerOnboardingTaskStatus = "missing" | "in_progress" | "complete" | "recommended";
export type WorkerOnboardingTaskPriority = "required" | "high_impact" | "optional";

export interface WorkerOnboardingTask {
  id: string;
  stepId: string;
  title: string;
  benefit: string;
  status: WorkerOnboardingTaskStatus;
  priority: WorkerOnboardingTaskPriority;
}

interface WorkerOnboardingTaskRow {
  id: string;
  stepId?: string;
  owner?: "worker" | "recruiter";
  title?: string;
  status?: "pending" | "in_progress" | "complete";
}

interface WorkerOnboardingPipelineDoc {
  id: string;
  status?: string;
  entityName?: string;
  entityKey?: string;
  tasks?: WorkerOnboardingTaskRow[];
  updatedAt?: unknown;
}

const TASK_BENEFITS: Record<string, string> = {
  worker_i9: "Required before your onboarding can be finalized.",
  worker_forms: "Completing forms keeps your start process moving.",
  worker_drug_screen: "This is often required to keep assignment eligibility active.",
};

const TASK_PRIORITY: Record<string, WorkerOnboardingTaskPriority> = {
  worker_i9: "required",
  worker_forms: "required",
  worker_drug_screen: "high_impact",
};

function toTaskStatus(status: WorkerOnboardingTaskRow["status"]): WorkerOnboardingTaskStatus {
  if (status === "complete") return "complete";
  if (status === "in_progress") return "in_progress";
  if (status === "pending") return "missing";
  return "recommended";
}

export function useWorkerOnboardingPipeline(uid: string | undefined, tenantId: string | undefined) {
  const [pipelines, setPipelines] = useState<WorkerOnboardingPipelineDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid || !tenantId) {
      setPipelines([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const ref = collection(db, "tenants", tenantId, "worker_onboarding");
    const q = query(ref, where("userId", "==", uid));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as WorkerOnboardingPipelineDoc[];
        setPipelines(rows);
        setLoading(false);
      },
      () => {
        setPipelines([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [uid, tenantId]);

  const tasks = useMemo(() => {
    const workerTasks: WorkerOnboardingTask[] = [];
    pipelines.forEach((pipeline) => {
      const pipelineStatus = String(pipeline.status || "").toLowerCase();
      if (pipelineStatus === "complete") return;
      const entityKey = String(pipeline.entityKey || "").toLowerCase();
      const entityLabel = pipeline.entityName || "this entity";
      const taskRows = Array.isArray(pipeline.tasks) ? pipeline.tasks : [];
      taskRows
        .filter((task) => task.owner === "worker")
        .filter((task) => task.status !== "complete")
        .filter((task) => {
          if (task.stepId !== "e_verify") return true;
          return everifyUiAppliesToEntityKey(entityKey);
        })
        .forEach((task) => {
          workerTasks.push({
            id: `${pipeline.id}__${task.id}`,
            stepId: task.stepId || "",
            title: task.title || "Complete onboarding task",
            benefit: TASK_BENEFITS[task.id] || `Required to complete onboarding for ${entityLabel}.`,
            status: toTaskStatus(task.status),
            priority: TASK_PRIORITY[task.id] || "required",
          });
        });
    });
    return workerTasks;
  }, [pipelines]);

  return {
    pipelines,
    tasks,
    loading,
    hasActivePipeline: pipelines.some((p) => String(p.status || "").toLowerCase() !== "complete"),
  };
}
