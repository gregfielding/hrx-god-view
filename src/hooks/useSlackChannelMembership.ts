/**
 * useSlackChannelMembership Hook
 * 
 * Tracks Slack channel membership via Firestore onSnapshot for real-time updates.
 */

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface MemberPreview {
  userId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

interface UseSlackChannelMembershipResult {
  membersByChannel: Record<string, MemberPreview[]>;
  isMemberByChannel: Record<string, boolean>;
  joinChannel: (channelId: string) => Promise<void>;
  leaveChannel: (channelId: string) => Promise<void>;
  loading: boolean;
}

export function useSlackChannelMembership(
  tenantId: string | null,
  userId: string | null
): UseSlackChannelMembershipResult {
  const [membersByChannel, setMembersByChannel] = useState<Record<string, MemberPreview[]>>({});
  const [isMemberByChannel, setIsMemberByChannel] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Real-time membership tracking via Firestore snapshot
  useEffect(() => {
    if (!tenantId || !userId) {
      setMembersByChannel({});
      setIsMemberByChannel({});
      setLoading(false);
      return;
    }

    setLoading(true);

    const membershipsRef = collection(db, 'tenants', tenantId, 'slackChannelMembers');
    const membershipsQuery = query(membershipsRef);

    const unsubscribe = onSnapshot(
      membershipsQuery,
      (snapshot) => {
        try {
          const membersMap: Record<string, MemberPreview[]> = {};
          const isMemberMap: Record<string, boolean> = {};
          const userIdsToFetch = new Set<string>();

          // First pass: collect all user IDs and build initial structure
          for (const membershipDoc of snapshot.docs) {
            const data = membershipDoc.data();
            const channelId = data.channelId || membershipDoc.id.split('_')[0]; // fallback extraction
            
            if (!channelId || !data.userId) continue;

            // Track if current user is a member (immediate, no async needed)
            if (data.userId === userId) {
              isMemberMap[channelId] = true;
            }

            // Collect user ID for batch fetch
            userIdsToFetch.add(data.userId);

            // Initialize member entry (will be enriched with user data)
            if (!membersMap[channelId]) {
              membersMap[channelId] = [];
            }
            membersMap[channelId].push({
              userId: data.userId,
              displayName: 'Loading...',
            });
          }

          // Batch fetch user data
          Promise.all(
            Array.from(userIdsToFetch).map(async (uid) => {
              try {
                const userDoc = await getDoc(doc(db, 'users', uid));
                const userData = userDoc.data();
                return {
                  userId: uid,
                  displayName: userData?.displayName || userData?.fullName || userData?.email?.split('@')[0] || 'Unknown',
                  email: userData?.email,
                  avatarUrl: userData?.avatarUrl,
                };
              } catch (err) {
                console.warn(`Failed to load user data for ${uid}:`, err);
                return {
                  userId: uid,
                  displayName: 'Unknown',
                };
              }
            })
          ).then((userDataMap) => {
            // Create a map for quick lookup
            const userDataById = new Map(userDataMap.map(u => [u.userId, u]));

            // Enrich member previews with fetched user data
            const enrichedMembersMap: Record<string, MemberPreview[]> = {};
            for (const [channelId, members] of Object.entries(membersMap)) {
              enrichedMembersMap[channelId] = members.map(m => 
                userDataById.get(m.userId) || m
              );
            }

            setMembersByChannel(enrichedMembersMap);
            setIsMemberByChannel(isMemberMap);
            setLoading(false);
          }).catch((err: any) => {
            console.error('Error fetching user data:', err);
            // Fall back to basic structure if batch fetch fails
            setMembersByChannel(membersMap);
            setIsMemberByChannel(isMemberMap);
            setLoading(false);
          });

          // Set loading to false after initial processing (even if user data is still loading)
          if (snapshot.docs.length === 0) {
            setLoading(false);
          }
        } catch (err: any) {
          console.error('Error processing channel memberships:', err);
          setLoading(false);
        }
      },
      (err) => {
        console.error('Error loading channel memberships:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId, userId]);

  // Join channel (create membership doc)
  const joinChannel = async (channelId: string) => {
    if (!tenantId || !userId || !channelId) return;

    try {
      const membershipId = `${channelId}_${userId}`;
      const membershipRef = doc(db, 'tenants', tenantId, 'slackChannelMembers', membershipId);
      
      await setDoc(membershipRef, {
        channelId,
        userId,
        joinedAt: new Date(),
        createdAt: new Date(),
      }, { merge: true });
    } catch (err: any) {
      console.error('Error joining channel:', err);
      throw err;
    }
  };

  // Leave channel (delete membership doc)
  const leaveChannel = async (channelId: string) => {
    if (!tenantId || !userId || !channelId) return;

    try {
      const membershipId = `${channelId}_${userId}`;
      const membershipRef = doc(db, 'tenants', tenantId, 'slackChannelMembers', membershipId);
      
      await deleteDoc(membershipRef);
    } catch (err: any) {
      console.error('Error leaving channel:', err);
      throw err;
    }
  };

  return {
    membersByChannel,
    isMemberByChannel,
    joinChannel,
    leaveChannel,
    loading,
  };
}
