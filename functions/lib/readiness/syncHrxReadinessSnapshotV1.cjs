var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/readiness/syncHrxReadinessSnapshotV1.ts
var syncHrxReadinessSnapshotV1_exports = {};
__export(syncHrxReadinessSnapshotV1_exports, {
  recomputeHrxReadinessSnapshotForAssignment: () => recomputeHrxReadinessSnapshotForAssignment,
  syncHrxReadinessSnapshotV1: () => syncHrxReadinessSnapshotV1
});
module.exports = __toCommonJS(syncHrxReadinessSnapshotV1_exports);
var admin = __toESM(require("firebase-admin"));
var import_https = require("firebase-functions/v2/https");
var logger = __toESM(require("firebase-functions/logger"));

// ../src/shared/jobReadinessChip/labels.ts
var ASSIGNMENT_LABELS = {
  background_check: "Background check",
  drug_screen: "Drug screen",
  e_verify: "E-Verify",
  required_certification: "Required certification",
  cert_match: "Certification",
  license_match: "License",
  skill_match: "Skill",
  education_match: "Education",
  language_match: "Language",
  screening_package_match: "Screening package",
  orientation: "Orientation",
  ppe_acknowledgement: "PPE acknowledgement",
  safety_briefing: "Safety briefing",
  shift_confirmation: "Shift confirmation",
  physical_willingness: "Physical requirements",
  uniform_willingness: "Uniform requirements",
  ppe_willingness: "Required PPE",
  language_willingness: "Working language",
  custom: "Requirement"
};
var EMPLOYEE_JOB_LEVEL_LABELS = {
  background_check: "Background check",
  drug_screen: "Drug screen",
  e_verify: "E-Verify"
};
function jobReadinessChipLabelFor(source, requirementType, override) {
  const cleaned = (override ?? "").trim();
  if (cleaned.length > 0) return cleaned;
  if (source === "assignment") {
    return ASSIGNMENT_LABELS[requirementType] ?? "Requirement";
  }
  return EMPLOYEE_JOB_LEVEL_LABELS[requirementType] ?? "Requirement";
}
var EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES = /* @__PURE__ */ new Set([
  "background_check",
  "drug_screen",
  "e_verify"
]);

// ../src/shared/jobReadinessChip/computeJobReadinessChip.ts
var R1_DEPLOY_DATE_ISO = "2026-04-27T05:38:46.000Z";
var PASSING_STATUSES = /* @__PURE__ */ new Set([
  "complete_pass",
  "complete",
  // legacy
  "not_applicable"
]);
var FAILING_STATUSES = /* @__PURE__ */ new Set([
  "complete_fail"
]);
var NEEDS_REVIEW_STATUSES = /* @__PURE__ */ new Set([
  "needs_review"
]);
var EXPIRED_STATUSES = /* @__PURE__ */ new Set([
  "expired"
]);
var PENDING_STATUSES = /* @__PURE__ */ new Set([
  "incomplete",
  "in_progress",
  "blocked"
]);
function classifyContribution(args) {
  const { status, severity, resolutionMethod } = args;
  if (resolutionMethod === "csa_waived") {
    return { contribution: "green", detail: "Waived by recruiter" };
  }
  if (PASSING_STATUSES.has(status)) {
    return { contribution: "green", detail: "Satisfied" };
  }
  if (FAILING_STATUSES.has(status)) {
    return severity === "hard" ? { contribution: "red", detail: "Failed" } : { contribution: "yellow", detail: "Failed (soft requirement)" };
  }
  if (NEEDS_REVIEW_STATUSES.has(status)) {
    return severity === "hard" ? { contribution: "red", detail: "Needs review" } : { contribution: "yellow", detail: "Needs review (soft requirement)" };
  }
  if (EXPIRED_STATUSES.has(status)) {
    return severity === "hard" ? { contribution: "red", detail: "Expired" } : { contribution: "yellow", detail: "Expired (soft requirement)" };
  }
  if (PENDING_STATUSES.has(status)) {
    if (severity === "hard") {
      const detail2 = status === "in_progress" ? "In progress" : status === "blocked" ? "Blocked" : "Pending";
      return { contribution: "red", detail: detail2 };
    }
    const detail = resolutionMethod === "self_attest" ? "Worker has not answered yet" : status === "in_progress" ? "In progress" : "Pending";
    return { contribution: "yellow", detail };
  }
  return { contribution: "yellow", detail: "Unknown status" };
}
var CONTRIBUTION_RANK = {
  red: 0,
  yellow: 1,
  green: 2
};
function typeSortKey(t) {
  return String(t);
}
function compareContributors(a, b) {
  const tierDelta = CONTRIBUTION_RANK[a.contribution] - CONTRIBUTION_RANK[b.contribution];
  if (tierDelta !== 0) return tierDelta;
  const typeDelta = typeSortKey(a.requirementType).localeCompare(typeSortKey(b.requirementType));
  if (typeDelta !== 0) return typeDelta;
  return a.itemId.localeCompare(b.itemId);
}
function fromAssignmentItem(item) {
  const severity = item.severity ?? "soft";
  const resolutionMethod = item.resolutionMethod ?? null;
  const { contribution, detail } = classifyContribution({
    status: item.status,
    severity,
    resolutionMethod
  });
  return {
    source: "assignment",
    itemId: item.id,
    workerUid: item.workerUid,
    requirementType: item.requirementType,
    requirementLabel: jobReadinessChipLabelFor("assignment", item.requirementType, item.requirementLabel),
    contribution,
    status: item.status,
    resolutionMethod,
    severity,
    detail
  };
}
function fromEmployeeItem(item) {
  if (!EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES.has(item.requirementType)) return null;
  const severity = "hard";
  const resolutionMethod = null;
  let contribution;
  let detail;
  if (item.requirementType === "e_verify" && item.status === "in_progress") {
    contribution = "yellow";
    detail = "USCIS verifying";
  } else {
    const cls = classifyContribution({
      status: item.status,
      severity,
      resolutionMethod
    });
    contribution = cls.contribution;
    detail = cls.detail;
  }
  const requirementTypeCarriesCaseId = item.requirementType === "e_verify" || item.requirementType === "background_check" || item.requirementType === "drug_screen";
  const caseId = requirementTypeCarriesCaseId && typeof item.externalRef === "string" && item.externalRef.length > 0 ? item.externalRef : void 0;
  return {
    source: "employee",
    itemId: item.id,
    workerUid: item.workerUid,
    requirementType: item.requirementType,
    requirementLabel: jobReadinessChipLabelFor("employee", item.requirementType, item.requirementLabel),
    contribution,
    status: item.status,
    resolutionMethod,
    severity,
    detail,
    ...caseId ? { caseId } : {}
  };
}
function buildText(state, pendingCount) {
  switch (state) {
    case "computing":
      return "Job Ready (computing\u2026)";
    case "legacy_review":
      return "Legacy \u2014 needs review";
    case "red":
      return "Job Not Ready";
    case "yellow":
      return pendingCount > 0 ? `Job Ready (${pendingCount} pending)` : "Job Ready";
    case "green":
    default:
      return "Job Ready";
  }
}
function computeJobReadinessChip(args) {
  const contributors = [];
  for (const item of args.assignmentReadinessItems) {
    contributors.push(fromAssignmentItem(item));
  }
  for (const item of args.employeeReadinessItems) {
    const c = fromEmployeeItem(item);
    if (c) contributors.push(c);
  }
  if (contributors.length === 0) {
    if (!args.readinessSeeded) {
      if (typeof args.assignmentCreatedAtIso === "string" && args.assignmentCreatedAtIso < R1_DEPLOY_DATE_ISO) {
        return {
          state: "legacy_review",
          text: buildText("legacy_review", 0),
          pendingCount: 0,
          blockerCount: 0,
          contributors: []
        };
      }
      return {
        state: "computing",
        text: buildText("computing", 0),
        pendingCount: 0,
        blockerCount: 0,
        contributors: []
      };
    }
    return {
      state: "red",
      text: buildText("red", 0),
      pendingCount: 0,
      blockerCount: 0,
      contributors: []
    };
  }
  let blockerCount = 0;
  let pendingCount = 0;
  for (const c of contributors) {
    if (c.contribution === "red") blockerCount += 1;
    else if (c.contribution === "yellow") pendingCount += 1;
  }
  contributors.sort(compareContributors);
  let state;
  if (blockerCount > 0) state = "red";
  else if (pendingCount > 0) state = "yellow";
  else state = "green";
  return {
    state,
    text: buildText(state, pendingCount),
    pendingCount,
    blockerCount,
    contributors
  };
}

