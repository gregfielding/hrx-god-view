/**
 * useSlackIntegration Hook
 * 
 * Provides real-time Slack integration status for the active tenant.
 * Watches the slackTeams collection for connection status updates.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { normalizeSecurityLevel } from '../utils/security';

export interface SlackTeamClientDoc {
  tenantId: string;
  teamId: string;
  teamName?: string;
  botDisplayName?: string;
  status: 'active' | 'inactive';
  lastEventTs?: string;
  lastEventSummary?: {
    channelId?: string;
    channelType?: 'im' | 'channel' | 'group' | 'mpim';
    slackUserId?: string;
    text?: string;
  };
  updatedAt?: any;
}

export function useSlackIntegration() {
  const { user, activeTenant, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const [team, setTeam] = useState<SlackTeamClientDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !activeTenant?.id) {
      setTeam(null);
      setLoading(false);
      return;
    }

    const tenantId = activeTenant.id;
    const teamRef = doc(db, 'slackTeams', tenantId);

    const unsubscribe = onSnapshot(
      teamRef,
      (snap) => {
        if (!snap.exists()) {
          console.log('[useSlackIntegration] slackTeams document does not exist for tenantId:', tenantId);
          setTeam(null);
        } else {
          const data = snap.data() as SlackTeamClientDoc;
          console.log('[useSlackIntegration] slackTeams document found:', {
            tenantId: data.tenantId,
            teamId: data.teamId,
            teamName: data.teamName,
            status: data.status,
            lastEventTs: data.lastEventTs,
          });
          setTeam(data);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('[useSlackIntegration] Error listening to slackTeams doc', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, activeTenant?.id]);

  // Calculate effective security level for active tenant
  const effectiveSecurityLevel = normalizeSecurityLevel(
    currentClaimsSecurityLevel || securityLevel
  );

  // Only users with securityLevel >= 5 can access Slack
  const hasAccess = effectiveSecurityLevel >= 5;

  return {
    loading,
    error,
    team,
    hasAccess,
    user,
    effectiveSecurityLevel,
  };
}

