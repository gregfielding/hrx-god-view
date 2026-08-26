/**
 * /reports — the report library index. Cards come from reportsRegistry;
 * each links to /reports/<slug>. Reports above the viewer's security
 * level are hidden entirely (e.g. A/R Aging is level 7 only).
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from '@mui/material';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';

import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../contexts/AuthContext';
import {
  REPORT_CATEGORY_ORDER,
  ReportDef,
  reportsVisibleAtLevel,
} from './reportsRegistry';

const ReportsIndexPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentClaimsSecurityLevel, securityLevel } = useAuth();
  const level =
    Number.parseInt(String(currentClaimsSecurityLevel ?? securityLevel ?? '0'), 10) || 0;

  const sections = useMemo(() => {
    const visible = reportsVisibleAtLevel(level);
    return REPORT_CATEGORY_ORDER.map((category) => ({
      category,
      reports: visible.filter((r) => r.category === category),
    })).filter((s) => s.reports.length > 0);
  }, [level]);

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AssessmentOutlinedIcon fontSize="small" />
            <span>Reports</span>
          </Box>
        }
        subtitle="Payroll, finance, and compliance reports — pick one to run it."
      />

      {sections.map(({ category, reports }) => (
        <Box key={category} sx={{ mt: 3 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
            {category}
          </Typography>
          <Box
            sx={{
              mt: 0.5,
              display: 'grid',
              gap: 2,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(3, minmax(0, 1fr))',
              },
            }}
          >
            {reports.map((r: ReportDef) => (
              <Card key={r.slug} variant="outlined">
                <CardActionArea
                  onClick={() => navigate(`/reports/${r.slug}`)}
                  sx={{ height: '100%' }}
                >
                  <CardContent>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      <Avatar
                        variant="rounded"
                        sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', width: 40, height: 40 }}
                      >
                        {r.icon}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" fontWeight={700}>
                          {r.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {r.description}
                        </Typography>
                      </Box>
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
};

export default ReportsIndexPage;
