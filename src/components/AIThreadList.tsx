import React, { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, IconButton, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloseIcon from '@mui/icons-material/Close';
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, where, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../firebase';

interface AIThreadListProps {
  tenantId: string;
  userId: string;
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
}

const AIThreadList: React.FC<AIThreadListProps> = ({ tenantId, userId, selectedThreadId, onSelect, onCreate }) => {
  const [threads, setThreads] = useState<Array<{ id: string; title?: string; createdAt?: any }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !userId) return;
    const q = query(
      collection(db, 'tenants', tenantId, 'ai_chats'),
      where('createdBy', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(q, async (snap) => {
      const base = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const withTitles = await Promise.all(base.map(async (t) => {
        if (t.title) return t;
        try {
          const msgsQ = query(collection(db, 'tenants', tenantId, 'ai_chats', t.id, 'messages'), orderBy('createdAt', 'asc'), limit(1));
          const msgsSnap = await getDocs(msgsQ);
          const first = msgsSnap.docs[0]?.data() as any;
          const title = first?.role === 'user' ? (first.content || '').slice(0, 60) : 'Conversation';
          return { ...t, title };
        } catch {
          return { ...t, title: 'Conversation' };
        }
      }));
      setThreads(withTitles);
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error('AIThreadList snapshot error:', err);
      setLoading(false);
      setError(err?.message || 'Failed to load conversations');
    });
    return () => unsub();
  }, [tenantId, userId]);

  const handleDelete = async (threadId: string) => {
    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'ai_chats', threadId));
      if (selectedThreadId === threadId) {
        onSelect('');
      }
    } catch (e) {
      console.error('Failed to delete thread', e);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>Conversations</Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={async () => {
            try {
              const functions = getFunctions();
              const startAIThread = httpsCallable(functions, 'startAIThread');
              const res = await startAIThread({ tenantId });
              const id = (res.data as any)?.threadId as string;
              onSelect(id);
            } catch (e) {
              console.error('Failed to create thread:', e);
              onCreate();
            }
          }}
          variant="outlined"
        >
          New
        </Button>
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <CircularProgress size={18} />
        </Box>
      ) : error ? (
        <Typography variant="body2" color="error.main">{error}</Typography>
      ) : threads.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No conversations yet.</Typography>
      ) : (
        <List dense sx={{ p: 0 }}>
          {threads.map((t) => (
            <ListItem key={t.id} disablePadding secondaryAction={
              <IconButton size="small" edge="end" onClick={() => handleDelete(t.id)} aria-label="delete">
                <CloseIcon fontSize="small" />
              </IconButton>
            }>
              <ListItemButton selected={t.id === selectedThreadId} onClick={() => onSelect(t.id)}>
                <ChatBubbleOutlineIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                <ListItemText
                  primary={t.title || 'Conversation'}
                  secondary={t.createdAt?.toDate ? new Date(t.createdAt.toDate()).toLocaleString() : ''}
                  primaryTypographyProps={{ variant: 'body2' }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};

export default AIThreadList;


