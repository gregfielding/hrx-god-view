import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, Paper, TextField, IconButton, CircularProgress, Stack, Chip, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import AIThreadList from './AIThreadList';
import SendIcon from '@mui/icons-material/Send';
import PsychologyIcon from '@mui/icons-material/Psychology';
import PersonIcon from '@mui/icons-material/Person';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, orderBy, query, doc, setDoc } from 'firebase/firestore';

import { db } from '../firebase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: any;
}

interface AIAssistantChatProps {
  tenantId: string;
  userId: string;
  threadId?: string;
  onThreadCreated?: (threadId: string) => void;
  suggestedPrompts?: string[];
  title?: string;
  onOpenRequested?: () => void;
  showThreadListPanel?: boolean; // when false, hide internal history panel (dash provides its own)
}

const AIAssistantChat: React.FC<AIAssistantChatProps> = ({ tenantId, userId, threadId, onThreadCreated, suggestedPrompts, title = 'AI Assistant', onOpenRequested, showThreadListPanel = true }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [seed, setSeed] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const functions = useMemo(() => getFunctions(), []);

  const ensureThread = useCallback(async () => {
    if (threadId) return threadId;
    const startAIThread = httpsCallable(functions, 'startAIThread');
    const res = await startAIThread({ tenantId, context: 'assistant' });
    const id = (res.data as any)?.threadId as string;
    onThreadCreated?.(id);
    return id;
  }, [functions, onThreadCreated, tenantId, threadId]);

  // Live subscription to messages when thread is ready
  useEffect(() => {
    if (!tenantId || !threadId) return;
    const q = query(
      collection(db, 'tenants', tenantId, 'ai_chats', threadId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: ChatMessage[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setMessages(list);
    });
    return () => unsub();
  }, [tenantId, threadId]);

  // Allow parent to change threadId and restore messages
  useEffect(() => {
    // The subscription above reacts to threadId change and restores history automatically
  }, [threadId]);

  const sendMessage = useCallback(async () => {
    if (!input.trim()) return;
    const userMsg: ChatMessage = {
      id: `${Date.now()}`,
      role: 'user',
      content: input.trim()
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const currentThreadId = await ensureThread();

      // Update conversation title to the first user message
      try {
        await setDoc(doc(db, 'tenants', tenantId, 'ai_chats', currentThreadId), { title: userMsg.content.slice(0, 80) }, { merge: true });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to set chat title:', e);
      }

      const response = await fetch(`https://us-central1-hrx1-d3beb.cloudfunctions.net/enhancedChatWithGPT`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, userId, threadId: currentThreadId, messages: [...messages, userMsg].slice(-10) })
      });
      const data = await response.json();
      const assistantMsg: ChatMessage = {
        id: `${Date.now()}_assistant`,
        role: 'assistant',
        content: data?.reply || 'No response'
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const assistantMsg: ChatMessage = {
        id: `${Date.now()}_assistant_error`,
        role: 'assistant',
        content: 'Sorry, I could not process that right now.'
      };
      setMessages(prev => [...prev, assistantMsg]);
      // eslint-disable-next-line no-console
      console.error('AI chat error:', err);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }
  }, [ensureThread, input, messages, tenantId, userId]);

  const handleSuggestionClick = useCallback(async (prompt: string) => {
    try {
      onOpenRequested?.();
      const startAIThread = httpsCallable(functions, 'startAIThread');
      const res = await startAIThread({ tenantId, context: 'assistant' });
      const newId = (res.data as any)?.threadId as string;
      onThreadCreated?.(newId);

      const userMsg: ChatMessage = { id: `${Date.now()}`, role: 'user', content: prompt };
      setMessages([userMsg]);
      setLoading(true);
      try {
        await setDoc(doc(db, 'tenants', tenantId, 'ai_chats', newId), { title: prompt.slice(0, 80) }, { merge: true });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to set chat title from suggestion:', e);
      }
      const response = await fetch(`https://us-central1-hrx1-d3beb.cloudfunctions.net/enhancedChatWithGPT`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, userId, threadId: newId, messages: [userMsg] })
      });
      const data = await response.json();
      const assistantMsg: ChatMessage = { id: `${Date.now()}_assistant`, role: 'assistant', content: data?.reply || 'No response' };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const assistantMsg: ChatMessage = { id: `${Date.now()}_assistant_error`, role: 'assistant', content: 'Could not start chat.' };
      setMessages(prev => [...prev, assistantMsg]);
      // eslint-disable-next-line no-console
      console.error('Suggestion start error:', err);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }
  }, [functions, onOpenRequested, onThreadCreated, tenantId, userId]);

  useEffect(() => {
    setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }), 50);
  }, [messages.length]);

  return (
    <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'row', height: '100%', borderRadius: 0, gap: showThreadListPanel ? 3 : 0 }}>
      {/* Left: historical threads (optional) */}
      {showThreadListPanel && (
        <Box sx={{ width: 300, borderRight: '1px solid', borderColor: 'divider', height: '100%', overflow: 'hidden' }}>
          <AIThreadList
            tenantId={tenantId}
            userId={userId}
            selectedThreadId={threadId}
            onSelect={(id) => onThreadCreated?.(id)}
            onCreate={() => {}}
          />
        </Box>
      )}
      {/* Right: live chat column */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Messages area */}
        <Box ref={listRef} sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        {messages.length === 0 && (
          <Box sx={{ textAlign: 'center', mt: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1 }}>
              <PsychologyIcon color="primary" sx={{ fontSize: 40 }} />
              <Typography variant="h6">{title}</Typography>
              <Tooltip title="Refresh suggestions">
                <IconButton size="small" onClick={() => setSeed(s => s + 1)}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Typography variant="body2" color="text.secondary">Ask questions, draft messages, and get help with your work…</Typography>
            <Box sx={{ mt: 2, display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              {(suggestedPrompts && suggestedPrompts.length > 0
                ? suggestedPrompts
                : ['Ask me anything', 'Draft a professional email', 'Summarize these notes', 'Brainstorm outreach ideas']
               ).map((t) => (
                <Chip key={t + seed} label={t} variant="outlined" onClick={() => handleSuggestionClick(t)} />
              ))}
            </Box>
          </Box>
        )}
        <Stack spacing={2}>
          {messages.map((m) => (
            <Box key={m.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Box sx={{ mt: '2px', color: m.role === 'user' ? 'primary.main' : 'secondary.main' }}>
                {m.role === 'user' ? <PersonIcon fontSize="small" /> : <PsychologyIcon fontSize="small" />}
              </Box>
              <Paper variant="outlined" sx={{ p: 1.5, maxWidth: '900px', bgcolor: m.role === 'user' ? 'grey.50' : 'white' }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
              </Paper>
            </Box>
          ))}
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
              <CircularProgress size={16} />
              <Typography variant="caption">Thinking…</Typography>
            </Box>
          )}
        </Stack>
        </Box>
        {/* Input area */}
        <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1 }}>
          <TextField
            fullWidth
            placeholder="Message AI…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          />
          <IconButton color="primary" onClick={sendMessage} disabled={loading || !input.trim()}>
            {loading ? <CircularProgress size={18} /> : <SendIcon />}
          </IconButton>
        </Box>
      </Box>
    </Paper>
  );
};

export default AIAssistantChat;


