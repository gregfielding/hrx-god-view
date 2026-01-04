import React, { useEffect, useState } from 'react';
import { Box, Typography, Stack, Checkbox, Chip, Button, Tooltip, TextField } from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  LocationOn as LocationIcon,
  Contacts as ContactsIcon,
  People as PeopleIcon,
  Description as DescriptionIcon,
  Work as BriefcaseIcon,
} from '@mui/icons-material';
import { JobOrder } from '../../types/recruiter/jobOrder';
import type { JobsBoardPost } from '../../services/recruiter/jobsBoardService';
import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import jobTitlesList from '../../data/onetJobTitles.json';

interface JobOrderChecklistProps {
  jobOrder: JobOrder | null;
  location: any;
  associatedContacts: any[];
  onEditLocation?: () => void;
  onEditContacts?: () => void;
  recruiterUsers?: Array<{ id: string }>;
  onEditRecruiters?: () => void;
  jobPosts?: JobsBoardPost[];
  onOpenJobBoard?: () => void;
  tenantId: string;
  jobOrderId: string;
  onJobOrderUpdated?: (updates: Partial<JobOrder>) => void;
  applicantsCount?: number;
  candidateCount?: number;
  shiftsCount?: number;
  assignmentsCount?: number;
}

type ChecklistStatus = 'complete' | 'missing';

interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  status: ChecklistStatus;
  auto: boolean;
  icon: React.ReactNode;
  onAction?: () => void;
  actionLabel?: string;
}

const normalizedJobTitles = (jobTitlesList as string[]).map((title) => title.toLowerCase());

const ChecklistRow: React.FC<{ item: ChecklistItem }> = ({ item }) => {
  const isComplete = item.status === 'complete';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 1.5,
        borderRadius: 1,
        border: '1px solid',
        borderColor: isComplete ? 'success.light' : 'divider',
        bgcolor: isComplete ? 'success.light' : 'background.paper',
        mb: 1.5,
        transition: 'background-color 0.2s ease, border-color 0.2s ease',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
        <Checkbox
          checked={isComplete}
          disabled={item.auto}
          icon={<RadioButtonUncheckedIcon sx={{ color: 'grey.400' }} />}
          checkedIcon={<CheckCircleIcon sx={{ color: 'success.main' }} />}
          sx={{ p: 0.5 }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              bgcolor: 'grey.100',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isComplete ? 'success.main' : 'text.secondary',
              flexShrink: 0,
            }}
          >
            {item.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}
            >
              {item.label}
            </Typography>
            {item.description && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block' }}
              >
                {item.description}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, ml: 2 }}>
        <Chip
          size="small"
          label={isComplete ? 'Complete' : 'Missing'}
          color={isComplete ? 'success' : 'warning'}
          variant={isComplete ? 'filled' : 'outlined'}
          sx={{ fontWeight: 600, fontSize: '0.7rem' }}
        />
        <Tooltip title={item.auto ? 'This item updates automatically' : 'This item can be checked manually'}>
          <Typography variant="caption" color="text.secondary">
            {item.auto ? 'Auto' : 'Manual'}
          </Typography>
        </Tooltip>
        {item.onAction && !isComplete && (
          <Button
            variant="outlined"
            size="small"
            onClick={item.onAction}
            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
          >
            {item.actionLabel || 'Update'}
          </Button>
        )}
      </Box>
    </Box>
  );
};

