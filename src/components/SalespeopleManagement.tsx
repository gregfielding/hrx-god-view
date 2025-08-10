import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Switch,
  FormControlLabel,
  Button,
  Alert,
  CircularProgress,
  Chip,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
  Search as SearchIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { collection, query, getDocs, doc, updateDoc } from 'firebase/firestore';

import { db } from '../firebase';

interface SalespeopleManagementProps {
  tenantId: string;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string;
  crm_sales?: boolean;
  securityLevel?: string;
}

const SalespeopleManagement: React.FC<SalespeopleManagementProps> = ({ tenantId }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadUsers();
  }, [tenantId]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const usersQuery = query(collection(db, 'tenants', tenantId, 'users'));
      const usersSnapshot = await getDocs(usersQuery);
      const usersData = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as User[];
      setUsers(usersData);
    } catch (err: any) {
      console.error('Error loading users:', err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const toggleSalesperson = async (userId: string, isSalesperson: boolean) => {
    try {
      setSaving(true);
      await updateDoc(doc(db, 'tenants', tenantId, 'users', userId), {
        crm_sales: isSalesperson
      });
      
      // Update local state
      setUsers(prev => prev.map(user => 
        user.id === userId ? { ...user, crm_sales: isSalesperson } : user
      ));
      
      setSuccess(`${isSalesperson ? 'Added' : 'Removed'} salesperson successfully`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Error updating user:', err);
      setError('Failed to update user');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = users.filter(user => 
    user.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.jobTitle?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const salespeople = users.filter(user => user.crm_sales);
  const nonSalespeople = users.filter(user => !user.crm_sales);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Salespeople Management
      </Typography>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Select which tenant workers should have access to CRM sales features. 
        Salespeople will appear in deal associations and can be assigned to opportunities.
      </Typography>

      {/* Statistics */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <Card sx={{ minWidth: 120 }}>
          <CardContent sx={{ textAlign: 'center', py: 2 }}>
            <Typography variant="h4" color="primary">
              {salespeople.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Salespeople
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ minWidth: 120 }}>
          <CardContent sx={{ textAlign: 'center', py: 2 }}>
            <Typography variant="h4" color="text.secondary">
              {nonSalespeople.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Other Workers
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ minWidth: 120 }}>
          <CardContent sx={{ textAlign: 'center', py: 2 }}>
            <Typography variant="h4" color="text.secondary">
              {users.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total Workers
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Alerts */}
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

      {/* Search */}
      <TextField
        fullWidth
        placeholder="Search users by name, email, or job title..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 3 }}
        size="small"
      />

      {/* Users Table */}
      <Card>
        <CardHeader 
          title={`Workers (${filteredUsers.length})`}
          action={
            <Button
              size="small"
              variant="outlined"
              onClick={loadUsers}
              disabled={saving}
            >
              Refresh
            </Button>
          }
        />
        <CardContent>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Job Title</TableCell>
                  <TableCell>Security Level</TableCell>
                  <TableCell align="center">Salesperson</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PersonIcon fontSize="small" color="action" />
                        <Typography>
                          {user.firstName} {user.lastName}
                        </Typography>
                        {user.crm_sales && (
                          <Chip 
                            label="Sales" 
                            size="small" 
                            color="primary" 
                            variant="outlined"
                          />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.jobTitle || '-'}</TableCell>
                    <TableCell>
                      <Chip 
                        label={user.securityLevel || 'Standard'} 
                        size="small" 
                        color={user.securityLevel === 'Admin' ? 'error' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <FormControlLabel
                        control={
                          <Switch
                            checked={user.crm_sales || false}
                            onChange={(e) => toggleSalesperson(user.id, e.target.checked)}
                            disabled={saving}
                            size="small"
                          />
                        }
                        label=""
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
        <Button
          variant="outlined"
          startIcon={<BusinessIcon />}
          onClick={() => {
            // Mark all users as salespeople
            users.forEach(user => {
              if (!user.crm_sales) {
                toggleSalesperson(user.id, true);
              }
            });
          }}
          disabled={saving}
        >
          Mark All as Salespeople
        </Button>
        <Button
          variant="outlined"
          color="secondary"
          onClick={() => {
            // Remove all salespeople
            users.forEach(user => {
              if (user.crm_sales) {
                toggleSalesperson(user.id, false);
              }
            });
          }}
          disabled={saving}
        >
          Remove All Salespeople
        </Button>
      </Box>
    </Box>
  );
};

export default SalespeopleManagement; 