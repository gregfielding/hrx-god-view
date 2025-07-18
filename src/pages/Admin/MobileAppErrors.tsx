import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Alert,
  Stack
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import ErrorIcon from '@mui/icons-material/Error';
import BugReportIcon from '@mui/icons-material/BugReport';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import AndroidIcon from '@mui/icons-material/Android';
import WebIcon from '@mui/icons-material/Web';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';

interface MobileAppError {
  id: string;
  timestamp: string;
  userId?: string;
  deviceId?: string;
  appVersion: string;
  platform: 'ios' | 'android' | 'web';
  errorType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  errorMessage: string;
  errorDetails: string;
  stackTrace?: string;
  userAction?: string;
  screenName?: string;
  networkStatus?: string;
  deviceInfo?: any;
  context?: any;
  status: string;
  autoFixAttempted: boolean;
  fixApplied?: string;
  resolvedAt?: string;
  reprocessed?: boolean;
  aiAnalysis?: any;
}

interface MobileErrorStats {
  totalErrors?: number;
  crashes?: number;
  networkErrors?: number;
  criticalErrors?: number;
  autoFixed?: number;
}

const platformIcons: Record<string, React.ReactNode> = {
  ios: <PhoneIphoneIcon color="primary" />,
  android: <AndroidIcon color="success" />,
  web: <WebIcon color="action" />,
};

const severityColors: Record<string, 'default' | 'primary' | 'warning' | 'error' | 'success'> = {
  low: 'default',
  medium: 'primary',
  high: 'warning',
  critical: 'error',
};

const errorTypeLabels: Record<string, string> = {
  crash: 'Crash',
  network: 'Network',
  ui: 'UI',
  data: 'Data',
  authentication: 'Auth',
  permission: 'Permission',
  performance: 'Performance',
  other: 'Other',
};

