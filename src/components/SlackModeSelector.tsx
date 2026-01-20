/**
 * Slack Mode Selector
 * 
 * Phase 5: UI component for selecting Slack integration mode per conversation
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  Select,
  MenuItem,
  FormHelperText,
  SelectChangeEvent,
  CircularProgress,
  Alert,
} from '@mui/material';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { canUserAccessSlack, getSecurityLevelForActiveTenant } from '../utils/security';

export type SlackConversationMode =
  | 'off'              // Slack integration disabled for this conversation
  | 'manual'           // HRX messages *only* go to Slack when explicitly requested
  | 'auto_all'         // All HRX messages in this conversation mirror to Slack
  | 'auto_admin_only'; // Only HRX messages from high-security users mirror to Slack

interface SlackModeSelectorProps {
  tenantId: string;
  conversationId: string;
  conversationType: 'dm' | 'channel';
  onModeChange?: (mode: SlackConversationMode) => void;
}

const SlackModeSelector: React.FC<SlackModeSelectorProps> = ({
  tenantId,
  conversationId,
  conversationType,
  onModeChange,
}) => {
  const { user, activeTenant, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const [mode, setMode] = useState<SlackConversationMode>('manual');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure the object passed into security helpers includes activeTenantId + tenantIds security level.
  const userAny = user as any;
  const userWithTenant = user
    ? {
        ...userAny,
        activeTenantId: userAny.activeTenantId || activeTenant?.id,
        tenantIds:
          userAny.tenantIds ||
          (activeTenant?.id
            ? {
                [activeTenant.id]: {
                  securityLevel: currentClaimsSecurityLevel || securityLevel,
                },
              }
            : {}),
      }
    : null;

  // Check if user has permission (securityLevel >= 6 for settings)
  const canModifySettings = !!(userWithTenant && getSecurityLevelForActiveTenant(userWithTenant as any) >= 6);
  const canAccessSlack = !!(userWithTenant && canUserAccessSlack(userWithTenant as any));

  useEffect(() => {
    const loadSettings = async () => {
      if (!tenantId || !conversationId) {
        setLoading(false);
        return;
      }

      try {
        const conversationRef = doc(
          db,
          'tenants',
          tenantId,
          conversationType === 'dm' ? 'internalDMs' : 'internalChannels',
          conversationId
        );

        const conversationSnap = await getDoc(conversationRef);
        if (conversationSnap.exists()) {
          const data = conversationSnap.data();
          const settings = data.slackSettings;
          if (settings?.mode) {
            setMode(settings.mode);
          }
        }
      } catch (err: any) {
        console.error('Error loading Slack settings:', err);
        setError('Failed to load Slack settings');
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [tenantId, conversationId, conversationType]);

  const handleModeChange = async (event: SelectChangeEvent<SlackConversationMode>) => {
    const newMode = event.target.value as SlackConversationMode;
    
    if (!canModifySettings) {
      setError('You do not have permission to modify Slack settings');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const conversationRef = doc(
        db,
        'tenants',
        tenantId,
        conversationType === 'dm' ? 'internalDMs' : 'internalChannels',
        conversationId
      );

      await updateDoc(conversationRef, {
        'slackSettings.mode': newMode,
        'slackSettings.updatedAt': serverTimestamp(),
      });

      setMode(newMode);
      if (onModeChange) {
        onModeChange(newMode);
      }
    } catch (err: any) {
      console.error('Error updating Slack mode:', err);
      setError('Failed to update Slack mode');
    } finally {
      setSaving(false);
    }
  };

  if (!canAccessSlack) {
    return null; // Don't show if user can't access Slack
  }

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Slack Integration Mode
      </Typography>
      <FormControl fullWidth size="small" disabled={!canModifySettings || saving}>
        <Select
          value={mode}
          onChange={handleModeChange}
          displayEmpty
        >
          <MenuItem value="off">Off</MenuItem>
          <MenuItem value="manual">Manual</MenuItem>
          <MenuItem value="auto_all">Auto – All</MenuItem>
          <MenuItem value="auto_admin_only">Auto – Admin Only</MenuItem>
        </Select>
        <FormHelperText>
          {mode === 'off' && 'Slack integration disabled for this conversation'}
          {mode === 'manual' && 'Messages only mirror to Slack when explicitly requested'}
          {mode === 'auto_all' && 'All messages in this conversation mirror to Slack'}
          {mode === 'auto_admin_only' && 'Only messages from high-security users (level 5+) mirror to Slack'}
        </FormHelperText>
      </FormControl>

      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!canModifySettings && (
        <Alert severity="info" sx={{ mt: 1 }}>
          Only Managers and Admins (security level 6+) can modify Slack settings
        </Alert>
      )}
    </Box>
  );
};

export default SlackModeSelector;



