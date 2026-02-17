import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Chip,
  Stack,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Security as SecurityIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';

interface AssignmentRequirementsCardProps {
  userId: string;
  tenantId: string;
}

interface Assignment {
  id: string;
  jobOrderId: string;
  status: string;
  startDate?: string;
  endDate?: string;
  onboardingInstanceId?: string | null;
  onboardingStatus?: string;
  onboardingPercent?: number;
}

interface OnboardingInstance {
  status: string;
  percentComplete: number;
  resolvedDocuments: Array<{ key: string; title?: string; required?: boolean; blocking?: boolean; mode?: string }>;
  resolvedSteps: Array<{ key: string; title?: string; required?: boolean; blocking?: boolean }>;
  resolvedChecks: Array<{ key: string; title?: string; required?: boolean; blocking?: boolean }>;
  blockedReason?: string | null;
}

interface JobOrder {
  id: string;
  jobOrderName?: string;
  jobTitle?: string;
  companyName?: string;
  worksiteName?: string;
  uniformRequirements?: string;
  checkInInstructions?: string;
  backgroundCheckRequired?: boolean;
  drugScreenRequired?: boolean;
  requiredLicenses?: string[];
  requiredCertifications?: string[];
  ppeRequirements?: string;
  additionalTrainingRequired?: string;
}

