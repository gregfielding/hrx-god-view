import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Grid,
  Paper,
  Divider,
  Chip,
  List,
  ListItem,
  ListItemText,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  CloudDownload,
  Refresh,
  CheckCircle,
  Error,
  Info,
  ExpandMore,
  FormatQuote,
  Person,
  Tag,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { app } from '../../firebase';

interface SeedingResult {
  success: boolean;
  totalAdded: number;
  totalSkipped: number;
  currentPage: number;
  hasMorePages: boolean;
  addedQuotes: string[];
  skippedQuotes: string[];
}

const MotivationLibrarySeeder: React.FC = () => {
  const { user } = useAuth();
  const functions = getFunctions(app, 'us-central1');
  
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SeedingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState({
    page: 1,
    limit: 20,
    maxQuotes: 100,
  });

  const handleSeed = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const seedMotivations = httpsCallable(functions, 'seedMotivationMessagesFromAPI');
      const response = await seedMotivations(settings);
      const data = response.data as SeedingResult;
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to seed motivation library');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSeed = async () => {
    setSettings({ page: 1, limit: 10, maxQuotes: 50 });
    await handleSeed();
  };

  const handleFullSeed = async () => {
    setSettings({ page: 1, limit: 20, maxQuotes: 300 });
    await handleSeed();
  };

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h4" gutterBottom>
        Motivation Library Seeder
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Seed the motivation library with quotes from Quotable.io API
      </Typography>

      <Grid container spacing={3}>
        {/* Settings Card */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Seeding Settings
              </Typography>
              
              <TextField
                fullWidth
                label="Starting Page"
                type="number"
                value={settings.page}
                onChange={(e) => setSettings(prev => ({ ...prev, page: parseInt(e.target.value) || 1 }))}
                sx={{ mb: 2 }}
                helperText="Page number to start fetching from"
              />
              
              <TextField
                fullWidth
                label="Quotes per Request"
                type="number"
                value={settings.limit}
                onChange={(e) => setSettings(prev => ({ ...prev, limit: parseInt(e.target.value) || 20 }))}
                sx={{ mb: 2 }}
                helperText="Number of quotes to fetch per API call (max 150)"
                inputProps={{ min: 1, max: 150 }}
              />
              
              <TextField
                fullWidth
                label="Maximum Quotes"
                type="number"
                value={settings.maxQuotes}
                onChange={(e) => setSettings(prev => ({ ...prev, maxQuotes: parseInt(e.target.value) || 100 }))}
                sx={{ mb: 3 }}
                helperText="Maximum number of quotes to add in this run"
              />

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  startIcon={<CloudDownload />}
                  onClick={handleSeed}
                  disabled={loading}
                  sx={{ minWidth: 120 }}
                >
                  {loading ? <CircularProgress size={20} /> : 'Seed Library'}
                </Button>
                
                <Button
                  variant="outlined"
                  startIcon={<Refresh />}
                  onClick={handleQuickSeed}
                  disabled={loading}
                >
                  Quick Seed (50)
                </Button>
                
                <Button
                  variant="outlined"
                  startIcon={<Refresh />}
                  onClick={handleFullSeed}
                  disabled={loading}
                >
                  Full Seed (300)
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Status Card */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Seeding Status
              </Typography>
              
              {loading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <CircularProgress size={20} />
                  <Typography>Seeding motivation library...</Typography>
                </Box>
              )}

              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              {result && (
                <Box>
                  <Alert 
                    severity={result.success ? "success" : "error"} 
                    sx={{ mb: 2 }}
                    icon={result.success ? <CheckCircle /> : <Error />}
                  >
                    {result.success 
                      ? `Successfully added ${result.totalAdded} quotes!`
                      : 'Seeding failed'
                    }
                  </Alert>

                  <Paper sx={{ p: 2, mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Summary
                    </Typography>
                    <Grid container spacing={1}>
                      <Grid item xs={6}>
                        <Chip 
                          icon={<CheckCircle />} 
                          label={`Added: ${result.totalAdded}`} 
                          color="success" 
                          size="small"
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <Chip 
                          icon={<Info />} 
                          label={`Skipped: ${result.totalSkipped}`} 
                          color="info" 
                          size="small"
                        />
                      </Grid>
                                             <Grid item xs={6}>
                         <Chip 
                           icon={<FormatQuote />} 
                           label={`Page: ${result.currentPage}`} 
                           variant="outlined" 
                           size="small"
                         />
                       </Grid>
                      <Grid item xs={6}>
                        <Chip 
                          icon={<Refresh />} 
                          label={result.hasMorePages ? "More pages" : "Complete"} 
                          variant="outlined" 
                          size="small"
                        />
                      </Grid>
                    </Grid>
                  </Paper>

                  {/* Sample Quotes */}
                  {result.addedQuotes.length > 0 && (
                    <Accordion>
                      <AccordionSummary expandIcon={<ExpandMore />}>
                        <Typography variant="subtitle2">
                          Sample Added Quotes ({result.addedQuotes.length})
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <List dense>
                          {result.addedQuotes.map((quote, index) => (
                            <ListItem key={index} sx={{ py: 0.5 }}>
                              <ListItemText
                                primary={quote.length > 80 ? `${quote.substring(0, 80)}...` : quote}
                                secondary={`Quote ${index + 1}`}
                              />
                            </ListItem>
                          ))}
                        </List>
                      </AccordionDetails>
                    </Accordion>
                  )}

                  {/* Skipped Quotes */}
                  {result.skippedQuotes.length > 0 && (
                    <Accordion>
                      <AccordionSummary expandIcon={<ExpandMore />}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Skipped Quotes ({result.skippedQuotes.length})
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          These quotes were already in the library
                        </Typography>
                        <List dense>
                          {result.skippedQuotes.map((quote, index) => (
                            <ListItem key={index} sx={{ py: 0.5 }}>
                              <ListItemText
                                primary={quote.length > 80 ? `${quote.substring(0, 80)}...` : quote}
                                secondary={`Duplicate ${index + 1}`}
                              />
                            </ListItem>
                          ))}
                        </List>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Information Card */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                About Quotable.io Integration
              </Typography>
              
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" gutterBottom>
                    <Info sx={{ mr: 1, verticalAlign: 'middle' }} />
                    API Details
                  </Typography>
                  <Typography variant="body2" paragraph>
                    • Endpoint: https://api.quotable.io/quotes<br/>
                    • Rate Limiting: 100ms delay between requests<br/>
                    • Retry Logic: Up to 3 retries on failures<br/>
                    • Duplicate Prevention: Automatic detection
                  </Typography>
                </Grid>
                
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" gutterBottom>
                    <Tag sx={{ mr: 1, verticalAlign: 'middle' }} />
                    Tag Mapping
                  </Typography>
                  <Typography variant="body2" paragraph>
                    • Tone Tags: Mapped to Uplifting, Encouraging, etc.<br/>
                    • Role Tags: Mapped to Sales, Healthcare, Admin, etc.<br/>
                    • Original Tags: Preserved for future analysis<br/>
                    • Default Fallbacks: Applied when no mapping exists
                  </Typography>
                </Grid>
              </Grid>

              <Divider sx={{ my: 2 }} />
              
              <Typography variant="subtitle2" gutterBottom>
                <Person sx={{ mr: 1, verticalAlign: 'middle' }} />
                Usage Guidelines
              </Typography>
              <Typography variant="body2">
                • Start with small batches (10-20 quotes) to test<br/>
                • Use "Quick Seed" for testing, "Full Seed" for production<br/>
                • Monitor the results and check for any errors<br/>
                • Quotes are automatically tagged and categorized<br/>
                • All operations are logged for monitoring
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MotivationLibrarySeeder; 