// ../src/shared/buildAssignmentReadiness.ts
function buildAssignmentReadiness({
  user,
  employment,
  assignment,
  screening,
  certifications,
  assignmentReadinessItems,
  employeeReadinessItems,
  readinessSeeded,
  assignmentCreatedAtIso
}) {
  const computeChip = assignmentReadinessItems !== void 0 && employeeReadinessItems !== void 0;
  const createdAtForChip = typeof assignmentCreatedAtIso === "string" && assignmentCreatedAtIso.length > 0 ? assignmentCreatedAtIso : void 0;
  if (!assignment?.id) {
    return {
      readiness: "PENDING_INITIALIZATION",
      requirements: [],
      summary: { blockers: 0, warnings: 0, completed: 0 },
      ...computeChip ? {
        jobReadinessChip: computeJobReadinessChip({
          assignmentReadinessItems: assignmentReadinessItems ?? [],
          employeeReadinessItems: employeeReadinessItems ?? [],
          readinessSeeded: Boolean(readinessSeeded),
          ...createdAtForChip ? { assignmentCreatedAtIso: createdAtForChip } : {}
        })
      } : {}
    };
  }
  const requirements = [];
  requirements.push({
    key: "work_authorization",
    label: "Work Authorization",
    category: "identity",
    severity: "hard_block",
    status: user?.workAuthorization ? "complete" : "missing"
  });
  requirements.push({
    key: "i9",
    label: "I-9 Form",
    category: "identity",
    severity: "hard_block",
    status: employment?.i9Complete ? "complete" : "missing"
  });
  const payrollInvite = Boolean(employment?.payrollInviteSent);
  const payrollComplete = Boolean(employment?.directDepositComplete);
  let payrollStatus = "missing";
  let payrollDetail;
  if (payrollComplete) {
    payrollStatus = "complete";
  } else if (payrollInvite) {
    payrollStatus = "in_progress";
    payrollDetail = "Invite sent, incomplete";
  }
  requirements.push({
    key: "payroll_setup",
    label: "Payroll Setup",
    category: "employment",
    severity: "warning",
    status: payrollStatus,
    detail: payrollDetail
  });
  requirements.push({
    key: "tax_form",
    label: "Tax Form",
    category: "employment",
    severity: "warning",
    status: employment?.taxFormComplete ? "complete" : "missing"
  });
  void employment?.handbookSigned;
  void employment?.policiesSigned;
  if (assignment.requiresBackgroundCheck) {
    let status = "missing";
    if (screening?.backgroundComplete) status = "complete";
    else if (screening?.backgroundOrdered) status = "in_progress";
    requirements.push({
      key: "background_check",
      label: "Background Check",
      category: "screening",
      severity: "warning",
      status
    });
  }
  if (assignment.requiresDrugScreen) {
    let status = "missing";
    if (screening?.drugScreenComplete) status = "complete";
    else if (screening?.drugScreenOrdered) status = "in_progress";
    requirements.push({
      key: "drug_screen",
      label: "Drug Screen",
      category: "screening",
      severity: "warning",
      status
    });
  }
  for (const c of certifications ?? []) {
    if (!c?.key || !c?.label) continue;
    requirements.push({
      key: `cert_${c.key}`,
      label: c.label,
      category: "certification",
      severity: "warning",
      status: c.complete ? "complete" : "missing"
    });
  }
  const hasBlocker = requirements.some((r) => r.severity === "hard_block" && r.status !== "complete");
  const hasWarnings = requirements.some((r) => r.severity === "warning" && r.status !== "complete");
  let readiness = "READY";
  if (hasBlocker) readiness = "BLOCKED";
  else if (hasWarnings) readiness = "READY_WITH_WARNINGS";
  return {
    readiness,
    requirements,
    summary: {
      blockers: requirements.filter((r) => r.severity === "hard_block" && r.status !== "complete").length,
      warnings: requirements.filter((r) => r.severity === "warning" && r.status !== "complete").length,
      completed: requirements.filter((r) => r.status === "complete").length
    },
    ...computeChip ? {
      jobReadinessChip: computeJobReadinessChip({
        assignmentReadinessItems: assignmentReadinessItems ?? [],
        employeeReadinessItems: employeeReadinessItems ?? [],
        readinessSeeded: Boolean(readinessSeeded),
        ...createdAtForChip ? { assignmentCreatedAtIso: createdAtForChip } : {}
      })
    } : {}
  };
}