const AssignmentRequirementsCard: React.FC<AssignmentRequirementsCardProps> = ({
  userId,
  tenantId,
}) => {
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [jobOrders, setJobOrders] = useState<Map<string, JobOrder>>(new Map());
  const [onboardingByAssignment, setOnboardingByAssignment] = useState<Map<string, OnboardingInstance>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAssignmentRequirements();
  }, [userId, tenantId]);

  const loadAssignmentRequirements = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch active assignments for this user (tenant-scoped)
      const assignmentsQuery = query(
        collection(db, 'tenants', tenantId, 'assignments'),
        where('userId', '==', userId)
      );
      const assignmentsSnapshot = await getDocs(assignmentsQuery);

      const fetchedAssignments: Assignment[] = [];
      const jobOrderIds = new Set<string>();
      const onboardingInstanceIds: string[] = [];

      assignmentsSnapshot.forEach((snap) => {
        const data = snap.data();
        const assignment: Assignment = {
          id: snap.id,
          jobOrderId: data.jobOrderId,
          status: data.status || 'active',
          startDate: data.startDate,
          endDate: data.endDate,
          onboardingInstanceId: data.onboardingInstanceId ?? null,
          onboardingStatus: data.onboardingStatus,
          onboardingPercent: data.onboardingPercent ?? 0,
        };
        fetchedAssignments.push(assignment);
        if (assignment.jobOrderId) {
          jobOrderIds.add(assignment.jobOrderId);
        }
        if (assignment.onboardingInstanceId) {
          onboardingInstanceIds.push(assignment.onboardingInstanceId);
        }
      });

      setAssignments(fetchedAssignments);

      // Fetch onboarding instances for assignments that have onboardingInstanceId
      const onboardingMap = new Map<string, OnboardingInstance>();
      await Promise.all(
        onboardingInstanceIds.map(async (instanceId) => {
          try {
            const instRef = doc(db, 'tenants', tenantId, 'onboarding_instances', instanceId);
            const instSnap = await getDoc(instRef);
            if (instSnap.exists()) {
              const d = instSnap.data();
              onboardingMap.set(instanceId, {
                status: d.status || 'unknown',
                percentComplete: d.percentComplete ?? 0,
                resolvedDocuments: Array.isArray(d.resolvedDocuments) ? d.resolvedDocuments : [],
                resolvedSteps: Array.isArray(d.resolvedSteps) ? d.resolvedSteps : [],
                resolvedChecks: Array.isArray(d.resolvedChecks) ? d.resolvedChecks : [],
                blockedReason: d.blockedReason ?? null,
              });
            }
          } catch {
            /* ignore */
          }
        })
      );
      setOnboardingByAssignment(onboardingMap);

      // Fetch job orders for these assignments (try job_orders first, then recruiter_jobOrders)
      const jobOrdersMap = new Map<string, JobOrder>();
      await Promise.all(
        Array.from(jobOrderIds).map(async (jobOrderId) => {
          try {
            let jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
            let jobOrderSnap = await getDoc(jobOrderRef);
            if (!jobOrderSnap.exists()) {
              jobOrderRef = doc(db, 'tenants', tenantId, 'recruiter_jobOrders', jobOrderId);
              jobOrderSnap = await getDoc(jobOrderRef);
            }
            if (jobOrderSnap.exists()) {
              const data = jobOrderSnap.data();
              jobOrdersMap.set(jobOrderId, {
                id: jobOrderId,
                jobOrderName: data.jobOrderName || data.title || data.jobTitle,
                jobTitle: data.jobTitle,
                companyName: data.companyName,
                worksiteName: data.worksiteName,
                uniformRequirements: data.uniformRequirements,
                checkInInstructions: data.checkInInstructions,
                backgroundCheckRequired: data.backgroundCheckRequired,
                drugScreenRequired: data.drugScreenRequired,
                requiredLicenses: data.requiredLicenses || [],
                requiredCertifications: data.requiredCertifications || [],
                ppeRequirements: data.ppeRequirements,
                additionalTrainingRequired: data.additionalTrainingRequired,
              });
            }
          } catch (err) {
            console.warn(`Could not load job order ${jobOrderId}:`, err);
          }
        })
      );

      setJobOrders(jobOrdersMap);
    } catch (err: any) {
      console.error('Error loading assignment requirements:', err);
      setError('Failed to load assignment requirements');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={100}>
            <CircularProgress size={24} />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Alert severity="error">{error}</Alert>
        </CardContent>
      </Card>
    );
  }

  if (assignments.length === 0) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardHeader
          title="Assignment Requirements"
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        />
        <CardContent>
          <Alert severity="info">
            No active assignments found. Requirements will appear here when the user is assigned to a job.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Group assignments by job order
  const assignmentsByJobOrder = new Map<string, Assignment[]>();
  assignments.forEach((assignment) => {
    if (!assignmentsByJobOrder.has(assignment.jobOrderId)) {
      assignmentsByJobOrder.set(assignment.jobOrderId, []);
    }
    assignmentsByJobOrder.get(assignment.jobOrderId)!.push(assignment);
  });

  return (
    <Card sx={{ mb: 3 }}>
      <CardHeader
        title="Assignment Requirements"
        titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
      />
      <CardContent>
        {Array.from(assignmentsByJobOrder.entries()).map(([jobOrderId, jobAssignments]) => {
          const jobOrder = jobOrders.get(jobOrderId);
          const assignmentWithOnboarding = jobAssignments.find((a) => a.onboardingInstanceId);
          const onboardingInstance = assignmentWithOnboarding?.onboardingInstanceId
            ? onboardingByAssignment.get(assignmentWithOnboarding.onboardingInstanceId)
            : null;

          if (!jobOrder) {
            return (
              <Alert severity="warning" key={jobOrderId} sx={{ mb: 2 }}>
                Job order {jobOrderId.substring(0, 8)}... not found
              </Alert>
            );
          }

          const hasAnyRequirements =
            jobOrder.uniformRequirements ||
            jobOrder.checkInInstructions ||
            jobOrder.backgroundCheckRequired ||
            jobOrder.drugScreenRequired ||
            (jobOrder.requiredLicenses && jobOrder.requiredLicenses.length > 0) ||
            (jobOrder.requiredCertifications && jobOrder.requiredCertifications.length > 0) ||
            jobOrder.ppeRequirements ||
            jobOrder.additionalTrainingRequired;

          return (
            <Box key={jobOrderId} sx={{ mb: 3 }}>
              {/* Job Order Header */}
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <AssignmentIcon color="primary" />
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {jobOrder.jobOrderName || jobOrder.jobTitle || 'Job Order'}
                  </Typography>
                  {jobOrder.companyName && (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      <BusinessIcon fontSize="small" color="action" />
                      <Typography variant="body2" color="text.secondary">
                        {jobOrder.companyName}
                      </Typography>
                    </Stack>
                  )}
                  {jobOrder.worksiteName && (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <LocationIcon fontSize="small" color="action" />
                      <Typography variant="body2" color="text.secondary">
                        {jobOrder.worksiteName}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              </Stack>

              {/* Onboarding instance (Phase 1A) — resolved documents, steps, checks */}
              {onboardingInstance && (
                <Box sx={{ mb: 2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Onboarding
                    </Typography>
                    <Chip
                      label={onboardingInstance.status}
                      size="small"
                      color={
                        onboardingInstance.status === 'completed'
                          ? 'success'
                          : onboardingInstance.status === 'blocked'
                            ? 'warning'
                            : 'default'
                      }
                    />
                    <Chip label={`${onboardingInstance.percentComplete}%`} size="small" variant="outlined" />
                  </Stack>
                  {onboardingInstance.blockedReason && (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      {onboardingInstance.blockedReason}
                    </Alert>
                  )}
                  {onboardingInstance.resolvedDocuments.length > 0 && (
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                        Documents
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {onboardingInstance.resolvedDocuments.map((d, i) => (
                          <Chip key={d.key || i} label={d.title || d.key} size="small" variant="outlined" />
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {onboardingInstance.resolvedSteps.length > 0 && (
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                        Steps
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {onboardingInstance.resolvedSteps.map((s, i) => (
                          <Chip key={s.key || i} label={s.title || s.key} size="small" variant="outlined" />
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {onboardingInstance.resolvedChecks.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                        Checks
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {onboardingInstance.resolvedChecks.map((c, i) => (
                          <Chip key={c.key || i} label={c.title || c.key} size="small" variant="outlined" />
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {onboardingInstance.resolvedDocuments.length === 0 &&
                    onboardingInstance.resolvedSteps.length === 0 &&
                    onboardingInstance.resolvedChecks.length === 0 &&
                    !onboardingInstance.blockedReason && (
                      <Typography variant="body2" color="text.secondary">
                        No documents, steps, or checks configured yet.
                      </Typography>
                    )}
                </Box>
              )}

              {!hasAnyRequirements && !onboardingInstance ? (
                <Alert severity="info" sx={{ mt: 1 }}>
                  No specific requirements listed for this assignment.
                </Alert>
              ) : hasAnyRequirements ? (
                <Box>
                  {/* Screening Requirements */}
                  {(jobOrder.backgroundCheckRequired || jobOrder.drugScreenRequired) && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                        Screening Requirements
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {jobOrder.backgroundCheckRequired && (
                          <Chip
                            icon={<SecurityIcon />}
                            label="Background Check Required"
                            color="primary"
                            variant="outlined"
                            size="small"
                          />
                        )}
                        {jobOrder.drugScreenRequired && (
                          <Chip
                            icon={<SecurityIcon />}
                            label="Drug Screen Required"
                            color="primary"
                            variant="outlined"
                            size="small"
                          />
                        )}
                      </Stack>
                    </Box>
                  )}

                  {/* Licenses & Certifications */}
                  {((jobOrder.requiredLicenses && jobOrder.requiredLicenses.length > 0) ||
                    (jobOrder.requiredCertifications && jobOrder.requiredCertifications.length > 0)) && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                        Required Licenses & Certifications
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {jobOrder.requiredLicenses?.map((license, idx) => (
                          <Chip key={`license-${idx}`} label={license} size="small" variant="outlined" />
                        ))}
                        {jobOrder.requiredCertifications?.map((cert, idx) => (
                          <Chip key={`cert-${idx}`} label={cert} size="small" variant="outlined" />
                        ))}
                      </Stack>
                    </Box>
                  )}

                  {/* Uniform Requirements */}
                  {jobOrder.uniformRequirements && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                        Uniform Requirements
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {jobOrder.uniformRequirements}
                      </Typography>
                    </Box>
                  )}

                  {/* PPE Requirements */}
                  {jobOrder.ppeRequirements && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                        PPE Requirements
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {jobOrder.ppeRequirements}
                      </Typography>
                    </Box>
                  )}

                  {/* Additional Training */}
                  {jobOrder.additionalTrainingRequired && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                        Additional Training Required
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {jobOrder.additionalTrainingRequired}
                      </Typography>
                    </Box>
                  )}

                  {/* Check-In Instructions */}
                  {jobOrder.checkInInstructions && (
                    <Box>
                      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                        Check-In Instructions
                      </Typography>
                      <Alert severity="info" icon={<InfoIcon />}>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                          {jobOrder.checkInInstructions}
                        </Typography>
                      </Alert>
                    </Box>
                  )}
                </Box>
              ) : null}

              {Array.from(assignmentsByJobOrder.entries()).length > 1 &&
                jobOrderId !== Array.from(assignmentsByJobOrder.keys())[assignmentsByJobOrder.size - 1] && (
                  <Divider sx={{ my: 3 }} />
                )}
            </Box>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default AssignmentRequirementsCard;

