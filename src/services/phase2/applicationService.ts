import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  collectionGroup,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Application, ApplicationFormData, ApplicationFilters, ApplicationSortOptions } from '../../types/phase2';
import { safeToDate } from '../../utils/dateUtils';
import type { ApplicationHiringLifecycle } from '../../types/applicationHiringLifecycle';

import {
  applyHiringLifecycleTimestampMetadata,
  buildHiringLifecycleOnApplicationCreate,
  buildHiringLifecycleOnStageUpdate,
} from '../../shared/hiringLifecyclePatch';
import {
  firestoreSafeHiringLifecycle,
  hiringLifecycleCoreFromApplicationData,
} from '../../utils/hiringLifecycleFirestoreHelpers';

/** Optional inputs for dual-writing `hiringLifecycle` on create (defaults are conservative). */
export type TenantApplicationLifecycleWriteOptions = {
  aiPrescreenInterviewRequired?: boolean;
  profileEligible?: boolean;
  profileBlockerCodes?: string[];
  workerAiPrescreenInterviewCompletedAt?: unknown | null;
};

/**
 * Sprint 3: canonical Firestore payload for new job-linked applications at
 * `tenants/{tenantId}/applications`. Include `candidate.email` and `candidate.phone` whenever
 * the form provides non-empty values (triggers and recruiters rely on them when present).
 */
export function buildJobLinkedTenantApplicationCreatePayload(
  tenantId: string,
  formData: ApplicationFormData,
  createdBy: string,
  lifecycleOptions?: TenantApplicationLifecycleWriteOptions,
): Omit<Application, 'id'> {
  const jo = String(formData.jobOrderId || '').trim();
  if (!jo) {
    throw new Error('jobOrderId is required for job-linked tenant applications');
  }

  const emailRaw = typeof formData.candidate?.email === 'string' ? formData.candidate.email.trim() : '';
  const phoneRaw = typeof formData.candidate?.phone === 'string' ? formData.candidate.phone.trim() : '';

  const candidate: Application['candidate'] = {
    ...formData.candidate,
    firstName: String(formData.candidate.firstName || '').trim(),
    lastName: String(formData.candidate.lastName || '').trim(),
  };
  if (emailRaw) {
    candidate.email = emailRaw;
  }
  if (phoneRaw) {
    candidate.phone = phoneRaw;
  }

  const now = serverTimestamp();
  const base: Omit<Application, 'id'> = {
    ...formData,
    tenantId,
    jobOrderId: jo,
    candidate,
    stageChangedAt: now,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy,
  };

  const uid = typeof formData.userId === 'string' ? formData.userId.trim() : '';
  if (uid) {
    (base as Application & { userId?: string }).userId = uid;
  }
  const candId = typeof formData.candidateId === 'string' ? formData.candidateId.trim() : '';
  if (candId) {
    (base as Application & { candidateId?: string }).candidateId = candId;
  }
  const jobId = formData.jobId != null && String(formData.jobId).trim() ? String(formData.jobId).trim() : '';
  if (jobId) {
    (base as Application & { jobId?: string }).jobId = jobId;
  }
  const postId = formData.postId != null && String(formData.postId).trim() ? String(formData.postId).trim() : '';
  if (postId) {
    (base as Application & { postId?: string }).postId = postId;
  }
  const shiftId = formData.shiftId != null && String(formData.shiftId).trim() ? String(formData.shiftId).trim() : '';
  if (shiftId) {
    (base as Application & { shiftId?: string }).shiftId = shiftId;
  }
  if (Array.isArray(formData.shiftIds) && formData.shiftIds.length > 0) {
    const ids = formData.shiftIds.map((x) => String(x).trim()).filter(Boolean);
    if (ids.length) {
      (base as Application & { shiftIds?: string[] }).shiftIds = ids;
    }
  }
  if (Array.isArray(formData.selectedShifts) && formData.selectedShifts.length > 0) {
    (base as Application & { selectedShifts?: unknown[] }).selectedShifts = formData.selectedShifts;
  }

  const { hiringLifecycle: hlCore } = buildHiringLifecycleOnApplicationCreate({
    applicationStatus: String(formData.status ?? 'applied'),
    aiPrescreenInterviewRequired: lifecycleOptions?.aiPrescreenInterviewRequired ?? false,
    profileEligible: lifecycleOptions?.profileEligible ?? true,
    profileBlockerCodes: lifecycleOptions?.profileBlockerCodes,
    workerAiPrescreenInterviewCompletedAt: lifecycleOptions?.workerAiPrescreenInterviewCompletedAt,
  });
  const hiringLifecycleFull = applyHiringLifecycleTimestampMetadata({
    core: hlCore,
    previous: null,
    nowIso: new Date().toISOString(),
  });

  return {
    ...base,
    hiringLifecycle: firestoreSafeHiringLifecycle(hiringLifecycleFull) as ApplicationHiringLifecycle,
  };
}

export class ApplicationService {
  private static instance: ApplicationService;

