/**
 * Documents v3 — /c1/workers/documents
 * Spec: HRX-Documents-Compliance-Scoring-v3
 *
 * Header: Compliance %, Expiring Soon, Expired (always visible).
 * Tabs: Compliance | Credentials | Job Files
 * - Compliance: checklist-driven (HRX + attestations); Everee refs hidden for v1.
 * - Credentials: resume + certifications (HRX).
 * - Job Files: read-only from Job Order Staff Instructions.
 */

import React, { useState, useMemo } from 'react';
import {
  Box,
  Stack,
  Typography,
  Button,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Container,
  Card,
  CardContent,
  Chip,
  Link,
  CircularProgress,
} from '@mui/material';
import { InsertDriveFile as FileIcon, OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import DocRecordCard from '../../../components/worker/documents/DocRecordCard';
import WorkerDocumentsSummary from '../../../components/worker/documents/WorkerDocumentsSummary';
import WorkerDocumentsRequired from '../../../components/worker/documents/WorkerDocumentsRequired';
import WorkerDocumentsOptional from '../../../components/worker/documents/WorkerDocumentsOptional';
import type { WorkerDocumentItem } from '../../../components/worker/documents/WorkerDocumentCard';
import type { SummaryStatus } from '../../../components/worker/documents/WorkerDocumentsSummary';
import type { OnboardingChecklist, OnboardingChecklistItem } from '../../../types/onboarding';
import { getDisplayStatus, parseExpiresAt } from '../../../utils/onboardingExpiration';
import { computeComplianceSummary } from '../../../utils/complianceSummary';
import { useAssignmentFiles } from '../../../hooks/useAssignmentFiles';
import { useWorkerCredentials } from '../../../hooks/useWorkerCredentials';
import { useOnboarding } from '../../../hooks/useOnboarding';
import { WORK_ELIGIBILITY_CHECKLIST_KEY, deriveWorkEligibilityFromAttestation } from '../../../types/workEligibility';

/** Human labels for checklist item keys */
const CHECKLIST_ITEM_LABELS: Record<string, string> = {
  everee_identity: 'Identity verification',
  everee_i9: 'I-9',
  direct_deposit: 'Direct deposit',
  driver_license: 'Driver license',
  resume: 'Resume',
  certifications: 'Certifications',
  [WORK_ELIGIBILITY_CHECKLIST_KEY]: 'Work Eligibility',
};

/** CTA label: attestation = "Review answers"; HRX docs = Upload/View/Replace. Everee items show no CTA for v1. */
function getCtaLabel(
  key: string,
  status: string,
  provider: 'everee' | 'hrx',
  kind?: 'document' | 'attestation'
): string {
  if (kind === 'attestation') return 'Review answers';
  if (provider === 'everee') return 'Not available yet';
  if (status === 'missing') return 'Upload';
  if (status === 'verified' || status === 'expiring_soon' || status === 'expired') return 'Replace';
  return 'View';
}

const WorkerDocuments: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { checklist, summary: complianceSummary, loading: onboardingLoading, hasOnboarding } = useOnboarding(user?.uid);
  const { files: assignmentFiles, loading: assignmentFilesLoading, error: assignmentFilesError } = useAssignmentFiles(user?.uid);
  const { data: credentials, loading: credentialsLoading } = useWorkerCredentials(user?.uid);

  const [tabIndex, setTabIndex] = useState(0);
  const [comingSoonOpen, setComingSoonOpen] = useState(false);

  // Required: only Resume (uploadable doc). Work Eligibility = attestation (Review answers); Gov ID hidden.
  const { requiredDocs, optionalDocs, summary } = useMemo(() => {
    const resumeStatus: SummaryStatus = credentials.resume ? 'verified' : 'missing';
    const requiredDocs: WorkerDocumentItem[] = [
      { key: 'resume', label: 'Resume', status: resumeStatus, fileUrl: credentials.resume?.downloadUrl ?? undefined },
    ];
    const optionalDocs: WorkerDocumentItem[] = [];
    const eligibilityStatus: SummaryStatus = credentials.workEligibility ? 'verified' : 'missing';
    return {
      requiredDocs,
      optionalDocs,
      summary: {
        eligibilityStatus,
        idStatus: 'submitted' as SummaryStatus,
        certCount: credentials.certCount,
        backgroundLabel: credentials.backgroundSummary,
      },
    };
  }, [credentials.resume, credentials.workEligibility, credentials.certCount, credentials.backgroundSummary]);

  /** Compliance checklist with work_eligibility merged in (provider=hrx, kind=attestation). */
  const complianceChecklistWithWorkEligibility = useMemo((): OnboardingChecklist => {
    const attestation = credentials.workEligibilityAttestation;
    const hasAttestation = attestation && attestation.attestedAt != null;
    const workEligibilityItem: OnboardingChecklistItem = {
      status: hasAttestation && deriveWorkEligibilityFromAttestation(attestation) ? 'verified' : 'missing',
      provider: 'hrx',
      kind: 'attestation',
    };
    return { ...checklist, [WORK_ELIGIBILITY_CHECKLIST_KEY]: workEligibilityItem };
  }, [checklist, credentials.workEligibilityAttestation]);

  const hasMissingRequired = requiredDocs.some((d) => d.status === 'missing');

  const handleOnboardingCta = (key: string, item: OnboardingChecklistItem) => {
    if (key === WORK_ELIGIBILITY_CHECKLIST_KEY && item.kind === 'attestation') {
      navigate('/c1/workers/profile#work-eligibility');
      return;
    }
    setComingSoonOpen(true);
  };

  const handleUpload = (key: string) => setComingSoonOpen(true);
  const handleReplace = (key: string) => setComingSoonOpen(true);
  const handleView = (key: string, fileUrl: string) => {
    if (fileUrl && fileUrl !== '#') window.open(fileUrl, '_blank');
  };
  const handleAddCertification = () => setComingSoonOpen(true);

  const scrollToRequired = () => {
    document.getElementById('worker-docs-required')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 2 }}>
      <Stack spacing={3}>
        {/* Page header */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          flexWrap="wrap"
          gap={2}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 600 }}>
              Documents
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Compliance, credentials, and job files.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="outlined" onClick={() => navigate('/c1/workers/profile')}>
              Job Readiness
            </Button>
            <Button variant="contained" onClick={() => navigate('/c1/jobs-board')}>
              Find Work
            </Button>
          </Stack>
        </Stack>

        {/* v3: Header — Compliance % only when checklist exists; else "Not started" */}
        <Card variant="outlined" sx={{ borderRadius: 2, boxShadow: 'none', overflow: 'visible' }}>
          <CardContent sx={{ py: 2, px: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" color="text.secondary">
                Compliance
              </Typography>
              {hasOnboarding && Object.keys(checklist).length > 0 ? (
                <>
                  <Chip
                    size="medium"
                    label={`${complianceSummary.compliancePercent}%`}
                    color={complianceSummary.compliancePercent === 100 ? 'success' : 'default'}
                    sx={{ fontWeight: 600 }}
                  />
                  {complianceSummary.expiringSoonCount > 0 && (
                    <Chip size="small" label={`${complianceSummary.expiringSoonCount} expiring soon`} color="warning" />
                  )}
                  {complianceSummary.expiredCount > 0 && (
                    <Chip size="small" label={`${complianceSummary.expiredCount} expired`} color="error" />
                  )}
                </>
              ) : (
                <Chip size="medium" label="Not started" color="default" sx={{ fontWeight: 600 }} />
              )}
            </Stack>
          </CardContent>
        </Card>

        <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
          <Tab label="Compliance" id="worker-docs-tab-0" />
          <Tab label="Credentials" id="worker-docs-tab-1" />
          <Tab label="Job Files" id="worker-docs-tab-2" />
        </Tabs>

        {/* Tab 1: Compliance — checklist-driven; empty state when no checklist */}
        {tabIndex === 0 && (
          <Stack spacing={2}>
            {!onboardingLoading && Object.keys(complianceChecklistWithWorkEligibility).length === 0 ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  Compliance checklist not available yet.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Your recruiter will request anything needed.
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">
                  Required compliance and onboarding items. Upload or complete items below. Expiration: &gt;30 days = verified, ≤30 days = expiring soon, past = expired.
                </Typography>
                <Stack spacing={1.5}>
                  {Object.entries(complianceChecklistWithWorkEligibility).map(([key, item]) => {
                    const expiresAt = parseExpiresAt(item.expiresAt ?? item.nextExpiringAt);
                    const displayStatus = getDisplayStatus(item.status, expiresAt);
                    const label = CHECKLIST_ITEM_LABELS[key] ?? key;
                    const ctaLabel = getCtaLabel(key, displayStatus, item.provider, item.kind);
                    const viewUrl = item.provider === 'everee' ? undefined : (item.viewUrl ?? (item.fileUrl ? '#' : undefined));
                    return (
                      <DocRecordCard
                        key={key}
                        label={label}
                        provider={item.provider}
                        status={displayStatus}
                        expiresAt={expiresAt ?? undefined}
                        viewUrl={viewUrl}
                        ctaLabel={ctaLabel}
                        onCta={() => handleOnboardingCta(key, item)}
                      />
                    );
                  })}
                </Stack>
              </>
            )}
          </Stack>
        )}

        {/* Tab 2: Credentials — Work eligibility from application; Resume; certs; Background = admin orders */}
        {tabIndex === 1 && (
          <Stack spacing={4}>
            {credentialsLoading ? (
              <Typography variant="body2" color="text.secondary">Loading…</Typography>
            ) : (
              <>
            <WorkerDocumentsSummary
              eligibilityStatus={summary.eligibilityStatus}
              idStatus={summary.idStatus}
              certCount={summary.certCount}
              backgroundLabel={summary.backgroundLabel}
              hideId
              eligibilityReviewHref="/c1/workers/profile#work-eligibility"
            />
            {hasMissingRequired && (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={scrollToRequired}>
                    Upload now
                  </Button>
                }
              >
                <strong>Action needed.</strong> Upload your required documents to become shift-ready.
              </Alert>
            )}
            <div id="worker-docs-required">
              <WorkerDocumentsRequired
                requiredDocs={requiredDocs}
                onUpload={handleUpload}
                onReplace={handleReplace}
                onView={handleView}
              />
            </div>
            <WorkerDocumentsOptional
              optionalDocs={optionalDocs}
              onAddCertification={handleAddCertification}
              onReplace={handleReplace}
              onView={handleView}
            />
            {/* Screening orders (from admin): show what was ordered + results when present */}
            {(credentials.backgroundCheckOrders.length > 0 || credentials.drugScreeningOrders.length > 0 || credentials.additionalScreeningOrders.length > 0 || credentials.eVerifyOrders.length > 0) && (
              <Card variant="outlined" sx={{ borderRadius: 2, boxShadow: 'none' }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                    Screening orders
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Ordered by your employer. Results appear here when updated.
                  </Typography>
                  <Stack spacing={0.5}>
                    {credentials.backgroundCheckOrders.map((o) => (
                      <Typography key={o.id} variant="body2">
                        Background: {o.typeLabel || o.type || 'Check'} — {o.status ?? '—'} {o.result ? `(${o.result})` : ''}
                      </Typography>
                    ))}
                    {credentials.drugScreeningOrders.map((o) => (
                      <Typography key={o.id} variant="body2">
                        Drug: {o.typeLabel || o.type || 'Panel'} — {o.status ?? '—'} {o.result ? `(${o.result})` : ''}
                      </Typography>
                    ))}
                    {credentials.additionalScreeningOrders.map((o) => (
                      <Typography key={o.id} variant="body2">
                        Other: {o.typeLabel || o.type || 'Screening'} — {o.status ?? '—'} {o.result ? `(${o.result})` : ''}
                      </Typography>
                    ))}
                    {credentials.eVerifyOrders.map((o) => (
                      <Typography key={o.id} variant="body2">
                        E-Verify — {o.status ?? '—'} {o.result ? `(${o.result})` : ''}
                      </Typography>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}
              </>
            )}
          </Stack>
        )}

        {/* Tab 3: Job Files — from Job Order Staff Instructions */}
        {tabIndex === 2 && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Read-only files from your job orders (Staff Instructions): first day materials, site maps, safety procedures, orientation packets.
            </Typography>
            {assignmentFilesError && (
              <Alert severity="warning">{assignmentFilesError}</Alert>
            )}
            {assignmentFilesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : assignmentFiles.length === 0 ? (
              <Alert severity="info">
                No assignment files yet. When recruiters add documents to a job order’s Staff Instructions (e.g. First Day Instructions), they’ll appear here for jobs you’ve applied to.
              </Alert>
            ) : (
              <Stack spacing={1.5}>
                {assignmentFiles.map((file, idx) => (
                  <Card key={idx} variant="outlined" sx={{ borderRadius: 2, boxShadow: 'none' }}>
                    <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
                        <FileIcon sx={{ color: 'action.active', fontSize: 22 }} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {file.fileLabel}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {file.jobOrderName} · {file.sectionLabel}
                          </Typography>
                        </Box>
                        <Link
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                        >
                          View
                          <OpenInNewIcon sx={{ fontSize: 16 }} />
                        </Link>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>

      <Dialog open={comingSoonOpen} onClose={() => setComingSoonOpen(false)}>
        <DialogTitle>Not available yet</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This action is not available yet. Your recruiter can request documents as needed.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComingSoonOpen(false)}>OK</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default WorkerDocuments;
