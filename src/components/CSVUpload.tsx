import React, { useState, useRef } from 'react';
import {
  Box,
  Button,
  Typography,
  Paper,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Chip,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Divider,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Download as DownloadIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  TableChart as TableIcon,
} from '@mui/icons-material';
import {
  parseCSVFile,
  downloadSampleCSV,
  CSVValidationResult,
  CSVWorkerData,
} from '../utils/csvUpload';

interface CSVUploadProps {
  onWorkersReady: (workers: CSVWorkerData[]) => void;
  onCancel: () => void;
  departments: any[];
  locations: any[];
  divisions: any[];
  managers: any[];
}

const CSVUpload: React.FC<CSVUploadProps> = ({
  onWorkersReady,
  onCancel,
  departments,
  locations,
  divisions,
  managers,
}) => {
  const [validationResult, setValidationResult] = useState<CSVValidationResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const result = await parseCSVFile(file);
      setValidationResult(result);
      if (result.isValid) {
        setShowPreview(true);
      }
    } catch (error: any) {
      console.error('CSV parsing error:', error);
      setValidationResult({
        isValid: false,
        errors: [error.message],
        warnings: [],
        data: []
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    downloadSampleCSV();
  };

  const handleConfirmImport = () => {
    if (validationResult?.data) {
      onWorkersReady(validationResult.data);
    }
  };

  const getDepartmentName = (id: string) => {
    const dept = departments.find(d => d.id === id);
    return dept ? dept.name : id;
  };

  const getLocationName = (id: string) => {
    const loc = locations.find(l => l.id === id);
    return loc ? (loc.nickname || loc.name) : id;
  };

  const getDivisionName = (id: string) => {
    const div = divisions.find(d => d.id === id);
    return div ? div.name : id;
  };

  const getManagerName = (id: string) => {
    const mgr = managers.find(m => m.id === id);
    return mgr ? `${mgr.firstName} ${mgr.lastName}` : id;
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Bulk Import Workers
      </Typography>

      {/* Security Level Guide */}
      <Paper sx={{ p: 2, mb: 3, background: '#f8fafc' }}>
        <Typography variant="subtitle1" gutterBottom>
          <b>Instructions for CSV Upload</b>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          <b>Required:</b> For the <code>securityLevel</code> column, use the following numbers to indicate the worker's role:
        </Typography>
        <Box sx={{ overflowX: 'auto', mb: 1 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 400 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ border: '1px solid #e0e0e0', padding: 6 }}>securityLevel</th>
                <th style={{ border: '1px solid #e0e0e0', padding: 6 }}>Role</th>
                <th style={{ border: '1px solid #e0e0e0', padding: 6 }}>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>7</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Admin</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Full admin access</td></tr>
              <tr><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>6</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Manager</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Manager access</td></tr>
              <tr><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>5</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Worker</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Standard employee</td></tr>
              <tr><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>4</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Hired Staff</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Hired/assigned to a customer worksite</td></tr>
              <tr><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>3</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Applicant</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Job applicant, not yet hired</td></tr>
              <tr><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>2</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Suspended</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Suspended, no access/engagement</td></tr>
              <tr><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>1</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Dismissed</td><td style={{ border: '1px solid #e0e0e0', padding: 6 }}>Dismissed, no access/engagement</td></tr>
            </tbody>
          </table>
        </Box>
        <Typography variant="body2" color="text.secondary">
          <b>Tip:</b> Download the template to see the required columns and example values. All required fields must be filled in for each worker.
        </Typography>
      </Paper>
      
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <UploadIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Upload CSV File
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Import multiple workers at once using a CSV file. Download the template below to see the required format.
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mb: 2 }}>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleDownloadTemplate}
            >
              Download Template
            </Button>
            <Button
              variant="contained"
              component="label"
              startIcon={<UploadIcon />}
              disabled={isUploading}
            >
              Choose CSV File
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                hidden
                onChange={handleFileSelect}
              />
            </Button>
          </Box>
        </Box>

        {isUploading && (
          <Box sx={{ width: '100%', mb: 2 }}>
            <LinearProgress />
            <Typography variant="body2" sx={{ mt: 1 }}>
              Processing CSV file...
            </Typography>
          </Box>
        )}

        {validationResult && (
          <Box>
            {validationResult.isValid ? (
              <Alert severity="success" sx={{ mb: 2 }}>
                <Typography variant="subtitle2">
                  CSV file is valid! {validationResult.data.length} worker(s) ready to import.
                </Typography>
                {validationResult.warnings.length > 0 && (
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {validationResult.warnings.length} warning(s) found. Review below.
                  </Typography>
                )}
              </Alert>
            ) : (
              <Alert severity="error" sx={{ mb: 2 }}>
                <Typography variant="subtitle2">
                  CSV file has {validationResult.errors.length} error(s) that must be fixed.
                </Typography>
              </Alert>
            )}

            {validationResult.errors.length > 0 && (
              <Card variant="outlined" sx={{ mb: 2 }}>
                <CardHeader
                  title={`Errors (${validationResult.errors.length})`}
                  avatar={<ErrorIcon color="error" />}
                />
                <CardContent>
                  <List dense>
                    {validationResult.errors.map((error, index) => (
                      <ListItem key={index}>
                        <ListItemIcon>
                          <ErrorIcon color="error" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={error} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}

            {validationResult.warnings.length > 0 && (
              <Card variant="outlined" sx={{ mb: 2 }}>
                <CardHeader
                  title={`Warnings (${validationResult.warnings.length})`}
                  avatar={<WarningIcon color="warning" />}
                />
                <CardContent>
                  <List dense>
                    {validationResult.warnings.map((warning, index) => (
                      <ListItem key={index}>
                        <ListItemIcon>
                          <WarningIcon color="warning" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={warning} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}

            {validationResult.isValid && (
              <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                <Button
                  variant="outlined"
                  startIcon={<TableIcon />}
                  onClick={() => setShowPreview(true)}
                >
                  Preview Data
                </Button>
                <Button
                  variant="contained"
                  onClick={handleConfirmImport}
                  disabled={!validationResult.isValid}
                >
                  Import {validationResult.data.length} Worker(s)
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* Preview Dialog */}
      <Dialog
        open={showPreview}
        onClose={() => setShowPreview(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TableIcon />
            <Typography variant="h6">Preview Import Data</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Review the data before importing. Only valid rows will be imported.
          </Typography>
          
          <Grid container spacing={2}>
            {validationResult?.data.slice(0, 5).map((worker, index) => (
              <Grid item xs={12} key={index}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Typography variant="subtitle1">
                        {worker.firstName} {worker.lastName}
                        {worker.preferredName && (
                          <Chip 
                            label={`"${worker.preferredName}"`} 
                            size="small" 
                            sx={{ ml: 1 }}
                          />
                        )}
                      </Typography>
                      <Chip 
                        label={worker.securityLevel} 
                        color={worker.securityLevel === '5' ? 'primary' : 'secondary'}
                        size="small"
                      />
                    </Box>
                    
                    <Grid container spacing={1}>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Email: {worker.email}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Phone: {worker.phone}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Job: {worker.jobTitle || 'Not specified'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Department: {worker.departmentId ? getDepartmentName(worker.departmentId) : 'Not specified'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Employment: {worker.employmentType}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Status: {worker.workStatus}
                        </Typography>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          
          {validationResult && validationResult.data.length > 5 && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                ... and {validationResult.data.length - 5} more worker(s)
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPreview(false)}>Close</Button>
          <Button 
            variant="contained" 
            onClick={handleConfirmImport}
          >
            Import {validationResult?.data.length} Worker(s)
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
        <Button variant="outlined" onClick={onCancel}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
};

export default CSVUpload; 