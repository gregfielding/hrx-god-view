import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  Chip,
  Grid,
  Paper,
} from '@mui/material';
import { doc, getDoc, onSnapshot, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';

interface UserGroupsTabProps {
  uid: string;
}

const UserGroupsTab: React.FC<UserGroupsTabProps> = ({ uid }) => {
  const { tenantId: activeTenantId } = useAuth();
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [tenantName, setTenantName] = useState<string>('');

  useEffect(() => {
    if (activeTenantId) {
      loadUserGroups(activeTenantId);
    }
  }, [activeTenantId]);

  const loadUserGroups = async (tenantId: string) => {
    try {
      // Fetch user groups
      const gq = collection(db, 'tenants', tenantId, 'userGroups');
      const gSnap = await getDocs(gq);
      const groupData = gSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUserGroups(groupData);

      // Fetch current user's group memberships
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        setUserGroupIds(userData.userGroupIds || []);
      }
    } catch (error) {
      console.error('Error loading user groups:', error);
      setUserGroups([]);
    }
  };

  const handleUserGroupsChange = (event: any, newValue: any[]) => {
    const newGroupIds = newValue.map((group: any) => group.id);
    setUserGroupIds(newGroupIds);
    
    // Persist to Firestore
    const userRef = doc(db, 'users', uid);
    updateDoc(userRef, { 
      userGroupIds: newGroupIds,
      updatedAt: new Date()
    }).catch((error) => {
      console.error('Error updating user groups:', error);
    });
  };

  return (
    <Box sx={{ p: 0 }}>
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          User Groups
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Manage which user groups this user belongs to. User groups help organize users and control access to specific features.
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
                <TextField 
                  {...params} 
                  label="User Groups" 
                  placeholder="Select groups" 
                  fullWidth 
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    label={option.title || option.id}
                    {...getTagProps({ index })}
                    key={option.id}
                  />
                ))
              }
              isOptionEqualToValue={(option, value) => option.id === value.id}
            />
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

export default UserGroupsTab;
