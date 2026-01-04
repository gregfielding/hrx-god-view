import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Avatar
} from '@mui/material';
import {
  Language as LanguageIcon,
  Person as PersonIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon
} from '@mui/icons-material';
import { getFunctions } from 'firebase/functions';

interface UserLanguagePreference {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  preferredLanguage: string;
  secondaryLanguage?: string;
  autoTranslate: boolean;
  translationQuality: 'high' | 'medium' | 'low';
  lastUpdated: Date;
  tenantId?: string;
  department?: string;
  location?: string;
}

interface LanguageStats {
  language: string;
  name: string;
  userCount: number;
  percentage: number;
}

const UserLanguagePreferences: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // User preferences state
  const [userPreferences, setUserPreferences] = useState<UserLanguagePreference[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserLanguagePreference[]>([]);
  
  // Language statistics state
  const [languageStats, setLanguageStats] = useState<LanguageStats[]>([]);
  
  // Dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserLanguagePreference | null>(null);
  
  // Filter states
  const [filters, setFilters] = useState({
    search: '',
    language: 'all',
    tenantId: 'all',
    department: 'all'
  });
  
  // Edit form state
  const [editForm, setEditForm] = useState({
    preferredLanguage: '',
    secondaryLanguage: '',
    autoTranslate: true,
    translationQuality: 'medium' as 'high' | 'medium' | 'low'
  });
  
  const functions = getFunctions();

  useEffect(() => {
    loadUserPreferences();
    loadLanguageStats();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [userPreferences, filters]);

  const loadUserPreferences = async () => {
    setLoading(true);
    try {
      // Mock data for demonstration
      const mockUsers: UserLanguagePreference[] = [
        {
          userId: 'user1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          preferredLanguage: 'en',
          secondaryLanguage: 'es',
          autoTranslate: true,
          translationQuality: 'high',
          lastUpdated: new Date(),
          tenantId: 'customer1',
          department: 'Engineering',
          location: 'New York'
        },
        {
          userId: 'user2',
          firstName: 'Maria',
          lastName: 'Garcia',
          email: 'maria.garcia@example.com',
          preferredLanguage: 'es',
          secondaryLanguage: 'en',
          autoTranslate: true,
          translationQuality: 'medium',
          lastUpdated: new Date(),
          tenantId: 'customer1',
          department: 'Sales',
          location: 'Miami'
        },
        {
          userId: 'user3',
          firstName: 'David',
          lastName: 'Smith',
          email: 'david.smith@example.com',
          preferredLanguage: 'en',
          autoTranslate: false,
          translationQuality: 'low',
          lastUpdated: new Date(),
          tenantId: 'customer2',
          department: 'Marketing',
          location: 'Los Angeles'
        }
      ];
      
      setUserPreferences(mockUsers);
    } catch (error: any) {
      setError(`Error loading user preferences: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadLanguageStats = async () => {
    setLoading(true);
    try {
      // Calculate statistics from user preferences
      const stats = calculateLanguageStats(userPreferences);
      setLanguageStats(stats);
    } catch (error: any) {
      setError(`Error loading language statistics: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const calculateLanguageStats = (users: UserLanguagePreference[]): LanguageStats[] => {
    const languageCounts: { [key: string]: number } = {};
    const totalUsers = users.length;
    
    users.forEach(user => {
      languageCounts[user.preferredLanguage] = (languageCounts[user.preferredLanguage] || 0) + 1;
    });
    
    return Object.entries(languageCounts).map(([language, count]) => ({
      language,
      name: getLanguageName(language),
      userCount: count,
      percentage: totalUsers > 0 ? (count / totalUsers) * 100 : 0
    }));
  };

  const applyFilters = () => {
    let filtered = userPreferences;
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(user =>
        user.firstName.toLowerCase().includes(searchLower) ||
        user.lastName.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower)
      );
    }
    
    if (filters.language !== 'all') {
      filtered = filtered.filter(user => user.preferredLanguage === filters.language);
    }
    
    if (filters.tenantId !== 'all') {
      filtered = filtered.filter(user => user.tenantId === filters.tenantId);
    }
    
    if (filters.department !== 'all') {
      filtered = filtered.filter(user => user.department === filters.department);
    }
    
    setFilteredUsers(filtered);
  };

  const handleEditUser = (user: UserLanguagePreference) => {
    setSelectedUser(user);
    setEditForm({
      preferredLanguage: user.preferredLanguage,
      secondaryLanguage: user.secondaryLanguage || '',
      autoTranslate: user.autoTranslate,
      translationQuality: user.translationQuality
    });
    setEditDialogOpen(true);
  };

  const handleSaveUserPreferences = async () => {
    if (!selectedUser) return;
    
    setLoading(true);
    try {
      // This would update the user preferences in the backend
      const updatedUsers = userPreferences.map(user =>
        user.userId === selectedUser.userId
          ? {
              ...user,
              preferredLanguage: editForm.preferredLanguage,
              secondaryLanguage: editForm.secondaryLanguage || undefined,
              autoTranslate: editForm.autoTranslate,
              translationQuality: editForm.translationQuality,
              lastUpdated: new Date()
            }
          : user
      );
      
      setUserPreferences(updatedUsers);
      setEditDialogOpen(false);
      setSelectedUser(null);
      setSuccess('User language preferences updated successfully!');
    } catch (error: any) {
      setError(`Error updating user preferences: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkUpdate = async (updates: Partial<UserLanguagePreference>) => {
    setLoading(true);
    try {
      // This would perform bulk updates in the backend
      const updatedUsers = userPreferences.map(user => ({
        ...user,
        ...updates,
        lastUpdated: new Date()
      }));
      
      setUserPreferences(updatedUsers);
      setSuccess('Bulk update completed successfully!');
    } catch (error: any) {
      setError(`Error performing bulk update: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getLanguageName = (code: string) => {
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese'
    };
    return languageNames[code] || code.toUpperCase();
  };

  const getQualityColor = (quality: string) => {
    switch (quality) {
      case 'high': return 'success';
      case 'medium': return 'warning';
      case 'low': return 'error';
      default: return 'default';
    }
  };

  const getUniqueValues = (field: keyof UserLanguagePreference) => {
    const values = userPreferences.map(user => user[field]).filter(Boolean);
    return [...new Set(values)];
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        User Language Preferences
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
      
      <Box sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="User Preferences" icon={<PersonIcon />} />
          <Tab label="Language Statistics" icon={<LanguageIcon />} />
          <Tab label="Bulk Operations" icon={<EditIcon />} />
        </Tabs>
      </Box>
      
      {activeTab === 0 && (
        <Box>
          {/* Filters */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Filters
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    fullWidth
                    label="Search Users"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    InputProps={{
                      startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                    }}
                  />
                </Grid>
                
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Language</InputLabel>
                    <Select
                      value={filters.language}
                      label="Language"
                      onChange={(e) => setFilters({ ...filters, language: e.target.value })}
                    >
                      <MenuItem value="all">All Languages</MenuItem>
                      <MenuItem value="en">English</MenuItem>
                      <MenuItem value="es">Spanish</MenuItem>
                      <MenuItem value="fr">French</MenuItem>
                      <MenuItem value="de">German</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Department</InputLabel>
                    <Select
                      value={filters.department}
                      label="Department"
                      onChange={(e) => setFilters({ ...filters, department: e.target.value })}
                    >
                      <MenuItem value="all">All Departments</MenuItem>
                      {getUniqueValues('department').map(dept => (
                        <MenuItem key={String(dept)} value={String(dept)}>{String(dept)}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={12} sm={6} md={3}>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={() => setFilters({
                      search: '',
                      language: 'all',
                      tenantId: 'all',
                      department: 'all'
                    })}
                  >
                    Clear Filters
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
          
          {/* Users Table */}
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  User Language Preferences ({filteredUsers.length} users)
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={loadUserPreferences}
                  disabled={loading}
                >
                  Refresh
                </Button>
              </Box>
              
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>User</TableCell>
                      <TableCell>Preferred Language</TableCell>
                      <TableCell>Secondary Language</TableCell>
                      <TableCell>Auto-translate</TableCell>
                      <TableCell>Quality</TableCell>
                      <TableCell>Department</TableCell>
                      <TableCell>Last Updated</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={8} align="center">
                          <CircularProgress />
                        </TableCell>
                      </TableRow>
                    ) : filteredUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} align="center">
                          No users found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUsers.map((user) => (
                        <TableRow key={user.userId}>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              <Avatar sx={{ mr: 2 }}>
                                {user.firstName[0]}{user.lastName[0]}
                              </Avatar>
                              <Box>
                                <Typography variant="body2">
                                  {user.firstName} {user.lastName}
                                </Typography>
                                <Typography variant="caption" color="textSecondary">
                                  {user.email}
                                </Typography>
                              </Box>
                            </Box>
                          </TableCell>
                          
                          <TableCell>
                            <Chip
                              label={getLanguageName(user.preferredLanguage)}
                              color="primary"
                              size="small"
                            />
                          </TableCell>
                          
                          <TableCell>
                            {user.secondaryLanguage ? (
                              <Chip
                                label={getLanguageName(user.secondaryLanguage)}
                                variant="outlined"
                                size="small"
                              />
                            ) : (
                              <Typography variant="body2" color="textSecondary">
                                None
                              </Typography>
                            )}
                          </TableCell>
                          
                          <TableCell>
                            <Switch
                              checked={user.autoTranslate}
                              disabled
                              size="small"
                            />
                          </TableCell>
                          
                          <TableCell>
                            <Chip
                              label={user.translationQuality}
                              color={getQualityColor(user.translationQuality) as any}
                              size="small"
                            />
                          </TableCell>
                          
                          <TableCell>
                            <Typography variant="body2">
                              {user.department || 'N/A'}
                            </Typography>
                          </TableCell>
                          
                          <TableCell>
                            <Typography variant="body2" color="textSecondary">
                              {user.lastUpdated.toLocaleDateString()}
                            </Typography>
                          </TableCell>
                          
                          <TableCell>
                            <Tooltip title="Edit Preferences">
                              <IconButton
                                size="small"
                                onClick={() => handleEditUser(user)}
                              >
                                <EditIcon />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Box>
      )}
      
      {activeTab === 1 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Language Distribution
                </Typography>
                {languageStats.map((stat) => (
                  <Box key={stat.language} sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">
                        {stat.name}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {stat.userCount} users ({stat.percentage.toFixed(1)}%)
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        width: '100%',
                        height: 8,
                        backgroundColor: 'grey.200',
                        borderRadius: 1,
                        overflow: 'hidden'
                      }}
                    >
                      <Box
                        sx={{
                          width: `${stat.percentage}%`,
                          height: '100%',
                          backgroundColor: 'primary.main',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Translation Quality Distribution
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {['high', 'medium', 'low'].map((quality) => {
                    const count = userPreferences.filter(u => u.translationQuality === quality).length;
                    const percentage = userPreferences.length > 0 ? (count / userPreferences.length) * 100 : 0;
                    
                    return (
                      <Box key={quality}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                          <Chip
                            label={quality}
                            color={getQualityColor(quality) as any}
                            size="small"
                          />
                          <Typography variant="body2" color="textSecondary">
                            {count} users ({percentage.toFixed(1)}%)
                          </Typography>
                        </Box>
                        <Box
                          sx={{
                            width: '100%',
                            height: 6,
                            backgroundColor: 'grey.200',
                            borderRadius: 1,
                            overflow: 'hidden'
                          }}
                        >
                          <Box
                            sx={{
                              width: `${percentage}%`,
                              height: '100%',
                              backgroundColor: getQualityColor(quality) === 'success' ? 'success.main' :
                                               getQualityColor(quality) === 'warning' ? 'warning.main' : 'error.main',
                              transition: 'width 0.3s ease'
                            }}
                          />
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
      
      {activeTab === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Bulk Operations
            </Typography>
            
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Set Default Language
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <FormControl sx={{ minWidth: 120 }}>
                    <InputLabel>Language</InputLabel>
                    <Select
                      value=""
                      label="Language"
                      onChange={(e) => handleBulkUpdate({ preferredLanguage: e.target.value })}
                    >
                      <MenuItem value="en">English</MenuItem>
                      <MenuItem value="es">Spanish</MenuItem>
                      <MenuItem value="fr">French</MenuItem>
                      <MenuItem value="de">German</MenuItem>
                    </Select>
                  </FormControl>
                  <Button variant="outlined">
                    Apply to All
                  </Button>
                </Box>
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Enable Auto-translate
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <FormControlLabel
                    control={
                      <Switch
                        onChange={(e) => handleBulkUpdate({ autoTranslate: e.target.checked })}
                      />
                    }
                    label="Enable for all users"
                  />
                </Box>
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Set Translation Quality
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <FormControl sx={{ minWidth: 120 }}>
                    <InputLabel>Quality</InputLabel>
                    <Select
                      value=""
                      label="Quality"
                      onChange={(e) => handleBulkUpdate({ translationQuality: e.target.value as any })}
                    >
                      <MenuItem value="high">High</MenuItem>
                      <MenuItem value="medium">Medium</MenuItem>
                      <MenuItem value="low">Low</MenuItem>
                    </Select>
                  </FormControl>
                  <Button variant="outlined">
                    Apply to All
                  </Button>
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
      
      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Edit Language Preferences - {selectedUser?.firstName} {selectedUser?.lastName}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Preferred Language</InputLabel>
                <Select
                  value={editForm.preferredLanguage}
                  label="Preferred Language"
                  onChange={(e) => setEditForm({ ...editForm, preferredLanguage: e.target.value })}
                >
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="es">Spanish</MenuItem>
                  <MenuItem value="fr">French</MenuItem>
                  <MenuItem value="de">German</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Secondary Language</InputLabel>
                <Select
                  value={editForm.secondaryLanguage}
                  label="Secondary Language"
                  onChange={(e) => setEditForm({ ...editForm, secondaryLanguage: e.target.value })}
                >
                  <MenuItem value="">None</MenuItem>
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="es">Spanish</MenuItem>
                  <MenuItem value="fr">French</MenuItem>
                  <MenuItem value="de">German</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editForm.autoTranslate}
                    onChange={(e) => setEditForm({ ...editForm, autoTranslate: e.target.checked })}
                  />
                }
                label="Enable Auto-translate"
              />
            </Grid>
            
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Translation Quality</InputLabel>
                <Select
                  value={editForm.translationQuality}
                  label="Translation Quality"
                  onChange={(e) => setEditForm({ ...editForm, translationQuality: e.target.value as any })}
                >
                  <MenuItem value="high">High</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="low">Low</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleSaveUserPreferences} 
            variant="contained"
            disabled={loading}
            startIcon={<SaveIcon />}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserLanguagePreferences; 