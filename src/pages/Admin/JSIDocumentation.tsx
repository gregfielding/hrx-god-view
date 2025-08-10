import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Security,
  Psychology,
  Work,
  SupervisorAccount,
  Favorite,
  ExitToApp,
  Timeline,
  Warning,
  CheckCircle,
  Info,
  ExpandMore,
} from '@mui/icons-material';

const JSIDocumentation: React.FC = () => {
  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      {/* Header */}
      <Box mb={4}>
        <Typography variant="h3" component="h1" gutterBottom color="primary">
          Job Satisfaction Insights (JSI) Documentation
        </Typography>
        <Typography variant="h6" color="text.secondary">
          Comprehensive guide to understanding and using the JSI scoring system
        </Typography>
      </Box>

      <Grid container spacing={4}>
        {/* Overview Section */}
        <Grid item xs={12}>
          <Paper sx={{ p: 4 }}>
            <Typography variant="h4" gutterBottom>
              What is JSI?
            </Typography>
            <Typography variant="body1" paragraph>
              Job Satisfaction Insights (JSI) is an AI-powered system that tracks worker
              satisfaction, retention risk, and overall workforce wellbeing using a mix of sentiment
              analysis, surveys, and behavioral logging. It provides baseline scoring, tracks
              changes over time, and issues alerts for HR intervention.
            </Typography>
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2">
                <strong>Key Benefits:</strong> Early detection of burnout, improved retention,
                data-driven HR decisions, and proactive workforce management.
              </Typography>
            </Alert>
          </Paper>
        </Grid>

        {/* Scoring Formula Section */}
        <Grid item xs={12}>
          <Paper sx={{ p: 4 }}>
            <Typography variant="h4" gutterBottom>
              JSI Scoring Formula
            </Typography>
            <Typography variant="h6" gutterBottom color="primary">
              Overall JSI Score (0-100 scale)
            </Typography>
            <Box
              sx={{
                p: 3,
                backgroundColor: '#f5f5f5',
                fontFamily: 'monospace',
                fontSize: '1.1rem',
                borderRadius: 2,
                mb: 3,
              }}
            >
              JSI = (WorkEngagement × 0.3) + (CareerAlignment × 0.2) + (ManagerRelationship × 0.2) +
              (PersonalWellbeing × 0.2) + (JobMobility × 0.1)
            </Box>

            <Typography variant="h6" gutterBottom>
              Score Interpretation
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Card sx={{ border: '2px solid #4caf50' }}>
                  <CardContent>
                    <Typography variant="h6" color="success.main" gutterBottom>
                      70-100: High Satisfaction
                    </Typography>
                    <Typography variant="body2">
                      Workers are engaged, satisfied, and likely to stay. Focus on growth and
                      retention strategies.
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card sx={{ border: '2px solid #ff9800' }}>
                  <CardContent>
                    <Typography variant="h6" color="warning.main" gutterBottom>
                      50-69: Moderate Satisfaction
                    </Typography>
                    <Typography variant="body2">
                      Workers are generally satisfied but may have concerns. Monitor closely and
                      address specific issues.
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card sx={{ border: '2px solid #f44336' }}>
                  <CardContent>
                    <Typography variant="h6" color="error.main" gutterBottom>
                      0-49: Low Satisfaction
                    </Typography>
                    <Typography variant="body2">
                      Workers are at risk of leaving. Immediate intervention and support are
                      recommended.
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* Dimension Details */}
        <Grid item xs={12}>
          <Paper sx={{ p: 4 }}>
            <Typography variant="h4" gutterBottom>
              Scoring Dimensions
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <strong>Dimension</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Weight</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Description</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Data Sources</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Risk Indicators</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <Box display="flex" alignItems="center">
                        <Work sx={{ mr: 1 }} />
                        <strong>Work Engagement</strong>
                      </Box>
                    </TableCell>
                    <TableCell>30%</TableCell>
                    <TableCell>
                      Energy, focus, daily fulfillment, expressed joy or boredom
                    </TableCell>
                    <TableCell>
                      AI sentiment analysis, vibe check responses, conversation logs
                    </TableCell>
                    <TableCell>Low energy, disinterest, lack of initiative</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box display="flex" alignItems="center">
                        <Psychology sx={{ mr: 1 }} />
                        <strong>Career Alignment</strong>
                      </Box>
                    </TableCell>
                    <TableCell>20%</TableCell>
                    <TableCell>How well the role matches their long-term goals</TableCell>
                    <TableCell>Goal surveys, manager feedback, role satisfaction</TableCell>
                    <TableCell>Goal mismatch, career frustration, skill underutilization</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box display="flex" alignItems="center">
                        <SupervisorAccount sx={{ mr: 1 }} />
                        <strong>Manager Relationship</strong>
                      </Box>
                    </TableCell>
                    <TableCell>20%</TableCell>
                    <TableCell>Trust, communication, respect, safety</TableCell>
                    <TableCell>Communication sentiment, feedback patterns</TableCell>
                    <TableCell>
                      Communication breakdown, lack of trust, feedback avoidance
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box display="flex" alignItems="center">
                        <Favorite sx={{ mr: 1 }} />
                        <strong>Personal Wellbeing</strong>
                      </Box>
                    </TableCell>
                    <TableCell>20%</TableCell>
                    <TableCell>Mental health, physical state, family stress</TableCell>
                    <TableCell>Wellbeing surveys, work/life balance indicators</TableCell>
                    <TableCell>Stress indicators, work/life imbalance, health concerns</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box display="flex" alignItems="center">
                        <ExitToApp sx={{ mr: 1 }} />
                        <strong>Job Mobility</strong>
                      </Box>
                    </TableCell>
                    <TableCell>10%</TableCell>
                    <TableCell>Signals they're considering or applying to other jobs</TableCell>
                    <TableCell>Job search signals, tenure satisfaction, external links</TableCell>
                    <TableCell>
                      Job search activity, low tenure satisfaction, external interest
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        {/* Risk Tags */}
        <Grid item xs={12}>
          <Paper sx={{ p: 4 }}>
            <Typography variant="h4" gutterBottom>
              Risk Tags & Alerts
            </Typography>
            <Typography variant="body1" paragraph>
              The system automatically flags workers based on specific risk patterns and score
              thresholds.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom>
                  High Severity Risks
                </Typography>
                <List>
                  <ListItem>
                    <ListItemIcon>
                      <Warning color="error" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Manager Strain"
                      secondary="Issues with supervisor relationship"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <ExitToApp color="error" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Job Search Risk"
                      secondary="Signals of job hunting activity"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Favorite color="error" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Wellbeing Decline"
                      secondary="Personal wellbeing concerns"
                    />
                  </ListItem>
                </List>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom>
                  Medium Severity Risks
                </Typography>
                <List>
                  <ListItem>
                    <ListItemIcon>
                      <Work color="warning" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Low Engagement"
                      secondary="Worker shows signs of disengagement"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Psychology color="warning" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Career Misalignment"
                      secondary="Role doesn't match long-term goals"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Timeline color="warning" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Tenure Risk"
                      secondary="Short tenure with satisfaction issues"
                    />
                  </ListItem>
                </List>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* Privacy & Security */}
        <Grid item xs={12}>
          <Paper sx={{ p: 4 }}>
            <Typography variant="h4" gutterBottom>
              Privacy & Security
            </Typography>
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                <Security sx={{ mr: 1, verticalAlign: 'middle' }} />
                Your Data is Protected
              </Typography>
              <Typography variant="body2">
                All JSI data is encrypted, anonymized where possible, and subject to strict access
                controls.
              </Typography>
            </Alert>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom>
                  Data Protection
                </Typography>
                <List>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="End-to-end encryption"
                      secondary="All data is encrypted in transit and at rest"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Anonymized aggregation"
                      secondary="Individual data is protected in reports"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Access controls"
                      secondary="Role-based permissions limit data access"
                    />
                  </ListItem>
                </List>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom>
                  Visibility Rules
                </Typography>
                <List>
                  <ListItem>
                    <ListItemIcon>
                      <Info color="info" />
                    </ListItemIcon>
                    <ListItemText
                      primary="HRX/Agency Admins"
                      secondary="Full access to all data including wellbeing"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Info color="info" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Customer Admins"
                      secondary="Can control wellbeing visibility for their org"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Info color="info" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Managers"
                      secondary="See wellbeing only for direct reports if enabled"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Info color="info" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Workers"
                      secondary="Always see their own personal wellbeing scores"
                    />
                  </ListItem>
                </List>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* Best Practices */}
        <Grid item xs={12}>
          <Paper sx={{ p: 4 }}>
            <Typography variant="h4" gutterBottom>
              Best Practices
            </Typography>

            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">Setting Up JSI</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <List>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Enable baseline surveys"
                      secondary="Start with comprehensive initial assessment"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Configure alert thresholds"
                      secondary="Set appropriate risk levels for your organization"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Train managers"
                      secondary="Ensure they understand how to use JSI data"
                    />
                  </ListItem>
                </List>
              </AccordionDetails>
            </Accordion>

            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">Using JSI Data</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <List>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Regular monitoring"
                      secondary="Check JSI dashboard weekly for trends and alerts"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Proactive intervention"
                      secondary="Address concerns before they become retention risks"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Data-driven decisions"
                      secondary="Use JSI insights to inform HR strategies"
                    />
                  </ListItem>
                </List>
              </AccordionDetails>
            </Accordion>

            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">Privacy Compliance</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <List>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Obtain consent"
                      secondary="Ensure workers understand and consent to data collection"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Limit access"
                      secondary="Only grant access to those who need it"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Regular audits"
                      secondary="Periodically review access and data usage"
                    />
                  </ListItem>
                </List>
              </AccordionDetails>
            </Accordion>
          </Paper>
        </Grid>

        {/* FAQ */}
        <Grid item xs={12}>
          <Paper sx={{ p: 4 }}>
            <Typography variant="h4" gutterBottom>
              Frequently Asked Questions
            </Typography>

            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">How accurate is the JSI scoring?</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2">
                  JSI scoring is based on multiple data sources and AI analysis, providing a
                  comprehensive view of worker satisfaction. The system continuously learns and
                  improves accuracy over time. However, it should be used as one tool among many for
                  understanding worker satisfaction.
                </Typography>
              </AccordionDetails>
            </Accordion>

            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">Can workers see their own JSI scores?</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2">
                  Yes, workers can view their own JSI scores and personal wellbeing data. This
                  transparency helps build trust and allows workers to understand their own
                  satisfaction patterns.
                </Typography>
              </AccordionDetails>
            </Accordion>

            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">How often are scores updated?</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2">
                  Scores are updated continuously as new data becomes available from surveys,
                  check-ins, and behavioral logging. The system provides both real-time updates and
                  periodic comprehensive assessments.
                </Typography>
              </AccordionDetails>
            </Accordion>

            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">
                  What should I do when I see a high-risk worker?
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2">
                  High-risk workers require immediate attention. Schedule a 1:1 meeting to discuss
                  concerns, review the specific risk factors identified, and develop an action plan.
                  Consider involving HR or management as appropriate.
                </Typography>
              </AccordionDetails>
            </Accordion>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default JSIDocumentation;
