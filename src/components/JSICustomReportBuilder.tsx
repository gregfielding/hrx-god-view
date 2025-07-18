import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Button,
  FormControl,
  FormControlLabel,
  Checkbox,
  TextField,
  Select,
  MenuItem,
  InputLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Divider,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore,
  Add,
  Remove,
  Settings,
  Description,
  Assessment,
  TrendingUp,
  Warning,
  Business,
  Person,
  DataUsage,
  Download,
} from '@mui/icons-material';

interface ReportSection {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  required: boolean;
  subsections?: {
    id: string;
    name: string;
    enabled: boolean;
  }[];
}

interface CustomReportBuilderProps {
  onGenerateReport: (config: ReportConfig) => void;
  customerName?: string;
}

interface ReportConfig {
  sections: ReportSection[];
  format: 'pdf' | 'excel' | 'csv' | 'json';
  includeCharts: boolean;
  includeRawData: boolean;
  includeMetadata: boolean;
  customTitle?: string;
  customDescription?: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

const JSICustomReportBuilder: React.FC<CustomReportBuilderProps> = ({
  onGenerateReport,
  customerName = 'Organization',
}) => {
  const [sections, setSections] = useState<ReportSection[]>([
    {
      id: 'executive-summary',
      name: 'Executive Summary',
      description: 'High-level overview with key metrics and insights',
      icon: <Description />,
      enabled: true,
      required: true,
    },
    {
      id: 'individual-scores',
      name: 'Individual Worker Scores',
      description: 'Detailed scores for each worker with risk levels and trends',
      icon: <Person />,
      enabled: true,
      required: false,
      subsections: [
        { id: 'basic-info', name: 'Basic Information', enabled: true },
        { id: 'scores', name: 'All Dimension Scores', enabled: true },
        { id: 'risk-analysis', name: 'Risk Analysis', enabled: true },
        { id: 'trends', name: 'Trend Information', enabled: true },
        { id: 'flags', name: 'Risk Flags', enabled: true },
        { id: 'ai-insights', name: 'AI Insights', enabled: false },
      ],
    },
    {
      id: 'department-analysis',
      name: 'Department Analysis',
      description: 'Comparative analysis across departments',
      icon: <Business />,
      enabled: true,
      required: false,
      subsections: [
        { id: 'overview', name: 'Department Overview', enabled: true },
        { id: 'comparison', name: 'Cross-Department Comparison', enabled: true },
        { id: 'risk-distribution', name: 'Risk Distribution', enabled: true },
        { id: 'trends', name: 'Department Trends', enabled: false },
      ],
    },
    {
      id: 'risk-analysis',
      name: 'Risk Analysis',
      description: 'Comprehensive risk assessment and categorization',
      icon: <Warning />,
      enabled: true,
      required: false,
      subsections: [
        { id: 'risk-levels', name: 'Risk Level Breakdown', enabled: true },
        { id: 'risk-factors', name: 'Risk Factor Analysis', enabled: true },
        { id: 'interventions', name: 'Recommended Interventions', enabled: true },
        { id: 'trends', name: 'Risk Trends', enabled: false },
      ],
    },
    {
      id: 'benchmarking',
      name: 'Benchmarking',
      description: 'Comparison with global and industry benchmarks',
      icon: <Assessment />,
      enabled: true,
      required: false,
      subsections: [
        { id: 'global', name: 'Global Benchmarks', enabled: true },
        { id: 'industry', name: 'Industry Benchmarks', enabled: true },
        { id: 'percentiles', name: 'Percentile Rankings', enabled: true },
        { id: 'trends', name: 'Benchmark Trends', enabled: false },
      ],
    },
    {
      id: 'trends',
      name: 'Trend Analysis',
      description: 'Historical trends and predictive insights',
      icon: <TrendingUp />,
      enabled: false,
      required: false,
      subsections: [
        { id: 'historical', name: 'Historical Trends', enabled: false },
        { id: 'predictions', name: 'Predictive Insights', enabled: false },
        { id: 'anomalies', name: 'Anomaly Detection', enabled: false },
      ],
    },
    {
      id: 'raw-data',
      name: 'Raw Data',
      description: 'Complete dataset for advanced analysis',
      icon: <DataUsage />,
      enabled: false,
      required: false,
    },
  ]);

  const [reportConfig, setReportConfig] = useState<ReportConfig>({
    sections: sections,
    format: 'excel',
    includeCharts: true,
    includeRawData: false,
    includeMetadata: true,
    customTitle: `${customerName} - Job Satisfaction Insights Report`,
    customDescription: `Comprehensive analysis of job satisfaction across the organization`,
  });

  const handleSectionToggle = (sectionId: string) => {
    setSections((prev) =>
      prev.map((section) => {
        if (section.id === sectionId) {
          return { ...section, enabled: !section.enabled };
        }
        return section;
      }),
    );
  };

  const handleSubsectionToggle = (sectionId: string, subsectionId: string) => {
    setSections((prev) =>
      prev.map((section) => {
        if (section.id === sectionId && section.subsections) {
          return {
            ...section,
            subsections: section.subsections.map((sub) => {
              if (sub.id === subsectionId) {
                return { ...sub, enabled: !sub.enabled };
              }
              return sub;
            }),
          };
        }
        return section;
      }),
    );
  };

  const handleConfigChange = (field: keyof ReportConfig, value: any) => {
    setReportConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerateReport = () => {
    const updatedConfig = {
      ...reportConfig,
      sections: sections,
    };
    onGenerateReport(updatedConfig);
  };

  const getEnabledSectionsCount = () => {
    return sections.filter((s) => s.enabled).length;
  };

  const getTotalSubsectionsCount = () => {
    return sections.reduce((total, section) => {
      if (section.enabled && section.subsections) {
        return total + section.subsections.filter((sub) => sub.enabled).length;
      }
      return total;
    }, 0);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Custom Report Builder
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Configure your report by selecting the sections and data you want to include
      </Typography>

      <Grid container spacing={3}>
        {/* Report Configuration */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Report Settings
              </Typography>

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Report Format</InputLabel>
                <Select
                  value={reportConfig.format}
                  onChange={(e) => handleConfigChange('format', e.target.value)}
                  label="Report Format"
                >
                  <MenuItem value="excel">Excel (.xlsx)</MenuItem>
                  <MenuItem value="pdf">PDF (.pdf)</MenuItem>
                  <MenuItem value="csv">CSV (.csv)</MenuItem>
                  <MenuItem value="json">JSON (.json)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label="Report Title"
                value={reportConfig.customTitle}
                onChange={(e) => handleConfigChange('customTitle', e.target.value)}
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                multiline
                rows={3}
                label="Report Description"
                value={reportConfig.customDescription}
                onChange={(e) => handleConfigChange('customDescription', e.target.value)}
                sx={{ mb: 2 }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={reportConfig.includeCharts}
                    onChange={(e) => handleConfigChange('includeCharts', e.target.checked)}
                  />
                }
                label="Include Charts & Visualizations"
                sx={{ mb: 1 }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={reportConfig.includeRawData}
                    onChange={(e) => handleConfigChange('includeRawData', e.target.checked)}
                  />
                }
                label="Include Raw Data"
                sx={{ mb: 1 }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={reportConfig.includeMetadata}
                    onChange={(e) => handleConfigChange('includeMetadata', e.target.checked)}
                  />
                }
                label="Include Metadata"
                sx={{ mb: 2 }}
              />

              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  Selected: {getEnabledSectionsCount()} sections, {getTotalSubsectionsCount()}{' '}
                  subsections
                </Typography>
              </Alert>

              <Button
                variant="contained"
                fullWidth
                startIcon={<Download />}
                onClick={handleGenerateReport}
                disabled={getEnabledSectionsCount() === 0}
              >
                Generate Report
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Section Selection */}
        <Grid item xs={12} md={8}>
          <Typography variant="h6" gutterBottom>
            Report Sections
          </Typography>

          {sections.map((section) => (
            <Accordion key={section.id} sx={{ mb: 1 }}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={section.enabled}
                        onChange={() => handleSectionToggle(section.id)}
                        disabled={section.required}
                      />
                    }
                    label=""
                    sx={{ mr: 1 }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>{section.icon}</Box>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="subtitle1">
                      {section.name}
                      {section.required && (
                        <Chip label="Required" size="small" color="primary" sx={{ ml: 1 }} />
                      )}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {section.description}
                    </Typography>
                  </Box>
                </Box>
              </AccordionSummary>

              <AccordionDetails>
                {section.subsections && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      Subsections:
                    </Typography>
                    <Grid container spacing={1}>
                      {section.subsections.map((subsection) => (
                        <Grid item xs={12} sm={6} key={subsection.id}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={subsection.enabled}
                                onChange={() => handleSubsectionToggle(section.id, subsection.id)}
                                disabled={!section.enabled}
                              />
                            }
                            label={subsection.name}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                )}

                {!section.subsections && (
                  <Typography variant="body2" color="text.secondary">
                    This section includes all available data for {section.name.toLowerCase()}.
                  </Typography>
                )}
              </AccordionDetails>
            </Accordion>
          ))}
        </Grid>
      </Grid>
    </Box>
  );
};

export default JSICustomReportBuilder;
