import React, { useEffect, useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { Star as StarIcon, StarBorder as StarBorderIcon } from '@mui/icons-material';
import { doc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface CompanyFollowButtonProps {
  companyId: string;
  companyName: string;
  tenantId: string;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

const CompanyFollowButton: React.FC<CompanyFollowButtonProps> = ({
  companyId,
  companyName,
  tenantId,
  onSuccess,
  onError
}) => {
  const { user } = useAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // Check if user is following this company
  useEffect(() => {
    if (!companyId || !user?.uid) return;
    
    const followRef = doc(db, 'users', user.uid, 'followedCompanies', companyId);
    const unsubscribeFollow = onSnapshot(followRef, (doc) => {
      setIsFollowing(doc.exists());
    }, (err) => {
      console.error('Error checking follow status:', err);
    });
    
    return () => unsubscribeFollow();
  }, [companyId, user?.uid]);

  const handleToggleFollow = async () => {
    if (!companyId || !user?.uid) return;
    
    setFollowLoading(true);
    try {
      const followRef = doc(db, 'users', user.uid, 'followedCompanies', companyId);
      const followDoc = await getDoc(followRef);
      
      if (followDoc.exists()) {
        // Unfollow
        await deleteDoc(followRef);
        onSuccess?.('Company unfollowed successfully');
      } else {
        // Follow
        await setDoc(followRef, { 
          followedAt: serverTimestamp(),
          companyName,
          tenantId
        });
        onSuccess?.('Company followed successfully');
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
      onError?.('Failed to update follow status');
    } finally {
      setFollowLoading(false);
    }
  };

  return (
    <Button
      variant={isFollowing ? "outlined" : "contained"}
      startIcon={followLoading ? <CircularProgress size={16} /> : (isFollowing ? <StarIcon /> : <StarBorderIcon />)}
      onClick={handleToggleFollow}
      disabled={followLoading}
      color={isFollowing ? "warning" : "primary"}
    >
      {isFollowing ? 'Unfollow' : 'Follow'}
    </Button>
  );
};

export default CompanyFollowButton; 