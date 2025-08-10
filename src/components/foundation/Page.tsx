import React from 'react';
import { Box, Container } from '@mui/material';

type PageProps = { title?: string; children: React.ReactNode };

export const Page: React.FC<PageProps> = ({ children }) => {
  return (
    <Box sx={{ py: 3 }}>
      <Container maxWidth="xl">{children}</Container>
    </Box>
  );
};

export default Page;


