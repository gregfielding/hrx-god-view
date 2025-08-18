import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
  FormControl,
  Select,
  MenuItem,
  Alert,
  Grid,
} from '@mui/material';
import { Business as BusinessIcon } from '@mui/icons-material';
import { getStageHexColor, getTextContrastColor } from '../utils/crmStageColors';

interface ContactOpportunitiesTabProps {
  deals: any[];
  contact: any;
}

const ContactOpportunitiesTab: React.FC<ContactOpportunitiesTabProps> = ({ deals, contact }) => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  
  // Calculate expected revenue range from qualification data
  const calculateExpectedRevenueRange = (deal: any) => {
    if (!deal.stageData?.qualification) {
      return { min: 0, max: 0, hasData: false };
    }

    const qualData = deal.stageData.qualification;
    const payRate = qualData.expectedAveragePayRate || 16; // Default to $16
    const markup = qualData.expectedAverageMarkup || 40; // Default to 40%
    const timeline = qualData.staffPlacementTimeline;

    if (!timeline) {
      return { min: 0, max: 0, hasData: false };
    }

    // Calculate bill rate: pay rate + markup
    const billRate = payRate * (1 + markup / 100);
    
    // Annual hours per employee (2080 full-time hours)
    const annualHoursPerEmployee = 2080;
    
    // Calculate annual revenue per employee
    const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
    
    // Get starting and 180-day numbers
    const startingCount = timeline.starting || 0;
    const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
    
    // Calculate revenue range
    const minRevenue = annualRevenuePerEmployee * startingCount;
    const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
    
    return {
      min: minRevenue,
      max: maxRevenue,
      hasData: startingCount > 0 || after180DaysCount > 0
    };
  };
  
  // Get expected close date from qualification stage
  const getExpectedCloseDate = (deal: any) => {
    if (!deal.stageData?.qualification?.expectedCloseDate) {
      return null;
    }
    
    const date = new Date(deal.stageData.qualification.expectedCloseDate);
    return date;
  };
  
  return (
    <Grid container spacing={0}>
      <Grid item xs={12}>
        <Box sx={{ p:0, pl:3, pr:3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mt: 0, mb: 1 }}>
            <Typography variant="h6" fontWeight={700}>Opportunities ({deals.length})</Typography>
          </Box>
        </Box>
      </Grid>
      <Grid item xs={12}>
        <Card>
          <CardContent>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            
            {deals.length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Deal Name</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Value</TableCell>
                      <TableCell>Probability</TableCell>
                      <TableCell>Close Date</TableCell>
                      <TableCell>Company</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {deals.slice(0, 10).map((deal: any) => (
                      <TableRow key={deal.id}>
                        <TableCell>
                          <Typography
                            sx={{ 
                              cursor: 'pointer',
                              color: 'primary.main',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: 'primary.dark'
                              }
                            }}
                            onClick={() => navigate(`/crm/deals/${deal.id}`)}
                          >
                            {deal.name}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={deal.stage || 'Unknown Stage'} 
                            size="small" 
                            style={{
                              backgroundColor: getStageHexColor(deal.stage || ''),
                              color: getTextContrastColor(getStageHexColor(deal.stage || '')),
                              fontWeight: 600
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const revenueRange = calculateExpectedRevenueRange(deal);
                            if (revenueRange.hasData) {
                              return `$${revenueRange.min.toLocaleString()} - $${revenueRange.max.toLocaleString()}`;
                            }
                            return deal.estimatedRevenue ? `$${deal.estimatedRevenue.toLocaleString()}` : '-';
                          })()}
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={`${deal.probability || 0}%`} 
                            size="small" 
                            color={deal.probability > 50 ? 'success' : 'default'}
                          />
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const expectedCloseDate = getExpectedCloseDate(deal);
                            if (expectedCloseDate) {
                              return expectedCloseDate.toLocaleDateString();
                            }
                            // Fallback to regular closeDate if no qualification date
                            if (deal.closeDate) {
                              return new Date(deal.closeDate).toLocaleDateString();
                            }
                            return 'Not set';
                          })()}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const companies = (deal.associations?.companies || []) as any[];
                            const first = companies.find(c => typeof c === 'object') || companies[0];
                            const companyName = typeof first === 'string' ? '' : (first?.snapshot?.companyName || first?.snapshot?.name || first?.companyName || first?.name || '');
                            return companyName || 'Unknown Company';
                          })()}
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => navigate(`/crm/deals/${deal.id}`)}
                              sx={{ minWidth: 'auto', px: 1 }}
                            >
                              View
                            </Button>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No opportunities associated with this contact
              </Typography>
            )}
            
            {deals.length > 10 && (
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  +{deals.length - 10} more opportunities
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
};

export default ContactOpportunitiesTab;
