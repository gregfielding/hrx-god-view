/**
 * In-app reference copy of the Background Check Review Process & Approval
 * Matrix (policy v1.1) — staff-gated by the surrounding recruiter layout,
 * opened in a new tab from the Backgrounds & Compliance tab and the
 * adjudication case panel. Content is generated from the canonical
 * markdown in docs/compliance/ (see backgroundCheckPolicyContent.ts), so
 * the app can never drift from the policy of record.
 */
import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BACKGROUND_CHECK_POLICY_MD } from './backgroundCheckPolicyContent';
import ComplianceMailboxCard from '../../components/compliance/ComplianceMailboxCard';

export default function BackgroundCheckPolicyPage() {
  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', px: 2, py: 3 }}>
      <ComplianceMailboxCard />
      <Paper variant="outlined" sx={{ px: { xs: 2, md: 5 }, py: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 1 }}
        >
          C1 Staffing · Compliance Policy · Reference copy
        </Typography>
        <Box
          sx={{
            // Document typography over the rendered markdown.
            '& h1': { fontSize: '1.8rem', lineHeight: 1.25, mt: 1, mb: 1.5 },
            '& h2': {
              fontSize: '1.25rem',
              mt: 4,
              mb: 1,
              pt: 1.5,
              borderTop: 1,
              borderColor: 'divider',
            },
            '& h3': { fontSize: '1.05rem', mt: 2.5, mb: 1 },
            '& p, & li': { fontSize: '0.95rem', lineHeight: 1.65 },
            '& blockquote': {
              m: 0,
              mb: 2,
              px: 2,
              py: 1.25,
              bgcolor: 'action.hover',
              borderLeft: 3,
              borderColor: 'primary.main',
              '& p': { m: 0 },
            },
            '& table': {
              borderCollapse: 'collapse',
              width: '100%',
              my: 1.5,
              display: 'block',
              overflowX: 'auto',
              fontSize: '0.85rem',
            },
            '& th': {
              textAlign: 'left',
              bgcolor: 'action.hover',
              fontWeight: 700,
            },
            '& th, & td': {
              border: 1,
              borderColor: 'divider',
              px: 1,
              py: 0.75,
              verticalAlign: 'top',
            },
            '& hr': { border: 0, borderTop: 1, borderColor: 'divider', my: 3 },
            '& code': {
              bgcolor: 'action.hover',
              px: 0.5,
              borderRadius: 0.5,
              fontSize: '0.85em',
            },
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{BACKGROUND_CHECK_POLICY_MD}</ReactMarkdown>
        </Box>
      </Paper>
    </Box>
  );
}
