import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  Card,
  CardContent,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip
} from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface GmailReauthHelperProps {
  tenantId: string;
}

interface UserWithGmailIssue {
  id: string;
  email: string;
  displayName?: string;
  gmailAuthNeeded?: boolean;
  gmailAuthError?: string;
}

const GmailReauthHelper: React.FC<GmailReauthHelperProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const [usersWithGmailIssues, setUsersWithGmailIssues] = useState<UserWithGmailIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadUsersWithGmailIssues = async () => {
    if (!tenantId) return;
    
    try {
      setLoading(true);
      
      // Query users who need Gmail re-authentication
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where(`tenantIds.${tenantId}.status`, '==', 'active'),
        where('gmailAuthNeeded', '==', true)
      );
      
      const snapshot = await getDocs(q);
      const users: UserWithGmailIssue[] = [];
      
      snapshot.forEach(doc => {
        const userData = doc.data();
        users.push({
          id: doc.id,
          email: userData.email || '',
          displayName: userData.displayName || userData.firstName + ' ' + userData.lastName || '',
          gmailAuthNeeded: userData.gmailAuthNeeded,
          gmailAuthError: userData.gmailAuthError
        });
      });
      
      setUsersWithGmailIssues(users);
    } catch (error) {
      console.error('Error loading users with Gmail issues:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearGmailAuthFlag = async (userId: string) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        gmailAuthNeeded: false,
        gmailAuthError: null
      });
      
      // Refresh the list
      await loadUsersWithGmailIssues();
    } catch (error) {
      console.error('Error clearing Gmail auth flag:', error);
    }
  };

  const refreshList = async () => {
    setRefreshing(true);
    await loadUsersWithGmailIssues();
    setRefreshing(false);
  };

  useEffect(() => {
    loadUsersWithGmailIssues();
  }, [tenantId]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h6" fontWeight="bold">
            Gmail Authentication Issues
          </Typography>
          <Button
            startIcon={<RefreshIcon />}
            onClick={refreshList}
            disabled={refreshing}
            size="small"
          >
            Refresh
          </Button>
        </Box>

        {usersWithGmailIssues.length === 0 ? (
          <Alert severity="success" icon={<CheckCircleIcon />}>
            No users with Gmail authentication issues found.
          </Alert>
        ) : (
          <>
            <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
              {usersWithGmailIssues.length} user(s) need to re-authenticate with Gmail. 
              Their access tokens have expired or been revoked.
            </Alert>

            <List>
              {usersWithGmailIssues.map((userWithIssue) => (
                <ListItem
                  key={userWithIssue.id}
                  sx={{
                    border: '1px solid',
                    borderColor: 'warning.light',
                    borderRadius: 1,
                    mb: 1,
                    bgcolor: 'warning.50'
                  }}
                >
                  <ListItemIcon>
                    <ErrorIcon color="warning" />
                  </ListItemIcon>
                  <ListItemText
                    primaryTypographyProps={{ component: 'div' }}
                    secondaryTypographyProps={{ component: 'div' }}
                    primary={
                      <Box component="span" display="inline-flex" alignItems="center" gap={1}>
                        <Typography variant="body1" fontWeight="medium" component="span">
                          {userWithIssue.displayName || userWithIssue.email}
                        </Typography>
                        <Chip 
                          label="Needs Re-auth" 
                          size="small" 
                          color="warning" 
                          variant="outlined"
                        />
                      </Box>
                    }
                    secondary={
                      <Box component="span">
                        <Typography variant="body2" color="text.secondary" component="span">
                          {userWithIssue.email}
                        </Typography>
                        {userWithIssue.gmailAuthError && (
                          <Typography variant="caption" color="error" component="div">
                            Error: {userWithIssue.gmailAuthError}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => clearGmailAuthFlag(userWithIssue.id)}
                    sx={{ ml: 1 }}
                  >
                    Mark Resolved
                  </Button>
                </ListItem>
              ))}
            </List>

            <Box mt={2}>
              <Typography variant="body2" color="text.secondary">
                <strong>Instructions for users:</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary" component="div">
                <ol>
                  <li>Users need to go to their profile settings</li>
                  <li>Disconnect and reconnect their Gmail account</li>
                  <li>Grant the necessary permissions when prompted</li>
                  <li>Once re-authenticated, click "Mark Resolved" above</li>
                </ol>
              </Typography>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default GmailReauthHelper;