// ../src/shared/readinessSnapshotV1.ts
var READINESS_SNAPSHOT_V1_SOURCE_VERSION = 1;
function buildReadinessSnapshotV1Comparable(result) {
  return {
    state: result.readiness,
    sourceVersion: READINESS_SNAPSHOT_V1_SOURCE_VERSION,
    summary: { ...result.summary },
    requirements: result.requirements.map(requirementToSnapshotRow),
    ...result.jobReadinessChip ? { jobReadinessChip: result.jobReadinessChip } : {}
  };
}
function requirementToSnapshotRow(r) {
  return {
    key: r.key,
    label: r.label,
    category: r.category,
    status: r.status,
    severity: r.severity
  };
}
function stableKeyReplacer(_key, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = value[k];
    }
    return sorted;
  }
  return value;
}
function readinessSnapshotV1ComparableJson(c) {
  return JSON.stringify(c, stableKeyReplacer);
}

// ../src/shared/readinessEntityResolve.ts
function deriveC1EntityKeyFromEntityName(rawName) {
  const v = String(rawName || "").toLowerCase();
  if (v.includes("select")) return "select";
  if (v.includes("event")) return "events";
  return "workforce";
}
function pipelineEntityKey(pipe, userId) {
  const fromField = String(pipe.entityKey || "").toLowerCase();
  if (fromField === "select" || fromField === "workforce" || fromField === "events") return fromField;
  const prefix = `${userId}__`;
  if (pipe.id.startsWith(prefix)) {
    const tail = pipe.id.slice(prefix.length).toLowerCase();
    if (tail === "select" || tail === "workforce" || tail === "events") return tail;
  }
  return null;
}
function employmentRecordEntityKey(rec, userId) {
  const k = String(rec.entityKey || "").toLowerCase();
  if (k === "select" || k === "workforce" || k === "events") return k;
  const prefix = `${userId}__`;
  if (rec.id.startsWith(prefix)) {
    const tail = rec.id.slice(prefix.length).toLowerCase();
    if (tail === "select" || tail === "workforce" || tail === "events") return tail;
  }
  return null;
}
function resolveAssignmentEntityKey(assignmentData, bundle) {
  const docEkRaw = String(assignmentData.entityKey || "").toLowerCase();
  if (docEkRaw === "select" || docEkRaw === "workforce" || docEkRaw === "events") {
    return docEkRaw;
  }
  const jobOrderId = assignmentData.jobOrderId;
  if (!jobOrderId?.trim()) return null;
  const jo = bundle.jobOrderById.get(jobOrderId.trim());
  const hid = String(jo?.effectiveHiringEntityId || jo?.hiringEntityId || "").trim() || null;
  if (!hid) return null;
  return bundle.entityIdToKey.get(hid) ?? null;
}
function hiringEntityIdForAssignment(assignmentData, bundle) {
  const joId = String(assignmentData.jobOrderId || "").trim() || null;
  if (!joId) return null;
  const jo = bundle.jobOrderById.get(joId);
  const hid = String(jo?.effectiveHiringEntityId || jo?.hiringEntityId || "").trim() || null;
  return hid || null;
}
function complianceItemRelevantToAssignment(item, ctx) {
  const md = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const mdJo = String(md.jobOrderId ?? md.job_order_id ?? "").trim();
  const mdAid = String(md.assignmentId ?? md.assignment_id ?? "").trim();
  if (mdAid && mdAid === ctx.assignmentId) return true;
  if (mdJo && ctx.jobOrderId && mdJo === ctx.jobOrderId) return true;
  const eid = String(item.employmentId ?? "").trim();
  if (eid && ctx.entityEmploymentId && eid === ctx.entityEmploymentId) return true;
  const ent = String(item.entityId ?? "").trim();
  if (ent && ctx.hiringEntityId && ent === ctx.hiringEntityId) return true;
  return false;
}

// ../src/utils/c1EntityWorkAuthorizationUi.ts
function deriveC1EntityKeyFromEntityName2(rawName) {
  const v = String(rawName || "").toLowerCase();
  if (v.includes("select")) return "select";
  if (v.includes("event")) return "events";
  return "workforce";
}
function resolveC1SelectEntityId(entities) {
  const byCode = entities.find((e) => (e.entityCode || "").trim().toUpperCase() === "C1SL");
  if (byCode) return byCode.id;
  const found = entities.find((e) => {
    const n = e.name.trim().toLowerCase();
    return n === "c1 select llc" || /^c1\s+select\b/i.test(e.name.trim());
  }) ?? null;
  return found?.id ?? null;
}

// ../src/utils/employmentEntityPresentation.ts
function defaultWorkerTypeForEntity(entityKey) {
  return entityKey === "events" ? "1099" : "w2";
}
function resolveEntityFirestoreIdForTab(entityKey, entityBrief, employmentForTab) {
  if (employmentForTab?.entityId) {
    const row = entityBrief.find((e) => e.id === employmentForTab.entityId);
    const name = row?.name || "";
    if (deriveC1EntityKeyFromEntityName2(name) === entityKey) {
      return employmentForTab.entityId;
    }
  }
  if (entityKey === "select") {
    return resolveC1SelectEntityId(
      entityBrief.map((e) => ({ id: e.id, name: e.name, entityCode: e.entityCode }))
    );
  }
  const found = entityBrief.find((e) => deriveC1EntityKeyFromEntityName2(e.name) === entityKey);
  return found?.id ?? null;
}

