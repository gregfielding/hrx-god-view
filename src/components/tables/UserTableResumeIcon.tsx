import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import { openUserResumeInNewTab, pickResumeFromUserDoc } from '../../utils/userResumeOpen';

type Props = {
  /** Firestore user-shaped object (must include `resume` when applicable). */
  user: Record<string, unknown>;
};

/**
 * Small document icon (smaller than profile header) — opens resume in a new tab; stops row navigation.
 */
const UserTableResumeIcon: React.FC<Props> = ({ user }) => {
  const resume = pickResumeFromUserDoc(user);
  if (!resume) return null;

  return (
    <Tooltip title={`View Resume: ${resume.fileName}`}>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          openUserResumeInNewTab(resume);
        }}
        aria-label={`View resume ${resume.fileName}`}
        sx={{
          p: 0.25,
          color: 'primary.main',
          flexShrink: 0,
          '&:hover': {
            color: 'primary.dark',
            bgcolor: 'action.hover',
          },
        }}
      >
        <DescriptionIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Tooltip>
  );
};

export default UserTableResumeIcon;
