import React, { useState, useEffect } from 'react';
import { Avatar, AvatarProps } from '@mui/material';

/** LinkedIn CDN image URLs often 404 or expire; skip them to avoid console errors. */
function isLikelyBrokenLinkedInImageUrl(url: string): boolean {
  try {
    const u = url.trim().toLowerCase();
    return u.includes('media.licdn.com') || (u.includes('licdn.com') && u.includes('/dms/image'));
  } catch {
    return false;
  }
}

/**
 * Avatar that falls back to children (e.g. initials) when the image fails to load.
 * Skips known-bad URLs (e.g. LinkedIn CDN) and handles onError for others.
 */
interface SafeAvatarProps extends Omit<AvatarProps, 'src'> {
  src?: string | null;
}

const SafeAvatar: React.FC<SafeAvatarProps> = ({ src, children, ...rest }) => {
  const [imgError, setImgError] = useState(false);
  useEffect(() => setImgError(false), [src]);
  const skipUrl = !src || imgError || isLikelyBrokenLinkedInImageUrl(src);
  const effectiveSrc = skipUrl ? undefined : src;
  return (
    <Avatar
      src={effectiveSrc}
      imgProps={{
        onError: () => setImgError(true),
      }}
      {...rest}
    >
      {children}
    </Avatar>
  );
};

export default SafeAvatar;
