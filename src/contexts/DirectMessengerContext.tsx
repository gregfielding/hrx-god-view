/**
 * Direct Messenger Context
 * 
 * Global state management for the Direct Messenger feature.
 * Provides messenger drawer state, active thread, and unread count.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useDMThreads } from '../hooks/useDMThreads';
import { getThreadId } from '../utils/dmThreadUtils';
import { DMThreadView, ParticipantMeta, DMParticipantMeta } from '../types/directMessenger';

type DirectMessengerPane = 'threads' | 'people';
type DirectMessengerMode = 'list' | 'conversation';

interface DirectMessengerContextType {
  isOpen: boolean;
  activeThreadId: string | null;
  pane: DirectMessengerPane;
  mode: DirectMessengerMode; // For mobile: 'list' or 'conversation'
  openMessenger: () => void;
  closeMessenger: () => void;
  openThreadForUser: (userId: string, userData?: DMParticipantMeta) => Promise<void>;
  setPane: (pane: DirectMessengerPane) => void;
  setMode: (mode: DirectMessengerMode) => void;
  setActiveThreadId: (threadId: string | null) => void;
  unreadCount: number;
  threads: DMThreadView[]; // Expose threads for PeopleList to check existing conversations
  activeThreadOtherUser: ParticipantMeta | null;
}

const DirectMessengerContext = createContext<DirectMessengerContextType>({
  isOpen: false,
  activeThreadId: null,
  pane: 'threads',
  mode: 'list',
  openMessenger: () => {},
  closeMessenger: () => {},
  openThreadForUser: async () => {},
  setPane: () => {},
  setMode: () => {},
  setActiveThreadId: () => {},
  unreadCount: 0,
  threads: [] as DMThreadView[],
  activeThreadOtherUser: null,
});

export const useDirectMessenger = () => useContext(DirectMessengerContext);

interface DirectMessengerProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component for Direct Messenger state
 */
export const DirectMessengerProvider: React.FC<DirectMessengerProviderProps> = ({ children }) => {
  const { user, activeTenant } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pane, setPane] = useState<DirectMessengerPane>('threads');
  const [mode, setMode] = useState<DirectMessengerMode>('list');
  const [pendingOtherUserId, setPendingOtherUserId] = useState<string | null>(null); // Store userId when opening new thread
  const [pendingOtherUserData, setPendingOtherUserData] = useState<DMParticipantMeta | null>(null); // Store user data when opening new thread

  const tenantId = activeTenant?.id;
  const currentUserId = user?.uid;

  // Fetch threads and unread count
  const { threads, globalUnreadCount } = useDMThreads({
    tenantId: tenantId || '',
    currentUserId: currentUserId || '',
    maxThreads: 30,
  });

  // Effect: When a thread appears in the list that matches our pending thread, clear pending data
  useEffect(() => {
    if (pendingOtherUserId && activeThreadId && threads.length > 0) {
      // Check if the thread we're waiting for has appeared in the list
      const matchingThread = threads.find(t => t.id === activeThreadId);
      if (matchingThread) {
        // Thread has appeared! Clear pending data
        console.log('[DirectMessengerContext] Thread appeared in list, clearing pending data');
        setPendingOtherUserId(null);
        setPendingOtherUserData(null);
      }
    }
  }, [threads, activeThreadId, pendingOtherUserId]);

  /**
   * Open the messenger drawer
   */
  const openMessenger = useCallback(() => {
    setIsOpen(true);
    setPane('threads');
    setMode('list');
  }, []);

  /**
   * Close the messenger drawer
   */
  const closeMessenger = useCallback(() => {
    setIsOpen(false);
    setActiveThreadId(null);
    setPendingOtherUserId(null); // Clear pending user ID
    setPendingOtherUserData(null); // Clear pending user data
    setPane('threads');
    setMode('list');
  }, []);

  /**
   * Open or create a thread for a specific user
   */
  const openThreadForUser = useCallback(
    async (userId: string, userData?: DMParticipantMeta) => {
      if (!currentUserId || !tenantId) {
        console.error('Cannot open thread: missing user or tenant');
        return;
      }

      if (userId === currentUserId) {
        console.error('Cannot open thread with yourself');
        return;
      }

      // Generate deterministic thread ID
      const threadId = getThreadId(currentUserId, userId);

      // Check if thread exists in our loaded threads
      const existingThread = threads.find((t) => t.otherUser.uid === userId);

      if (existingThread) {
        // Thread exists, open it
        setActiveThreadId(existingThread.id);
        setPendingOtherUserId(null); // Clear pending user ID
        setPendingOtherUserData(null); // Clear pending user data
      } else {
        // Thread doesn't exist yet - it will be created when first message is sent
        // Set the active thread ID so the conversation view knows which thread to use
        setActiveThreadId(threadId);
        setPendingOtherUserId(userId); // Store the userId for when we need to create the thread
        setPendingOtherUserData(userData || null); // Store the user data if provided
      }
      
      // Open drawer and switch to threads tab to show the conversation
      setIsOpen(true);
      setPane('threads');
    },
    [currentUserId, tenantId, threads]
  );

  // Get active thread's other user
  // This will automatically update when threads list updates (via onSnapshot)
  const activeThreadOtherUser = React.useMemo(() => {
    if (!activeThreadId || !currentUserId) return null;
    
    // First, try to find the thread in the loaded threads list
    const thread = threads.find(t => t.id === activeThreadId);
    if (thread) {
      return {
        uid: thread.otherUser.uid,
        displayName: thread.otherUser.displayName,
        email: thread.otherUser.email,
        avatarUrl: thread.otherUser.avatarUrl,
      };
    }
    
    // If thread not found in list yet, check if we have pending user data
    // This handles the case where thread was just created but hasn't appeared in threads list yet
    // If thread doesn't exist yet but we have a pending userId, use stored data or return minimal object
    if (pendingOtherUserId) {
      if (pendingOtherUserData) {
        // Use the stored user data
        return {
          uid: pendingOtherUserId,
          displayName: pendingOtherUserData.displayName,
          email: pendingOtherUserData.email,
          avatarUrl: pendingOtherUserData.avatarUrl,
        };
      }
      // Fallback: return minimal object with just the uid
      return {
        uid: pendingOtherUserId,
        displayName: '', // Will be fetched when creating thread
        email: '',
        avatarUrl: undefined,
      };
    }
    return null;
  }, [activeThreadId, threads, currentUserId, pendingOtherUserId, pendingOtherUserData]);

  return (
    <DirectMessengerContext.Provider
      value={{
        isOpen,
        activeThreadId,
        pane,
        mode,
        openMessenger,
        closeMessenger,
        openThreadForUser,
        setPane,
        setMode,
        setActiveThreadId,
        unreadCount: globalUnreadCount,
        threads,
        activeThreadOtherUser,
      }}
    >
      {children}
    </DirectMessengerContext.Provider>
  );
};

