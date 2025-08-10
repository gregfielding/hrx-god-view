import React, { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  Chip,
  IconButton,
  Tooltip,
  LinearProgress,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';

import { app } from '../../firebase';

const TONE_KEYS = [
  { key: 'formality', label: 'Formality' },
  { key: 'friendliness', label: 'Friendliness' },
  { key: 'conciseness', label: 'Conciseness' },
  { key: 'assertiveness', label: 'Assertiveness' },
  { key: 'enthusiasm', label: 'Enthusiasm' },
];

const CustomerToneOverrides: React.FC = () => {
  const [overrides, setOverrides] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<any>(null);
  const [editTone, setEditTone] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const navigate = useNavigate();

  const fetchOverrides = async () => {
    setLoading(true);
    try {
      const functions = getFunctions(app, 'us-central1');
      const listOverrides = httpsCallable(functions, 'listCustomerToneOverrides');
      const res: any = await listOverrides();
      setOverrides(res.data.overrides || []);
    } catch (err) {
      setOverrides([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOverrides();
  }, []);

  const handleEdit = (customer: any) => {
    setEditCustomer(customer);
    setEditTone({ ...customer.tone });
    setEditOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const functions = getFunctions(app, 'us-central1');
      const setTone = httpsCallable(functions, 'setCustomerTone');
      await setTone({ tenantId: editCustomer.id, tone: editTone });
      setEditOpen(false);
      fetchOverrides();
    } catch (err) {}
    setSaving(false);
  };

  const handleReset = async (tenantId: string) => {
    setResetting(true);
    try {
      const functions = getFunctions(app, 'us-central1');
      const resetTone = httpsCallable(functions, 'resetCustomerTone');
      await resetTone({ tenantId });
      fetchOverrides();
    } catch (err) {}
    setResetting(false);
  };

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h3">
          Customer Tone Overrides
        </Typography>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/admin/ai')}
          sx={{ fontWeight: 600 }}
        >
          Back to Launchpad
        </Button>
      </Box>
      <Typography variant="subtitle1" color="text.secondary" mb={3}>
        View and manage custom AI tone settings for each customer. Reset to default to remove an
        override.
      </Typography>
      <Paper sx={{ p: 2, mb: 4 }}>
        {loading ? (
          <LinearProgress />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Customer</TableCell>
                {TONE_KEYS.map((t) => (
                  <TableCell key={t.key}>{t.label}</TableCell>
                ))}
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {overrides.length === 0 && (
                <TableRow>
                  <TableCell colSpan={TONE_KEYS.length + 2}>
                    <em>No customer overrides found.</em>
                  </TableCell>
                </TableRow>
              )}
              {overrides.map((c, i) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name || c.id}</TableCell>
                  {TONE_KEYS.map((t) => (
                    <TableCell key={t.key}>
                      <Chip
                        label={c.tone[t.key] !== undefined ? c.tone[t.key] : '-'}
                        size="small"
                      />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Tooltip title="Edit">
                      <IconButton onClick={() => handleEdit(c)}>
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Reset to Default">
                      <span>
                        <IconButton onClick={() => handleReset(c.id)} disabled={resetting}>
                          <RestartAltIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit Tone for {editCustomer?.name || editCustomer?.id}</DialogTitle>
        <DialogContent>
          {TONE_KEYS.map((t) => (
            <Box key={t.key} mb={2}>
              <Typography variant="subtitle2">{t.label}</Typography>
              <Slider
                value={typeof editTone[t.key] === 'number' ? editTone[t.key] : 0.5}
                min={0}
                max={1}
                step={0.01}
                onChange={(_, val) =>
                  setEditTone((prev: any) => ({ ...prev, [t.key]: val as number }))
                }
              />
              <Typography variant="caption" color="text.secondary">
                Value: {typeof editTone[t.key] === 'number' ? editTone[t.key].toFixed(2) : '0.50'}
              </Typography>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CustomerToneOverrides;
