/**
 * Messages Page - Internal Slack-style Messaging
 * 
 * Provides Direct Messages (DMs) and Channels for team collaboration.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Tabs, Tab, Typography, CircularProgress, Alert } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import MessagesSidebar from '../components/MessagesSidebar';
import MessagesContent from '../components/MessagesContent';
import NewChannelDialog from '../components/NewChannelDialog';
import { useSearchParams } from 'react-router-dom';

interface DirectMessage {
  id: string;
  tenantId: string;
  participants: string[];
  participantNames: string[];
  participantAvatars?: string[];
  lastMessage?: string;
  lastMessageAt?: any;
  lastMessageFrom?: string;
  lastMessageFromUserId?: string;
  unreadCounts: { [userId: string]: number };
  isGroup: boolean;
  groupName?: string;
  groupAvatar?: string;
  createdAt: any;
  updatedAt: any;
}

interface InternalChannel {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  isPrivate: boolean;
  memberIds: string[];
  memberCount: number;
  createdBy: string;
  createdByName?: string;
  lastMessage?: string;
  lastMessageAt?: any;
  lastMessageFrom?: string;
  lastMessageFromUserId?: string;
  unreadCounts: { [userId: string]: number };
  mutedBy: string[];
  createdAt: any;
  updatedAt: any;
}

const MessagesPage: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'dms' | 'channels'>('dms');
  const [dms, setDms] = useState<DirectMessage[]>([]);
  const [channels, setChannels] = useState<InternalChannel[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<{
    type: 'dm' | 'channel';
    id: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newChannelDialogOpen, setNewChannelDialogOpen] = useState(false);

  const effectiveTenantId = activeTenant?.id || '';

  // Handle URL parameters to open a specific conversation
  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    const conversationType = searchParams.get('type') as 'dm' | 'channel' | null;
    
    if (conversationId && conversationType) {
      // Verify the conversation exists and user has access
      const verifyAndOpen = async () => {
        try {
          if (conversationType === 'dm') {
            const dmDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'internalDMs', conversationId));
            if (dmDoc.exists() && dmDoc.data().participants?.includes(user?.uid)) {
              setSelectedConversation({ type: 'dm', id: conversationId });
              setActiveTab('dms');
              // Clear URL params after opening
              setSearchParams({});
            }
          } else if (conversationType === 'channel') {
            const channelDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'internalChannels', conversationId));
            if (channelDoc.exists() && channelDoc.data().memberIds?.includes(user?.uid)) {
              setSelectedConversation({ type: 'channel', id: conversationId });
              setActiveTab('channels');
              // Clear URL params after opening
              setSearchParams({});
            }
          }
        } catch (err) {
          console.error('Error verifying conversation access:', err);
        }
      };
      
      if (user?.uid && effectiveTenantId) {
        verifyAndOpen();
      }
    }
  }, [searchParams, user?.uid, effectiveTenantId, setSearchParams]);

  // Real-time listener for DMs
  useEffect(() => {
    if (!user?.uid || !effectiveTenantId) {
      setDms([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const dmsRef = collection(db, 'tenants', effectiveTenantId, 'internalDMs');
    const dmsQuery = query(
      dmsRef,
      where('participants', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      dmsQuery,
      (snapshot) => {
        const dmsList: DirectMessage[] = [];
        snapshot.forEach((doc) => {
          dmsList.push({
            id: doc.id,
            ...doc.data(),
          } as DirectMessage);
        });
        setDms(dmsList);
        setLoading(false);
      },
      (err) => {
        console.error('Error listening to DMs:', err);
        setError('Failed to load direct messages');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, effectiveTenantId]);

  // Real-time listener for Channels
  useEffect(() => {
    if (!user?.uid || !effectiveTenantId) {
      setChannels([]);
      return;
    }

    const channelsRef = collection(db, 'tenants', effectiveTenantId, 'internalChannels');
    const channelsQuery = query(
      channelsRef,
      where('memberIds', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      channelsQuery,
      (snapshot) => {
        const channelsList: InternalChannel[] = [];
        snapshot.forEach((doc) => {
          channelsList.push({
            id: doc.id,
            ...doc.data(),
          } as InternalChannel);
        });
        setChannels(channelsList);
      },
      (err) => {
        console.error('Error listening to channels:', err);
        setError('Failed to load channels');
      }
    );

    return () => unsubscribe();
  }, [user?.uid, effectiveTenantId]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: 'dms' | 'channels') => {
    setActiveTab(newValue);
    setSelectedConversation(null); // Clear selection when switching tabs
  };

  const handleConversationSelect = (type: 'dm' | 'channel', id: string) => {
    setSelectedConversation({ type, id });
  };

  const handleMessageSent = () => {
    // Real-time listeners will automatically update
  };

  const handleChannelCreated = () => {
    setNewChannelDialogOpen(false);
    // Real-time listener will automatically update
  };

  if (!user?.uid || !effectiveTenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Please select a tenant to view messages.</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Sidebar */}
      <Box sx={{ width: 240, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 2, py: 1 }}>
          <Tabs value={activeTab} onChange={handleTabChange} variant="fullWidth">
            <Tab label="DMs" value="dms" />
            <Tab label="Channels" value="channels" />
          </Tabs>
        </Box>

        <MessagesSidebar
          activeTab={activeTab}
          dms={dms}
          channels={channels}
          selectedConversation={selectedConversation}
          onConversationSelect={handleConversationSelect}
          onCreateChannel={() => setNewChannelDialogOpen(true)}
        />
      </Box>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedConversation ? (
          <MessagesContent
            conversationType={selectedConversation.type}
            conversationId={selectedConversation.id}
            tenantId={effectiveTenantId}
            userId={user.uid}
            onMessageSent={handleMessageSent}
          />
        ) : (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="h6" color="text.secondary">
              Select a conversation to start messaging
            </Typography>
          </Box>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ position: 'absolute', top: 16, right: 16, zIndex: 1300 }}>
          {error}
        </Alert>
      )}

      <NewChannelDialog
        open={newChannelDialogOpen}
        onClose={() => setNewChannelDialogOpen(false)}
        onChannelCreated={handleChannelCreated}
        tenantId={effectiveTenantId}
        userId={user?.uid || ''}
      />
    </Box>
  );
};

export default MessagesPage;

