/**
 * useSlackChannelMembership Hook
 * 
 * Tracks Slack channel membership via Firestore onSnapshot for real-time updates.
 */

import { useState, useEffect, useRef } from 'react';
import { collection, query, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
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
  const isMountedRef = useRef(true);
  const userDataCacheRef = useRef<Map<string, MemberPreview>>(new Map());

  // Real-time membership tracking via Firestore snapshot
  useEffect(() => {
    isMountedRef.current = true;

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
        if (!isMountedRef.current) return;

        try {
          const membersMap: Record<string, string[]> = {}; // channelId -> userId[]
          const isMemberMap: Record<string, boolean> = {};
          const userIdsToEnrich = new Set<string>();

          // Build membership structure synchronously (no async in callback)
          for (const membershipDoc of snapshot.docs) {
            const data = membershipDoc.data();
            const channelId = data.channelId || membershipDoc.id.split('_')[0];
            
            if (!channelId || !data.userId) continue;

            // Track membership
            if (!membersMap[channelId]) {
              membersMap[channelId] = [];
            }
            membersMap[channelId].push(data.userId);
            userIdsToEnrich.add(data.userId);

            // Track if current user is a member
            if (data.userId === userId) {
              isMemberMap[channelId] = true;
            }
          }

          // Update isMemberByChannel immediately (synchronous)
          setIsMemberByChannel(isMemberMap);

          // Enrich with user data asynchronously (outside callback)
          const enrichUserData = async () => {
            if (!isMountedRef.current) return;

            const enrichedMembersMap: Record<string, MemberPreview[]> = {};

            // Fetch user data for any new user IDs
            const fetchPromises: Promise<void>[] = [];
            for (const uid of userIdsToEnrich) {
              if (userDataCacheRef.current.has(uid)) {
                continue; // Already cached
              }

              fetchPromises.push(
                getDoc(doc(db, 'users', uid))
                  .then((userDoc) => {
                    if (!isMountedRef.current) return;
                    const userData = userDoc.data();
                    const preview: MemberPreview = {
                      userId: uid,
                      displayName: userData?.displayName || userData?.fullName || userData?.firstName && userData?.lastName 
                        ? `${userData.firstName} ${userData.lastName}`.trim()
                        : userData?.email?.split('@')[0] || 'Unknown',
                      email: userData?.email,
                      avatarUrl: userData?.avatar || userData?.avatarUrl, // HRX uses 'avatar' field
                    };
                    userDataCacheRef.current.set(uid, preview);
                  })
                  .catch((err) => {
                    console.warn(`Failed to load user data for ${uid}:`, err);
                    if (isMountedRef.current) {
                      userDataCacheRef.current.set(uid, {
                        userId: uid,
                        displayName: 'Unknown',
                      });
                    }
                  })
              );
            }

            // Wait for all fetches to complete
            await Promise.all(fetchPromises);

            if (!isMountedRef.current) return;

            // Build enriched members map
            for (const [channelId, userIds] of Object.entries(membersMap)) {
              enrichedMembersMap[channelId] = userIds.map(uid => 
                userDataCacheRef.current.get(uid) || {
                  userId: uid,
                  displayName: 'Loading...',
                }
              );
            }

            setMembersByChannel(enrichedMembersMap);
            setLoading(false);
          };

          // If no members, set empty state immediately
          if (snapshot.docs.length === 0) {
            setMembersByChannel({});
            setLoading(false);
          } else {
            // Otherwise enrich with user data
            enrichUserData().catch((err) => {
              if (isMountedRef.current) {
                console.error('Error enriching user data:', err);
                // Fallback: use basic structure
                const basicMap: Record<string, MemberPreview[]> = {};
                for (const [channelId, userIds] of Object.entries(membersMap)) {
                  basicMap[channelId] = userIds.map(uid => ({
                    userId: uid,
                    displayName: 'Loading...',
                  }));
                }
                setMembersByChannel(basicMap);
                setLoading(false);
              }
            });
          }
        } catch (err: any) {
          if (isMountedRef.current) {
            console.error('Error processing channel memberships:', err);
            setLoading(false);
          }
        }
      },
      (err) => {
        if (isMountedRef.current) {
          console.error('Error loading channel memberships:', err);
          setLoading(false);
        }
      }
    );

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
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