// ../src/types/externalOnboardingSteps.ts
var EXTERNAL_ONBOARDING_STEP_CATALOG = [
  {
    stepKey: "payroll_onboarding",
    displayLabel: "Confirm payroll setup",
    appliesTo: "both",
    defaultBlocking: true,
    adminVerificationRequired: true
  },
  {
    stepKey: "handbook_acknowledgment",
    displayLabel: "Sign handbook",
    appliesTo: "w2",
    defaultBlocking: true,
    adminVerificationRequired: true
  },
  {
    stepKey: "pto_acknowledgment",
    displayLabel: "Acknowledge PTO policy",
    appliesTo: "w2",
    defaultBlocking: false,
    adminVerificationRequired: true
  },
  {
    stepKey: "independent_contractor_agreement",
    displayLabel: "Sign contractor agreement",
    appliesTo: "1099",
    defaultBlocking: true,
    adminVerificationRequired: true
  },
  {
    stepKey: "direct_deposit",
    displayLabel: "Set up direct deposit",
    appliesTo: "both",
    defaultBlocking: true,
    adminVerificationRequired: true
  },
  {
    stepKey: "tax_withholding_forms",
    displayLabel: "Fill out tax forms",
    appliesTo: "w2",
    defaultBlocking: true,
    adminVerificationRequired: true
  },
  {
    stepKey: "contractor_tax_form_w9",
    displayLabel: "Complete W-9",
    appliesTo: "1099",
    defaultBlocking: true,
    adminVerificationRequired: true
  },
  {
    stepKey: "i9_employee_section",
    displayLabel: "Complete I-9",
    appliesTo: "w2",
    defaultBlocking: true,
    adminVerificationRequired: true
  },
  {
    stepKey: "policies_acknowledgment",
    displayLabel: "Sign policies",
    appliesTo: "both",
    defaultBlocking: true,
    adminVerificationRequired: true
  }
];
var EXTERNAL_ONBOARDING_STEP_KEYS = EXTERNAL_ONBOARDING_STEP_CATALOG.map((d) => d.stepKey);
var LEGACY_EXTERNAL_ONBOARDING_STEP_KEY_ALIASES = {
  policies_procedure_blog: "policies_acknowledgment",
  payroll_tax_forms: "tax_withholding_forms"
};
var EXTERNAL_ONBOARDING_STEP_LABELS = Object.fromEntries(EXTERNAL_ONBOARDING_STEP_CATALOG.map((d) => [d.stepKey, d.displayLabel]));

// ../src/utils/externalOnboardingSteps.ts
var VALID_SOURCES = /* @__PURE__ */ new Set(["tempworks"]);
var VALID_STATUS = /* @__PURE__ */ new Set([
  "not_started",
  "invite_sent",
  "worker_completed_external",
  "pending_admin_verification",
  "completed",
  "error"
]);
function tsToIso(v) {
  if (v == null) return null;
  if (typeof v.toDate === "function") {
    const d = v.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return null;
}
function isStepKey(k) {
  return EXTERNAL_ONBOARDING_STEP_KEYS.includes(k);
}
function resolveCanonicalExternalStepKey(rawKey) {
  if (isStepKey(rawKey)) return rawKey;
  const mapped = LEGACY_EXTERNAL_ONBOARDING_STEP_KEY_ALIASES[rawKey];
  return mapped ?? null;
}
function coerceRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const status = o.status;
  const externalSource = o.externalSource;
  if (typeof status !== "string" || !VALID_STATUS.has(status)) return null;
  if (typeof externalSource !== "string" || !VALID_SOURCES.has(externalSource)) {
    return null;
  }
  return {
    status,
    externalSource,
    inviteSentAt: o.inviteSentAt,
    workerMarkedCompleteAt: o.workerMarkedCompleteAt,
    verifiedBy: typeof o.verifiedBy === "string" ? o.verifiedBy : void 0,
    verifiedAt: o.verifiedAt,
    verificationNote: typeof o.verificationNote === "string" ? o.verificationNote : void 0,
    correctionRequestedAt: o.correctionRequestedAt,
    updatedAt: o.updatedAt,
    updatedBy: typeof o.updatedBy === "string" ? o.updatedBy : void 0
  };
}
function parseExternalOnboardingSteps(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const canon = resolveCanonicalExternalStepKey(k);
    if (!canon) continue;
    const row = coerceRecord(v);
    if (row) out[canon] = row;
  }
  return Object.keys(out).length ? out : void 0;
}
function isExternalOnboardingStepVerifiedComplete(record) {
  if (record.status !== "completed") return false;
  return tsToIso(record.verifiedAt) != null;
}
function normalizeWorkerTypeForExternalSteps(raw) {
  const s = String(raw ?? "").trim().toUpperCase().replace(/-/g, "");
  if (!s) return "unknown";
  if (s.includes("BOTH")) return "both";
  if (s === "1099" || s === "IC") return "1099";
  if (s === "W2" || s === "EMPLOYEE") return "w2";
  return "unknown";
}

// ../src/utils/employmentWorkerTypeResolution.ts
function resolveEffectiveEmploymentWorkerType(args) {
  const entity = args.entityWorkerType != null && String(args.entityWorkerType).trim() !== "" ? String(args.entityWorkerType).trim() : "";
  const employment = args.employmentWorkerType != null && String(args.employmentWorkerType).trim() !== "" ? String(args.employmentWorkerType).trim() : "";
  const rawEffective = entity || employment || null;
  const forSettingsCatalog = rawEffective || "W2";
  const normalizedExternal = normalizeWorkerTypeForExternalSteps(rawEffective ?? void 0);
  return { rawEffective, forSettingsCatalog, normalizedExternal };
}

