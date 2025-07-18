import React from 'react';
import { Chip, Box, Typography } from '@mui/material';

interface FAQSuggestionProps {
  question: string;
  onClick: () => void;
}

const FAQSuggestion: React.FC<FAQSuggestionProps> = ({ question, onClick }) => {
  return (
    <Chip label={question} size="small" onClick={onClick} sx={{ cursor: 'pointer', m: 0.5 }} />
  );
};

export default FAQSuggestion;
