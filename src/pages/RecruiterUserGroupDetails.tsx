import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { calculateProfileScore } from '../utils/applicantScoring';
import { normalizeScoreSummary } from '../utils/scoreSummary';
import { sanitizeWorkerNameParts } from '../utils/profileDisplayName';
import PageHeader from '../components/PageHeader';
import InboxSearchBar from '../components/InboxSearchBar';
import UserGroupHiringControlPanel from '../components/recruiter/userGroup/UserGroupHiringControlPanel';
import { TriggerGroupInterviewDialog } from '../components/recruiter/userGroup/TriggerGroupInterviewDialog';
import UserGroupMembersTable, {
  type MemberPreferenceStatus,
} from '../components/recruiter/userGroup/UserGroupMembersTable';
import RecruiterMultiSelect from '../components/recruiter/RecruiterMultiSelect';

interface TenantUserGroup {
  id: string;
  title?: string;
  description?: string;
  hiringConfig?: Record<string, unknown>;
  memberIds?: string[];
  memberStatusById?: Record<string, string>;
  /**
   * Recruiting role assignments. See `docs/RECRUITING_ROLE_MODEL.md` §2.1 —
   * Onboarding Specialist assignment lives at the user-group level
   * because a worker's specialist is resolved via their group
   * memberships.
   */
  roles?: {
    /** Preferred field — the role formerly known as CSA. */
    onboardingSpecialistIds?: string[];
    /** Legacy alias retained during the rename transition window. */
    csaIds?: string[];
  };
}