// ../src/utils/employmentMinimalChecklistModel.ts
function coerceDate(v) {
  if (v == null) return null;
  if (typeof v.toDate === "function") {
    const d = v.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  return null;
}
function itemFromExternalRecord(rec) {
  if (!rec) return { completed: false };
  const completed = isExternalOnboardingStepVerifiedComplete(rec);
  if (!completed) return { completed: false };
  const completedAt = coerceDate(rec.verifiedAt) || coerceDate(rec.workerMarkedCompleteAt) || coerceDate(rec.updatedAt) || null;
  return { completed: true, completedAt };
}
function eeSectionComplete(ee, field) {
  const s = String(ee?.[field] ?? "").toLowerCase();
  return s === "complete";
}
function mergeExternalWithEeMirror(external, eeComplete, eeUpdatedAt) {
  if (external.completed) return external;
  if (!eeComplete) return { completed: false };
  return { completed: true, completedAt: coerceDate(eeUpdatedAt) };
}
function buildTaxIdentityChecklistItems(overview) {
  const raw = overview.workerOnboarding?.externalOnboardingSteps;
  const steps = parseExternalOnboardingSteps(raw) ?? {};
  const ee = overview.entityEmployment;
  const i9 = itemFromExternalRecord(steps.i9_employee_section);
  const is1099 = overview.workerType === "1099";
  const taxKey = is1099 ? "contractor_tax_form_w9" : "tax_withholding_forms";
  const taxExt = itemFromExternalRecord(steps[taxKey]);
  const taxLabel = is1099 ? "W-9" : "W-4";
  const w4OrW9 = {
    ...mergeExternalWithEeMirror(taxExt, eeSectionComplete(ee, "taxIdentityStatus"), ee?.updatedAt),
    taxLabel
  };
  return { i9, w4OrW9 };
}
function buildHandbookPoliciesItems(overview) {
  const raw = overview.workerOnboarding?.externalOnboardingSteps;
  const steps = parseExternalOnboardingSteps(raw) ?? {};
  const ee = overview.entityEmployment;
  const handbookExt = itemFromExternalRecord(steps.handbook_acknowledgment);
  const handbook = mergeExternalWithEeMirror(handbookExt, eeSectionComplete(ee, "handbookStatus"), ee?.updatedAt);
  const policies = itemFromExternalRecord(steps.policies_acknowledgment);
  return { handbook, policies };
}
function buildDirectDepositItem(overview) {
  const raw = overview.workerOnboarding?.externalOnboardingSteps;
  const steps = parseExternalOnboardingSteps(raw) ?? {};
  const ext = itemFromExternalRecord(steps.direct_deposit);
  if (ext.completed) return ext;
  const a = overview.workerPayrollAccount;
  const ps = String(a?.payrollStatus || "").toLowerCase();
  const dd = String(a?.directDepositStatus || "").toLowerCase();
  const fromAccount = ps === "complete" || dd === "complete" || dd === "completed" || Boolean(coerceDate(a?.payrollSetupCompletedAt));
  if (!fromAccount) return { completed: false };
  return { completed: true, completedAt: coerceDate(a?.payrollSetupCompletedAt) || coerceDate(a?.updatedAt) };
}
function aggregatePayrollFromAccounts(accounts) {
  let payrollInviteSent = false;
  let directDepositComplete = false;
  let taxFormComplete = false;
  for (const a of accounts) {
    const st = String(a.payrollStatus || "");
    if (["invite_sent", "account_created", "in_progress", "complete"].includes(st)) {
      payrollInviteSent = true;
    }
    if (a.inviteStatus === "sent" || a.inviteSentAt || a.payrollInviteSentAt) {
      payrollInviteSent = true;
    }
    if (st === "complete") {
      directDepositComplete = true;
    }
    const tfs = String(a.taxFormStatus || "").toLowerCase();
    if (tfs === "complete" || tfs === "submitted" || tfs === "verified") {
      taxFormComplete = true;
    }
    const dds = String(a.directDepositStatus || "").toLowerCase();
    if (dds === "complete" || dds === "verified") {
      directDepositComplete = true;
    }
  }
  return { payrollInviteSent, directDepositComplete, taxFormComplete };
}
function workerTypeForReadinessChecklist(entityWorkerTypeRaw, employmentWorkerType, entityKey) {
  const effective = resolveEffectiveEmploymentWorkerType({
    entityWorkerType: entityWorkerTypeRaw ?? null,
    employmentWorkerType: employmentWorkerType ?? null
  });
  const n = effective.normalizedExternal;
  if (n === "1099") return "1099";
  if (n === "w2") return "w2";
  return defaultWorkerTypeForEntity(entityKey);
}
function assignmentReadinessEmploymentFromPipeline(args) {
  const ee = args.entityEmployment;
  const empWt = ee && typeof ee === "object" && "workerType" in ee ? String(ee.workerType || "").trim() : "";
  const wt = workerTypeForReadinessChecklist(args.entityWorkerTypeRaw, empWt || null, args.entityKey);
  const overviewLike = {
    entityEmployment: ee,
    workerOnboarding: args.workerOnboarding,
    workerType: wt,
    workerPayrollAccount: args.workerPayrollAccount ?? null,
    everifyCaseBriefs: []
  };
  const { i9, w4OrW9 } = buildTaxIdentityChecklistItems(overviewLike);
  const { handbook, policies } = buildHandbookPoliciesItems({
    entityEmployment: ee,
    workerOnboarding: args.workerOnboarding
  });
  const directDeposit = buildDirectDepositItem(overviewLike);
  const payOne = aggregatePayrollFromAccounts(args.workerPayrollAccount ? [args.workerPayrollAccount] : []);
  return {
    i9Complete: i9.completed,
    taxFormComplete: w4OrW9.completed || payOne.taxFormComplete,
    payrollInviteSent: payOne.payrollInviteSent,
    directDepositComplete: directDeposit.completed || payOne.directDepositComplete,
    handbookSigned: handbook.completed,
    policiesSigned: policies.completed
  };
}

// ../src/types/payroll.ts
function workerPayrollAccountId(userId, entityKey) {
  return `${userId}__${entityKey}`;
}

// ../src/utils/workAuthorizedDisplay.ts
function getWorkAuthorizedStatus(user) {
  if (user == null || typeof user !== "object") return "skipped";
  const u = user;
  const attestation = u.workEligibilityAttestation;
  if (attestation != null && typeof attestation === "object" && typeof attestation.authorizedToWorkUS === "boolean") {
    if (attestation.authorizedToWorkUS) return "yes";
    if (typeof attestation.requireSponsorship === "boolean") return "no";
  }
  return "skipped";
}

// ../src/types/compliance.ts
var COMPLIANCE_ITEM_TYPES = [
  { type: "i9", category: "eligibility", label: "I-9", hasExpiration: false },
  { type: "everify", category: "eligibility", label: "E-Verify", hasExpiration: false },
  { type: "handbook_acknowledgment", category: "acknowledgment", label: "Handbook acknowledgment", hasExpiration: false },
  { type: "policy_acknowledgment", category: "acknowledgment", label: "Policy acknowledgment", hasExpiration: false },
  { type: "contractor_agreement", category: "acknowledgment", label: "Contractor agreement", hasExpiration: false },
  { type: "w4", category: "eligibility", label: "W-4", hasExpiration: false },
  { type: "w9", category: "eligibility", label: "W-9", hasExpiration: false },
  { type: "background_check", category: "screening", label: "Background check", hasExpiration: true },
  { type: "drug_screen", category: "screening", label: "Drug screen", hasExpiration: true },
  { type: "tb_test", category: "screening", label: "TB test", hasExpiration: true },
  { type: "drivers_license", category: "credential", label: "Driver's license", hasExpiration: true },
  { type: "work_permit", category: "credential", label: "Work permit", hasExpiration: true },
  { type: "food_handler", category: "credential", label: "Food handler card", hasExpiration: true },
  { type: "cpr_bls", category: "credential", label: "CPR / BLS", hasExpiration: true },
  { type: "forklift_certification", category: "credential", label: "Forklift certification", hasExpiration: true }
];
var TYPE_CONFIG_MAP = new Map(
  COMPLIANCE_ITEM_TYPES.map((c) => [c.type, c])
);
function getComplianceTypeConfig(type) {
  return TYPE_CONFIG_MAP.get(type);
}
function getComplianceTypeLabel(type) {
  return getComplianceTypeConfig(type)?.label ?? type;
}

// ../src/shared/assignmentScreeningSignals.ts
function hasNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}
function complianceField(jobOrder, key) {
  const c = jobOrder.compliance;
  if (!c || typeof c !== "object") return void 0;
  return c[key];
}
function mergeAssignmentScreeningFromJobOrder(assignment, jobOrder) {
  const jo = jobOrder ?? {};
  const joBg = Boolean(jo.backgroundCheckRequired ?? jo.showBackgroundChecks) || hasNonEmptyArray(jo.backgroundCheckPackages) || hasNonEmptyArray(complianceField(jo, "backgroundCheckPackages"));
  const joDrug = Boolean(jo.drugScreenRequired ?? jo.showDrugScreening) || hasNonEmptyArray(jo.drugScreeningPanels) || hasNonEmptyArray(complianceField(jo, "drugScreeningPanels"));
  const assignBg = Boolean(assignment.showBackgroundChecks ?? assignment.backgroundCheckRequired);
  const assignDrug = Boolean(assignment.drugScreenRequired ?? assignment.showDrugScreening);
  const bg = assignBg || joBg;
  const drug = assignDrug || joDrug;
  return {
    showBackgroundChecks: bg,
    backgroundCheckRequired: bg,
    drugScreenRequired: drug,
    showDrugScreening: drug
  };
}

