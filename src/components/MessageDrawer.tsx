/**
 * Message Drawer Component
 * 
 * Standardized drawer for sending messages to users individually or in groups.
 * Slides in from the right, takes ~40% of desktop screen.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Divider,
  TextField,
  Button,
  Chip,
  FormControl,
  FormLabel,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Stack,
  Alert,
  CircularProgress,
  Avatar,
  Tooltip,
  Select,
  MenuItem,
  Autocomplete,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import EmailTemplateEditor from './EmailTemplateEditor';
import { type Channel } from '../utils/templateApi';
import { useAuth } from '../contexts/AuthContext';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, db } from '../firebase';
import { collection, query, where, getDocs, limit, doc, getDoc } from 'firebase/firestore';
import { createAutoSave, loadDraft, deleteDraft } from '../utils/emailDrafts';
import { useMemo } from 'react';

export interface MessageRecipient {
  userId: string;
  name: string;
  email?: string;
  phone?: string;
  avatar?: string;
}

interface MessageDrawerProps {
  open: boolean;
  onClose: () => void;
  recipients: MessageRecipient[];
  tenantId?: string;
  initialChannel?: Channel;
  defaultChannels?: Channel[];
  defaultSubject?: string;
  defaultBody?: string; // Pre-filled message body (for forwarding)
  threadId?: string; // For email thread replies
  onSend?: (result: { success: boolean; dispatchedChannels?: Channel[]; messageLogIds?: string[] }) => void;
  onMessageSent?: (optimisticMessageId?: string) => void; // Callback after message is sent (for thread replies)
  onOptimisticMessage?: (message: any) => void; // Callback to add optimistic message before sending
  variant?: 'drawer' | 'inline'; // Render as drawer or inline form
}

interface SenderOption {
  id: string;
  type: 'system' | 'gmail' | 'recruiter_sms';
  label: string;
  email?: string;
  phone?: string;
  enabled: boolean;
  description?: string;
}

const MessageDrawer: React.FC<MessageDrawerProps> = ({
  open,
  onClose,
  recipients,
  tenantId,
  initialChannel,
  defaultChannels,
  defaultSubject,
  defaultBody,
  threadId,
  onSend,
  onMessageSent,
  onOptimisticMessage,
  variant = 'drawer',
}) => {
  const { user, activeTenant } = useAuth();
  const effectiveTenantId = tenantId || activeTenant?.id || '';
  const [channels, setChannels] = useState<Channel[]>(defaultChannels || (initialChannel ? [initialChannel] : ['email']));
  const [subject, setSubject] = useState(defaultSubject || ''); // Subject for email
  const [messageBody, setMessageBody] = useState(defaultBody || ''); // Unified message body (HTML for rich text)
  const [cc, setCc] = useState<string>(''); // Cc field for email
  const [bcc, setBcc] = useState<string>(''); // Bcc field for email
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [senderOptions, setSenderOptions] = useState<SenderOption[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('system');
  const [loadingSenders, setLoadingSenders] = useState(false);
  const [hasTwilioNumber, setHasTwilioNumber] = useState<boolean>(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; size: number; file: File }>>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [internalRecipients, setInternalRecipients] = useState<MessageRecipient[]>(recipients);
  const [recipientOptions, setRecipientOptions] = useState<Array<{ id: string; name: string; email: string; phone?: string; type: 'user' | 'contact' }>>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipientInputValue, setRecipientInputValue] = useState('');
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const prevOpenRef = useRef(false); // Track previous open state to detect when drawer first opens

  // Create auto-save function for drafts
  const autoSaveDraft = useMemo(
    () => {
      if (!user?.uid || !effectiveTenantId) return () => {};
      return createAutoSave(user.uid, effectiveTenantId, draftId);
    },
    [user?.uid, effectiveTenantId, draftId]
  );

  // Auto-save draft when subject or body changes
  useEffect(() => {
    if (!open || !user?.uid || !effectiveTenantId || draftLoaded) return;
    
    // Only auto-save if there's actual content
    if (subject.trim() || messageBody.trim()) {
      const newDraftId = draftId || `draft-${Date.now()}`;
      if (!draftId) {
        setDraftId(newDraftId);
      }
      
      autoSaveDraft({
        to: internalRecipients.map(r => r.email || r.name).filter(Boolean),
        cc: cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : [],
        bcc: bcc ? bcc.split(',').map(e => e.trim()).filter(Boolean) : [],
        subject,
        bodyHtml: messageBody,
        bodyPlain: messageBody.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(),
      });
    }
  }, [subject, messageBody, cc, bcc, internalRecipients, open, user?.uid, effectiveTenantId, draftId, draftLoaded, autoSaveDraft]);

  // Load draft when drawer opens (if not replying/forwarding)
  useEffect(() => {
    if (open && user?.uid && effectiveTenantId && !threadId && !defaultSubject && !defaultBody) {
      // Try to load the most recent draft
      // For now, we'll create a new draft ID - in production, you'd want to load existing drafts
      setDraftLoaded(true);
    } else if (open && (threadId || defaultSubject || defaultBody)) {
      // Don't auto-save when replying/forwarding
      setDraftLoaded(true);
    } else if (!open) {
      // Reset draft state when drawer closes
      setDraftId(undefined);
      setDraftLoaded(false);
    }
  }, [open, user?.uid, effectiveTenantId, threadId, defaultSubject, defaultBody]);

  // Pre-load sender information and check Twilio number when drawer opens
  // CRITICAL: Only reset form fields when drawer FIRST opens (not on every prop change)
  useEffect(() => {
    const isOpening = open && !prevOpenRef.current; // Drawer is opening (was closed, now open)
    const isClosing = !open && prevOpenRef.current; // Drawer is closing (was open, now closed)
    
    // Update ref to track current state
    prevOpenRef.current = open;
    
    if (isOpening && user?.uid) {
      // Only reset form fields when drawer FIRST opens, not on subsequent prop changes
      setChannels(defaultChannels || (initialChannel ? [initialChannel] : ['email']));
      setSubject(defaultSubject || '');
      setMessageBody(defaultBody || '');
      setCc('');
      setBcc('');
      setAttachments([]);
      setError(null);
      setSuccess(false);
      setInternalRecipients(recipients);
      setRecipientInputValue(recipients.map(r => r.email || r.name).join(', '));
      setRecipientOptions([]);
      
      // Immediately set Gmail sender option (will be updated if not connected)
      const initialOptions: SenderOption[] = [{
        id: 'gmail',
        type: 'gmail',
        label: 'Gmail',
        email: user?.email || '',
        enabled: true,
        description: 'Send from your Gmail account',
      }];
      setSenderOptions(initialOptions);
      setSelectedSenderId('gmail');
      setLoadingSenders(false);
      
      // Check Gmail status and Twilio number in background (non-blocking)
      const checkSenderInfo = async () => {
        // Check Gmail connection
        try {
          const getGmailStatusFn = httpsCallable(functions, 'getGmailStatusOptimized');
          const gmailResult = await getGmailStatusFn({ userId: user.uid });
          const gmailData = gmailResult.data as { connected?: boolean; email?: string };
          
          if (!gmailData?.connected) {
            // Remove Gmail option if not connected
            setSenderOptions([{
              id: 'system',
              type: 'system',
              label: 'System',
              enabled: true,
              description: 'SendGrid email',
            }]);
            setSelectedSenderId('system');
          } else if (gmailData?.email) {
            // Update Gmail option with actual email
            setSenderOptions([{
              id: 'gmail',
              type: 'gmail',
              label: 'Gmail',
              email: gmailData.email,
              enabled: true,
              description: `Send from ${gmailData.email}`,
            }]);
          }
        } catch (err) {
          console.warn('Failed to check Gmail status:', err);
        }
        
        // Check Twilio number assignment
        if (effectiveTenantId) {
          try {
            const recruiterNumberDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'recruiterNumbers', user.uid));
            const hasNumber = recruiterNumberDoc.exists() && (recruiterNumberDoc.data()?.twilioNumber || recruiterNumberDoc.data()?.useMainNumber);
            setHasTwilioNumber(hasNumber || false);
          } catch (err) {
            console.warn('Failed to check Twilio number:', err);
            setHasTwilioNumber(false);
          }
        }
      };
      
      checkSenderInfo();
    } else if (isClosing) {
      // Reset draft state when drawer closes
      setDraftId(undefined);
      setDraftLoaded(false);
    }
    
    // Update recipients if they change while drawer is open (but don't reset form fields)
    // Only update if recipients actually changed (compare by IDs/emails)
    if (open && !isOpening) {
      const currentRecipientIds = new Set(internalRecipients.map(r => r.userId || r.email || r.name).filter(Boolean));
      const newRecipientIds = new Set(recipients.map(r => r.userId || r.email || r.name).filter(Boolean));
      const recipientsChanged = 
        currentRecipientIds.size !== newRecipientIds.size ||
        [...newRecipientIds].some(id => !currentRecipientIds.has(id));
      
      if (recipientsChanged) {
        setInternalRecipients(recipients);
        setRecipientInputValue(recipients.map(r => r.email || r.name).join(', '));
      }
    }
  }, [open, initialChannel, defaultChannels, defaultSubject, defaultBody, user?.uid, effectiveTenantId, recipients]);

  // Search for recipients by email, name, or username
  const searchRecipients = async (searchTerm: string) => {
    if (!searchTerm || searchTerm.length < 2 || !effectiveTenantId) {
      setRecipientOptions([]);
      return;
    }

    setLoadingRecipients(true);
    try {
      const searchLower = searchTerm.toLowerCase();
      const results: Array<{ id: string; name: string; email: string; phone?: string; type: 'user' | 'contact' }> = [];

      // Search users by email, name, or username (client-side filtering to avoid index requirements)
      try {
        const usersRef = collection(db, 'users');
        const usersQuery = query(usersRef, limit(500)); // Get more users for better search results
        const usersSnapshot = await getDocs(usersQuery);
        
        usersSnapshot.docs.forEach(doc => {
          const userData = doc.data();
          const email = userData.email?.toLowerCase() || '';
          const firstName = (userData.firstName || '').toLowerCase();
          const lastName = (userData.lastName || '').toLowerCase();
          const displayName = (userData.displayName || '').toLowerCase();
          const fullName = `${firstName} ${lastName}`.trim();
          const username = email.split('@')[0] || '';
          
          // Match by email, first name, last name, full name, display name, or username
          const matchesEmail = email.includes(searchLower);
          const matchesFirstName = firstName.includes(searchLower);
          const matchesLastName = lastName.includes(searchLower);
          const matchesFullName = fullName.includes(searchLower);
          const matchesDisplayName = displayName.includes(searchLower);
          const matchesUsername = username.includes(searchLower);
          
          if (matchesEmail || matchesFirstName || matchesLastName || matchesFullName || matchesDisplayName || matchesUsername) {
            const name = userData.displayName || fullName || email.split('@')[0];
            results.push({
              id: doc.id,
              name,
              email: userData.email,
              phone: userData.phone,
              type: 'user',
            });
          }
        });
      } catch (err) {
        console.warn('Error searching users:', err);
      }

      // Search CRM contacts by email or name (client-side filtering to avoid index requirements)
      try {
        const contactsRef = collection(db, 'tenants', effectiveTenantId, 'crm_contacts');
        const contactsQuery = query(contactsRef, limit(500)); // Get more contacts for better search results
        const contactsSnapshot = await getDocs(contactsQuery);
        
        contactsSnapshot.docs.forEach(doc => {
          const contactData = doc.data();
          const email = (contactData.email || '').toLowerCase();
          const firstName = (contactData.firstName || '').toLowerCase();
          const lastName = (contactData.lastName || '').toLowerCase();
          const fullName = contactData.firstName && contactData.lastName
            ? `${contactData.firstName} ${contactData.lastName}`.toLowerCase()
            : '';
          const displayName = (contactData.fullName || contactData.name || '').toLowerCase();
          
          // Match by email, first name, last name, full name, or display name
          const matchesEmail = email.includes(searchLower);
          const matchesFirstName = firstName.includes(searchLower);
          const matchesLastName = lastName.includes(searchLower);
          const matchesFullName = fullName.includes(searchLower);
          const matchesDisplayName = displayName.includes(searchLower);
          
          if (matchesEmail || matchesFirstName || matchesLastName || matchesFullName || matchesDisplayName) {
            const name = contactData.firstName && contactData.lastName
              ? `${contactData.firstName} ${contactData.lastName}`
              : contactData.fullName || contactData.name || email.split('@')[0];
            
            results.push({
              id: doc.id,
              name,
              email: contactData.email,
              phone: contactData.phone,
              type: 'contact',
            });
          }
        });
      } catch (err) {
        console.warn('Error searching contacts:', err);
      }

      // Remove duplicates (same email)
      const uniqueResults = Array.from(
        new Map(results.map(item => [item.email.toLowerCase(), item])).values()
      );

      setRecipientOptions(uniqueResults);
    } catch (error: any) {
      console.error('Error searching recipients:', error);
      setError('Failed to search recipients');
    } finally {
      setLoadingRecipients(false);
    }
  };

  // Handle recipient input change
  const handleRecipientInputChange = (event: any, newValue: string) => {
    setRecipientInputValue(newValue);
    if (newValue && newValue.length >= 2) {
      searchRecipients(newValue);
    } else {
      setRecipientOptions([]);
    }
  };

  // Handle recipient selection/change
  const handleRecipientChange = (event: any, newValue: any) => {
    if (typeof newValue === 'string') {
      // Free text - extract email addresses
      const emailRegex = /[\w.-]+@[\w.-]+\.[\w]+/g;
      const emails = newValue.match(emailRegex) || [];
      
      if (emails.length > 0) {
        const newRecipients: MessageRecipient[] = emails.map(email => ({
          userId: email, // Use email as ID for unknown recipients
          name: email.split('@')[0],
          email: email,
        }));
        setInternalRecipients(newRecipients);
        setRecipientInputValue('');
      } else {
        // Check if it's a valid email format (more permissive regex)
        const singleEmailMatch = newValue.trim().match(/^[\w.-]+@[\w.-]+\.[\w]+$/);
        if (singleEmailMatch) {
          const email = singleEmailMatch[0];
          const newRecipient: MessageRecipient = {
            userId: email,
            name: email.split('@')[0],
            email: email,
          };
          setInternalRecipients([newRecipient]);
          setRecipientInputValue('');
        } else {
          // Keep the input value so user can continue typing
          setRecipientInputValue(newValue);
        }
      }
    } else if (newValue) {
      // Selected from autocomplete
      const newRecipient: MessageRecipient = {
        userId: newValue.id,
        name: newValue.name,
        email: newValue.email,
        phone: newValue.phone,
      };
      setInternalRecipients([newRecipient]);
      setRecipientInputValue('');
    } else {
      // Cleared
      setInternalRecipients([]);
      setRecipientInputValue('');
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploadingAttachments(true);
    try {
      const newAttachments = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Validate file size (25MB max per Gmail limit)
        if (file.size > 25 * 1024 * 1024) {
          setError(`File "${file.name}" is too large. Maximum size is 25MB.`);
          continue;
        }

        newAttachments.push({
          id: `${Date.now()}_${i}`,
          name: file.name,
          size: file.size,
          file,
        });
      }
      setAttachments(prev => [...prev, ...newAttachments]);
    } catch (err: any) {
      setError(err.message || 'Failed to add attachments');
    } finally {
      setUploadingAttachments(false);
      // Reset input
      event.target.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const loadSenderOptions = async () => {
    if (!user?.uid) return;
    
    setLoadingSenders(true);
    try {
      const options: SenderOption[] = [];
      
      // Always add system sender
      options.push({
        id: 'system',
        type: 'system',
        label: 'System',
        enabled: true,
        description: 'SendGrid email / Main Twilio number',
      });

      // Check Gmail connection
      try {
        const getGmailStatusFn = httpsCallable(functions, 'getGmailStatus');
        const gmailResult = await getGmailStatusFn({ userId: user.uid });
        const gmailData = gmailResult.data as { connected?: boolean; email?: string };
        
        if (gmailData?.connected && gmailData?.email) {
          options.push({
            id: 'gmail',
            type: 'gmail',
            label: 'My Gmail',
            email: gmailData.email,
            enabled: true,
            description: `Send from ${gmailData.email}`,
          });
        }
      } catch (err) {
        console.warn('Failed to check Gmail status:', err);
      }

      // Check recruiter number assignment (only if SMS channel might be used)
      // Skip this for email-only sends (forwards, replies) to avoid unnecessary API calls
      const isEmailOnly = defaultChannels?.includes('email') && defaultChannels.length === 1;
      if (!isEmailOnly && !defaultBody && effectiveTenantId) {
        // Only check recruiter numbers if SMS might be used (not email-only) and tenantId is available
        try {
          const getRecruiterNumbersFn = httpsCallable(functions, 'getRecruiterNumbers');
          const numbersResult = await getRecruiterNumbersFn({ tenantId: effectiveTenantId });
          const numbersData = numbersResult.data as { success?: boolean; assignments?: any[] };
          
          if (numbersData?.success && numbersData?.assignments) {
            const myAssignment = numbersData.assignments.find(
              (a: any) => a.recruiterId === user.uid && a.twilioNumber && !a.useMainNumber
            );
            
            if (myAssignment?.twilioNumber) {
              options.push({
                id: 'recruiter_sms',
                type: 'recruiter_sms',
                label: 'My Recruiter Number',
                phone: myAssignment.twilioNumber,
                enabled: true,
                description: `Send SMS from ${myAssignment.twilioNumber}`,
              });
            }
          }
        } catch (err: any) {
          // Silently fail - user might not have permission or SMS might not be needed
          // Only log if it's not a permission/validation error
          if (err?.code !== 'permission-denied' && err?.code !== 'PERMISSION_DENIED' && err?.code !== 'invalid-argument') {
            console.warn('Failed to check recruiter numbers:', err);
          }
        }
      }

      setSenderOptions(options);
      
      // Auto-select first available sender
      if (options.length > 0) {
        setSelectedSenderId(options[0].id);
      }
    } catch (err) {
      console.error('Error loading sender options:', err);
      // Fallback to system sender only
      setSenderOptions([{
        id: 'system',
        type: 'system',
        label: 'System',
        enabled: true,
        description: 'SendGrid email / Main Twilio number',
      }]);
    } finally {
      setLoadingSenders(false);
    }
  };

  const handleChannelToggle = (channel: Channel) => {
    setChannels(prev => {
      if (prev.includes(channel)) {
        return prev.filter(c => c !== channel);
      } else {
        return [...prev, channel];
      }
    });
  };

  const validateForm = (): boolean => {
    if (channels.length === 0) {
      setError('Please select at least one channel');
      return false;
    }

    // Validate subject if email is selected
    if (channels.includes('email')) {
      if (!subject.trim()) {
        setError('Subject is required');
        return false;
      }
    }

    // Strip HTML to check if there's actual content
    const textContent = messageBody.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!textContent) {
      setError('Message content is required');
      return false;
    }

    // Check SMS length if SMS is selected
    if (channels.includes('sms')) {
      if (textContent.length > 1600) {
        setError(`Message is too long for SMS (${textContent.length}/1600 characters). Consider shortening it or removing SMS from selected channels.`);
        return false;
      }
    }

    return true;
  };

  const handleSend = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL || 
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      // If this is a new email (forward or new email, not a reply), use sendNewEmailApi
      const isForwardOrNewEmail = !threadId && channels.includes('email') && channels.length === 1;
      if (isForwardOrNewEmail) {
        // Extract emails from recipients, also check recipientInputValue in case user typed but didn't select
        let toEmails = internalRecipients.map(r => r.email || r.name).filter(Boolean);
        
        // If no recipients in internalRecipients, try to extract from input value
        if (toEmails.length === 0 && recipientInputValue.trim()) {
          const emailRegex = /[\w.-]+@[\w.-]+\.[\w]+/g;
          const emails = recipientInputValue.match(emailRegex) || [];
          if (emails.length > 0) {
            toEmails = emails;
            // Also update internalRecipients for consistency
            const newRecipients: MessageRecipient[] = emails.map(email => ({
              userId: email,
              name: email.split('@')[0],
              email: email,
            }));
            setInternalRecipients(newRecipients);
          }
        }
        
        if (toEmails.length === 0) {
          setError('Please enter at least one recipient email address');
          setLoading(false);
          return;
        }
        const ccEmails = cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : [];
        const bccEmails = bcc ? bcc.split(',').map(e => e.trim()).filter(Boolean) : [];

        // Strip HTML to get plain text version
        const bodyPlain = messageBody.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

        // Upload attachments to Firebase Storage
        const uploadedAttachments = [];
        if (attachments.length > 0) {
          for (const attachment of attachments) {
            try {
              const fileName = `${Date.now()}_${attachment.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
              const storagePath = `tenants/${effectiveTenantId}/emailAttachments/new/${fileName}`;
              const storageRef = ref(storage, storagePath);
              
              await uploadBytes(storageRef, attachment.file);
              const downloadUrl = await getDownloadURL(storageRef);
              
              uploadedAttachments.push({
                id: attachment.id,
                name: attachment.name,
                contentType: attachment.file.type || 'application/octet-stream',
                size: attachment.size,
                storagePath,
                downloadUrl,
              });
            } catch (uploadError: any) {
              console.error('Failed to upload attachment:', uploadError);
              setError(`Failed to upload attachment "${attachment.name}": ${uploadError.message}`);
              setLoading(false);
              return;
            }
          }
        }

        const response = await fetch(
          `${API_BASE_URL}/sendNewEmailApi`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tenantId: effectiveTenantId,
              userId: user?.uid,
              to: toEmails,
              cc: ccEmails.length > 0 ? ccEmails : undefined,
              bcc: bccEmails.length > 0 ? bccEmails : undefined,
              subject,
              bodyHtml: messageBody,
              bodyPlain,
              attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
              senderIdentity: selectedSenderId === 'system' ? 'sendgrid' : 'gmail',
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: { message: 'Failed to send email' } }));
          throw new Error(error.error?.message || 'Failed to send email');
        }

        const result = await response.json();
        
        if (result.success) {
          setSuccess(true);
          if (onMessageSent) {
            onMessageSent();
          }
          if (onSend) {
            onSend({ success: true, dispatchedChannels: ['email'], messageLogIds: [result.messageId] });
          }
          setTimeout(() => {
            onClose();
          }, 2000);
        } else {
          setError('Failed to send email');
        }
        return;
      }

      // If this is an email thread reply, use the email threads API
      if (threadId && channels.includes('email') && channels.length === 1) {
        const toEmails = internalRecipients.map(r => r.email || r.name).filter(Boolean);
        if (toEmails.length === 0) {
          setError('Please enter at least one recipient email address');
          return;
        }
        const ccEmails = cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : [];
        const bccEmails = bcc ? bcc.split(',').map(e => e.trim()).filter(Boolean) : [];

        // Strip HTML to get plain text version
        const bodyPlain = messageBody.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

        // Upload attachments to Firebase Storage
        const uploadedAttachments = [];
        if (attachments.length > 0) {
          for (const attachment of attachments) {
            try {
              const fileName = `${Date.now()}_${attachment.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
              const storagePath = `tenants/${effectiveTenantId}/emailAttachments/${threadId}/${fileName}`;
              const storageRef = ref(storage, storagePath);
              
              await uploadBytes(storageRef, attachment.file);
              const downloadUrl = await getDownloadURL(storageRef);
              
              uploadedAttachments.push({
                id: attachment.id,
                name: attachment.name,
                contentType: attachment.file.type || 'application/octet-stream',
                size: attachment.size,
                storagePath, // This is the full path relative to bucket root
                downloadUrl,
              });
            } catch (uploadError: any) {
              console.error('Failed to upload attachment:', uploadError);
              setError(`Failed to upload attachment "${attachment.name}": ${uploadError.message}`);
              setLoading(false);
              return;
            }
          }
        }

        // Create optimistic message
        const optimisticMessageId = `optimistic-${Date.now()}-${Math.random()}`;
        const optimisticMessage = {
          id: optimisticMessageId,
          direction: 'outbound' as const,
          from: user?.email || user?.displayName || 'You',
          fromUserId: user?.uid,
          to: toEmails,
          cc: ccEmails.length > 0 ? ccEmails : undefined,
          subject,
          bodyHtml: messageBody,
          bodyPlain,
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
          status: 'sending',
          read: true,
          createdAt: new Date(),
        };

        // Add optimistic message immediately
        if (onOptimisticMessage) {
          onOptimisticMessage(optimisticMessage);
        }

        // Send email and only show success/close AFTER the server confirms.
        // This prevents "silent success" when Gmail/SendGrid fails.
        try {
          const response = await fetch(
            `${API_BASE_URL}/sendEmailReplyApi?threadId=${encodeURIComponent(threadId)}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                tenantId: effectiveTenantId,
                userId: user?.uid,
                to: toEmails,
                cc: ccEmails.length > 0 ? ccEmails : undefined,
                bcc: bccEmails.length > 0 ? bccEmails : undefined,
                subject,
                bodyHtml: messageBody,
                bodyPlain,
                attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
                senderIdentity: selectedSenderId === 'system' ? 'sendgrid' : 'gmail',
              }),
            }
          );

          if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: 'Failed to send email reply' } }));
            throw new Error(error.error?.message || 'Failed to send email reply');
          }

          const result = await response.json();
          
          if (result.success) {
            // Remove optimistic message and notify
            if (onMessageSent) {
              onMessageSent(optimisticMessageId);
            }
            if (onSend) {
              onSend({ success: true, dispatchedChannels: ['email'], messageLogIds: [result.messageId] });
            }
            setSuccess(true);
            setTimeout(() => {
              onClose();
            }, 750);
          } else {
            // Remove optimistic message on error
            if (onMessageSent) {
              onMessageSent(optimisticMessageId);
            }
            setError('Failed to send email reply');
            setSuccess(false);
          }
        } catch (err: any) {
          // Remove optimistic message on error
          if (onMessageSent) {
            onMessageSent(optimisticMessageId);
          }
          setError(err.message || 'Failed to send email reply');
          setSuccess(false);
        }
        return;
      }

      // Otherwise, use the standard message sending API
      const sendPromises = internalRecipients.map(async (rec) => {
        const context: Record<string, any> = {
          tenantId: effectiveTenantId,
          firstName: rec.name.split(' ')[0] || rec.name,
          lastName: rec.name.split(' ').slice(1).join(' ') || '',
          fullName: rec.name,
          email: rec.email || '',
          phone: rec.phone || '',
          _directMessage: true,
          _message: messageBody,
          _subject: subject || undefined,
        };

        const selectedSender = senderOptions.find(s => s.id === selectedSenderId);
        
        const payload = {
          userId: rec.userId,
          messageTypeId: 'direct_message',
          context,
          overrideChannels: channels,
          metadata: {
            senderId: selectedSenderId,
            senderType: selectedSender?.type || 'system',
            source: selectedSender?.type === 'recruiter_sms' || selectedSender?.type === 'gmail' ? 'recruiter' : 'system',
            sourceId: selectedSender?.type === 'recruiter_sms' || selectedSender?.type === 'gmail' ? user?.uid : undefined,
          },
        };

        const response = await fetch(`${API_BASE_URL}/sendMessageApi`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: { message: 'Failed to send message' } }));
          throw new Error(error.error?.message || 'Failed to send message');
        }

        return response.json();
      });

      const results = await Promise.all(sendPromises);
      const allSuccess = results.every(r => r.success);
      const dispatchedChannels = results[0]?.dispatchedChannels || channels;
      const allWarnings = results.flatMap(r => (r.warnings || []) as string[]);
      
      const result = {
        success: allSuccess,
        dispatchedChannels,
        messageLogIds: results.flatMap(r => r.messageLogIds || []),
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      };

      if (result.success) {
        setSuccess(true);
        if (onSend) {
          onSend(result);
        }
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setError(result.warnings?.join(', ') || 'Failed to send message');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const recipientDisplayName = internalRecipients.length === 1
    ? internalRecipients[0].name
    : `${internalRecipients.length} Recipients`;

  const formContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: variant === 'inline' ? 'auto' : '100%' }}>
      {/* Header - only show in drawer variant */}
      {variant === 'drawer' && (
        <Box sx={{ p: 3, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6" component="h2">
              Send Message
            </Typography>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      )}

      {/* Content */}
      <Box sx={{ flex: variant === 'inline' ? 'none' : 1, overflow: 'auto', p: variant === 'inline' ? 2 : 3 }}>
          <Stack spacing={3}>
            {/* Sender Selection */}
            {loadingSenders ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Loading sender options...
                </Typography>
              </Box>
            ) : senderOptions.length > 1 ? (
              <FormControl fullWidth>
                <FormLabel>Send As</FormLabel>
                <Select
                  value={selectedSenderId}
                  onChange={(e) => setSelectedSenderId(e.target.value)}
                  size="small"
                  sx={{ mt: 1 }}
                >
                  {senderOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id} disabled={!option.enabled}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                        <Typography variant="body2" fontWeight={500}>
                          {option.label}
                        </Typography>
                        {option.description && (
                          <Typography variant="caption" color="text.secondary">
                            {option.description}
                          </Typography>
                        )}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            
            {/* Channel Selector - Hide when email-only (compose, reply, forward from inbox) */}
            {!defaultBody && !(defaultChannels?.length === 1 && defaultChannels[0] === 'email') && (
              <FormControl component="fieldset">
                <FormLabel component="legend">Channels</FormLabel>
                <FormGroup row sx={{ mt: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={channels.includes('email')}
                      onChange={() => handleChannelToggle('email')}
                      icon={<EmailIcon />}
                      checkedIcon={<EmailIcon />}
                    />
                  }
                  label="Email"
                />
                {hasTwilioNumber && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={channels.includes('sms')}
                        onChange={() => handleChannelToggle('sms')}
                        icon={<SmsIcon />}
                        checkedIcon={<SmsIcon />}
                      />
                    }
                    label="SMS"
                  />
                )}
              </FormGroup>
            </FormControl>
            )}

            {/* Only show divider if Channels section is visible */}
            {!defaultBody && !(defaultChannels?.length === 1 && defaultChannels[0] === 'email') && <Divider />}

            {/* Email-specific fields */}
            {channels.includes('email') && (
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    To *
                  </Typography>
                  <Autocomplete
                    freeSolo
                    multiple={false}
                    options={recipientOptions}
                    loading={loadingRecipients}
                    inputValue={recipientInputValue}
                    onInputChange={handleRecipientInputChange}
                    onChange={handleRecipientChange}
                    getOptionLabel={(option) => {
                      if (typeof option === 'string') return option;
                      return option.email || option.name;
                    }}
                    renderOption={(props, option) => {
                      // eslint-disable-next-line react/prop-types
                      const { key, ...otherProps } = props;
                      if (typeof option === 'string') {
                        return <li key={key} {...otherProps}>{option}</li>;
                      }
                      return (
                        <Box key={key} component="li" {...otherProps} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
                            {option.name.charAt(0).toUpperCase()}
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2">{option.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {option.email}
                              {option.type === 'contact' && ' • Contact'}
                            </Typography>
                          </Box>
                        </Box>
                      );
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        fullWidth
                        size="small"
                        placeholder="Search by email or enter new email address"
                        disabled={false}
                        onKeyDown={(e) => {
                          // Handle Enter key to accept free-form email
                          if (e.key === 'Enter' && !e.shiftKey) {
                            const inputValue = (e.target as HTMLInputElement).value.trim();
                            if (inputValue) {
                              // Extract email from input
                              const emailRegex = /[\w.-]+@[\w.-]+\.[\w]+/g;
                              const emails = inputValue.match(emailRegex) || [];
                              if (emails.length > 0) {
                                const newRecipients: MessageRecipient[] = emails.map(email => ({
                                  userId: email,
                                  name: email.split('@')[0],
                                  email: email,
                                }));
                                setInternalRecipients(newRecipients);
                                setRecipientInputValue('');
                                e.preventDefault();
                              } else {
                                // Check if it's a valid single email
                                const singleEmailMatch = inputValue.match(/^[\w.-]+@[\w.-]+\.[\w]+$/);
                                if (singleEmailMatch) {
                                  const newRecipient: MessageRecipient = {
                                    userId: singleEmailMatch[0],
                                    name: singleEmailMatch[0].split('@')[0],
                                    email: singleEmailMatch[0],
                                  };
                                  setInternalRecipients([newRecipient]);
                                  setRecipientInputValue('');
                                  e.preventDefault();
                                }
                              }
                            }
                          }
                        }}
                        onBlur={(e) => {
                          // Handle blur to accept free-form email
                          const inputValue = e.target.value.trim();
                          if (inputValue && internalRecipients.length === 0) {
                            const emailRegex = /[\w.-]+@[\w.-]+\.[\w]+/g;
                            const emails = inputValue.match(emailRegex) || [];
                            if (emails.length > 0) {
                              const newRecipients: MessageRecipient[] = emails.map(email => ({
                                userId: email,
                                name: email.split('@')[0],
                                email: email,
                              }));
                              setInternalRecipients(newRecipients);
                              setRecipientInputValue('');
                            } else {
                              // Check if it's a valid single email
                              const singleEmailMatch = inputValue.match(/^[\w.-]+@[\w.-]+\.[\w]+$/);
                              if (singleEmailMatch) {
                                const newRecipient: MessageRecipient = {
                                  userId: singleEmailMatch[0],
                                  name: singleEmailMatch[0].split('@')[0],
                                  email: singleEmailMatch[0],
                                };
                                setInternalRecipients([newRecipient]);
                                setRecipientInputValue('');
                              }
                            }
                          }
                        }}
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {loadingRecipients ? <CircularProgress color="inherit" size={20} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    value={null}
                  />
                  {internalRecipients.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                        {internalRecipients.map((r) => (
                          <Chip
                            key={r.userId}
                            label={`${r.name}${r.email ? ` <${r.email}>` : ''}`}
                            size="small"
                            onDelete={() => {
                              setInternalRecipients([]);
                              setRecipientInputValue('');
                            }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Box>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Cc (optional)
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="cc@example.com"
                  />
                </Box>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Bcc (optional)
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="bcc@example.com"
                  />
                </Box>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Subject *
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Email subject line"
                    required
                  />
                </Box>
              </Stack>
            )}


            {/* Unified Message Editor */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Message *
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                {channels.includes('sms') && (
                  <span>
                    {messageBody.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length}/1600 characters (SMS limit)
                  </span>
                )}
                {!channels.includes('sms') && 'Your message will be adapted for each selected channel automatically.'}
              </Typography>
              <EmailTemplateEditor
                htmlBody={messageBody}
                onChange={setMessageBody}
                availableVariables={['firstName', 'lastName', 'fullName', 'email', 'phone']}
                hideViewToggle={true}
                editorHeight={250}
              />
              {channels.includes('sms') && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  SMS will use plain text version. Email will use rich formatting. Push will extract title from first line.
                </Alert>
              )}
            </Box>

            {/* Attachments (Email only) */}
            {channels.includes('email') && (
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">
                    Attachments
                  </Typography>
                  <input
                    accept="*/*"
                    style={{ display: 'none' }}
                    id="attachment-input"
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    disabled={uploadingAttachments}
                  />
                  <label htmlFor="attachment-input">
                    <Button
                      component="span"
                      size="small"
                      startIcon={<AttachFileIcon />}
                      disabled={uploadingAttachments}
                    >
                      Add File
                    </Button>
                  </label>
                </Stack>
                {attachments.length > 0 && (
                  <Stack spacing={1}>
                    {attachments.map((attachment) => (
                      <Stack
                        key={attachment.id}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{
                          p: 1,
                          bgcolor: 'grey.100',
                          borderRadius: 1,
                        }}
                      >
                        <AttachFileIcon fontSize="small" color="action" />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {attachment.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatFileSize(attachment.size)}
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveAttachment(attachment.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            )}

            {/* Error/Success Messages */}
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            {success && (
              <Alert severity="success">
                Message sent successfully via {channels.join(', ')}
              </Alert>
            )}
          </Stack>
        </Box>

      {/* Footer Actions */}
      <Box sx={{ p: variant === 'inline' ? 2 : 3, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSend}
            disabled={loading || channels.length === 0}
            startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
          >
            {loading ? 'Sending...' : 'Send'}
          </Button>
        </Stack>
      </Box>
    </Box>
  );

  if (variant === 'inline') {
    if (!open) return null;
    return formContent;
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '100%', md: '60vw', lg: '70vw' },
          minWidth: { md: '600px', lg: '800px' },
          maxWidth: { md: '60vw', lg: '70vw' },
          boxSizing: 'border-box',
        },
      }}
      ModalProps={{
        keepMounted: false, // Prevent width recalculation on mount
      }}
    >
      {formContent}
    </Drawer>
  );
};

export default MessageDrawer;

