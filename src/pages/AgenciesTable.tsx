import React, { useEffect, useState, useRef } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Typography,
  TextField,
  Button,
} from '@mui/material';
import { collection, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { ArrowDropUp, ArrowDropDown } from '@mui/icons-material';
import { doc, getDoc } from 'firebase/firestore';

const PAGE_SIZE = 10;

type Agency = {
  id: string;
  name: string;
  contactEmail?: string;
  phone?: string;
  createdAt?: any;
  city?: string;
  state?: string;
  avatar?: string;
  address?: {
    city?: string;
    state?: string;
  };
};

const AgenciesTable = () => {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [workforceCounts, setWorkforceCounts] = useState<Record<string, number>>({});
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [isEnd, setIsEnd] = useState(false);
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const firstLoadRef = useRef(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAgencies();
  }, []);

  const fetchAgencies = async (searchQuery = '', startDoc: any = null) => {
    setLoading(true);
    try {
      const baseRef = collection(db, 'agencies');
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(PAGE_SIZE)];

      if (searchQuery.trim()) {
        const searchLower = searchQuery.toLowerCase();
        constraints.push(where('searchKeywords', 'array-contains', searchLower));
      }

      if (startDoc) {
        constraints.push(startAfter(startDoc));
      }

      const q = query(baseRef, ...constraints);
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const results = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            city: data.address?.city || '',
            state: data.address?.state || '',
          };
        }) as Agency[];
        results.forEach(async (agency) => {
          try {
            const usersSnap = await getDocs(query(collection(db, 'users'), where('agencyId', '==', agency.id), where('role', '==', 'Worker')));
            setWorkforceCounts((prev) => ({ ...prev, [agency.id]: usersSnap.size }));
          } catch {
            setWorkforceCounts((prev) => ({ ...prev, [agency.id]: 0 }));
          }
          setLogoUrls((prev) => ({
            ...prev,
            [agency.id]: agency.avatar || '/img/default-logo.png',
          }));
        });
        setAgencies((prev) => (startDoc ? [...prev, ...results] : results));
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        setIsEnd(snapshot.size < PAGE_SIZE);
      } else {
        if (!startDoc) setAgencies([]);
        setIsEnd(true);
      }
    } catch (error) {
      console.error('Error fetching agencies:', error);
    }
    setLoading(false);
  };

  const handleSearch = () => {
    setHasSearched(true);
    fetchAgencies(search);
  };

  const handleClearSearch = () => {
    setSearch('');
    setHasSearched(false);
    fetchAgencies('');
  };

  const getSortValue = (agency: Agency & { workforceCount?: number; city?: string; state?: string }, field: string): string | number => {
    if (field === 'name') return agency.name || '';
    if (field === 'workforce') return workforceCounts[agency.id] ?? 0;
    if (field === 'city') return agency.city || '';
    if (field === 'state') return agency.state || '';
    return '';
  };

  const getSortedAgencies = () => {
    if (!sortField) return agencies;
    const sorted = [...agencies].sort((a, b) => {
      let aValue = getSortValue(a, sortField);
      let bValue = getSortValue(b, sortField);
      if (sortField === 'workforce') {
        return sortDirection === 'asc' ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
      } else {
        aValue = (aValue as string).toLowerCase();
        bValue = (bValue as string).toLowerCase();
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      }
    });
    return sorted;
  };

  const sortedAgencies = getSortedAgencies();

  return (
    <Box p={0}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h4" gutterBottom>
          Agencies
        </Typography>
        <Button variant="contained" color="primary" onClick={() => navigate('/agencies/new')}>
          Add Agency
        </Button>
      </Box>

      <Box display="flex" gap={2} mb={2} alignItems="center">
        <TextField
          variant="outlined"
          size="medium"
          placeholder="Search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (hasSearched) {
              setHasSearched(false);
            }
          }}
        />
        {search.trim() && !hasSearched && (
          <Button variant="contained" size="large" onClick={handleSearch}>
            SEARCH
          </Button>
        )}
        {hasSearched && (
          <Button variant="outlined" size="large" onClick={handleClearSearch}>
            CLEAR
          </Button>
        )}
      </Box>

      {loading && firstLoadRef.current ? (
        <CircularProgress />
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Logo</TableCell>
                <TableCell
                  onClick={() => {
                    if (sortField === 'name') {
                      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                    } else {
                      setSortField('name');
                      setSortDirection('asc');
                    }
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  Name
                  {sortField === 'name' && (
                    sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                  )}
                </TableCell>
                <TableCell
                  onClick={() => {
                    if (sortField === 'workforce') {
                      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                    } else {
                      setSortField('workforce');
                      setSortDirection('asc');
                    }
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  Workforce
                  {sortField === 'workforce' && (
                    sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                  )}
                </TableCell>
                <TableCell
                  onClick={() => {
                    if (sortField === 'city') {
                      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                    } else {
                      setSortField('city');
                      setSortDirection('asc');
                    }
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  City
                  {sortField === 'city' && (
                    sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                  )}
                </TableCell>
                <TableCell
                  onClick={() => {
                    if (sortField === 'state') {
                      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                    } else {
                      setSortField('state');
                      setSortDirection('asc');
                    }
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  State
                  {sortField === 'state' && (
                    sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                  )}
                </TableCell>
                <TableCell>View</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedAgencies.map((agency) => (
                <TableRow key={agency.id}>
                  <TableCell>
                    {logoUrls[agency.id] && logoUrls[agency.id] !== '/img/default-logo.png' && (
                      <img
                        src={logoUrls[agency.id]}
                        alt={agency.name}
                        style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }}
                        onError={() => {
                          setLogoUrls((prev) => ({
                            ...prev,
                            [agency.id]: '',
                          }));
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>{agency.name}</TableCell>
                  <TableCell>{workforceCounts[agency.id] !== undefined ? workforceCounts[agency.id] : '-'}</TableCell>
                  <TableCell>{agency.city || '-'}</TableCell>
                  <TableCell>{agency.state || '-'}</TableCell>
                  <TableCell>
                    <Button
                      component={Link}
                      to={`/agencies/${agency.id}`}
                      variant="outlined"
                      size="small"
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {!isEnd && (
        <Box mt={2}>
          <Button onClick={() => fetchAgencies(search, lastDoc)} disabled={loading}>
            Load More
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default AgenciesTable;

export {};
// ... existing code ... 