import React from 'react';
import { AppBar, Toolbar, Typography } from '@mui/material';

interface WorkerHeaderProps {
  title?: string;
}

const WorkerHeader: React.FC<WorkerHeaderProps> = ({ title = 'Worker' }) => {
  return (
    <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar>
        <Typography variant="h6" component="span">
          {title}
        </Typography>
      </Toolbar>
    </AppBar>
  );
};

export default WorkerHeader;