// ../src/shared/jobOrderSyntheticCertificationDemands.ts
function normalizeCertRequirementToken(raw) {
  return String(raw || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function certLabelMatchesJobOrderRequirement(certLabel, requirementRaw) {
  const lab = normalizeCertRequirementToken(certLabel);
  const req = normalizeCertRequirementToken(requirementRaw);
  if (!lab || !req) return false;
  if (lab === req) return true;
  if (req.length >= 4 && (lab.includes(req) || req.includes(lab))) return true;
  return false;
}
var MAX_SLUG_LEN = 48;
function hash6(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = h * 31 + s.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 8);
}
function stableCertRequiredSlug(raw) {
  const s = String(raw || "").trim();
  if (!s) return "unknown";
  let slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  if (!slug) slug = `h_${hash6(s)}`;
  if (slug.length > MAX_SLUG_LEN) {
    slug = slug.slice(0, MAX_SLUG_LEN).replace(/_+$/g, "") || `h_${hash6(s)}`;
  }
  return slug;
}
function allocateSyntheticInnerKey(raw, usedInnerKeys) {
  const baseSlug = stableCertRequiredSlug(raw);
  for (let n = 0; n < 100; n += 1) {
    const piece = n === 0 ? baseSlug : `${baseSlug}_${n}`;
    const inner2 = `required_${piece}`;
    if (!usedInnerKeys.has(inner2)) return inner2;
  }
  const inner = `required_${baseSlug}_${hash6(raw)}`;
  return inner;
}
function mergeJobOrderSyntheticCertificationDemands(jobOrder, certifications) {
  if (!jobOrder) return certifications;
  const explicitIds = Array.isArray(jobOrder.requiredCertificationComplianceIds) ? jobOrder.requiredCertificationComplianceIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const labelStrings = [
    ...Array.isArray(jobOrder.requiredCertifications) ? jobOrder.requiredCertifications : [],
    ...Array.isArray(jobOrder.requiredLicenses) ? jobOrder.requiredLicenses : []
  ].map((x) => String(x || "").trim()).filter(Boolean);
  if (explicitIds.length === 0 && labelStrings.length === 0) return certifications;
  const out = [...certifications];
  const usedInnerKeys = new Set(
    out.map((c) => String(c.key || "").trim()).filter(Boolean)
  );
  function addSynthetic(displayLabel) {
    const inner = allocateSyntheticInnerKey(displayLabel, usedInnerKeys);
    if (usedInnerKeys.has(inner)) return;
    usedInnerKeys.add(inner);
    out.push({
      key: inner,
      label: displayLabel,
      complete: false
    });
  }
  const seenIds = /* @__PURE__ */ new Set();
  for (const id of explicitIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const hasRow = certifications.some((c) => c.key === id);
    if (!hasRow) addSynthetic(id);
  }
  const seenNormLabels = /* @__PURE__ */ new Set();
  for (const lab of labelStrings) {
    const hasRow = certifications.some((c) => certLabelMatchesJobOrderRequirement(c.label, lab));
    if (hasRow) continue;
    const norm = normalizeCertRequirementToken(lab);
    if (norm && seenNormLabels.has(norm)) continue;
    if (norm) seenNormLabels.add(norm);
    addSynthetic(lab);
  }
  return out;
}

// src/readiness/hrxReadinessSnapshotLoadContext.ts
function toIsoOrUndefined(v) {
  if (v == null) return void 0;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : void 0;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v).toISOString();
  }
  if (v instanceof Date) {
    return Number.isFinite(v.getTime()) ? v.toISOString() : void 0;
  }
  const obj = v;
  if (typeof obj?.toDate === "function") {
    try {
      const d = obj.toDate();
      return Number.isFinite(d.getTime()) ? d.toISOString() : void 0;
    } catch {
    }
  }
  if (typeof obj?.toMillis === "function") {
    try {
      const ms = obj.toMillis();
      return Number.isFinite(ms) ? new Date(ms).toISOString() : void 0;
    } catch {
    }
  }
  return void 0;
}
function screeningForAssignment(assignmentId, records) {
  const linked = records.filter((r) => String(r.automationAssignmentId || "") === assignmentId);
  if (!linked.length) return {};
  const bgComplete = linked.some(
    (r) => r.hrxStatus === "completed" || r.orderCompleted === true || r.finalReportReady === true
  );
  const bgOrdered = linked.some((r) => {
    const st = String(r.hrxStatus || "");
    return st && !["draft", "completed", "canceled"].includes(st);
  });
  const drugComplete = linked.some(
    (r) => r.drugReportReady === true || r.hrxStatus === "drug_report_ready"
  );
  const drugOrdered = linked.some((r) => {
    const pkg = String(r.requestedPackageName || "").toLowerCase();
    if (pkg.includes("drug")) return r.hrxStatus !== "completed" && r.hrxStatus !== "canceled";
    return r.drugReportReady === false && r.hrxStatus && !["draft", "completed", "canceled"].includes(String(r.hrxStatus));
  });
  return {
    backgroundComplete: bgComplete,
    backgroundOrdered: bgOrdered || bgComplete,
    drugScreenComplete: drugComplete,
    drugScreenOrdered: drugOrdered || drugComplete
  };
}
async function fetchJobOrderBrief(db, tenantId, jobOrderId, accountHiringCache) {
  try {
    let joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
    if (!joSnap.exists) {
      joSnap = await db.doc(`tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`).get();
    }
    if (!joSnap.exists) return null;
    const jd = joSnap.data();
    const joHiring = jd.hiringEntityId ?? null;
    const recAcc = String(jd.recruiterAccountId || "").trim() || null;
    let effective = joHiring;
    if (!effective && recAcc) {
      if (Object.prototype.hasOwnProperty.call(accountHiringCache, recAcc)) {
        effective = accountHiringCache[recAcc];
      } else {
        try {
          const accSnap = await db.doc(`tenants/${tenantId}/accounts/${recAcc}`).get();
          const hid = accSnap.exists ? String(accSnap.data().hiringEntityId || "").trim() || null : null;
          accountHiringCache[recAcc] = hid;
          effective = hid;
        } catch {
          accountHiringCache[recAcc] = null;
          effective = null;
        }
      }
    }
    return { hiringEntityId: joHiring, effectiveHiringEntityId: effective };
  } catch {
    return null;
  }
}
async function buildEntityBundleForAssignment(db, tenantId, workerUserId, assignmentData) {
  const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
  const entityBrief = entitiesSnap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, name: String(data.name || d.id), entityCode: String(data.entityCode || "") };
  });
  const entityIdToKey = /* @__PURE__ */ new Map();
  entityBrief.forEach((e) => {
    entityIdToKey.set(e.id, deriveC1EntityKeyFromEntityName(e.name));
  });
  const [eeSnap, woSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/entity_employments`).where("userId", "==", workerUserId).get(),
    db.collection(`tenants/${tenantId}/worker_onboarding`).where("userId", "==", workerUserId).get()
  ]);
  const employmentsByKey = {
    select: null,
    workforce: null,
    events: null
  };
  eeSnap.docs.forEach((d) => {
    const rec = { id: d.id, ...d.data() };
    const ek = employmentRecordEntityKey(rec, workerUserId);
    if (ek) employmentsByKey[ek] = rec;
  });
  const pipelinesByKey = {
    select: null,
    workforce: null,
    events: null
  };
  woSnap.docs.forEach((d) => {
    const pipe = { id: d.id, ...d.data() };
    const ek = pipelineEntityKey(pipe, workerUserId);
    if (ek) pipelinesByKey[ek] = pipe;
  });
  const jobOrderById = /* @__PURE__ */ new Map();
  const joId = String(assignmentData.jobOrderId || "").trim();
  const accountHiringCache = {};
  if (joId) {
    const brief = await fetchJobOrderBrief(db, tenantId, joId, accountHiringCache);
    if (brief) jobOrderById.set(joId, brief);
  }
  return {
    bundle: {
      entityIdToKey,
      employmentsByKey,
      pipelinesByKey,
      jobOrderById
    },
    entityBrief
  };
}
async function fetchJobOrderDataForReadiness(db, tenantId, jobOrderId) {
  try {
    let joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
    if (!joSnap.exists) {
      joSnap = await db.doc(`tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`).get();
    }
    if (!joSnap.exists) return null;
    return joSnap.data();
  } catch {
    return null;
  }
}
function assignmentInputFromDoc(id, data, jobOrder) {
  const parts = [
    data.shiftTitle,
    data.jobTitle,
    data.roleTitle,
    data.companyDisplayName,
    data.companyName,
    data.customerName
  ].map((x) => typeof x === "string" ? x.trim() : "").filter(Boolean);
  const name = parts[0] || "Assignment";
  const screening = mergeAssignmentScreeningFromJobOrder(data, jobOrder ?? null);
  return {
    id,
    name,
    status: String(data.status || data.assignmentStatus || data.confirmationStatus || "\u2014"),
    requiresBackgroundCheck: screening.showBackgroundChecks,
    requiresDrugScreen: screening.drugScreenRequired
  };
}
async function loadHrxReadinessBuildArgsAdmin(db, params) {
  const { tenantId, assignmentId } = params;
  const assignRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const assignSnap = await assignRef.get();
  if (!assignSnap.exists) return null;
  const a = assignSnap.data();
  const workerUserId = String(a.userId || a.candidateId || "").trim();
  if (!workerUserId) return null;
  const joId = String(a.jobOrderId || "").trim();
  const jobOrderData = joId ? await fetchJobOrderDataForReadiness(db, tenantId, joId) : null;
  const assignmentInput = assignmentInputFromDoc(assignmentId, a, jobOrderData);
  const [userSnap, complianceSnap, bgSnap] = await Promise.all([
    db.doc(`users/${workerUserId}`).get(),
    db.collection(`tenants/${tenantId}/worker_compliance_items`).where("userId", "==", workerUserId).limit(80).get(),
    db.collection("backgroundChecks").where("candidateId", "==", workerUserId).where("tenantId", "==", tenantId).limit(120).get()
  ]);
  const userData = userSnap.exists ? userSnap.data() : {};
  const userInput = { workAuthorization: getWorkAuthorizedStatus(userData) === "yes" };
  const { bundle: entityBundle, entityBrief } = await buildEntityBundleForAssignment(db, tenantId, workerUserId, a);
  const ek = resolveAssignmentEntityKey(a, entityBundle);
  const ee = ek ? entityBundle.employmentsByKey[ek] : null;
  const pipe = ek ? entityBundle.pipelinesByKey[ek] : null;
  let entityWorkerTypeRaw = null;
  let payrollAccount = null;
  if (ek) {
    const eid = resolveEntityFirestoreIdForTab(ek, entityBrief, ee ?? null);
    if (eid) {
      const es = await db.doc(`tenants/${tenantId}/entities/${eid}`).get();
      if (es.exists) {
        const w = String(es.data().workerType || "").trim();
        entityWorkerTypeRaw = w || null;
      }
    }
    const payId = workerPayrollAccountId(workerUserId, ek);
    const paySnap = await db.doc(`tenants/${tenantId}/worker_payroll_accounts/${payId}`).get();
    if (paySnap.exists) {
      payrollAccount = { id: paySnap.id, ...paySnap.data() };
    }
  }
  const employmentInput = ek != null ? assignmentReadinessEmploymentFromPipeline({
    entityKey: ek,
    entityEmployment: ee,
    workerOnboarding: pipe,
    entityWorkerTypeRaw,
    workerPayrollAccount: payrollAccount
  }) : {};
  const hiringEntityId = hiringEntityIdForAssignment(a, entityBundle);
  const jobOrderId = String(a.jobOrderId || "").trim() || null;
  const ctx = {
    assignmentId,
    jobOrderId,
    entityEmploymentId: ee?.id ?? null,
    hiringEntityId
  };
  const certificationsFromCompliance = complianceSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((row) => complianceItemRelevantToAssignment(row, ctx)).map((row) => {
    const st = String(row.status || "").toLowerCase();
    const legacyDone = Boolean(row.completed);
    const done = st === "complete" || st === "approved" || legacyDone;
    const title = String(row.title || "").trim();
    const label = title || getComplianceTypeLabel(String(row.type || ""));
    return { key: row.id, label, complete: done };
  });
  const certifications = mergeJobOrderSyntheticCertificationDemands(jobOrderData, certificationsFromCompliance);
  const bgRecords = bgSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const screening = screeningForAssignment(assignmentId, bgRecords);
  const [assignmentReadinessItemsSnap, employeeReadinessItemsSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/assignmentReadinessItems`).where("assignmentId", "==", assignmentId).get(),
    hiringEntityId ? db.collection(`tenants/${tenantId}/employeeReadinessItems`).where("workerUid", "==", workerUserId).where("hiringEntityId", "==", hiringEntityId).get() : Promise.resolve(null)
  ]);
  const assignmentReadinessItems = assignmentReadinessItemsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() })
  );
  const employeeReadinessItems = employeeReadinessItemsSnap ? employeeReadinessItemsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() })
  ) : [];
  const readinessSeededAt = a.readinessSeededAt;
  const readinessSeeded = Boolean(readinessSeededAt) || assignmentReadinessItems.length > 0;
  const assignmentCreatedAtIso = toIsoOrUndefined(a.createdAt);
  return {
    user: userInput,
    employment: employmentInput,
    assignment: assignmentInput,
    screening,
    certifications,
    assignmentReadinessItems,
    employeeReadinessItems,
    readinessSeeded,
    assignmentCreatedAtIso
  };
}