const RecruiterUserGroupDetails: React.FC = () => {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const { activeTenant } = useAuth();

  const [group, setGroup] = useState<TenantUserGroup | null>(null);
  const [membersData, setMembersData] = useState<any[]>([]);
  const [allGroups, setAllGroups] = useState<TenantUserGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'members' | 'hiring' | 'settings'>('members');
  const [interviewInviteOpen, setInterviewInviteOpen] = useState(false);

  const tenantId = activeTenant?.id;

  useEffect(() => {
    if (!tenantId || !groupId) return;
    loadGroup();
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on tenant/group route only
  }, [tenantId, groupId]);

  useEffect(() => {
    if (!tenantId || !group?.id) return;
    const ids = group.memberIds || [];
    void fetchMembersByIds(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when group membership changes
  }, [tenantId, group?.id, group?.memberIds]);

  const loadGroup = async () => {
    if (!tenantId || !groupId) return;
    setLoading(true);
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const groupSnap = await getDoc(groupRef);
      if (groupSnap.exists()) {
        const data = groupSnap.data();
        setGroup({ id: groupId, ...data });
      } else {
        setError('Group not found');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load group');
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    if (!tenantId) return;
    try {
      const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(groupsRef);
      const groupsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as TenantUserGroup[];
      setAllGroups(groupsData);
    } catch (err) {
      console.error('Error loading groups:', err);
    }
  };

  const fetchMembersByIds = async (ids: string[]) => {
    if (!tenantId) return;
    if (!ids || ids.length === 0) {
      setMembersData([]);
      return;
    }
    setLoading(true);
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 10) {
        chunks.push(ids.slice(i, i + 10));
      }

      const snaps = await Promise.all(
        chunks.map((chunk) => getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)))),
      );
      const rawUsers = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));

      const users = rawUsers.map((u: any) => {
        const tenantData = u?.tenantIds?.[tenantId] || {};
        const securityLevel = String(tenantData.securityLevel || u.securityLevel || '0');

        const rawSkills = Array.isArray(u.skills)
          ? u.skills
          : Array.isArray(tenantData.skills)
            ? tenantData.skills
            : [];
        const normalizedSkills = rawSkills
          .map((skill: any) => {
            if (!skill) return null;
            if (typeof skill === 'string') return skill;
            if (typeof skill === 'object') {
              if (typeof skill.label === 'string') return skill.label;
              if (typeof skill.name === 'string') return skill.name;
              if (typeof skill.value === 'string') return skill.value;
            }
            return null;
          })
          .filter((skill: any) => typeof skill === 'string' && skill.trim().length > 0);

        const phoneRow = String(u.phone || u.phoneE164 || '');
        const nameSanitized = sanitizeWorkerNameParts({
          firstName: u.firstName,
          lastName: u.lastName,
          preferredName: u.preferredName,
          displayName: u.displayName,
          email: u.email,
          phone: phoneRow,
        });

        return {
          ...u,
          firstName: nameSanitized.firstName,
          lastName: nameSanitized.lastName,
          securityLevel,
          avatar: u.avatar || tenantData.avatar,
          phone: u.phone || '',
          scoreSummary: normalizeScoreSummary({
            ...(u.scoreSummary || {}),
            ...((tenantData as { scoreSummary?: Record<string, unknown> }).scoreSummary || {}),
          }),
          aiProfileScore:
            tenantData.aiProfileScore ??
            u.aiProfileScore ??
            u.aiScore ??
            u.aiProfile?.score ??
            calculateProfileScore(u),
          aiJobFitScore: tenantData.aiJobFitScore ?? u.aiJobFitScore,
          skills: normalizedSkills,
        };
      });

      const byId = new Map(users.map((u) => [u.id, u]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      setMembersData(ordered as any[]);
    } catch (err) {
      console.error('Failed to fetch group members:', err);
      setMembersData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!tenantId || !groupId || !group) return;
    setLoading(true);
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const newMemberIds = (group.memberIds || []).filter((id) => id !== userId);
      await updateDoc(groupRef, {
        memberIds: newMemberIds,
        [`memberStatusById.${userId}`]: deleteField(),
      });
      setGroup((prev) => {
        if (!prev) return prev;
        const next = { ...(prev.memberStatusById || {}) };
        delete next[userId];
        return { ...prev, memberIds: newMemberIds, memberStatusById: next };
      });
      await fetchMembersByIds(newMemberIds);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setLoading(false);
    }
  };

  const handleChangeGroupStatus = async (userId: string, status: MemberPreferenceStatus) => {
    if (!tenantId || !groupId) return;
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(groupRef, { [`memberStatusById.${userId}`]: status });
      setGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          memberStatusById: {
            ...(prev.memberStatusById || {}),
            [userId]: status,
          },
        };
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update group status');
    }
  };

  const tenantGroupRows = useMemo(
    () => allGroups.map((g) => ({ id: g.id, title: g.title })),
    [allGroups],
  );

  if (loading && !group) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ maxWidth: 640 }}>
        {error}
      </Alert>
    );
  }

  if (!group) {
    return (
      <Alert severity="info" sx={{ maxWidth: 640 }}>
        Group not found
      </Alert>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
            <Avatar
              sx={{
                width: 108,
                height: 108,
                bgcolor: 'primary.main',
                fontSize: '40px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {(group.title || 'G').trim().charAt(0).toUpperCase()}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0, minHeight: 108, display: 'flex', flexDirection: 'column' }}>
              <Typography
                variant="h6"
                sx={{
                  fontSize: { xs: '20px', md: '24px' },
                  fontWeight: 600,
                  lineHeight: 1.2,
                }}
              >
                {group.title || 'Untitled Group'}
              </Typography>
              {group.description && (
                <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', mt: 0.75 }}>
                  {group.description}
                </Typography>
              )}
              <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', mt: 0.75 }}>
                {membersData.length} member{membersData.length === 1 ? '' : 's'} • ID: {group.id.slice(0, 8)}
              </Typography>
            </Box>
          </Box>
        }
        filters={
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {[
              { label: 'Members', value: 'members' as const },
              { label: 'Hiring', value: 'hiring' as const },
              { label: 'Settings', value: 'settings' as const },
            ].map((t) => {
              const isActive = activeTab === t.value;
              return (
                <Button
                  key={t.value}
                  onClick={() => setActiveTab(t.value)}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.5,
                    py: 0.75,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  {t.label}
                </Button>
              );
            })}
          </Box>
        }
        rightActions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {activeTab === 'members' ? (
              <InboxSearchBar
                value={searchTerm}
                onChange={setSearchTerm}
                onSearch={setSearchTerm}
                placeholder="Search people..."
              />
            ) : null}

            {tenantId && groupId ? (
              <Button
                variant="contained"
                onClick={() => setInterviewInviteOpen(true)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '24px',
                  height: '40px',
                  px: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                Trigger Interviews
              </Button>
            ) : null}

            <Button
              variant="outlined"
              onClick={() => navigate('/recruiter/user-groups')}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
              }}
            >
              Back
            </Button>
          </Box>
        }
      />

      {tenantId && groupId ? (
        <TriggerGroupInterviewDialog
          open={interviewInviteOpen}
          onClose={() => setInterviewInviteOpen(false)}
          tenantId={tenantId}
          groupId={groupId}
          groupTitle={group.title}
        />
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {activeTab === 'settings' ? (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #EAEEF4', p: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                Group Settings
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Title: {group.title || 'Untitled Group'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Description: {group.description || '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Members: {membersData.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Group ID: {group.id}
              </Typography>
            </Paper>

            {/* Recruiting roles — Onboarding Specialist assignment
                (per docs/RECRUITING_ROLE_MODEL.md §2.1). Specialists
                picked here own welcome / onboarding calls for every
                worker in this group. A worker in multiple groups
                aggregates specialists across groups; the first (by
                group creation order) is the primary and denormalizes
                onto users.{uid}.primaryRecruiterId. The defensive read
                falls back to the legacy `roles.csaIds` field while the
                rename migration soaks. */}
            <GroupRolesEditor
              tenantId={tenantId || null}
              groupId={group.id}
              initialOnboardingSpecialistIds={
                group.roles?.onboardingSpecialistIds ?? group.roles?.csaIds ?? []
              }
              onSaved={(nextIds) => {
                setGroup((prev) =>
                  prev
                    ? {
                        ...prev,
                        roles: {
                          ...(prev.roles ?? {}),
                          onboardingSpecialistIds: nextIds,
                        },
                      }
                    : prev,
                );
              }}
            />
          </Box>
        ) : activeTab === 'hiring' && tenantId ? (
          <Box sx={{ p: '16px', width: '100%', boxSizing: 'border-box' }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
              Hiring control
            </Typography>
            <UserGroupHiringControlPanel
              tenantId={tenantId}
              groupId={group.id}
              memberCount={membersData.length}
              memberProfiles={membersData.map((m) => ({
                userId: m.id,
                aiProfileScore: m.aiProfileScore,
                aiJobFitScore: m.aiJobFitScore,
              }))}
              onSaved={() => void loadGroup()}
            />
          </Box>
        ) : tenantId && groupId ? (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            <UserGroupMembersTable
              tenantId={tenantId}
              groupId={groupId}
              memberIds={group.memberIds || []}
              memberStatusById={group.memberStatusById}
              membersData={membersData}
              tenantGroupRows={tenantGroupRows}
              loading={loading}
              onRemoveMember={handleRemoveMember}
              onChangeGroupStatus={handleChangeGroupStatus}
              searchQuery={searchTerm}
            />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};

export default RecruiterUserGroupDetails;

// ---------------------------------------------------------------------------
// GroupRolesEditor — inline editor for the user group's recruiting roles.
// Today this is just the Onboarding Specialist list (the role formerly
// known as CSA). Kept as a separate component so the Settings tab stays
// readable and so future roles (e.g. a sourcing lead per group) drop in
// without bloating the parent.
// ---------------------------------------------------------------------------

interface GroupRolesEditorProps {
  tenantId: string | null;
  groupId: string;
  initialOnboardingSpecialistIds: string[];
  onSaved: (nextIds: string[]) => void;
}

const GroupRolesEditor: React.FC<GroupRolesEditorProps> = ({
  tenantId,
  groupId,
  initialOnboardingSpecialistIds,
  onSaved,
}) => {
  const [onboardingSpecialistIds, setOnboardingSpecialistIds] = React.useState<string[]>(
    initialOnboardingSpecialistIds,
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  // Sync local state when the parent re-renders with a fresh group doc.
  React.useEffect(() => {
    setOnboardingSpecialistIds(initialOnboardingSpecialistIds);
  }, [initialOnboardingSpecialistIds.join(',')]);

  const dirty = useMemo(() => {
    if (onboardingSpecialistIds.length !== initialOnboardingSpecialistIds.length) return true;
    const set = new Set(initialOnboardingSpecialistIds);
    return onboardingSpecialistIds.some((id) => !set.has(id));
  }, [onboardingSpecialistIds, initialOnboardingSpecialistIds]);

  const handleSave = async () => {
    if (!tenantId || !groupId || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Write only the new field. The defensive read pattern in
      // consumers (see `recomputePrimaryForWorker.ts` and the Cloud
      // Functions trigger) keeps legacy `roles.csaIds` working until
      // the cleanup PR drops the fallback.
      await updateDoc(doc(db, 'tenants', tenantId, 'userGroups', groupId), {
        'roles.onboardingSpecialistIds': onboardingSpecialistIds,
      });
      onSaved(onboardingSpecialistIds);
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err?.message || 'Failed to save recruiting roles');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #EAEEF4', p: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
        Recruiting roles
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Onboarding Specialists picked here make welcome / onboarding
        calls to every worker in this group. Click a chip's × to remove;
        save to apply.
      </Typography>

      <RecruiterMultiSelect
        tenantId={tenantId}
        label="Onboarding Specialists"
        value={onboardingSpecialistIds}
        onChange={setOnboardingSpecialistIds}
        helperText="Workers in this group will show these Onboarding Specialists on their profile header."
        disabled={saving || !tenantId}
      />

      {error ? (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      ) : null}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!dirty || saving || !tenantId}
        >
          {saving ? <CircularProgress size={18} /> : 'Save'}
        </Button>
        {savedAt && !dirty ? (
          <Typography variant="caption" color="text.secondary">
            Saved · {new Date(savedAt).toLocaleTimeString()}
          </Typography>
        ) : null}
      </Box>
    </Paper>
  );
};

