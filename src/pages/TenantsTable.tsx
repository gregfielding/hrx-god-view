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
import { Link } from 'react-router-dom';
import { db } from '../firebase';

const PAGE_SIZE = 10;

type Tenant = {
  id: string;
  name: string;
  contactEmail?: string;
  phone?: string;
  createdAt?: any;
};

const TenantsTable = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [isEnd, setIsEnd] = useState(false);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async (searchQuery = '', startDoc: any = null) => {
    setLoading(true);
    try {
      const baseRef = collection(db, 'tenants');
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
        const results = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Tenant[];
        setTenants((prev) => (startDoc ? [...prev, ...results] : results));
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        setIsEnd(snapshot.size < PAGE_SIZE);
      } else {
        if (!startDoc) setTenants([]);
        setIsEnd(true);
      }
    } catch (error) {
      console.error('Error fetching tenants:', error);
    }
    setLoading(false);
  };

  const handleSearch = () => {
    fetchTenants(search);
  };

  const handleClearSearch = () => {
    setSearch('');
    fetchTenants('');
  };

  return (
    <Box p={0}>
      <Typography variant="h4" gutterBottom>
        Tenants
      </Typography>

      <Box display="flex" gap={2} mb={2}>
        <TextField
          variant="outlined"
          size="medium"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="contained" size="large" onClick={handleSearch}>
          SEARCH
        </Button>
        {search && (
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
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>View</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>{tenant.name}</TableCell>
                  <TableCell>{tenant.contactEmail || '-'}</TableCell>
                  <TableCell>{tenant.phone || '-'}</TableCell>
                  <TableCell>
                    <Button
                      component={Link}
                      to={`/tenants/${tenant.id}`}
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
          <Button onClick={() => fetchTenants(search, lastDoc)} disabled={loading}>
            Load More
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default TenantsTable;