const MobileAppErrors: React.FC = () => {
  const [errors, setErrors] = useState<MobileAppError[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedError, setSelectedError] = useState<MobileAppError | null>(null);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [stats, setStats] = useState<MobileErrorStats | null>(null);

  useEffect(() => {
    fetchErrors();
    fetchStats();
    // eslint-disable-next-line
  }, []);

  const fetchErrors = async () => {
    setLoading(true);
    setError('');
    try {
      const functions = getFunctions(app);
      const getMobileErrorStats = httpsCallable(functions, 'getMobileErrorStats');
      const res = await getMobileErrorStats();
      // For now, fetch all errors from Firestore directly (for demo)
      // In production, use a paginated API or backend function
      const response = await fetch('/__/firebase/firestore/v1/projects/' + app.options.projectId + '/databases/(default)/documents/mobileAppErrors');
      const data = await response.json();
      const docs = (data.documents || []).map((doc: any) => ({
        id: doc.name.split('/').pop(),
        ...doc.fields,
        timestamp: doc.fields.timestamp?.timestampValue || '',
        userId: doc.fields.userId?.stringValue || '',
        appVersion: doc.fields.appVersion?.stringValue || '',
        platform: doc.fields.platform?.stringValue || 'web',
        errorType: doc.fields.errorType?.stringValue || 'other',
        severity: doc.fields.severity?.stringValue || 'low',
        errorMessage: doc.fields.errorMessage?.stringValue || '',
        errorDetails: doc.fields.errorDetails?.stringValue || '',
        status: doc.fields.status?.stringValue || '',
        autoFixAttempted: doc.fields.autoFixAttempted?.booleanValue || false,
      }));
      setErrors(docs);
    } catch (err: any) {
      setError(err.message || 'Failed to load errors');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const functions = getFunctions(app);
      const getMobileErrorStats = httpsCallable(functions, 'getMobileErrorStats');
      const res = await getMobileErrorStats();
      const stats = (res.data as any)?.stats as MobileErrorStats;
      setStats(stats);
    } catch (err) {
      // ignore
    }
  };

  const filteredErrors = errors.filter(e =>
    (platformFilter === 'all' || e.platform === platformFilter) &&
    (severityFilter === 'all' || e.severity === severityFilter)
  );

  return (
    <Box p={3}>
      <Typography variant="h5" gutterBottom>
        <BugReportIcon sx={{ mr: 1 }} /> Mobile App Error Monitoring
      </Typography>
      {stats && (
        <Box mb={2}>
          <Stack direction="row" spacing={2}>
            <Chip label={`Total: ${stats?.totalErrors ?? 0}`} color="primary" />
            <Chip label={`Crashes: ${stats?.crashes ?? 0}`} color="error" />
            <Chip label={`Network: ${stats?.networkErrors ?? 0}`} color="warning" />
            <Chip label={`Critical: ${stats?.criticalErrors ?? 0}`} color="error" />
            <Chip label={`Auto-fixed: ${stats?.autoFixed ?? 0}`} color="success" />
            {/* TODO: Add charts/analytics here */}
          </Stack>
        </Box>
      )}
      <Paper sx={{ mb: 2, p: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item>
            <FormControl size="small">
              <InputLabel>Platform</InputLabel>
              <Select value={platformFilter} label="Platform" onChange={e => setPlatformFilter(e.target.value)}>
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="ios">iOS</MenuItem>
                <MenuItem value="android">Android</MenuItem>
                <MenuItem value="web">Web</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item>
            <FormControl size="small">
              <InputLabel>Severity</InputLabel>
              <Select value={severityFilter} label="Severity" onChange={e => setSeverityFilter(e.target.value)}>
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="low">Low</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="critical">Critical</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>
      {loading ? (
        <CircularProgress />
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>User</TableCell>
                <TableCell>Platform</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Error Message</TableCell>
                <TableCell>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredErrors.map(e => (
                <TableRow key={e.id}>
                  <TableCell>{new Date(e.timestamp).toLocaleString()}</TableCell>
                  <TableCell>{e.userId || '-'}</TableCell>
                  <TableCell>{platformIcons[e.platform] || e.platform}</TableCell>
                  <TableCell>{errorTypeLabels[e.errorType] || e.errorType}</TableCell>
                  <TableCell>
                    <Chip label={e.severity} color={severityColors[e.severity]} size="small" />
                  </TableCell>
                  <TableCell>{e.errorMessage}</TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => setSelectedError(e)}>
                      <InfoIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Dialog open={!!selectedError} onClose={() => setSelectedError(null)} maxWidth="md" fullWidth>
        <DialogTitle>Error Details</DialogTitle>
        <DialogContent>
          {selectedError && (
            <Box>
              <Typography variant="subtitle2">Error Message</Typography>
              <Typography gutterBottom>{selectedError.errorMessage}</Typography>
              <Typography variant="subtitle2">Details</Typography>
              <Typography gutterBottom>{selectedError.errorDetails}</Typography>
              {selectedError.stackTrace && (
                <>
                  <Typography variant="subtitle2">Stack Trace</Typography>
                  <Paper sx={{ p: 1, mb: 2, bgcolor: '#f5f5f5' }}>
                    <pre style={{ fontSize: 12, margin: 0 }}>{selectedError.stackTrace}</pre>
                  </Paper>
                </>
              )}
              <Typography variant="subtitle2">User</Typography>
              <Typography gutterBottom>{selectedError.userId || '-'}</Typography>
              <Typography variant="subtitle2">Platform</Typography>
              <Typography gutterBottom>{selectedError.platform}</Typography>
              <Typography variant="subtitle2">App Version</Typography>
              <Typography gutterBottom>{selectedError.appVersion}</Typography>
              <Typography variant="subtitle2">Status</Typography>
              <Typography gutterBottom>{selectedError.status}</Typography>
              <Typography variant="subtitle2">Auto-fix Attempted</Typography>
              <Typography gutterBottom>{selectedError.autoFixAttempted ? 'Yes' : 'No'}</Typography>
              {selectedError.fixApplied && (
                <>
                  <Typography variant="subtitle2">Fix Applied</Typography>
                  <Typography gutterBottom>{selectedError.fixApplied}</Typography>
                </>
              )}
              {selectedError.aiAnalysis && (
                <>
                  <Typography variant="subtitle2">AI Analysis</Typography>
                  <Paper sx={{ p: 1, mb: 2, bgcolor: '#f5f5f5' }}>
                    <pre style={{ fontSize: 12, margin: 0 }}>{JSON.stringify(selectedError.aiAnalysis, null, 2)}</pre>
                  </Paper>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedError(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MobileAppErrors; 