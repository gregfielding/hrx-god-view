import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  Chip,
  Grid,
  Card,
  CardHeader,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import FavoriteButton from '../../../components/FavoriteButton';
import { useFavorites } from '../../../hooks/useFavorites';

interface UserGroupsTabProps {
  uid: string;
  tenantId?: string;
}

type UserGroupDoc = {
  id: string;
  title?: string;
  description?: string;
  createdAt?: { toDate?: () => Date } | null;
  createdBy?: { firstName?: string; lastName?: string } | null;
  memberIds?: string[];
};

function formatGroupCreatedAt(createdAt: unknown): string {
  if (createdAt == null) return '—';
  if (
    typeof createdAt === 'object' &&
    createdAt !== null &&
    'toDate' in createdAt &&
    typeof (createdAt as { toDate?: () => Date }).toDate === 'function'
  ) {
    try {
      return (createdAt as { toDate: () => Date }).toDate().toLocaleDateString();
    } catch {
      return '—';
    }
  }
  if (createdAt instanceof Date) return createdAt.toLocaleDateString();
  return '—';
}

function formatGroupDescription(description: string | undefined): string {
  if (!description?.trim()) return '—';
  return description.length > 40 ? `${description.slice(0, 40)}…` : description;
}

const UserGroupsTab: React.FC<UserGroupsTabProps> = ({ uid, tenantId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantId: activeTenantId } = useAuth();
  const [userGroups, setUserGroups] = useState<UserGroupDoc[]>([]);
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const { isFavorite, toggleFavorite } = useFavorites('userGroups');

  const isFromRecruiter = location.pathname.includes('/recruiter');

  const effectiveTenantId = tenantId || activeTenantId;

  const loadUserGroups = useCallback(
    async (tid: string) => {
      try {
        const gq = collection(db, 'tenants', tid, 'userGroups');
        const gSnap = await getDocs(gq);
        const groupData = gSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as UserGroupDoc[];
        setUserGroups(groupData);

        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data() as Record<string, unknown>;
          const nested = (userData.tenantIds as Record<string, { userGroupIds?: string[] }> | undefined)?.[tid]
            ?.userGroupIds;
          const ids =
            (Array.isArray(nested) ? nested : null) ||
            (Array.isArray(userData.userGroupIds) ? (userData.userGroupIds as string[]) : null) ||
            [];
          setUserGroupIds(ids);
        }
      } catch (error) {
        console.error('Error loading user groups:', error);
        setUserGroups([]);
      }
    },
    [uid]
  );

  useEffect(() => {
    if (effectiveTenantId) {
      void loadUserGroups(effectiveTenantId);
    }
  }, [effectiveTenantId, loadUserGroups]);

  const memberGroups = useMemo(
    () => userGroups.filter((g) => userGroupIds.includes(g.id)).sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id)),
    [userGroups, userGroupIds]
  );

  const handleUserGroupsChange = (_event: unknown, newValue: UserGroupDoc[]) => {
    const newGroupIds = newValue.map((group) => group.id);
    setUserGroupIds(newGroupIds);

    const userRef = doc(db, 'users', uid);
    updateDoc(userRef, {
      userGroupIds: newGroupIds,
      updatedAt: new Date(),
    }).catch((error) => {
      console.error('Error updating user groups:', error);
    });
  };

  const openGroup = (groupId: string) => {
    navigate(isFromRecruiter ? `/recruiter/user-groups/${groupId}` : `/usergroups/${groupId}`);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card variant="outlined">
        <CardHeader title="User Groups" titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }} />
        <CardContent sx={{ p: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 3 }}>
            Manage which user groups this user belongs to. User groups help organize users and control access to specific
            features.
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                options={userGroups}
                getOptionLabel={(option) => option.title || option.id}
                value={userGroups.filter((g) => userGroupIds.includes(g.id))}
                onChange={handleUserGroupsChange}
                renderInput={(params) => (
                  <TextField {...params} label="User Groups" placeholder="Select groups" fullWidth />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip label={option.title || option.id} {...getTagProps({ index })} key={option.id} />
                  ))
                }
                isOptionEqualToValue={(option, value) => option.id === value.id}
              />
            </Grid>
          </Grid>

          <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 4, mb: 1.5 }}>
            Groups this user belongs to
          </Typography>

          {memberGroups.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              This user is not in any groups yet. Use the field above to add them to groups.
            </Typography>
          ) : (
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{
                borderRadius: 0,
                border: '1px solid #EAEEF4',
                overflowX: 'auto',
                width: '100%',
              }}
            >
              <Table size="small" sx={{ width: '100%' }}>
                <TableHead
                  sx={{
                    backgroundColor: 'background.paper',
                    '& .MuiTableCell-root': { borderRadius: 0 },
                  }}
                >
                  <TableRow sx={{ backgroundColor: 'background.paper' }}>
                    <TableCell sx={{ width: 60, bgcolor: '#FFFFFF', borderRadius: 0 }} />
                    <TableCell
                      sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}
                    >
                      Title
                    </TableCell>
                    <TableCell
                      sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}
                    >
                      Description
                    </TableCell>
                    <TableCell
                      sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}
                    >
                      Created
                    </TableCell>
                    <TableCell
                      sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}
                    >
                      Created By
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}
                    >
                      Members
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {memberGroups.map((group, index) => (
                    <TableRow
                      key={group.id}
                      hover
                      sx={{
                        cursor: 'pointer',
                        backgroundColor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                        '&:hover': { backgroundColor: 'action.selected' },
                      }}
                      onClick={() => openGroup(group.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <FavoriteButton
                          itemId={group.id}
                          favoriteType="userGroups"
                          isFavorite={isFavorite}
                          toggleFavorite={toggleFavorite}
                          size="small"
                          tooltipText={{
                            favorited: 'Remove from favorites',
                            notFavorited: 'Add to favorites',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {group.title || 'Untitled Group'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {formatGroupDescription(group.description)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{formatGroupCreatedAt(group.createdAt)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {group.createdBy
                            ? `${group.createdBy.firstName ?? ''} ${group.createdBy.lastName ?? ''}`.trim() || '—'
                            : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">{Array.isArray(group.memberIds) ? group.memberIds.length : 0}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default UserGroupsTab;
