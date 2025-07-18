import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Grid,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Box,
  Switch,
  FormControlLabel,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import { db } from '../../../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { LoggableSlider, LoggableTextField, LoggableSelect, LoggableSwitch } from '../../../../components/LoggableField';
import { useAuth } from '../../../../contexts/AuthContext';

interface VectorCollection {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  dimensions: number;
  similarityThreshold: number;
  maxResults: number;
  lastIndexed: string;
  documentCount: number;
}

interface VectorSettingsProps {
  tenantId: string;
}

const VectorSettings: React.FC<VectorSettingsProps> = ({ tenantId }) => {
  const [collections, setCollections] = useState<VectorCollection[]>([
    {
      id: 'traits',
      name: 'Traits Collection',
      description: 'Vector embeddings for worker traits and characteristics',
      enabled: true,
      dimensions: 1536,
      similarityThreshold: 0.7,
      maxResults: 10,
      lastIndexed: '2024-01-01T00:00:00Z',
      documentCount: 0,
    },
    {
      id: 'moments',
      name: 'Moments Collection',
      description: 'Vector embeddings for AI moments and interactions',
      enabled: true,
      dimensions: 1536,
      similarityThreshold: 0.75,
      maxResults: 15,
      lastIndexed: '2024-01-01T00:00:00Z',
      documentCount: 0,
    },
    {
      id: 'feedback',
      name: 'Feedback Collection',
      description: 'Vector embeddings for worker feedback and sentiment',
      enabled: true,
      dimensions: 1536,
      similarityThreshold: 0.8,
      maxResults: 20,
      lastIndexed: '2024-01-01T00:00:00Z',
      documentCount: 0,
    },
    {
      id: 'job_postings',
      name: 'Job Postings Collection',
      description: 'Vector embeddings for job descriptions and requirements',
      enabled: false,
      dimensions: 1536,
      similarityThreshold: 0.6,
      maxResults: 5,
      lastIndexed: '2024-01-01T00:00:00Z',
      documentCount: 0,
    },
    {
      id: 'policies',
      name: 'Policies Collection',
      description: 'Vector embeddings for company policies and procedures',
      enabled: false,
      dimensions: 1536,
      similarityThreshold: 0.85,
      maxResults: 8,
      lastIndexed: '2024-01-01T00:00:00Z',
      documentCount: 0,
    },
  ]);
  const [originalCollections, setOriginalCollections] = useState<VectorCollection[]>([]);
  const [globalSettings, setGlobalSettings] = useState({
    defaultDimensions: 1536,
    defaultSimilarityThreshold: 0.7,
    defaultMaxResults: 10,
    autoReindex: true,
    reindexFrequency: 'weekly', // 'daily' | 'weekly' | 'monthly'
  });
  const [originalGlobalSettings, setOriginalGlobalSettings] = useState(globalSettings);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [reindexing, setReindexing] = useState<string | null>(null);
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const vectorRef = doc(db, 'tenants', tenantId, 'aiSettings', 'vectors');
        const vectorSnap = await getDoc(vectorRef);
        if (vectorSnap.exists()) {
          const data = vectorSnap.data();
          if (data.collections) {
            setCollections(data.collections);
            setOriginalCollections(data.collections);
          }
          if (data.globalSettings) {
            setGlobalSettings(data.globalSettings);
            setOriginalGlobalSettings(data.globalSettings);
          }
        }
      } catch (err) {
        setError('Failed to fetch vector settings');
      }
    };
    fetchSettings();
  }, [tenantId]);

  const handleCollectionChange = (
    collectionId: string,
    field: keyof VectorCollection,
    value: any,
  ) => {
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id === collectionId ? { ...collection, [field]: value } : collection,
      ),
    );
  };

  const handleGlobalSettingChange = (field: string, value: any) => {
    setGlobalSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleReindex = async (collectionId: string) => {
    setReindexing(collectionId);
    try {
      // Simulate reindexing process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Update last indexed timestamp
      handleCollectionChange(collectionId, 'lastIndexed', new Date().toISOString());

      // Log the reindex action
      await setDoc(doc(db, 'ai_logs', `${tenantId}_VectorReindex_${Date.now()}`), {
        tenantId,
        section: 'VectorSettings',
        changed: 'reindex',
        collectionId,
        timestamp: new Date().toISOString(),
        eventType: 'vector_reindex',
        engineTouched: ['VectorEngine'],
      });
    } catch (err) {
      setError('Failed to reindex collection');
    } finally {
      setReindexing(null);
    }
  };

  const handleSave = async () => {
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'vectors');
      await setDoc(ref, { collections, globalSettings }, { merge: true });
      // Logging hook
      await setDoc(doc(db, 'ai_logs', `${tenantId}_VectorSettings_${Date.now()}`), {
        tenantId,
        section: 'VectorSettings',
        changed: 'vector_settings',
        oldValue: { collections: originalCollections, globalSettings: originalGlobalSettings },
        newValue: { collections, globalSettings },
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        engineTouched: ['VectorEngine'],
        userId: currentUser?.uid || null,
        sourceModule: 'VectorSettings',
      });
      setOriginalCollections([...collections]);
      setOriginalGlobalSettings({ ...globalSettings });
      setSuccess(true);
    } catch (err) {
      setError('Failed to save vector settings');
    }
  };

  const isChanged =
    JSON.stringify(collections) !== JSON.stringify(originalCollections) ||
    JSON.stringify(globalSettings) !== JSON.stringify(originalGlobalSettings);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Vector Settings
        <Tooltip title="Configure vector embeddings for AI context and similarity search.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>

      {/* Global Settings */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Global Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <LoggableTextField
                fieldPath={`tenants:${tenantId}.aiSettings.vectors.globalSettings.defaultDimensions`}
                trigger="update"
                destinationModules={['VectorEngine', 'ContextEngine']}
                value={globalSettings.defaultDimensions.toString()}
                onChange={(value: string) =>
                  handleGlobalSettingChange('defaultDimensions', parseInt(value))
                }
                label="Default Dimensions"
                placeholder="512 to 4096"
                contextType="vectors"
                urgencyScore={3}
                description="Agency vector default dimensions"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <LoggableSlider
                fieldPath={`tenants:${tenantId}.aiSettings.vectors.globalSettings.defaultSimilarityThreshold`}
                trigger="update"
                destinationModules={['VectorEngine', 'ContextEngine']}
                value={globalSettings.defaultSimilarityThreshold}
                onChange={(valueOrEvent: any, maybeValue?: any) => {
                  const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                  handleGlobalSettingChange('defaultSimilarityThreshold', value);
                }}
                min={0.1}
                max={1}
                step={0.05}
                label="Default Similarity Threshold"
                contextType="vectors"
                urgencyScore={3}
                description="Agency vector default similarity threshold"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <LoggableTextField
                fieldPath={`tenants:${tenantId}.aiSettings.vectors.globalSettings.defaultMaxResults`}
                trigger="update"
                destinationModules={['VectorEngine', 'ContextEngine']}
                value={globalSettings.defaultMaxResults.toString()}
                onChange={(value: string) =>
                  handleGlobalSettingChange('defaultMaxResults', parseInt(value))
                }
                label="Default Max Results"
                placeholder="1 to 100"
                contextType="vectors"
                urgencyScore={3}
                description="Agency vector default max results"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableSwitch
                fieldPath={`tenants:${tenantId}.aiSettings.vectors.globalSettings.autoReindex`}
                trigger="update"
                destinationModules={['VectorEngine', 'ContextEngine']}
                value={globalSettings.autoReindex}
                onChange={(value: boolean) => handleGlobalSettingChange('autoReindex', value)}
                label="Auto Reindex"
                contextType="vectors"
                urgencyScore={3}
                description="Agency vector auto reindex setting"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableSelect
                fieldPath={`tenants:${tenantId}.aiSettings.vectors.globalSettings.reindexFrequency`}
                trigger="update"
                destinationModules={['VectorEngine', 'ContextEngine']}
                value={globalSettings.reindexFrequency}
                onChange={(value: string) => handleGlobalSettingChange('reindexFrequency', value)}
                label="Reindex Frequency"
                options={[
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' }
                ]}
                contextType="vectors"
                urgencyScore={3}
                description="Agency vector reindex frequency"
                disabled={!globalSettings.autoReindex}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Vector Collections */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Vector Collections</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            {collections.map((collection) => (
              <Grid item xs={12} key={collection.id}>
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                      <LoggableSwitch
                        fieldPath={`tenants:${tenantId}.aiSettings.vectors.collections.${collection.id}.enabled`}
                        trigger="update"
                        destinationModules={['VectorEngine', 'ContextEngine']}
                        value={collection.enabled}
                        onChange={(value: boolean) =>
                          handleCollectionChange(collection.id, 'enabled', value)
                        }
                        label=""
                        contextType="vectors"
                        urgencyScore={3}
                        description={`Agency vector collection ${collection.id} enabled`}
                      />
                      <Typography fontWeight={600}>{collection.name}</Typography>
                      <Chip label={`${collection.documentCount} docs`} size="small" />
                      <Typography variant="caption" color="text.secondary">
                        Last indexed: {new Date(collection.lastIndexed).toLocaleDateString()}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={3}>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          {collection.description}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <LoggableTextField
                          fieldPath={`tenants:${tenantId}.aiSettings.vectors.collections.${collection.id}.dimensions`}
                          trigger="update"
                          destinationModules={['VectorEngine', 'ContextEngine']}
                          value={collection.dimensions.toString()}
                          onChange={(value: string) =>
                            handleCollectionChange(
                              collection.id,
                              'dimensions',
                              parseInt(value),
                            )
                          }
                          label="Dimensions"
                          placeholder="512 to 4096"
                          contextType="vectors"
                          urgencyScore={3}
                          description={`Agency vector collection ${collection.id} dimensions`}
                          disabled={!collection.enabled}
                        />
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <LoggableSlider
                          fieldPath={`tenants:${tenantId}.aiSettings.vectors.collections.${collection.id}.similarityThreshold`}
                          trigger="update"
                          destinationModules={['VectorEngine', 'ContextEngine']}
                          value={collection.similarityThreshold}
                          onChange={(valueOrEvent: any, maybeValue?: any) => {
                            const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                            handleCollectionChange(collection.id, 'similarityThreshold', value);
                          }}
                          min={0.1}
                          max={1}
                          step={0.05}
                          label="Similarity Threshold"
                          contextType="vectors"
                          urgencyScore={3}
                          description={`Agency vector collection ${collection.id} similarity threshold`}
                          disabled={!collection.enabled}
                        />
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <LoggableTextField
                          fieldPath={`tenants:${tenantId}.aiSettings.vectors.collections.${collection.id}.maxResults`}
                          trigger="update"
                          destinationModules={['VectorEngine', 'ContextEngine']}
                          value={collection.maxResults.toString()}
                          onChange={(value: string) =>
                            handleCollectionChange(
                              collection.id,
                              'maxResults',
                              parseInt(value),
                            )
                          }
                          label="Max Results"
                          placeholder="1 to 100"
                          contextType="vectors"
                          urgencyScore={3}
                          description={`Agency vector collection ${collection.id} max results`}
                          disabled={!collection.enabled}
                        />
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <Button
                          variant="outlined"
                          startIcon={<RefreshIcon />}
                          onClick={() => handleReindex(collection.id)}
                          disabled={!collection.enabled || reindexing === collection.id}
                          fullWidth
                        >
                          {reindexing === collection.id ? 'Reindexing...' : 'Reindex'}
                        </Button>
                      </Grid>
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              </Grid>
            ))}
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 3 }}>
        Save Vector Settings
      </Button>

      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Vector settings updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default VectorSettings;
