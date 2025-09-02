import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Card, CardContent, CardHeader, Chip, IconButton, Typography, Button, TextField, Snackbar, Alert, CircularProgress } from '@mui/material';
import { Close as CloseIcon, Add as AddIcon, Refresh as RefreshIcon } from '@mui/icons-material';

import { getFunctions, httpsCallable } from 'firebase/functions';

import { useAuth } from '../contexts/AuthContext';

interface SalesCoachProps {
  entityType: 'deal' | 'contact' | 'company';
  entityId: string;
  entityName: string;
  tenantId: string;
  // Deal-specific props
  dealStage?: string;
  // Contact-specific props
  contactCompany?: string;
  contactTitle?: string;
  // Shared context
  associations?: {
    companies?: any[];
    contacts?: any[];
    deals?: any[];
    salespeople?: any[];
    locations?: any[];
  };
  onStartNew?: () => void;
  key?: string; // Add key prop to detect when to start new conversation
  height?: string | number; // Allow custom height for widget usage
  compact?: boolean; // Compact mode for smaller widgets
}

interface CoachMessage {
  role: 'user' | 'assistant';
  text: string;
  at: number;
  actions?: Array<any>;
}

const SalesCoach: React.FC<SalesCoachProps> = ({ 
  entityType, 
  entityId, 
  entityName, 
  tenantId, 
  dealStage, 
  contactCompany, 
  contactTitle, 
  associations, 
  onStartNew,
  height = '450px',
  compact = false
}) => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<string>('');
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success'|'error'|'info' } | null>(null);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string; at: Date; messages: any[] }>>([]);

  const listRef = useRef<HTMLDivElement>(null);

  const threadKey = useMemo(() => `coach.thread.${entityId}`, [entityId]);

  useEffect(() => {
    // restore thread
    const raw = localStorage.getItem(threadKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setMessages(parsed);
      } catch {}
    }
    
    // Only analyze if we have a valid entityId
    if (entityId && entityId !== 'dashboard' && entityId !== 'unknown' && entityId.length >= 3) {
      analyze();
    }
    
    loadConversations();
  }, [entityId, entityType]);

  // Listen for new conversation events
  useEffect(() => {
    const handleNewConversation = (event: CustomEvent) => {
      console.log('Received new conversation event:', event.detail);
      if (event.detail.entityId === entityId) {
        console.log('Starting new conversation for entity:', entityId);
        console.log('Messages at event time:', messages);
        // Capture current messages before any potential clearing
        const currentMessages = [...messages];
        console.log('Captured messages:', currentMessages);
        startNewConversation(currentMessages);
      }
    };

    window.addEventListener('startNewSalesCoachConversation', handleNewConversation as EventListener);
    
    return () => {
      window.removeEventListener('startNewSalesCoachConversation', handleNewConversation as EventListener);
    };
  }, [entityId, messages]);

  // Effect to handle new conversation when key changes
  useEffect(() => {
    if (onStartNew) {
      onStartNew();
    }
    // Removed automatic startNewConversation() call - only start new conversation when explicitly requested
  }, [entityId]); // This will trigger when the entityId changes (which happens when key changes)

  useEffect(() => {
    localStorage.setItem(threadKey, JSON.stringify(messages));
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, threadKey]);

  // Debug conversations state changes
  useEffect(() => {
    console.log('Conversations state updated:', conversations);
  }, [conversations]);

  // Debounce analysis to prevent rapid successive calls
  const [lastAnalyzeTime, setLastAnalyzeTime] = useState(0);
  const ANALYZE_DEBOUNCE_DELAY = 10000; // 10 seconds debounce

  const analyze = async () => {
    // Debounce rapid analyze calls
    const now = Date.now();
    if (now - lastAnalyzeTime < ANALYZE_DEBOUNCE_DELAY) {
      console.log('Skipping Sales Coach analysis - too soon since last analyze');
      return;
    }
    setLastAnalyzeTime(now);

    setAnalyzing(true);
    try {
      // Only attempt to analyze if we have valid entity data
      if (!entityId || !tenantId) {
        console.log('Sales Coach: Missing required entity data');
        setSummary('');
        return;
      }

      const functions = getFunctions(undefined, 'us-central1');
      const analyzeFn = httpsCallable(functions, 'dealCoachAnalyzeCallable');
      
      const params = {
        dealId: entityId,
        stageKey: dealStage || 'general',
        tenantId,
        entityType: entityType || 'deal',
        entityName: entityName || 'Unknown',
        contactCompany: contactCompany || '',
        contactTitle: contactTitle || ''
      };

      console.log('Sales Coach analyze params:', params);
      
      const { data }: any = await analyzeFn(params);
      setSummary(data?.summary || '');
    } catch (e) {
      console.error('Sales Coach analyze error:', e);
      
      // Provide more detailed error information
      let errorMessage = 'Analysis feature temporarily unavailable';
      if (e && typeof e === 'object' && 'message' in e) {
        errorMessage = `Analysis error: ${e.message}`;
      }
      
      // Set fallback content instead of empty strings
      setSummary('Unable to analyze at this time. Please try again later or contact support if the issue persists.');
      
      // Log the error for debugging
      console.error('Sales Coach analyze failed:', {
        error: e,
        entityId,
        tenantId
      });
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
      // Only attempt to chat if we have valid entity data
      if (!entityId || !tenantId) {
        console.log('Sales Coach: Missing required entity data');
        setMessages((m) => [...m, { 
          role: 'assistant', 
          text: 'I\'m having trouble accessing the data. Please try refreshing the page.', 
          at: Date.now() 
        }]);
        return;
      }

      // Additional validation to prevent 500 errors
      if (entityId === 'dashboard' || entityId === 'unknown' || entityId.length < 3) {
        console.warn('Sales Coach: Invalid entityId for chat:', entityId);
        setMessages((m) => [...m, { 
          role: 'assistant', 
          text: 'Chat is not available for this context. Please select a specific deal, contact, or company to get personalized assistance.', 
          at: Date.now() 
        }]);
        return;
      }

      const functions = getFunctions(undefined, 'us-central1');
      const chatFn = httpsCallable(functions, 'dealCoachChatCallable');
      
      const params = {
        dealId: entityId,
        stageKey: dealStage || 'general',
        tenantId, 
        userId: user?.uid || 'unknown', 
        message: text,
        entityType: entityType || 'deal',
        entityName: entityName || 'Unknown',
        contactCompany: contactCompany || '',
        contactTitle: contactTitle || ''
      };

      console.log('Sales Coach chat params:', params);
      
      const { data }: any = await chatFn(params);
      
      // Convert JSON response to readable text
      let replyText = '';
      console.log('Sales Coach response data:', data);
      
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
        replyText = `I understand. How can I help you with this ${entityType}?`;
      }
      
      const actions: any[] = Array.isArray(data?.actions) ? data.actions : [];
      setMessages((m) => [...m, { role: 'assistant', text: replyText, actions, at: Date.now() }]);
      // Auto-run returned actions for convenience
      for (const a of actions) {
        await runAction(a);
      }
    } catch (e) {
      console.error('Sales Coach chat error:', e);
      
      // Provide more helpful error message
      let errorMessage = 'Sorry — something went wrong. Please try again.';
      if (e && typeof e === 'object' && 'message' in e) {
        if (e.message.includes('500')) {
          errorMessage = 'The AI service is temporarily unavailable. Please try again in a few minutes.';
        } else if (e.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        }
      }
      
      setMessages((m) => [...m, { 
        role: 'assistant', 
        text: errorMessage, 
        at: Date.now() 
      }]);
      
      // Log the error for debugging
      console.error('Sales Coach chat failed:', {
        error: e,
        entityId,
        tenantId,
        message: text
      });
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (action: any) => {
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const actionFn = httpsCallable(functions, 'dealCoachActionCallable');
      const { data }: any = await actionFn({ 
        tenantId, 
        dealId: entityId, // Use dealId for both deals and contacts
        action 
      });
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
      const conversationsKey = `coach.conversations.${entityId}`;
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
      const conversationsKey = `coach.conversations.${entityId}`;
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

  const startNewConversation = async (messagesToSave = messages) => {
    try {
      console.log('Starting new conversation, current messages:', messagesToSave.length);
      console.log('Current messages:', messagesToSave);
      
      // Save current conversation to localStorage if there are messages
      if (messagesToSave.length > 0) {
        const conversationsKey = `coach.conversations.${entityId}`;
        console.log('Conversations key:', conversationsKey);
        
        const firstUserMessage = messagesToSave.find(m => m.role === 'user');
        const title = firstUserMessage?.text?.slice(0, 60) || 'New Conversation';
        
        const newConversation = {
          id: Date.now().toString(),
          title,
          at: new Date(),
          messages: [...messagesToSave]
        };
        
        console.log('Saving conversation:', newConversation);
        
        // Load existing conversations and add the new one
        const raw = localStorage.getItem(conversationsKey);
        console.log('Raw localStorage data:', raw);
        
        const existingConversations = raw ? JSON.parse(raw) : [];
        console.log('Existing conversations:', existingConversations);
        
        const updatedConversations = [newConversation, ...existingConversations].slice(0, 10); // Keep last 10
        console.log('Updated conversations array:', updatedConversations);
        
        localStorage.setItem(conversationsKey, JSON.stringify(updatedConversations));
        console.log('Saved to localStorage');
        
        // Update state immediately for reactive UI
        setConversations(updatedConversations);
        console.log('Set conversations state to:', updatedConversations);
        
        // Clear current messages immediately after saving
        setMessages([]);
        setToast({ open: true, message: 'Started new conversation', severity: 'info' });
        
      } else {
        console.log('No messages to save');
        setToast({ open: true, message: 'Started new conversation', severity: 'info' });
      }
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
        {/* Chat */}
        <Box sx={{ display: 'flex', flexDirection: 'column', border: '1px solid', borderColor: 'divider', borderRadius: 1, height: compact ? '300px' : height, minHeight: compact ? 250 : 350 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight={700}>
              Sales Coach
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
          <Box ref={listRef} sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
            {messages.map((m, i) => (
              <Box key={i} sx={{ mb: 1, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                <Box sx={{ display: 'inline-block', px: 1.25, py: 0.75, borderRadius: 1, bgcolor: m.role === 'user' ? 'primary.main' : 'grey.100', color: m.role === 'user' ? 'white' : 'text.primary' }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: compact ? '0.75rem' : '0.875rem' }}>{m.text}</Typography>
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
            
            {/* AI Typing Indicator */}
            {loading && (
              <Box sx={{ mb: 1, textAlign: 'left' }}>
                <Box 
                  sx={{ 
                    display: 'inline-block', 
                    px: 1.25, 
                    py: 0.75, 
                    borderRadius: 1, 
                    bgcolor: 'grey.100',
                    animation: 'typing 1.4s infinite ease-in-out',
                    '@keyframes typing': {
                      '0%, 60%, 100%': {
                        opacity: 0.6,
                        transform: 'translateY(0px)'
                      },
                      '30%': {
                        opacity: 1,
                        transform: 'translateY(-2px)'
                      }
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box 
                      sx={{ 
                        width: 6, 
                        height: 6, 
                        borderRadius: '50%', 
                        bgcolor: 'grey.500',
                        animation: 'bounce 1.4s infinite ease-in-out',
                        '@keyframes bounce': {
                          '0%, 80%, 100%': {
                            transform: 'scale(0.8)',
                            opacity: 0.5
                          },
                          '40%': {
                            transform: 'scale(1)',
                            opacity: 1
                          }
                        }
                      }} 
                    />
                    <Box 
                      sx={{ 
                        width: 6, 
                        height: 6, 
                        borderRadius: '50%', 
                        bgcolor: 'grey.500',
                        animation: 'bounce 1.4s infinite ease-in-out 0.2s',
                        '@keyframes bounce': {
                          '0%, 80%, 100%': {
                            transform: 'scale(0.8)',
                            opacity: 0.5
                          },
                          '40%': {
                            transform: 'scale(1)',
                            opacity: 1
                          }
                        }
                      }} 
                    />
                    <Box 
                      sx={{ 
                        width: 6, 
                        height: 6, 
                        borderRadius: '50%', 
                        bgcolor: 'grey.500',
                        animation: 'bounce 1.4s infinite ease-in-out 0.4s',
                        '@keyframes bounce': {
                          '0%, 80%, 100%': {
                            transform: 'scale(0.8)',
                            opacity: 0.5
                          },
                          '40%': {
                            transform: 'scale(1)',
                            opacity: 1
                          }
                        }
                      }} 
                    />
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <TextField
              fullWidth
              size="small"
              placeholder={`Ask ${entityType === 'deal' ? 'Deal' : entityType === 'company' ? 'Company' : 'Sales'} Coach…`}
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
        <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Saved Conversations</Typography>
          </Box>
          {conversations.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No previous conversations</Typography>
          ) : (
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 1.5, 
              maxHeight: '-250px', 
              overflowY: 'auto',
              pr: 1
            }}>
              {conversations.map((c) => (
                <Box 
                  key={c.id} 
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    p: 1.5, 
                    border: '1px solid', 
                    borderColor: 'grey.200', 
                    borderRadius: 1.5,
                    bgcolor: 'grey.50',
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': {
                      bgcolor: 'grey.100',
                      borderColor: 'grey.300'
                    }
                  }}
                >
                  <Box 
                    onClick={() => loadConversationIntoThread(c.id)} 
                    style={{ cursor: 'pointer' }}
                    sx={{ flex: 1 }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 0.5 }}>{c.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.at.toLocaleString()}</Typography>
                  </Box>
                  <IconButton 
                    size="small" 
                    color="error" 
                    onClick={() => deleteConversation(c.id)}
                    sx={{ 
                      opacity: 0.7,
                      '&:hover': {
                        opacity: 1,
                        bgcolor: 'error.50'
                      }
                    }}
                  >
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

export default SalesCoach;
