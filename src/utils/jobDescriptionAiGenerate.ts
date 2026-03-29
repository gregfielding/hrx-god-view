import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

export function extractClientNotesFromJobOrder(jobOrderData: Record<string, unknown> | null | undefined): string {
  if (!jobOrderData || typeof jobOrderData !== 'object') return '';
  const fromClient = jobOrderData.jobDescriptionFromClient;
  const orderDesc = jobOrderData.jobOrderDescription;
  const jd = jobOrderData.jobDescription;
  const a =
    (typeof fromClient === 'string' && fromClient.trim()) ||
    (typeof orderDesc === 'string' && orderDesc.trim()) ||
    (typeof jd === 'string' && jd.trim()) ||
    '';
  return a;
}

export async function resolveClientNotesForJobBoardAi(args: {
  tenantId: string;
  jobOrderId?: string;
  jobOrderData?: Record<string, unknown> | null;
  /** Extra instructions for AI when the post is not tied to a job order (or in addition to order notes when both exist). */
  jobDescriptionPrompt: string;
}): Promise<string> {
  const oid = (args.jobOrderId || '').trim();
  if (oid) {
    let notes = extractClientNotesFromJobOrder(args.jobOrderData ?? undefined);
    if (!notes && args.tenantId) {
      const snap = await getDoc(doc(db, 'tenants', args.tenantId, 'job_orders', oid));
      if (snap.exists()) {
        notes = extractClientNotesFromJobOrder(snap.data() as Record<string, unknown>);
      }
    }
    const extra = (args.jobDescriptionPrompt || '').trim();
    if (extra) {
      return notes ? `${notes}\n\n${extra}` : extra;
    }
    return notes;
  }
  return (args.jobDescriptionPrompt || '').trim();
}

export function buildJobDescriptionAiPayload(
  formData: Record<string, any>,
  jobOrderData: Record<string, any> | null | undefined,
  clientNotes: string
) {
  const scoping = jobOrderData?.deal?.stageData?.scoping || {};
  const compliance = scoping.compliance || {};
  return {
    jobTitle: formData.jobTitle || jobOrderData?.jobTitle,
    jobOrderName: formData.postTitle || jobOrderData?.jobOrderName,
    jobDescriptionFromClient: clientNotes,
    payRate: formData.payRate || jobOrderData?.payRate,
    zipCode: formData.zipCode || jobOrderData?.worksiteAddress?.zipCode,
    city: formData.city || jobOrderData?.worksiteAddress?.city,
    state: formData.state || jobOrderData?.worksiteAddress?.state,
    skills: formData.skills && formData.skills.length > 0 ? formData.skills : (scoping.skills || []),
    uniformRequirements:
      formData.uniformRequirements && formData.uniformRequirements.length > 0
        ? formData.uniformRequirements
        : (scoping.uniformRequirements || []),
    customUniformRequirements:
      formData.customUniformRequirements ||
      scoping.customUniformRequirements ||
      jobOrderData?.customUniformRequirements ||
      '',
    experienceRequired: scoping.experience || compliance.experience || jobOrderData?.experienceRequired || '',
    educationRequired: scoping.education || jobOrderData?.educationRequired || '',
    languages: formData.languages && formData.languages.length > 0 ? formData.languages : (scoping.languages || []),
    physicalRequirements:
      formData.physicalRequirements && formData.physicalRequirements.length > 0
        ? formData.physicalRequirements
        : (scoping.physicalRequirements || []),
    ppeRequirements:
      formData.requiredPpe && formData.requiredPpe.length > 0 ? formData.requiredPpe : (scoping.ppe || []),
    backgroundCheckPackages:
      formData.backgroundCheckPackages && formData.backgroundCheckPackages.length > 0
        ? formData.backgroundCheckPackages
        : (compliance.backgroundCheckPackages || []),
    drugScreeningPanels:
      formData.drugScreeningPanels && formData.drugScreeningPanels.length > 0
        ? formData.drugScreeningPanels
        : (compliance.drugScreeningPanels || []),
    additionalScreenings:
      formData.additionalScreenings && formData.additionalScreenings.length > 0
        ? formData.additionalScreenings
        : (compliance.additionalScreenings || []),
    licensesCerts:
      formData.licensesCerts && formData.licensesCerts.length > 0 ? formData.licensesCerts : (scoping.licensesCerts || []),
    eVerifyRequired: formData.eVerifyRequired || compliance.eVerify || jobOrderData?.eVerifyRequired || false,
    shiftType: formData.shift && formData.shift.length > 0 ? formData.shift : (jobOrderData?.shiftType || []),
    startDate: formData.startDate || '',
    endDate: formData.endDate || '',
    workersNeeded: formData.workersNeeded || jobOrderData?.workersNeeded || 1,
  };
}

export function buildJobDescriptionToggleStates(formData: Record<string, any>) {
  return {
    showPayRate: formData.showPayRate,
    showWorkersNeeded: formData.showWorkersNeeded,
    showStart: formData.showStart,
    showEnd: formData.showEnd,
    showSkills: formData.showSkills,
    showUniformRequirements: formData.showUniformRequirements,
    showPhysicalRequirements: formData.showPhysicalRequirements,
    showRequiredPpe: formData.showRequiredPpe,
    showLicensesCerts: formData.showLicensesCerts,
    showBackgroundChecks: formData.showBackgroundChecks,
    showDrugScreening: formData.showDrugScreening,
    showAdditionalScreenings: formData.showAdditionalScreenings,
    showLanguages: formData.showLanguages,
    showShift: formData.showShift,
    showExperience: formData.showExperience,
    showEducation: formData.showEducation,
  };
}

export async function generateJobDescriptionWithAi(args: {
  tenantId: string;
  formData: Record<string, any>;
  jobOrderData?: Record<string, any> | null;
}): Promise<string> {
  const { tenantId, formData } = args;
  let orderData = args.jobOrderData;
  const oid = (formData.jobOrderId || '').trim();
  if (oid && tenantId && !orderData) {
    const snap = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', oid));
    if (snap.exists()) {
      orderData = snap.data() as Record<string, any>;
    }
  }

  const clientNotes = await resolveClientNotesForJobBoardAi({
    tenantId,
    jobOrderId: formData.jobOrderId,
    jobOrderData: orderData,
    jobDescriptionPrompt: formData.jobDescriptionPrompt || '',
  });

  const dataForAI = buildJobDescriptionAiPayload(formData, orderData, clientNotes);
  const toggleStates = buildJobDescriptionToggleStates(formData);
  const generateFn = httpsCallable(functions, 'generateJobDescription');
  const result = await generateFn({ jobOrderData: dataForAI, toggleStates });
  const response = result.data as { jobDescription?: string; description?: string };
  return (response?.jobDescription || response?.description || '').trim();
}
