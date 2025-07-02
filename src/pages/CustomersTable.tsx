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
  Autocomplete,
} from '@mui/material';
import { collection, getDocs, limit, orderBy, query, startAfter, where, doc, getDoc } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { ArrowDropUp, ArrowDropDown } from '@mui/icons-material';

const PAGE_SIZE = 10;

type Customer = {
  id: string;
  name: string;
  avatar?: string;
  city?: string;
  state?: string;
  createdAt?: any;
};

const CustomersTable = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [workforceCounts, setWorkforceCounts] = useState<Record<string, number>>({});
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({});
  const [agencyNames, setAgencyNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [agencyFilter, setAgencyFilter] = useState<string>('');
  const [availableAgencies, setAvailableAgencies] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [isEnd, setIsEnd] = useState(false);
  const firstLoadRef = useRef(true);
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async (searchQuery = '', startDoc: any = null, agencyFilterValue = agencyFilter) => {
    setLoading(true);
    try {
      const baseRef = collection(db, 'customers');
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(PAGE_SIZE)];

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
            city: data.address?.city || data.city,
            state: data.address?.state || data.state,
          };
        }) as Customer[];

        // Fetch agency names and workforce counts for all customers
        const customersWithAgencyData = await Promise.all(
          results.map(async (customer) => {
            let workforceCount = 0;
            let agencyName = '-';

            try {
              const usersSnap = await getDocs(query(
                collection(db, 'users'), 
                where('customerId', '==', customer.id),
                where('role', '==', 'Worker')
              ));
              workforceCount = usersSnap.size;
            } catch {
              workforceCount = 0;
            }

            if ((customer as any).agencyId) {
              try {
                const agencyRef = doc(db, 'agencies', (customer as any).agencyId);
                const agencySnap = await getDoc(agencyRef);
                if (agencySnap.exists()) {
                  agencyName = agencySnap.data().name || '-';
                }
              } catch {
                agencyName = '-';
              }
            }

            return {
              ...customer,
              workforceCount,
              agencyName,
            };
          })
        );

        // Filter by search query if provided
        let filteredResults = customersWithAgencyData;
        if (searchQuery.trim()) {
          const searchTerms = searchQuery.toLowerCase().split(' ').filter(term => term.length > 0);
          filteredResults = filteredResults.filter(customer => {
            const customerNameLower = customer.name.toLowerCase();
            const agencyNameLower = customer.agencyName.toLowerCase();
            return searchTerms.some(term => 
              customerNameLower.includes(term) || agencyNameLower.includes(term)
            );
          });
        }

        // Filter by agency if provided
        if (agencyFilterValue) {
          filteredResults = filteredResults.filter(customer => 
            customer.agencyName.toLowerCase() === agencyFilterValue.toLowerCase()
          );
        }

        // Update available agencies for filter dropdown
        const uniqueAgencies = Array.from(new Set(customersWithAgencyData.map(c => c.agencyName))).filter(name => name !== '-');
        setAvailableAgencies(uniqueAgencies);

        setCustomers((prev) => (startDoc ? [...prev, ...filteredResults] : filteredResults));
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        setIsEnd(snapshot.size < PAGE_SIZE);

        // Update workforce counts and agency names for display
        filteredResults.forEach((customer) => {
          setWorkforceCounts((prev) => ({ ...prev, [customer.id]: customer.workforceCount }));
          setAgencyNames((prev) => ({ ...prev, [customer.id]: customer.agencyName }));
          setLogoUrls((prev) => ({
            ...prev,
            [customer.id]: customer.avatar || '/img/default-logo.png',
          }));
        });
      } else {
        if (!startDoc) setCustomers([]);
        setIsEnd(true);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
    setLoading(false);
  };

  const handleSearch = () => {
    setHasSearched(true);
    fetchCustomers(search, null);
  };

  const handleClearSearch = () => {
    setSearch('');
    setAgencyFilter('');
    setHasSearched(false);
    fetchCustomers('', null);
  };

  // Sorting logic
  const getSortValue = (customer: Customer & { workforceCount?: number; agencyName?: string }, field: string): string | number => {
    if (field === 'name') return customer.name || '';
    if (field === 'workforce') return customer.workforceCount ?? 0;
    if (field === 'agencyName') return customer.agencyName || '';
    return '';
  };
  const getSortedCustomers = () => {
    if (!sortField) return customers;
    const sorted = [...customers].sort((a, b) => {
      let aValue = getSortValue(a, sortField);
      let bValue = getSortValue(b, sortField);
      if (sortField === 'workforce') {
        // Numeric sort
        return sortDirection === 'asc' ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
      } else {
        // String sort
        aValue = (aValue as string).toLowerCase();
        bValue = (bValue as string).toLowerCase();
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      }
    });
    return sorted;
  };
  const sortedCustomers = getSortedCustomers();

  return (
    <Box p={0}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h4" gutterBottom>
          Customers
        </Typography>
        <Button variant="contained" color="primary" onClick={() => navigate('/customer/new')}>
          Add Customer
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
        <Autocomplete
          options={availableAgencies}
          value={agencyFilter}
          onChange={(_, newValue) => {
            setAgencyFilter(newValue || '');
            // Always trigger fetchCustomers when agency filter changes, even if cleared
            setTimeout(() => fetchCustomers(search, null, newValue || ''), 0);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="outlined"
              size="medium"
              placeholder="Filter by Agency"
              sx={{ minWidth: 200 }}
            />
          )}
          clearOnEscape
        />
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
                    if (sortField === 'agencyName') {
                      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                    } else {
                      setSortField('agencyName');
                      setSortDirection('asc');
                    }
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  Agency
                  {sortField === 'agencyName' && (
                    sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                  )}
                </TableCell>
                <TableCell>City</TableCell>
                <TableCell>State</TableCell>
                <TableCell>View</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    {logoUrls[customer.id] && logoUrls[customer.id] !== '/img/default-logo.png' && (
                      <img
                        src={logoUrls[customer.id]}
                        alt={customer.name}
                        style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }}
                        onError={() => {
                          setLogoUrls((prev) => ({
                            ...prev,
                            [customer.id]: '',
                          }));
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>{customer.name}</TableCell>
                  <TableCell>{
                    workforceCounts[customer.id] !== undefined
                      ? workforceCounts[customer.id]
                      : '-'
                  }</TableCell>
                  <TableCell>{agencyNames[customer.id] || '-'}</TableCell>
                  <TableCell>{customer.city || '-'}</TableCell>
                  <TableCell>{customer.state || '-'}</TableCell>
                  <TableCell>
                    <Button
                      component={Link}
                      to={`/customers/${customer.id}`}
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
          <Button onClick={() => fetchCustomers(search, lastDoc, agencyFilter)} disabled={loading}>
            Load More
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default CustomersTable;
