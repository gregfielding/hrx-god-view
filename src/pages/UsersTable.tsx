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
import { useAuth } from '../contexts/AuthContext';

import { format } from 'date-fns';

type User = {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  role: string;
  createdAt?: any;
};

const PAGE_SIZE = 10;

const UsersTable = () => {
  const { role } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [isEnd, setIsEnd] = useState(false);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (role === 'god') {
      fetchUsers();
    }
  }, [role]);

  const fetchUsers = async (searchQuery = '', startDoc: any = null) => {
    setLoading(true);
    try {
      const baseRef = collection(db, 'users');
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(PAGE_SIZE)];

      const searchLower = searchQuery.toLowerCase();
      if (searchQuery) {
        constraints.push(where('searchKeywords', 'array-contains', searchLower));
      }

      if (startDoc) {
        console.log('Applying startAfter with', startDoc.id);
        constraints.push(startAfter(startDoc));
      }

      const userQuery = query(baseRef, ...constraints);
      const snap = await getDocs(userQuery);

      if (snap.empty) {
        console.warn('No users found in query snapshot');
      }

      const newUsers: User[] = snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as User[];

      if (firstLoadRef.current) {
        setUsers(newUsers);
        firstLoadRef.current = false;
      } else {
        setUsers((prev) => {
          const existingIds = new Set(prev.map((u) => u.id));
          const deduped = newUsers.filter((u) => !existingIds.has(u.id));
          return [...prev, ...deduped];
        });
      }

      if (newUsers.length < PAGE_SIZE) {
        setIsEnd(true);
      } else {
        setLastDoc(snap.docs[snap.docs.length - 1]);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
    setLoading(false);
  };

  const handleSearch = () => {
    setUsers([]);
    firstLoadRef.current = true;
    setIsEnd(false);
    setLastDoc(null);
    fetchUsers(search);
  };

  const handleClearSearch = () => {
    setSearch('');
    setUsers([]);
    firstLoadRef.current = true;
    setIsEnd(false);
    setLastDoc(null);
    fetchUsers('');
  };

  const handleNext = () => {
    fetchUsers(search, lastDoc);
  };

  if (role !== 'god') {
    return (
      <Box display="flex" justifyContent="center" mt={10}>
        <Typography>You do not have permission to view this page.</Typography>
      </Box>
    );
  }

  return (
    <Box p={0}>
      <Typography variant="h4" gutterBottom>
        All Users
      </Typography>

      <Box display="flex" gap={2} mb={3}>
        <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="contained" onClick={handleSearch}>
          Search
        </Button>
        {search && (
          <Button variant="outlined" color="secondary" onClick={handleClearSearch}>
            Clear
          </Button>
        )}
      </Box>

      {loading && <CircularProgress />}

      {!loading && (
        <>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>First Name</TableCell>
                  <TableCell>Last Name</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Created At</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.firstName}</TableCell>
                    <TableCell>{user.lastName}</TableCell>
                    <TableCell>{user.phone}</TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>
                      {user.createdAt?.toDate
                        ? format(user.createdAt.toDate(), 'yyyy-MM-dd HH:mm')
                        : ''}
                    </TableCell>
                    <TableCell>
                      <Link to={`/users/${user.id}`}>View Profile</Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box mt={2}>
            {!isEnd && (
              <Button onClick={handleNext} disabled={loading}>
                Load More
              </Button>
            )}
            {isEnd && (
              <Typography variant="body2" mt={1}>
                End of results
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
};

export default UsersTable;