  public static getInstance(): ApplicationService {
    if (!ApplicationService.instance) {
      ApplicationService.instance = new ApplicationService();
    }
    return ApplicationService.instance;
  }

  /**
   * Create a new application (standalone or job-linked). Job-linked creates use tenant `applications` only (Sprint 3).
   */
  async createApplication(
    tenantId: string,
    formData: ApplicationFormData,
    createdBy: string,
    lifecycleOptions?: TenantApplicationLifecycleWriteOptions,
  ): Promise<string> {
    try {
      let docRef;
      if (formData.jobOrderId) {
        const payload = buildJobLinkedTenantApplicationCreatePayload(tenantId, formData, createdBy, lifecycleOptions);
        docRef = await addDoc(collection(db, 'tenants', tenantId, 'applications'), payload);
      } else {
        const { hiringLifecycle: hlCore } = buildHiringLifecycleOnApplicationCreate({
          applicationStatus: String(formData.status ?? 'applied'),
          aiPrescreenInterviewRequired: lifecycleOptions?.aiPrescreenInterviewRequired ?? false,
          profileEligible: lifecycleOptions?.profileEligible ?? true,
          profileBlockerCodes: lifecycleOptions?.profileBlockerCodes,
          workerAiPrescreenInterviewCompletedAt: lifecycleOptions?.workerAiPrescreenInterviewCompletedAt,
        });
        const hiringLifecycleFull = applyHiringLifecycleTimestampMetadata({
          core: hlCore,
          previous: null,
          nowIso: new Date().toISOString(),
        });
        const applicationData: Omit<Application, 'id'> = {
          ...formData,
          tenantId,
          stageChangedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          createdBy,
          updatedAt: serverTimestamp(),
          updatedBy: createdBy,
          hiringLifecycle: firestoreSafeHiringLifecycle(hiringLifecycleFull) as ApplicationHiringLifecycle,
        };
        docRef = await addDoc(collection(db, 'tenants', tenantId, 'applications'), applicationData);
      }

      return docRef.id;
    } catch (error) {
      console.error('Error creating application:', error);
      throw error;
    }
  }

  /**
   * Update an existing application at `tenants/{tenantId}/applications/{applicationId}`.
   * `jobOrderId` is ignored (kept for call-site compatibility).
   */
  async updateApplication(
    tenantId: string,
    applicationId: string,
    updates: Partial<ApplicationFormData>,
    updatedBy: string,
    jobOrderId?: string
  ): Promise<void> {
    try {
      void jobOrderId;
      const applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      const snap = await getDoc(applicationRef);
      if (!snap.exists()) {
        throw new Error(`Application not found: ${applicationId}`);
      }

      const prevData = snap.data() as Record<string, unknown>;
      const payload: Record<string, unknown> = {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedBy,
      };
      if (updates.status !== undefined) {
        const prevCore = hiringLifecycleCoreFromApplicationData(prevData);
        const { hiringLifecycle: core } = buildHiringLifecycleOnStageUpdate({
          nextLegacyStatus: String(updates.status),
        });
        const full = applyHiringLifecycleTimestampMetadata({
          core,
          previous: prevCore,
          nowIso: new Date().toISOString(),
        });
        payload.hiringLifecycle = firestoreSafeHiringLifecycle(full);
      }

      await updateDoc(applicationRef, payload as DocumentData);
    } catch (error) {
      console.error('Error updating application:', error);
      throw error;
    }
  }

  /**
   * Update application stage at `tenants/{tenantId}/applications/{applicationId}`.
   * `jobOrderId` is ignored (kept for call-site compatibility).
   */
  async updateApplicationStage(
    tenantId: string,
    applicationId: string,
    newStage: Application['status'],
    updatedBy: string,
    jobOrderId?: string
  ): Promise<void> {
    try {
      void jobOrderId;
      const applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      const snap = await getDoc(applicationRef);
      if (!snap.exists()) {
        throw new Error(`Application not found: ${applicationId}`);
      }

      const prevData = snap.data() as Record<string, unknown>;
      const prevCore = hiringLifecycleCoreFromApplicationData(prevData);
      const { hiringLifecycle: core } = buildHiringLifecycleOnStageUpdate({
        nextLegacyStatus: String(newStage),
      });
      const full = applyHiringLifecycleTimestampMetadata({
        core,
        previous: prevCore,
        nowIso: new Date().toISOString(),
      });

      await updateDoc(applicationRef, {
        status: newStage,
        stageChangedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy,
        hiringLifecycle: firestoreSafeHiringLifecycle(full),
      });
    } catch (error) {
      console.error('Error updating application stage:', error);
      throw error;
    }
  }

