import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { 
  Inbox as InboxIcon,
  Search as SearchIcon,
  Add as AddIcon,
  FolderOpen as FolderIcon
} from '@mui/icons-material';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: 'inbox' | 'search' | 'add' | 'folder' | React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
  variant?: 'card' | 'minimal';
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon = 'inbox',
  action,
  variant = 'card'
}) => {
  const getIcon = () => {
    if (React.isValidElement(icon)) {
      return icon;
    }

    const iconProps = {
      sx: {
        fontSize: 64,
        color: '#8B94A3',
        mb: 2
      }
    };

    switch (icon) {
      case 'search':
        return <SearchIcon {...iconProps} />;
      case 'add':
        return <AddIcon {...iconProps} />;
      case 'folder':
        return <FolderIcon {...iconProps} />;
      default:
        return <InboxIcon {...iconProps} />;
    }
  };

  const content = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: 6,
        px: 3
      }}
    >
      {getIcon()}
      
      <Typography
        variant="h6"
        sx={{
          fontWeight: 600,
          color: '#0B0D12',
          mb: 1
        }}
      >
        {title}
      </Typography>
      
      <Typography
        variant="body2"
        sx={{
          color: '#5A6372',
          maxWidth: 400,
          lineHeight: 1.6,
          mb: action ? 3 : 0
        }}
      >
        {description}
      </Typography>
      
      {action && (
        <Button
          variant={action.variant === 'secondary' ? 'outlined' : 'contained'}
          startIcon={action.variant === 'secondary' ? undefined : <AddIcon />}
          onClick={action.onClick}
          sx={{
            borderRadius: 999,
            px: 3,
            py: 1
          }}
        >
          {action.label}
        </Button>
      )}
    </Box>
  );

  if (variant === 'minimal') {
    return content;
  }

  return (
    <Paper
      sx={{
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,.08)',
        backgroundColor: '#FFFFFF',
        overflow: 'hidden'
      }}
    >
      {content}
    </Paper>
  );
};
