import React, { useEffect, useState } from 'react';
import { collection, query, where, orderBy, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';

interface Notification {
  id: string;
  recipientType: string;
  recipientId: string | null;
  type: string;
  message: string;
  actions: string[];
  status: string;
  createdAt: any;
  relatedId?: string;
}

const recipientType = 'hrx'; // TODO: Make dynamic based on user role

export default function NotificationsTable() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = async () => {
    setLoading(true);
    const q = query(
      collection(db, 'notifications'),
      where('recipientType', '==', recipientType),
      orderBy('createdAt', 'desc'),
    );
    const snap = await getDocs(q);
    setNotifications(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Notification)));
    setLoading(false);
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        status: 'read',
      });
      await fetchNotifications(); // Refresh the list
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleRetry = async (notificationId: string) => {
    try {
      // For now, just mark as actioned. In the future, this could trigger a retry of the related action
      await updateDoc(doc(db, 'notifications', notificationId), {
        status: 'actioned',
      });
      await fetchNotifications(); // Refresh the list
    } catch (error) {
      console.error('Error retrying notification:', error);
    }
  };

  const handleView = async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        status: 'read',
      });
      // TODO: Navigate to the related item (e.g., moment, user, etc.)
      console.log('Viewing notification:', notificationId);
      await fetchNotifications(); // Refresh the list
    } catch (error) {
      console.error('Error viewing notification:', error);
    }
  };

  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            <TableCell>Message</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {notifications.map((n) => (
            <TableRow key={n.id}>
              <TableCell>
                {n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString() : ''}
              </TableCell>
              <TableCell>{n.message}</TableCell>
              <TableCell>
                <Chip label={n.type} />
              </TableCell>
              <TableCell>
                <Chip label={n.status} color={n.status === 'unread' ? 'primary' : 'default'} />
              </TableCell>
              <TableCell>
                {n.status === 'unread' && (
                  <Tooltip title="Mark as Read">
                    <IconButton size="small" onClick={() => handleMarkAsRead(n.id)}>
                      <VisibilityIcon />
                    </IconButton>
                  </Tooltip>
                )}
                {n.actions?.includes('retry') && (
                  <Tooltip title="Retry">
                    <IconButton size="small" onClick={() => handleRetry(n.id)}>
                      <RefreshIcon />
                    </IconButton>
                  </Tooltip>
                )}
                {n.actions?.includes('view') && (
                  <Tooltip title="View Details">
                    <IconButton size="small" onClick={() => handleView(n.id)}>
                      <CheckCircleIcon />
                    </IconButton>
                  </Tooltip>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {loading && <div style={{ padding: 16 }}>Loading...</div>}
    </TableContainer>
  );
}
