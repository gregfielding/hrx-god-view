/**
 * Sender Management Page
 * 
 * Unified view for managing sender identities (Twilio numbers and Gmail connections)
 * for all team members (security level 5-7).
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
  Stack,
  Chip,
  Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import { collection, query, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import SenderIdentityCard from '../../components/SenderIdentityCard';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  securityLevel: number;
  gmailConnected?: boolean;
  gmailEmail?: string;
  twilioNumber?: string;
  useMainNumber?: boolean;
}

const SenderManagementPage: React.FC = () => {
  const { activeTenant } = useAuth();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [filteredMembers, setFilteredMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const functions = getFunctions();
  const getRecruiterNumbersFn = httpsCallable(functions, 'getRecruiterNumbers');
  const getGmailStatusFn = httpsCallable(functions, 'getGmailStatus');

  useEffect(() => {
    if (activeTenant?.id) {
      loadTeamMembers();
    }
  }, [activeTenant?.id]);

  useEffect(() => {
    // Filter team members by search term
    if (!searchTerm.trim()) {
      setFilteredMembers(teamMembers);
    } else {
      const term = searchTerm.toLowerCase();
      setFilteredMembers(
        teamMembers.filter(
          (member) =>
            member.name.toLowerCase().includes(term) ||
            member.email.toLowerCase().includes(term)
        )
      );
    }
  }, [searchTerm, teamMembers]);

  const loadTeamMembers = async () => {
    if (!activeTenant?.id) return;

    setLoading(true);
    setError(null);

    try {
      // Load all users and filter for security level 5-7
      const allUsersQuery = query(collection(db, 'users'), limit(500));
      const allUsersSnapshot = await getDocs(allUsersQuery);

      // Filter to team members (security level 5-7) with tenant access
      const membersList = allUsersSnapshot.docs
        .filter((doc) => {
          const data = doc.data();
          const tenantId = activeTenant.id;

          // Check tenant access
          const hasTenantAccess =
            data.tenantId === tenantId ||
            data.activeTenantId === tenantId ||
            (data.tenantIds &&
              (Array.isArray(data.tenantIds)
                ? data.tenantIds.includes(tenantId)
                : typeof data.tenantIds === 'object' && tenantId in data.tenantIds));

          if (!hasTenantAccess) return false;

          // Check security level (5-7)
          const rootSecurityLevel = parseInt(data.securityLevel || '0');
          const tenantSecurityLevel = data.tenantIds?.[tenantId]?.securityLevel
            ? parseInt(String(data.tenantIds[tenantId].securityLevel))
            : null;
          const effectiveSecurityLevel =
            tenantSecurityLevel !== null ? tenantSecurityLevel : rootSecurityLevel;

          return effectiveSecurityLevel >= 5 && effectiveSecurityLevel <= 7;
        })
        .map((doc) => {
          const data = doc.data();
          const tenantId = activeTenant.id;
          const rootSecurityLevel = parseInt(data.securityLevel || '0');
          const tenantSecurityLevel = data.tenantIds?.[tenantId]?.securityLevel
            ? parseInt(String(data.tenantIds[tenantId].securityLevel))
            : null;
          const effectiveSecurityLevel =
            tenantSecurityLevel !== null ? tenantSecurityLevel : rootSecurityLevel;

          return {
            id: doc.id,
            name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.email,
            email: data.email,
            securityLevel: effectiveSecurityLevel,
            gmailConnected: data.gmailConnected || false,
            gmailEmail: data.gmailTokens?.email || data.email,
            twilioNumber: undefined,
            useMainNumber: undefined,
          } as TeamMember;
        });

      // Load Twilio number assignments
      try {
        const numbersResult = await getRecruiterNumbersFn({ tenantId: activeTenant.id });
        const numbersData = numbersResult.data as { success: boolean; assignments: any[] };
        if (numbersData.success && numbersData.assignments) {
          const assignmentsMap = new Map<string, any>();
          numbersData.assignments.forEach((assignment: any) => {
            assignmentsMap.set(assignment.recruiterId, assignment);
          });

          // Merge number assignments into members
          membersList.forEach((member) => {
            const assignment = assignmentsMap.get(member.id);
            if (assignment) {
              (member as TeamMember).twilioNumber = assignment.twilioNumber;
              (member as TeamMember).useMainNumber = assignment.useMainNumber;
            }
          });
        }
      } catch (numbersError) {
        console.warn('Failed to load Twilio number assignments:', numbersError);
      }

      // Load Gmail status for each member (in batches to avoid rate limits)
      const membersWithGmail = await Promise.all(
        membersList.map(async (member) => {
          try {
            const gmailResult = await getGmailStatusFn({ userId: member.id });
            const gmailData = gmailResult.data as { connected: boolean; email?: string };
            return {
              ...member,
              gmailConnected: gmailData.connected || member.gmailConnected,
              gmailEmail: gmailData.email || member.gmailEmail,
            };
          } catch (gmailError) {
            console.warn(`Failed to load Gmail status for ${member.id}:`, gmailError);
            return member;
          }
        })
      );

      setTeamMembers(membersWithGmail);
    } catch (err: any) {
      setError(err.message || 'Failed to load team members');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    loadTeamMembers();
  };

  if (loading && teamMembers.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={600}>
            Sender Management
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage Twilio number assignments and Gmail connections for your team
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Search */}
      <Box sx={{ mb: 3 }}>
        <TextField
          fullWidth
          placeholder="Search by name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Stats */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Chip
          label={`${teamMembers.length} Team Members`}
          color="primary"
          variant="outlined"
        />
        <Chip
          label={`${teamMembers.filter((m) => m.twilioNumber && !m.useMainNumber).length} Assigned Numbers`}
          color="primary"
          variant="outlined"
        />
        <Chip
          label={`${teamMembers.filter((m) => m.gmailConnected).length} Gmail Connected`}
          color="primary"
          variant="outlined"
        />
      </Stack>

      {/* Team Members Grid */}
      {filteredMembers.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              {searchTerm ? 'No team members found matching your search' : 'No team members found'}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {filteredMembers.map((member) => (
            <Grid item xs={12} sm={6} md={4} key={member.id}>
              <SenderIdentityCard
                tenantId={activeTenant?.id || ''}
                teamMember={member}
                onUpdate={loadTeamMembers}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
};

export default SenderManagementPage;