const JobOrderChecklist: React.FC<JobOrderChecklistProps> = ({
  jobOrder,
  location,
  associatedContacts,
  onEditLocation,
  onEditContacts,
  recruiterUsers = [],
  onEditRecruiters,
  jobPosts = [],
  onOpenJobBoard,
  tenantId,
  jobOrderId,
  onJobOrderUpdated,
  applicantsCount = 0,
  candidateCount = 0,
  shiftsCount = 0,
  assignmentsCount = 0,
}) => {
  const [indeedUrl, setIndeedUrl] = useState<string>('');
  const [craigslistUrl, setCraigslistUrl] = useState<string>('');
  const [savingExternal, setSavingExternal] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);

  useEffect(() => {
    const currentIndeed = (jobOrder as any)?.indeedUrl || '';
    const currentCraigslist = (jobOrder as any)?.craigslistUrl || '';
    setIndeedUrl(currentIndeed);
    setCraigslistUrl(currentCraigslist);
  }, [jobOrder?.id, (jobOrder as any)?.indeedUrl, (jobOrder as any)?.craigslistUrl]);

  const isStandardJobTitle = (title?: string | null): boolean => {
    if (!title || typeof title !== 'string') return false;
    const trimmed = title.trim();
    if (!trimmed) return false;
    return normalizedJobTitles.includes(trimmed.toLowerCase());
  };

  const isValidUrl = (value: string, kind: 'indeed' | 'craigslist'): boolean => {
    const trimmed = (value || '').trim();
    if (!trimmed) return false;
    try {
      const url = new URL(trimmed);
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      const host = url.hostname.toLowerCase();
      if (kind === 'indeed') return host.includes('indeed.');
      if (kind === 'craigslist') return host.includes('craigslist.');
      return false;
    } catch {
      return false;
    }
  };

  const handleSaveExternalUrls = async (nextIndeed: string, nextCraigslist: string) => {
    if (!tenantId || !jobOrderId) return;
    setSavingExternal(true);
    setExternalError(null);
    try {
      const cleanedIndeed = nextIndeed.trim();
      const cleanedCraigslist = nextCraigslist.trim();

      const updates: any = {
        indeedUrl: cleanedIndeed || '',
        craigslistUrl: cleanedCraigslist || '',
      };

      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      await updateDoc(jobOrderRef, updates);

      if (onJobOrderUpdated) {
        onJobOrderUpdated(updates);
      }
    } catch (err: any) {
      console.error('Error saving external job board URLs:', err);
      setExternalError(err?.message || 'Failed to save external job board URLs');
    } finally {
      setSavingExternal(false);
    }
  };
  // Auto-computed status: has a standardized job title been selected from the list?
  const hasStandardJobTitle = (() => {
    if (!jobOrder) return false;

    // Career jobs: use the single jobTitle field
    if ((jobOrder as any).jobType !== 'gig' && isStandardJobTitle((jobOrder as any).jobTitle)) {
      return true;
    }

    // Gig jobs: check gigPositions array if present
    const gigPositions = (jobOrder as any).gigPositions as Array<{ jobTitle?: string }> | undefined;
    if (Array.isArray(gigPositions)) {
      return gigPositions.some((pos) => isStandardJobTitle(pos.jobTitle || ''));
    }

    return false;
  })();
  // Auto-computed status: does this job order have a worksite / location?
  const hasLocation = (() => {
    if (!jobOrder) return false;
    const worksiteName = (jobOrder as any).worksiteName;
    const loadedLocationName = location?.nickname || location?.name;
    const dealLocations = (jobOrder.deal as any)?.associations?.locations || [];
    const locationEntry = Array.isArray(dealLocations) && dealLocations.length > 0 ? dealLocations[0] : null;
    const dealLocationName =
      typeof locationEntry === 'string'
        ? ''
        : (locationEntry?.snapshot?.name ||
           locationEntry?.snapshot?.nickname ||
           locationEntry?.name ||
           '');

    const displayLocationName = worksiteName || loadedLocationName || dealLocationName;
    return !!displayLocationName;
  })();

  // Auto-computed status: does this job order have at least one associated deal contact?
  const hasDealContact = Array.isArray(associatedContacts) && associatedContacts.length > 0;

  // Auto-computed status: does this job order have at least one recruiter assigned?
  const hasRecruiterAssigned =
    (Array.isArray((jobOrder as any)?.assignedRecruiters) && (jobOrder as any).assignedRecruiters.length > 0) ||
    (Array.isArray(recruiterUsers) && recruiterUsers.length > 0);

  // Auto-computed status: has the client's job description been added?
  const hasClientDescription = (() => {
    if (!jobOrder) return false;
    const text = (jobOrder as any).jobDescriptionFromClient;
    if (!text || typeof text !== 'string') return false;
    return text.trim().length > 0;
  })();

  // Auto-computed status: at least one jobs board post exists for this job order
  const hasJobBoardPost = Array.isArray(jobPosts) && jobPosts.length > 0;

  // Auto-computed status: at least one jobs board post has a full description (AI or manual)
  const hasAiJobDescription =
    Array.isArray(jobPosts) &&
    jobPosts.some((post) => typeof post.jobDescription === 'string' && post.jobDescription.trim().length > 0);

  // Auto-computed status: at least one auto-add user group is configured
  const hasAutoAddUserGroup =
    Array.isArray(jobPosts) &&
    jobPosts.some(
      (post) =>
        (Array.isArray(post.autoAddToUserGroups) && post.autoAddToUserGroups.length > 0) ||
        (typeof (post as any).autoAddToUserGroup === 'string' &&
          (post as any).autoAddToUserGroup.trim().length > 0)
    );

  const hasIndeedUrl = isValidUrl(indeedUrl, 'indeed');
  const hasCraigslistUrl = isValidUrl(craigslistUrl, 'craigslist');
  const hasExternalJobPost = hasIndeedUrl || hasCraigslistUrl;

  const hasFirstApplicant = applicantsCount > 0;
  const hasCandidate = candidateCount > 0;
  const hasShiftCreated = shiftsCount > 0;
  const requiredWorkers = (jobOrder as any)?.workersNeeded ?? 0;
  const hasAssignmentsForAllPositions =
    typeof requiredWorkers === 'number' &&
    requiredWorkers > 0 &&
    assignmentsCount >= requiredWorkers;

  const items: ChecklistItem[] = [
    {
      id: 'worksite',
      label: 'Worksite location is set',
      description: hasLocation
        ? 'This job order is linked to a worksite location.'
        : 'Add a worksite so staff know where this job is located.',
      status: hasLocation ? 'complete' : 'missing',
      auto: true,
      icon: <LocationIcon sx={{ fontSize: 18 }} />,
      onAction: hasLocation ? undefined : onEditLocation,
      actionLabel: 'Add location',
    },
    {
      id: 'dealContact',
      label: 'Primary deal contact added',
      description: hasDealContact
        ? 'At least one CRM deal contact is associated to this job order.'
        : 'Add a hiring manager or primary contact for this job.',
      status: hasDealContact ? 'complete' : 'missing',
      auto: true,
      icon: <ContactsIcon sx={{ fontSize: 18 }} />,
      onAction: hasDealContact ? undefined : onEditContacts,
      actionLabel: 'Add contact',
    },
    {
      id: 'recruiterAssigned',
      label: 'Recruiter assigned',
      description: hasRecruiterAssigned
        ? 'At least one recruiter is assigned to own this job order.'
        : 'Assign a recruiter so someone is clearly responsible for this job.',
      status: hasRecruiterAssigned ? 'complete' : 'missing',
      auto: true,
      icon: <PeopleIcon sx={{ fontSize: 18 }} />,
      onAction: hasRecruiterAssigned ? undefined : onEditRecruiters,
      actionLabel: 'Assign recruiter',
    },
    {
      id: 'jobTitleSelected',
      label: 'Job title selected',
      description: hasStandardJobTitle
        ? 'Job title is selected from the standard job titles list.'
        : 'Choose a job title from the standard list so analytics and matching work best.',
      status: hasStandardJobTitle ? 'complete' : 'missing',
      auto: true,
      icon: <BriefcaseIcon sx={{ fontSize: 18 }} />,
    },
    {
      id: 'clientJobDescription',
      label: 'Client job description added',
      description: hasClientDescription
        ? "Client's original job description is saved with this job order."
        : 'Paste the job description from the client so recruiters and AI have full context.',
      status: hasClientDescription ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
    },
    {
      id: 'jobBoardPost',
      label: 'Job board posting created',
      description: hasJobBoardPost
        ? 'This job order has at least one connected jobs board posting.'
        : 'Create a public posting so applicants can discover and apply for this job.',
      status: hasJobBoardPost ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
      onAction: hasJobBoardPost ? undefined : onOpenJobBoard,
      actionLabel: 'Open Jobs Board',
    },
    {
      id: 'aiJobDescription',
      label: 'AI job description generated',
      description: hasAiJobDescription
        ? 'An AI-ready job description is saved on at least one jobs board posting.'
        : 'Use the AI generator on the Jobs Board tab to create a compelling description.',
      status: hasAiJobDescription ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
      onAction: hasAiJobDescription ? undefined : onOpenJobBoard,
      actionLabel: 'Generate with AI',
    },
    {
      id: 'autoAddUserGroups',
      label: 'Auto-add user group selected',
      description: hasAutoAddUserGroup
        ? 'Applicants from this posting are automatically added to at least one user group.'
        : 'Select one or more user groups to auto-add new applicants from this posting.',
      status: hasAutoAddUserGroup ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
      onAction: hasAutoAddUserGroup ? undefined : onOpenJobBoard,
      actionLabel: 'Configure auto-add',
    },
    {
      id: 'externalJobBoards',
      label: 'External job board postings linked',
      description: hasExternalJobPost
        ? 'At least one external posting (Indeed or Craigslist) is linked to this job order.'
        : 'Add links to external job board postings (Indeed, Craigslist) so recruiters can jump out quickly.',
      status: hasExternalJobPost ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
    },
    {
      id: 'shiftCreated',
      label: 'Shift created',
      description: hasShiftCreated
        ? 'At least one shift has been set up for this job order.'
        : 'Use the Shift Setup tab to create the first shift schedule.',
      status: hasShiftCreated ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
    },
    {
      id: 'firstApplicant',
      label: 'First applicant has applied',
      description: hasFirstApplicant
        ? 'At least one candidate has applied to this job order.'
        : 'Once the first user applies, this step will complete automatically.',
      status: hasFirstApplicant ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
    },
    {
      id: 'firstCandidate',
      label: 'First applicant marked as Candidate',
      description: hasCandidate
        ? 'At least one applicant has been promoted to Candidate status.'
        : 'Use the Applications tab to mark a strong applicant as a Candidate.',
      status: hasCandidate ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
    },
    {
      id: 'assignmentsFull',
      label: 'Assignments created for all positions',
      description:
        requiredWorkers > 0
          ? hasAssignmentsForAllPositions
            ? `Assignments match or exceed the requested headcount (${assignmentsCount}/${requiredWorkers}).`
            : `Create ${requiredWorkers - assignmentsCount} more assignment(s) to fully staff this job.`
          : 'Set the number of workers needed on the job order to enable this step.',
      status: requiredWorkers > 0 && hasAssignmentsForAllPositions ? 'complete' : 'missing',
      auto: true,
      icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
    },
  ];

  return (
    <Box px={3} py={4}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Checklist
      </Typography>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 3 }}>
        Track key launch steps for this job order. Items marked as **Auto** will complete themselves
        as you link locations, contacts, and other required data.
      </Typography>

      <Stack spacing={1.5}>
        {items.map((item) => (
          <Box key={item.id}>
            <ChecklistRow item={item} />
            {item.id === 'externalJobBoards' && (
              <Box sx={{ mt: 1.5, ml: 5 }}>
                <Stack spacing={1.5}>
                  <TextField
                    label="Indeed posting URL"
                    size="small"
                    fullWidth
                    value={indeedUrl}
                    onChange={(e) => setIndeedUrl(e.target.value)}
                    onBlur={() => handleSaveExternalUrls(indeedUrl, craigslistUrl)}
                    placeholder="https://www.indeed.com/viewjob?..."
                    error={!!indeedUrl && !hasIndeedUrl}
                    helperText={
                      indeedUrl && !hasIndeedUrl
                        ? 'Enter a valid Indeed URL (https://www.indeed.com/...)'
                        : 'Optional: link to this job on Indeed'
                    }
                  />
                  <TextField
                    label="Craigslist posting URL"
                    size="small"
                    fullWidth
                    value={craigslistUrl}
                    onChange={(e) => setCraigslistUrl(e.target.value)}
                    onBlur={() => handleSaveExternalUrls(indeedUrl, craigslistUrl)}
                    placeholder="https://city.craigslist.org/..."
                    error={!!craigslistUrl && !hasCraigslistUrl}
                    helperText={
                      craigslistUrl && !hasCraigslistUrl
                        ? 'Enter a valid Craigslist URL (https://<city>.craigslist.org/...)'
                        : 'Optional: link to this job on Craigslist'
                    }
                  />
                  {externalError && (
                    <Typography variant="caption" color="error">
                      {externalError}
                    </Typography>
                  )}
                  {savingExternal && (
                    <Typography variant="caption" color="text.secondary">
                      Saving external job board links…
                    </Typography>
                  )}
                </Stack>
              </Box>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

export default JobOrderChecklist;


