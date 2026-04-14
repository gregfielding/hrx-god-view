import React, { useState, useEffect } from 'react';
import { Avatar, AvatarProps } from '@mui/material';

/**
 * Avatar that falls back to children (e.g. initials) when the image fails to load.
 *
 * We intentionally **do not** block LinkedIn CDN URLs up front: many CRM contacts store
 * `avatar` as a LinkedIn `media.licdn.com` URL; those still load in plain MUI `Avatar`
 * (e.g. location contact tables). Blocking them here made profile pages show initials
 * while lists showed the photo. Expired/broken URLs are handled via `onError` only.
 */
interface SafeAvatarProps extends Omit<AvatarProps, 'src'> {
  src?: string | null;
}

const SafeAvatar: React.FC<SafeAvatarProps> = ({ src, children, ...rest }) => {
  const [imgError, setImgError] = useState(false);
  useEffect(() => setImgError(false), [src]);
  const skipUrl = !src || imgError;
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
