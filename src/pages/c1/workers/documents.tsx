/**
 * Documents — /c1/workers/documents
 * Worker-facing document hub: required docs (Work Eligibility, ID, etc.) and optional certifications.
 * Spec: HRX / C1 Worker Documents Page Spec (MUI)
 *
 * Fixed links: /c1/workers/profile (Job Readiness), /c1/jobs-board (Find Work)
 *
 * --- v2 wiring (existing system) ---
 * Found existing upload flow at:
 *   - Certifications: src/pages/UserProfile/components/LicensesAndCertsTab.tsx — uploadBytes to
 *     storage path users/${uid}/certifications/${certSlug}/${Date.now()}-${file.name}, then
 *     updateDoc(users/{uid}, { certifications: array })
 *   - Apply flow certs: src/components/apply/steps/RequirementsAcknowledgementStep.tsx — same
 *     path pattern, arrayUnion on users/{uid}.certifications
 * Found Firestore doc schema at: users/{uid} — workEligibility (boolean), resume (object),
 *   certifications (array of { name, fileUrl, fileName, uploadedAt, issuer?, expirationDate? })
 * Storage paths: users/${uid}/certifications/${certSlug}/${timestamp}-${fileName}; avatars/${uid}.jpg
 * Next wiring step: connect WorkerDocumentCard Upload/Replace to same upload flow (e.g. reuse
 *   LicensesAndCertsTab upload logic or extract shared uploadWorkerDocument({ uid, docType, file })).
 * TODO v2: useWorkerDocuments(uid), listenToDocumentStatus(uid), status mapping from user doc.
 */

import React, { useState, useMemo } from 'react';
import { Box, Stack, Typography, Button, Alert, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import WorkerDocumentsSummary from '../../../components/worker/documents/WorkerDocumentsSummary';
import WorkerDocumentsRequired from '../../../components/worker/documents/WorkerDocumentsRequired';
import WorkerDocumentsOptional from '../../../components/worker/documents/WorkerDocumentsOptional';
import type { WorkerDocumentItem } from '../../../components/worker/documents/WorkerDocumentCard';
import type { SummaryStatus } from '../../../components/worker/documents/WorkerDocumentsSummary';

// ——— v1: Mock data. v2: Replace with real data from users/{uid}. ———
// TODO v2: useWorkerDocuments(uid) — read workEligibility, resume, certifications from users/{uid}.
// TODO v2: Map to requiredDocs (Work Eligibility from workEligibility boolean; ID/I-9 from future doc or placeholder; Resume from resume object).
// TODO v2: Certifications from user.certifications array; status mapping from existing schema (verified = has fileUrl and optionally admin-verified flag if exists).
function useMockDocuments(): {
  requiredDocs: WorkerDocumentItem[];
  optionalDocs: WorkerDocumentItem[];
  summary: { eligibilityStatus: SummaryStatus; idStatus: SummaryStatus; certCount: number };
} {
  return useMemo(() => {
    const requiredDocs: WorkerDocumentItem[] = [
      { key: 'workEligibility', label: 'Work Eligibility', status: 'missing' },
      { key: 'governmentId', label: 'Government ID', status: 'submitted' },
      { key: 'resume', label: 'Resume', status: 'verified', fileUrl: '#' },
    ];
    const optionalDocs: WorkerDocumentItem[] = [];
    const summary = {
      eligibilityStatus: 'missing' as SummaryStatus,
      idStatus: 'submitted' as SummaryStatus,
      certCount: 0,
    };
    return { requiredDocs, optionalDocs, summary };
  }, []);
}

const WorkerDocuments: React.FC = () => {
  const navigate = useNavigate();
  const { requiredDocs, optionalDocs, summary } = useMockDocuments();
  const [comingSoonOpen, setComingSoonOpen] = useState(false);

  const hasMissingRequired = requiredDocs.some((d) => d.status === 'missing');

  const handleUpload = (key: string) => {
    // v1: no-op; v2: open existing upload flow or modal (e.g. connect to LicensesAndCertsTab / WorkEligibility / resume upload)
    setComingSoonOpen(true);
  };

  const handleReplace = (key: string) => {
    setComingSoonOpen(true);
  };

  const handleView = (key: string, fileUrl: string) => {
    if (fileUrl && fileUrl !== '#') window.open(fileUrl, '_blank');
  };

  const handleAddCertification = () => {
    // v2: open add certification flow (reuse LicensesAndCertsTab dialog or extract shared component)
    setComingSoonOpen(true);
  };

  const scrollToRequired = () => {
    document.getElementById('worker-docs-required')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto' }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        {/* Section 1 — Header */}
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
              Upload required documents to unlock more shifts.
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

        {/* Section 2 — Shift Ready Summary */}
        <WorkerDocumentsSummary
          eligibilityStatus={summary.eligibilityStatus}
          idStatus={summary.idStatus}
          certCount={summary.certCount}
          backgroundLabel="—"
        />

        {/* Section 3 — Action Required Banner */}
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

        {/* Section 4 — Required Documents */}
        <div id="worker-docs-required">
          <WorkerDocumentsRequired
            requiredDocs={requiredDocs}
            onUpload={handleUpload}
            onReplace={handleReplace}
            onView={handleView}
          />
        </div>

        {/* Section 5 — Optional (Certifications) */}
        <WorkerDocumentsOptional
          optionalDocs={optionalDocs}
          onAddCertification={handleAddCertification}
          onReplace={handleReplace}
          onView={handleView}
        />
      </Stack>

      {/* v1: Coming soon dialog. v2: Replace with real upload modal. */}
      <Dialog open={comingSoonOpen} onClose={() => setComingSoonOpen(false)}>
        <DialogTitle>Coming soon</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Document upload will be connected here. We’ll use the same upload flow as your profile documents.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComingSoonOpen(false)}>OK</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkerDocuments;
