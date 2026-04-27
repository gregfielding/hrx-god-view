import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  Avatar,
  Chip,
  Typography,
  CircularProgress,
  Alert
} from '@mui/material';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db } from '../../firebase';

interface PeopleGridViewProps {
  tenantId: string;
}

// Mock data for demonstration
const getMockPersonData = (person: any) => ({
  jsiScore: Math.floor(Math.random() * 3) + 6, // 6-8
  burnoutRisk: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
  roleType: ['Worker', 'Supervisor', 'Manager'][Math.floor(Math.random() * 3)],
  tags: ['Lead', 'High Potential', 'New Hire'].slice(0, Math.floor(Math.random() * 2) + 1)
});

const getRiskColor = (risk: string) => {
  switch (risk) {
    case 'high': return 'error';
    case 'medium': return 'warning';
    case 'low': return 'success';
    default: return 'default';
  }
};

const PeopleGridView: React.FC<PeopleGridViewProps> = ({ tenantId }) => {
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  
  // Filters
  const [locationFilter, setLocationFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [burnoutFilter, setBurnoutFilter] = useState('');
  const [roleTypeFilter, setRoleTypeFilter] = useState('');
  
  // Filter options
  const [locations, setLocations] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        // Fetch people
        const peopleQuery = query(
          collection(db, 'users'),
          where('tenantId', '==', tenantId),
          where('role', '==', 'Worker')
        );
        const peopleSnap = await getDocs(peopleQuery);
        const peopleData = peopleSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPeople(peopleData);

        // Fetch filter options
        const locationsSnap = await getDocs(collection(db, 'tenants', tenantId, 'locations'));
        setLocations(locationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const divisionsSnap = await getDocs(collection(db, 'tenants', tenantId, 'divisions'));
        setDivisions(divisionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const departmentsSnap = await getDocs(collection(db, 'tenants', tenantId, 'departments'));
        setDepartments(departmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (err: any) {
        setError(err.message || 'Failed to load people data');
      }
      setLoading(false);
    };
    fetchData();
  }, [tenantId]);

  // Filter people based on search and filters
  const filteredPeople = people.filter(person => {
    const matchesSearch = !search || 
      person.firstName?.toLowerCase().includes(search.toLowerCase()) ||
      person.lastName?.toLowerCase().includes(search.toLowerCase()) ||
      person.jobTitle?.toLowerCase().includes(search.toLowerCase());
    
    const matchesLocation = !locationFilter || person.locationIds?.includes(locationFilter);
    const matchesDivision = !divisionFilter || person.divisionId === divisionFilter;
    const matchesDepartment = !departmentFilter || person.departmentId === departmentFilter;
    const matchesBurnout = !burnoutFilter || getMockPersonData(person).burnoutRisk === burnoutFilter;
    const matchesRoleType = !roleTypeFilter || getMockPersonData(person).roleType === roleTypeFilter;

    return matchesSearch && matchesLocation && matchesDivision && matchesDepartment && matchesBurnout && matchesRoleType;
  });

  const handleSelectAll = () => {
    if (selectedRows.length === filteredPeople.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(filteredPeople.map(p => p.id));
    }
  };

  const handleSelectRow = (personId: string) => {
    setSelectedRows(prev => 
      prev.includes(personId) 
        ? prev.filter(id => id !== personId)
        : [...prev, personId]
    );
  };

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      {/* Search and Filters */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            label="Search people..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            sx={{ minWidth: 200 }}
          />
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Location</InputLabel>
            <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <MenuItem value="">All Locations</MenuItem>
              {locations.map(loc => (
                <MenuItem key={loc.id} value={loc.id}>{loc.nickname || loc.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Division</InputLabel>
            <Select value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)}>
              <MenuItem value="">All Divisions</MenuItem>
              {divisions.map(div => (
                <MenuItem key={div.id} value={div.id}>{div.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Department</InputLabel>
            <Select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
              <MenuItem value="">All Departments</MenuItem>
              {departments.map(dept => (
                <MenuItem key={dept.id} value={dept.id}>{dept.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Burnout Risk</InputLabel>
            <Select value={burnoutFilter} onChange={(e) => setBurnoutFilter(e.target.value)}>
              <MenuItem value="">All Levels</MenuItem>
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Role Type</InputLabel>
            <Select value={roleTypeFilter} onChange={(e) => setRoleTypeFilter(e.target.value)}>
              <MenuItem value="">All Roles</MenuItem>
              <MenuItem value="Worker">Worker</MenuItem>
              <MenuItem value="Supervisor">Supervisor</MenuItem>
              <MenuItem value="Manager">Manager</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Paper>

      {/* Results Summary */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Showing {filteredPeople.length} of {people.length} people
          {selectedRows.length > 0 && ` (${selectedRows.length} selected)`}
        </Typography>
      </Box>

      {/* Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedRows.length === filteredPeople.length && filteredPeople.length > 0}
                  indeterminate={selectedRows.length > 0 && selectedRows.length < filteredPeople.length}
                  onChange={handleSelectAll}
                />
              </TableCell>
              <TableCell>Avatar</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Division</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Manager</TableCell>
              <TableCell>JSI</TableCell>
              <TableCell>Burnout Risk</TableCell>
              <TableCell>Role Type</TableCell>
              <TableCell>Tags</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredPeople
              .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
              .map((person) => {
                const personData = getMockPersonData(person);
                return (
                  <TableRow 
                    key={person.id}
                    hover
                    selected={selectedRows.includes(person.id)}
                    onClick={() => handleSelectRow(person.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedRows.includes(person.id)}
                        onChange={() => handleSelectRow(person.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell>
                      <Avatar sx={{ width: 32, height: 32 }}>
                        {person.firstName?.[0]}{person.lastName?.[0]}
                      </Avatar>
                    </TableCell>
                    <TableCell>{person.firstName} {person.lastName}</TableCell>
                    <TableCell>{person.jobTitle || 'N/A'}</TableCell>
                    <TableCell>
                      {divisions.find(d => d.id === person.divisionId)?.name || 'N/A'}
                    </TableCell>
                    <TableCell>
                      {departments.find(d => d.id === person.departmentId)?.name || 'N/A'}
                    </TableCell>
                    <TableCell>
                      {locations.find(l => person.locationIds?.includes(l.id))?.nickname || 'N/A'}
                    </TableCell>
                    <TableCell>N/A</TableCell>
                    <TableCell>
                      <Chip 
                        label={personData.jsiScore} 
                        size="small"
                        color={personData.jsiScore >= 7 ? 'success' : personData.jsiScore >= 5 ? 'warning' : 'error'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={personData.burnoutRisk} 
                        size="small"
                        color={getRiskColor(personData.burnoutRisk)}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={personData.roleType} 
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {personData.tags.map((tag: string, index: number) => (
                          <Chip key={index} label={tag} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
        <TablePagination
          rowsPerPageOptions={[5, 10, 25]}
          component="div"
          count={filteredPeople.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      </TableContainer>
    </Box>
  );
};

export default PeopleGridView; 