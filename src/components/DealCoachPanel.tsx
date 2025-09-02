import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Card, CardContent, CardHeader, Chip, IconButton, Typography, Button, TextField, Snackbar, Alert, CircularProgress } from '@mui/material';
import { Close as CloseIcon, Add as AddIcon, Refresh as RefreshIcon } from '@mui/icons-material';

import { getFunctions, httpsCallable } from 'firebase/functions';

import { useAuth } from '../contexts/AuthContext';


interface DealCoachPanelProps {
  dealId: string;
  stageKey: string;
  tenantId: string;
  onStartNew?: () => void;
  key?: string; // Add key prop to detect when to start new conversation
}

interface CoachMessage {
  role: 'user' | 'assistant';
  text: string;
  at: number;
  actions?: Array<any>;
}

const DealCoachPanel: React.FC<DealCoachPanelProps> = ({ dealId, stageKey, tenantId, onStartNew }) => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<string>('');
  const [suggestions, setSuggestions] = useState<Array<{ label: string; action: any }>>([]);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success'|'error'|'info' } | null>(null);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string; at: Date; messages: any[] }>>([]);

  const listRef = useRef<HTMLDivElement>(null);
  
  // Debounce analysis to prevent rapid successive calls
  const [lastAnalyzeTime, setLastAnalyzeTime] = useState(0);



  const threadKey = useMemo(() => `coach.thread.${dealId}`, [dealId]);

  useEffect(() => {
    // restore thread
    const raw = localStorage.getItem(threadKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setMessages(parsed);
      } catch {}
    }
    analyze();
    loadConversations();
    
    // Proactive conversation check disabled - function not available
    // const checkForProactiveConversation = async () => {
    //   if (messages.length === 0) {
    //     try {
    //       const functions = getFunctions(undefined, 'us-central1');
    //       const proactiveFn = httpsCallable(functions, 'dealCoachProactiveCallable');
    //       const result = await proactiveFn({ 
    //         tenantId, 
    //         dealId, 
    //         trigger: 'auto_check' 
    //       });
    //       const data = result.data as any;
    //       
    //       if (data.success && data.message && data.urgency !== 'low') {
    //         // Add proactive message to chat naturally
    //         const newMessage: CoachMessage = {
    //           role: 'assistant',
    //           text: data.message,
    //           at: Date.now()
    //         };
    //         setMessages([newMessage]);
    //       }
    //     } catch (error) {
    //       // Handle the error gracefully - this is an optional feature
    //       console.log('Proactive conversation feature not available:', error);
    //       // Don't show error toast since this is optional functionality
    //     }
    //   }
    // };

    // Check after a short delay to allow component to mount
    // const timer = setTimeout(checkForProactiveConversation, 2000);
    // return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, stageKey]);

  // Effect to handle new conversation when key changes
  useEffect(() => {
    if (onStartNew) {
      onStartNew();
    } else {
      // Default behavior: start new conversation
      startNewConversation();
    }
  }, [dealId]); // This will trigger when the dealId changes (which happens when key changes)

  useEffect(() => {
    localStorage.setItem(threadKey, JSON.stringify(messages));
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, threadKey]);

  // Debounce analysis to prevent rapid successive calls
  const ANALYZE_DEBOUNCE_DELAY = 15000; // 15 seconds debounce (increased for better cost containment)

  const analyze = async () => {
    // Debounce rapid analyze calls
    const now = Date.now();
    if (now - lastAnalyzeTime < ANALYZE_DEBOUNCE_DELAY) {
      console.log('Skipping Deal Coach analysis - too soon since last analyze');
      return;
    }
    setLastAnalyzeTime(now);

    setAnalyzing(true);
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const analyzeFn = httpsCallable(functions, 'dealCoachAnalyzeCallable');
      const { data }: any = await analyzeFn({ dealId, stageKey, tenantId });
      setSummary(data.summary || '');
      setSuggestions(data.suggestions || []);
    } catch (e) {
      console.log('Deal Coach analyze feature not available:', e);
      // Don't show error toast since this is optional functionality
      setSummary('');
      setSuggestions([]);
    } finally {
      setAnalyzing(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text, at: Date.now() }]);
    setLoading(true);
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const chatFn = httpsCallable(functions, 'dealCoachChatCallable');
      const { data }: any = await chatFn({ dealId, stageKey, tenantId, userId: user?.uid || 'unknown', message: text });
      
      // Convert JSON response to readable text
      let replyText = '';
      console.log('Deal Coach response data:', data);
      
      if (data?.text) {
        // Parse the JSON string from the text field
        try {
          const parsed = JSON.parse(data.text);
          if (parsed.next_best_action) {
            if (Array.isArray(parsed.next_best_action)) {
              // Handle array of actions
              replyText = parsed.next_best_action.map((action: string, index: number) => `${index + 1}. ${action}`).join('\n');
            } else {
              // Handle single action
              replyText = parsed.next_best_action;
            }
            
            if (parsed.steps && Array.isArray(parsed.steps)) {
              replyText += '\n\nSteps:\n';
              replyText += parsed.steps.map((step: string, index: number) => `${index + 1}. ${step}`).join('\n');
            }
            if (parsed.key_focus_areas && Array.isArray(parsed.key_focus_areas)) {
              replyText += '\n\nKey Focus Areas:\n';
              replyText += parsed.key_focus_areas.map((area: string, index: number) => `• ${area}`).join('\n');
            }
          } else {
            replyText = data.text;
          }
        } catch (e) {
          // If parsing fails, use the raw text
          replyText = data.text;
        }
      } else if (data?.next_best_action) {
        // Format the JSON response as readable text
        replyText = `${data.next_best_action}\n\n`;
        if (data.steps && Array.isArray(data.steps)) {
          replyText += data.steps.map((step: string, index: number) => `${index + 1}. ${step}`).join('\n');
        }
        if (data.key_focus_areas && Array.isArray(data.key_focus_areas)) {
          replyText += '\n\nKey Focus Areas:\n';
          replyText += data.key_focus_areas.map((area: string, index: number) => `• ${area}`).join('\n');
        }
      } else {
        replyText = 'I understand. How can I help you with this deal?';
      }
      
      const actions: any[] = Array.isArray(data?.actions) ? data.actions : [];
      setMessages((m) => [...m, { role: 'assistant', text: replyText, actions, at: Date.now() }]);
      // Auto-run returned actions for convenience
      for (const a of actions) {
        await runAction(a);
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Sorry — something went wrong.', at: Date.now() }]);
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (action: any) => {
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const actionFn = httpsCallable(functions, 'dealCoachActionCallable');
      const { data }: any = await actionFn({ tenantId, dealId, action });
      setToast({ open: true, message: 'Action completed', severity: 'success' });
      return data;
    } catch (e) {
      setToast({ open: true, message: 'Action failed', severity: 'error' });
      return null;
    }
  };

  const loadConversations = async () => {
    try {
      // Load conversations from localStorage (similar to dashboard chat)
      const conversationsKey = `coach.conversations.${dealId}`;
      const raw = localStorage.getItem(conversationsKey);
      if (raw) {
        const savedConversations = JSON.parse(raw);
        setConversations(savedConversations);
      } else {
        setConversations([]);
      }
    } catch (e) {
      console.error('Error loading conversations:', e);
      setConversations([]);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      // Remove conversation from localStorage
      const conversationsKey = `coach.conversations.${dealId}`;
      const raw = localStorage.getItem(conversationsKey);
      if (raw) {
        const existingConversations = JSON.parse(raw);
        const updatedConversations = existingConversations.filter((c: any) => c.id !== id);
        localStorage.setItem(conversationsKey, JSON.stringify(updatedConversations));
        setConversations(updatedConversations);
      }
      setToast({ open: true, message: 'Conversation deleted', severity: 'info' });
    } catch (e) {
      console.error('Error deleting conversation:', e);
      setToast({ open: true, message: 'Failed to delete', severity: 'error' });
    }
  };

  const startNewConversation = async () => {
    try {
      // Save current conversation to localStorage if there are messages
      if (messages.length > 0) {
        const conversationsKey = `coach.conversations.${dealId}`;
        const firstUserMessage = messages.find(m => m.role === 'user');
        const title = firstUserMessage?.text?.slice(0, 60) || 'New Conversation';
        
        const newConversation = {
          id: Date.now().toString(),
          title,
          at: new Date(),
          messages: [...messages]
        };
        
        // Load existing conversations and add the new one
        const raw = localStorage.getItem(conversationsKey);
        const existingConversations = raw ? JSON.parse(raw) : [];
        const updatedConversations = [newConversation, ...existingConversations].slice(0, 10); // Keep last 10
        
        localStorage.setItem(conversationsKey, JSON.stringify(updatedConversations));
        setConversations(updatedConversations);
      }
      
      // Clear current messages
      setMessages([]);
      setToast({ open: true, message: 'Started new conversation', severity: 'info' });
    } catch (e) {
      console.error('Error starting new conversation:', e);
      setToast({ open: true, message: 'Failed to start new conversation', severity: 'error' });
    }
  };

  const loadConversationIntoThread = async (eventId: string) => {
    try {
      // Load conversation from localStorage
      const selected = conversations.find((c) => c.id === eventId);
      if (selected) {
        setMessages(selected.messages || []);
        setToast({ open: true, message: 'Conversation loaded', severity: 'success' });
      } else {
        setToast({ open: true, message: 'Conversation not found', severity: 'error' });
      }
    } catch (e) {
      console.error('Error loading conversation:', e);
      setToast({ open: true, message: 'Failed to load conversation', severity: 'error' });
    }
  };

    return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          Deal Coach
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={analyze}
          disabled={analyzing}
          startIcon={analyzing ? <CircularProgress size={16} /> : <RefreshIcon />}
        >
          {analyzing ? 'Analyzing...' : 'Refresh Analysis'}
        </Button>
      </Box>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            {suggestions.map((s, idx) => (
              <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label={s.label} onClick={() => setInput(s.label)} />
                <Button size="small" variant="outlined" onClick={() => runAction(s.action)}>
                  {s.action?.type === 'createTask' ? 'Create Task' : s.action?.type === 'draftEmail' ? 'Draft Email' : s.action?.type === 'draftCall' ? 'Draft Call' : 'Apply'}
                </Button>
              </Box>
            ))}
          </Box>
        )}



        {/* Chat */}
        <Box sx={{ display: 'flex', flexDirection: 'column', border: '1px solid', borderColor: 'divider', borderRadius: 1, height: '450px', minHeight: 350 }}>
          <Box ref={listRef} sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
            {messages.map((m, i) => (
              <Box key={i} sx={{ mb: 1, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                <Box sx={{ display: 'inline-block', px: 1.25, py: 0.75, borderRadius: 1, bgcolor: m.role === 'user' ? 'primary.main' : 'grey.100', color: m.role === 'user' ? 'white' : 'text.primary' }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.text}</Typography>
                  {m.actions && m.actions.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {m.actions.map((a: any, idx: number) => (
                        <Button key={idx} size="small" variant="outlined" onClick={() => runAction(a)}>
                          {a.type === 'createTask' ? 'Create Task' : a.type === 'draftEmail' ? 'Draft Email' : a.type === 'draftCall' ? 'Draft Call' : 'Action'}
                        </Button>
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Ask Deal Coach…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button onClick={send} variant="contained" disabled={loading || !input.trim()}>Send</Button>
          </Box>
        </Box>
        <Snackbar open={!!toast?.open} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert severity={toast?.severity || 'info'} onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast?.message}
          </Alert>
        </Snackbar>
        <Box sx={{ mt: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Saved Conversations</Typography>
          {conversations.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No previous conversations</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {conversations.map((c) => (
                <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Box onClick={() => loadConversationIntoThread(c.id)} style={{ cursor: 'pointer' }}>
                    <Typography variant="subtitle2">{c.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.at.toLocaleString()}</Typography>
                  </Box>
                  <IconButton size="small" color="error" onClick={() => deleteConversation(c.id)}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
    );
  };

export default DealCoachPanel;


