import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';
import { People as PeopleIcon } from '@mui/icons-material';
import { doc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

interface LaborPoolSelectorProps {
  jobOrderId: string;
  tenantId: string;
  currentLaborPoolGroups?: string[];
  onUpdate?: () => void;
}

interface UserGroup {
  id: string;
  groupName: string;
}

const LaborPoolSelector: React.FC<LaborPoolSelectorProps> = ({
  jobOrderId,
  tenantId,
  currentLaborPoolGroups = [],
  onUpdate,
}) => {
  const [laborPoolType, setLaborPoolType] = useState<'all' | 'groups'>(
    currentLaborPoolGroups.length > 0 ? 'groups' : 'all'
  );
  const [selectedGroups, setSelectedGroups] = useState<string[]>(currentLaborPoolGroups);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load user groups on mount
  useEffect(() => {
    const loadUserGroups = async () => {
      if (!tenantId) return;
      
      try {
        setLoading(true);
        const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
        const groupsSnap = await getDocs(groupsRef);
        const groups = groupsSnap.docs.map(doc => ({
          id: doc.id,
          groupName: doc.data().groupName || doc.data().name || doc.id
        }));
        setUserGroups(groups);
      } catch (err) {
        console.error('Error loading user groups:', err);
        setError('Failed to load user groups');
      } finally {
        setLoading(false);
      }
    };

    loadUserGroups();
  }, [tenantId]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      
      // If "All Users", clear the laborPoolGroups array
      // If "Select User Groups", save the selected groups
      const laborPoolGroups = laborPoolType === 'all' ? [] : selectedGroups;
      
      await updateDoc(jobOrderRef, {
        laborPoolGroups,
        updatedAt: new Date()
      });

      setSuccess('Labor pool updated successfully');
      
      if (onUpdate) {
        onUpdate();
      }
    } catch (err: any) {
      console.error('Error updating labor pool:', err);
      setError(err.message || 'Failed to update labor pool');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <PeopleIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Labor Pool
        </Typography>
      </Box>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Define which workers can be selected for this job order in the Placements tab.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Labor Pool</InputLabel>
        <Select
          value={laborPoolType}
          label="Labor Pool"
          onChange={(e) => {
            const newType = e.target.value as 'all' | 'groups';
            setLaborPoolType(newType);
            if (newType === 'all') {
              setSelectedGroups([]);
            }
          }}
          disabled={loading || saving}
        >
          <MenuItem value="all">All Users</MenuItem>
          <MenuItem value="groups">Select User Groups</MenuItem>
        </Select>
      </FormControl>

      {laborPoolType === 'groups' && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>User Groups</InputLabel>
          <Select
            multiple
            value={selectedGroups}
            onChange={(e) => setSelectedGroups(e.target.value as string[])}
            input={<OutlinedInput label="User Groups" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((groupId) => {
                  const group = userGroups.find(g => g.id === groupId);
                  return (
                    <Chip 
                      key={groupId} 
                      label={group?.groupName || groupId}
                      size="small"
                    />
                  );
                })}
              </Box>
            )}
            disabled={loading || saving}
          >
            {userGroups.length === 0 ? (
              <MenuItem disabled>
                {loading ? 'Loading groups...' : 'No user groups available'}
              </MenuItem>
            ) : (
              userGroups.map((group) => (
                <MenuItem key={group.id} value={group.id}>
                  {group.groupName}
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>
      )}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={loading || saving}
          startIcon={saving && <CircularProgress size={16} />}
        >
          {saving ? 'Saving...' : 'Save Labor Pool'}
        </Button>

        {laborPoolType === 'groups' && selectedGroups.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {selectedGroups.length} group{selectedGroups.length !== 1 ? 's' : ''} selected
          </Typography>
        )}
      </Box>

      <Box sx={{ mt: 2, p: 2, bgcolor: 'info.lighter', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary">
          <strong>How it works:</strong> In the Placements tab, the workforce dropdown will show:
          <br />• Applicants (those who applied for shifts)
          <br />• Candidates (shortlisted applicants)
          {laborPoolType === 'groups' && selectedGroups.length > 0 && (
            <>
              <br />• {selectedGroups.map(id => userGroups.find(g => g.id === id)?.groupName || id).join(', ')}
            </>
          )}
        </Typography>
      </Box>
    </Box>
  );
};

export default LaborPoolSelector;