  /**
   * Get application by id from `tenants/{tenantId}/applications/{applicationId}`.
   * `jobOrderId` is ignored (kept for call-site compatibility).
   */
  async getApplication(
    tenantId: string,
    applicationId: string,
    jobOrderId?: string
  ): Promise<Application | null> {
    try {
      void jobOrderId;
      const tenantRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      const tenantDoc = await getDoc(tenantRef);

      if (tenantDoc.exists()) {
        const data = tenantDoc.data() as Omit<Application, 'id'>;
        return { id: tenantDoc.id, ...data };
      }

      return null;
    } catch (error) {
      console.error('Error getting application:', error);
      throw error;
    }
  }

  /**
   * Get applications with filtering and sorting
   */
  async getApplications(
    tenantId: string,
    filters: ApplicationFilters = {},
    sortOptions: ApplicationSortOptions = { field: 'createdAt', direction: 'desc' },
    limitCount?: number
  ): Promise<Application[]> {
    try {
      let q = query(
        collectionGroup(db, 'applications'),
        where('tenantId', '==', tenantId)
      );

      if (filters.status) {
        q = query(q, where('status', '==', filters.status));
      }
      if (filters.jobOrderId) {
        q = query(q, where('jobOrderId', '==', filters.jobOrderId));
      }
      if (filters.source) {
        q = query(q, where('source', '==', filters.source));
      }
      if (filters.rating) {
        q = query(q, where('rating', '==', filters.rating));
      }

      const sortField = sortOptions.field === 'candidate.lastName' ? 'candidate.lastName' : sortOptions.field;
      q = query(q, orderBy(sortField, sortOptions.direction));

      if (limitCount) {
        q = query(q, limit(limitCount));
      }

      const querySnapshot = await getDocs(q);
      let applications = querySnapshot.docs.map((d) => {
        const data = d.data() as Omit<Application, 'id'>;
        return { id: d.id, ...data };
      });

      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        applications = applications.filter(
          (app) =>
            app.candidate.firstName.toLowerCase().includes(searchTerm) ||
            app.candidate.lastName.toLowerCase().includes(searchTerm) ||
            app.candidate.email?.toLowerCase().includes(searchTerm) ||
            app.notes?.toLowerCase().includes(searchTerm)
        );
      }

      if (filters.tags && filters.tags.length > 0) {
        applications = applications.filter(
          (app) => app.tags && filters.tags!.some((tag) => app.tags!.includes(tag))
        );
      }

      return applications;
    } catch (error) {
      console.error('Error getting applications:', error);
      throw error;
    }
  }

  /**
   * Job-linked applications for a job order: tenant `applications` only, `jobOrderId` equality + `createdAt` desc when indexed.
   */
  async getApplicationsByJobOrder(
    tenantId: string,
    jobOrderId: string,
    status?: Application['status']
  ): Promise<Application[]> {
    try {
      const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
      let snap;
      try {
        snap = await getDocs(
          query(applicationsRef, where('jobOrderId', '==', jobOrderId), orderBy('createdAt', 'desc')),
        );
      } catch {
        snap = await getDocs(query(applicationsRef, where('jobOrderId', '==', jobOrderId)));
      }

      let list: Application[] = snap.docs.map((d) => {
        const data = d.data() as Omit<Application, 'id'>;
        return { id: d.id, ...data };
      });

      if (status) {
        list = list.filter((a) => a.status === status);
      }

      list.sort((a, b) => {
        const ta = safeToDate((a as Application & { createdAt?: unknown }).createdAt)?.getTime() ?? 0;
        const tb = safeToDate((b as Application & { createdAt?: unknown }).createdAt)?.getTime() ?? 0;
        return tb - ta;
      });

      return list;
    } catch (error) {
      console.error('Error getting applications by job order:', error);
      throw error;
    }
  }

  /**
   * Delete application at `tenants/{tenantId}/applications/{applicationId}`.
   * `jobOrderId` is ignored (kept for call-site compatibility).
   */
  async deleteApplication(tenantId: string, applicationId: string, jobOrderId?: string): Promise<void> {
    try {
      void jobOrderId;
      const applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      const snap = await getDoc(applicationRef);
      if (!snap.exists()) {
        throw new Error(`Application not found: ${applicationId}`);
      }

      await deleteDoc(applicationRef);
    } catch (error) {
      console.error('Error deleting application:', error);
      throw error;
    }
  }

  /**
   * Get application statistics for a tenant
   */
  async getApplicationStats(tenantId: string): Promise<{
    total: number;
    byStatus: Record<Application['status'], number>;
    bySource: Record<string, number>;
  }> {
    try {
      const applications = await this.getApplications(tenantId);

      const stats = {
        total: applications.length,
        byStatus: {
          applied: 0,
          screening: 0,
          interview: 0,
          offer: 0,
          hired: 0,
          rejected: 0,
          withdrawn: 0,
        } as Record<Application['status'], number>,
        bySource: {} as Record<string, number>,
      };

      applications.forEach((app) => {
        stats.byStatus[app.status]++;
        if (app.source) {
          stats.bySource[app.source] = (stats.bySource[app.source] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      console.error('Error getting application stats:', error);
      throw error;
    }
  }
}

export const getApplicationService = (): ApplicationService => {
  return ApplicationService.getInstance();
};
