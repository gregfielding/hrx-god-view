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
import { useTenantJobTitleOptions } from '../../hooks/useTenantJobTitles';

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

const isStandardJobTitleValue = (
  title: string | null | undefined,
  jobTitles: readonly string[],
): boolean => {
  if (!title || typeof title !== 'string') return false;
  const trimmed = title.trim();
  if (!trimmed) return false;
  const needle = trimmed.toLowerCase();
  for (const candidate of jobTitles) {
    if (typeof candidate === 'string' && candidate.toLowerCase() === needle) return true;
  }
  return false;
};

const isValidUrlValue = (value: string, kind: 'indeed' | 'craigslist'): boolean => {
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

export function getJobOrderChecklistProgress(input: {
  jobOrder: JobOrder | null;
  location?: any;
  associatedContacts?: any[];
  recruiterUsers?: Array<{ id: string }>;
  jobPosts?: JobsBoardPost[];
  shiftsCount?: number;
  indeedUrl?: string;
  craigslistUrl?: string;
  /**
   * Tenant's curated Job Titles list (from `useTenantJobTitleOptions`).
   * If omitted, the "Job title selected" row falls back to a simple
   * non-empty check so the summary still renders before the hook
   * resolves; callers that want the strict "must be in the tenant's
   * list" check should pass titles through.
   */
  jobTitles?: readonly string[];
}): {
  total: number;
  completed: number;
  statuses: Array<{ id: string; label: string; complete: boolean }>;
} {
  const {
    jobOrder,
    location,
    associatedContacts = [],
    recruiterUsers = [],
    jobPosts = [],
    shiftsCount = 0,
    indeedUrl,
    craigslistUrl,
    jobTitles,
  } = input;

  const hasJobTitlesList = Array.isArray(jobTitles) && jobTitles.length > 0;
  const titleQualifies = (title: string | null | undefined): boolean => {
    if (!title || typeof title !== 'string') return false;
    const trimmed = title.trim();
    if (!trimmed) return false;
    // Without a curated list, treat any non-empty title as "selected"
    // so we don't regress the summary while the hook is hydrating.
    return hasJobTitlesList ? isStandardJobTitleValue(trimmed, jobTitles!) : true;
  };

  const hasStandardJobTitle = (() => {
    if (!jobOrder) return false;

    if ((jobOrder as any).jobType !== 'gig' && titleQualifies((jobOrder as any).jobTitle)) {
      return true;
    }

    const gigPositions = (jobOrder as any).gigPositions as Array<{ jobTitle?: string }> | undefined;
    if (Array.isArray(gigPositions)) {
      return gigPositions.some((pos) => titleQualifies(pos.jobTitle || ''));
    }

    return false;
  })();

  // Location/worksite
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

  const hasDealContact = Array.isArray(associatedContacts) && associatedContacts.length > 0;

  const hasRecruiterAssigned =
    (Array.isArray((jobOrder as any)?.assignedRecruiters) && (jobOrder as any).assignedRecruiters.length > 0) ||
    (Array.isArray(recruiterUsers) && recruiterUsers.length > 0);

  const hasClientDescription = (() => {
    if (!jobOrder) return false;
    const text = (jobOrder as any).jobDescriptionFromClient;
    if (!text || typeof text !== 'string') return false;
    return text.trim().length > 0;
  })();

  const hasJobBoardPost = Array.isArray(jobPosts) && jobPosts.length > 0;
  // 'aiJobDescription' (AI job description generated) removed from
  // the checklist by request — descriptions land on jobs board posts
  // through several paths (AI generator, manual, account default)
  // and the JO doesn't gate on which one was used.

  const hasAutoAddUserGroup =
    Array.isArray(jobPosts) &&
    jobPosts.some(
      (post) =>
        (Array.isArray(post.autoAddToUserGroups) && post.autoAddToUserGroups.length > 0) ||
        (typeof (post as any).autoAddToUserGroup === 'string' &&
          (post as any).autoAddToUserGroup.trim().length > 0)
    );

  const effectiveIndeedUrl = (indeedUrl ?? (jobOrder as any)?.indeedUrl ?? '').trim();
  const effectiveCraigslistUrl = (craigslistUrl ?? (jobOrder as any)?.craigslistUrl ?? '').trim();
  const hasExternalJobPost =
    isValidUrlValue(effectiveIndeedUrl, 'indeed') || isValidUrlValue(effectiveCraigslistUrl, 'craigslist');

  const hasShiftCreated = shiftsCount > 0;

  // Gig orders skip two rows that don't model their workflow:
  //   1. `clientJobDescription` — gigs carry one JD per position
  //      (`gigPositions[].jobDescription`), not a single JO-level
  //      `jobDescriptionFromClient`, so the row would always read
  //      "Missing" even when every position has its own description.
  //   2. `externalJobBoards` — gigs are sourced through the public
  //      jobs board + auto-add user groups, not Indeed / Craigslist
  //      cross-posts. Career orders still cross-post externally, so
  //      the row stays for those. May 2026.
  const isGigOrder = String((jobOrder as any)?.jobType ?? '').toLowerCase() === 'gig';

  const statuses: Array<{ id: string; label: string; complete: boolean }> = [
    { id: 'worksite', label: 'Worksite location is set', complete: hasLocation },
    // 'dealContact' (Primary deal contact added) removed from the
    // checklist by request — recruiters edit hiring contacts on the
    // Account / Contact pages and the JO doesn't gate on it.
    { id: 'recruiterAssigned', label: 'Recruiter assigned', complete: hasRecruiterAssigned },
    { id: 'jobTitleSelected', label: 'Job title selected', complete: hasStandardJobTitle },
    ...(isGigOrder
      ? []
      : [{ id: 'clientJobDescription', label: 'Client job description added', complete: hasClientDescription }]),
    { id: 'jobBoardPost', label: 'Job board posting created', complete: hasJobBoardPost },
    // 'aiJobDescription' removed from the summary by request — see
    // the explanatory comment alongside the dropped `hasAiJobDescription`
    // computation above.
    { id: 'autoAddUserGroups', label: 'Auto-add user group selected', complete: hasAutoAddUserGroup },
    ...(isGigOrder
      ? []
      : [{ id: 'externalJobBoards', label: 'External job board postings linked', complete: hasExternalJobPost }]),
    { id: 'shiftCreated', label: 'Shift created', complete: hasShiftCreated },
  ];

  const completed = statuses.filter((s) => s.complete).length;
  return { total: statuses.length, completed, statuses };
}

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
  const jobTitlesList = useTenantJobTitleOptions(tenantId);
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
    if ((jobOrder as any).jobType !== 'gig' && isStandardJobTitleValue((jobOrder as any).jobTitle, jobTitlesList)) {
      return true;
    }

    // Gig jobs: check gigPositions array if present
    const gigPositions = (jobOrder as any).gigPositions as Array<{ jobTitle?: string }> | undefined;
    if (Array.isArray(gigPositions)) {
      return gigPositions.some((pos) => isStandardJobTitleValue(pos.jobTitle || '', jobTitlesList));
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

  // 'hasAiJobDescription' (AI job description generated) removed —
  // see the matching comment above the dropped `statuses` row.

  // Auto-computed status: at least one auto-add user group is configured
  const hasAutoAddUserGroup =
    Array.isArray(jobPosts) &&
    jobPosts.some(
      (post) =>
        (Array.isArray(post.autoAddToUserGroups) && post.autoAddToUserGroups.length > 0) ||
        (typeof (post as any).autoAddToUserGroup === 'string' &&
          (post as any).autoAddToUserGroup.trim().length > 0)
    );

  const hasIndeedUrl = isValidUrlValue(indeedUrl, 'indeed');
  const hasCraigslistUrl = isValidUrlValue(craigslistUrl, 'craigslist');
  const hasExternalJobPost = hasIndeedUrl || hasCraigslistUrl;

  const hasShiftCreated = shiftsCount > 0;

  // Gigs hide two rows from the full panel — `clientJobDescription`
  // (per-position JDs, not a JO-level field) and `externalJobBoards`
  // (gigs aren't cross-posted to Indeed / Craigslist; they're sourced
  // through the public jobs board + auto-add user groups). Mirrors the
  // same skip in `getJobOrderChecklistProgress` above so summary chips
  // and full panel stay in sync. May 2026.
  const isGigOrder = String((jobOrder as any)?.jobType ?? '').toLowerCase() === 'gig';

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
    // 'dealContact' (Primary deal contact added) checklist row removed
    // by request — see the matching note in the `statuses` array above.
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
    ...(isGigOrder
      ? []
      : [
          {
            id: 'clientJobDescription',
            label: 'Client job description added',
            description: hasClientDescription
              ? "Client's original job description is saved with this job order."
              : 'Paste the job description from the client so recruiters and AI have full context.',
            status: (hasClientDescription ? 'complete' : 'missing') as ChecklistItem['status'],
            auto: true,
            icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
          } satisfies ChecklistItem,
        ]),
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
    // 'aiJobDescription' item removed by request — descriptions reach
    // posts through multiple paths (AI generator, manual entry,
    // account-level defaults) and the JO checklist shouldn't single
    // out one of those paths as the canonical step.
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
    ...(isGigOrder
      ? []
      : [
          {
            id: 'externalJobBoards',
            label: 'External job board postings linked',
            description: hasExternalJobPost
              ? 'At least one external posting (Indeed or Craigslist) is linked to this job order.'
              : 'Add links to external job board postings (Indeed, Craigslist) so recruiters can jump out quickly.',
            status: (hasExternalJobPost ? 'complete' : 'missing') as ChecklistItem['status'],
            auto: true,
            icon: <DescriptionIcon sx={{ fontSize: 18 }} />,
          } satisfies ChecklistItem,
        ]),
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