// src/readiness/syncHrxReadinessSnapshotV1.ts
function tryParseComparable(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  if (typeof o.state !== "string" || typeof o.sourceVersion !== "number") return null;
  const summary = o.summary;
  if (!summary || typeof summary !== "object") return null;
  const s = summary;
  if (typeof s.blockers !== "number" || typeof s.warnings !== "number" || typeof s.completed !== "number") {
    return null;
  }
  if (!Array.isArray(o.requirements)) return null;
  const chip = o.jobReadinessChip && typeof o.jobReadinessChip === "object" ? o.jobReadinessChip : void 0;
  return {
    state: o.state,
    sourceVersion: o.sourceVersion,
    summary: {
      blockers: s.blockers,
      warnings: s.warnings,
      completed: s.completed
    },
    requirements: o.requirements,
    ...chip ? { jobReadinessChip: chip } : {}
  };
}
async function recomputeHrxReadinessSnapshotForAssignment(db, tenantId, assignmentId) {
  const args = await loadHrxReadinessBuildArgsAdmin(db, { tenantId, assignmentId });
  if (!args) {
    return {
      skipped: true,
      missingAssignment: true,
      snapshot: {
        state: "PENDING_INITIALIZATION",
        sourceVersion: READINESS_SNAPSHOT_V1_SOURCE_VERSION,
        summary: { blockers: 0, warnings: 0, completed: 0 },
        requirements: []
      }
    };
  }
  const result = buildAssignmentReadiness(args);
  const nextComparable = buildReadinessSnapshotV1Comparable(result);
  const assignRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const cur = await assignRef.get();
  const existingRaw = cur.get("readinessSnapshotV1");
  const existingComparable = tryParseComparable(existingRaw);
  if (existingComparable && readinessSnapshotV1ComparableJson(existingComparable) === readinessSnapshotV1ComparableJson(nextComparable)) {
    logger.debug("readinessSnapshotV1 unchanged; skip write", { tenantId, assignmentId });
    return { skipped: true, missingAssignment: false, snapshot: nextComparable };
  }
  await assignRef.set(
    {
      readinessSnapshotV1: {
        ...nextComparable,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    },
    { merge: true }
  );
  logger.info("readinessSnapshotV1 written", { tenantId, assignmentId, state: nextComparable.state });
  return { skipped: false, missingAssignment: false, snapshot: nextComparable };
}
async function assertCanManageAssignmentsForTenant(auth, tenantId, uid) {
  const roles = auth?.token?.roles || {};
  const tenantRole = roles?.[tenantId]?.role;
  if (tenantRole && ["Recruiter", "Manager", "Admin"].includes(String(tenantRole))) return;
  if (auth?.token?.isHRX === true) return;
  const db = admin.firestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new import_https.HttpsError("permission-denied", "No permission to sync readiness for this tenant.");
  }
  const userData = userSnap.data() || {};
  const tenantMeta = userData.tenantIds?.[tenantId] || {};
  const role = String(tenantMeta.role || userData.role || "").trim().toLowerCase();
  if (["recruiter", "manager", "admin"].includes(role)) return;
  const recruiterEnabled = Boolean(tenantMeta.recruiter ?? userData.recruiter);
  if (recruiterEnabled) return;
  const secRaw = tenantMeta.securityLevel ?? userData.securityLevel ?? "0";
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 4) return;
  throw new import_https.HttpsError("permission-denied", "No permission to sync readiness for this tenant.");
}
var syncHrxReadinessSnapshotV1 = (0, import_https.onCall)(async (request) => {
  if (!request.auth?.uid) {
    throw new import_https.HttpsError("unauthenticated", "Authentication required.");
  }
  const tenantId = String(request.data?.tenantId || "").trim();
  const assignmentId = String(request.data?.assignmentId || "").trim();
  if (!tenantId || !assignmentId) {
    throw new import_https.HttpsError("invalid-argument", "tenantId and assignmentId are required.");
  }
  await assertCanManageAssignmentsForTenant(request.auth, tenantId, request.auth.uid);
  const db = admin.firestore();
  const { skipped, missingAssignment, snapshot } = await recomputeHrxReadinessSnapshotForAssignment(
    db,
    tenantId,
    assignmentId
  );
  if (missingAssignment) {
    throw new import_https.HttpsError("not-found", "Assignment not found or missing worker user id.");
  }
  return { skipped, snapshot };
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  recomputeHrxReadinessSnapshotForAssignment,
  syncHrxReadinessSnapshotV1
});
