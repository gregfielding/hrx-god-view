import React, { useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Button,
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import BuildIcon from '@mui/icons-material/Build';
import PersonIcon from '@mui/icons-material/Person';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import PageHeader from '../components/PageHeader';
import type { SmartGroupData, SmartGroupEntry, JobCategory } from '../services/smartGroupService';
import {
  getMergedMetroOptions,
  getMergedSubareaOptionsForMetro,
  getMergedCityOptionsForSubarea,
  getCityKeysForMetro,
  formatGeoLabel,
} from '../data/metroSubareaSchema';

/** Metro filter value for applicants in cities not in any defined metro (fallback metros). */
const OTHER_METRO_VALUE = '__other__';
import { useSmartGroupSettings } from '../hooks/useSmartGroupSettings';

interface SmartGroupRow {
  userId: string;
  userName: string;
  applicationId: string;
  entry: SmartGroupEntry;
  interviewScore?: number;
  aiScore?: number;
}

export interface SmartGroupsPageProps {
  hideHeader?: boolean;
}

const SmartGroupsPage: React.FC<SmartGroupsPageProps> = ({ hideHeader = false }) => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const { customMetros } = useSmartGroupSettings(tenantId);
  const [rows, setRows] = useState<SmartGroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metroFilter, setMetroFilter] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [reportBuilt, setReportBuilt] = useState(false);

  const loadData = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
      const applicationsSnap = await getDocs(applicationsRef);
      const userIds = new Set<string>();
      applicationsSnap.docs.forEach((d) => {
        const data = d.data();
        const status = (data.status || '').toLowerCase();
        if (status !== 'withdrawn' && status !== 'deleted' && (data.userId || data.uid)) {
          userIds.add(data.userId || data.uid);
        }
      });

      const flatRows: SmartGroupRow[] = [];
      for (const uid of userIds) {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) continue;
        const userData = userSnap.data();
        const smartGroupData = userData?.smartGroupData as SmartGroupData | undefined;
        if (!smartGroupData?.byApplication || Object.keys(smartGroupData.byApplication).length === 0) continue;

        const userName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || uid;
        const scoreSummary = userData?.scoreSummary;
        const interviewScore = scoreSummary?.interviewAvg != null ? Number(scoreSummary.interviewAvg) : undefined;
        const aiScore = scoreSummary?.aiScore != null ? Number(scoreSummary.aiScore) : undefined;

        for (const [applicationId, entry] of Object.entries(smartGroupData.byApplication)) {
          flatRows.push({
            userId: uid,
            userName,
            applicationId,
            entry: entry as SmartGroupEntry,
            interviewScore,
            aiScore,
          });
        }
      }

      setRows(flatRows);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Smart Groups data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBuildReport = () => {
    setReportBuilt(true);
    loadData();
  };

  const clearMetro = () => {
    setMetroFilter(null);
    setAreaFilter(null);
    setCityFilter(null);
  };
  const clearArea = () => {
    setAreaFilter(null);
    setCityFilter(null);
  };
  const clearCity = () => setCityFilter(null);
  const clearCategory = () => setCategoryFilter(null);

  const metroOptions = getMergedMetroOptions(customMetros);
  const areaOptions = metroFilter ? getMergedSubareaOptionsForMetro(metroFilter, customMetros) : [];
  const cityOptions =
    metroFilter && areaFilter
      ? getMergedCityOptionsForSubarea(metroFilter, areaFilter, customMetros)
      : [];

  const categoryOptionsFromData = Array.from(
    new Set(rows.map((r) => r.entry.jobCategory).filter(Boolean))
  ).sort();
  const schemaCategories: JobCategory[] = ['industrial', 'hospitality', 'janitorial', 'other'];
  const categoryOptions = schemaCategories.filter(
    (c) => categoryOptionsFromData.includes(c) || categoryOptionsFromData.length === 0
  );
  if (categoryOptionsFromData.length > 0) {
    categoryOptionsFromData.forEach((c) => {
      if (!categoryOptions.includes(c)) categoryOptions.push(c);
    });
    categoryOptions.sort();
  }

  const cityKeysForSelectedMetro =
    metroFilter && metroFilter !== OTHER_METRO_VALUE
      ? getCityKeysForMetro(metroFilter, customMetros)
      : [];
  const filteredRows = rows.filter((row) => {
    const matchMetro = !metroFilter
      ? true
      : metroFilter === OTHER_METRO_VALUE
        ? (row.entry.metroKey && !metroOptions.includes(row.entry.metroKey))
        : (row.entry.metroKey && row.entry.metroKey === metroFilter) ||
          (row.entry.cityKey && cityKeysForSelectedMetro.includes(row.entry.cityKey));
    const matchArea =
      !areaFilter ||
      (Array.isArray(row.entry.subareaKeys) && row.entry.subareaKeys.includes(areaFilter));
    const matchCity =
      !cityFilter || (row.entry.cityKey && row.entry.cityKey === cityFilter);
    const matchCategory =
      !categoryFilter || row.entry.jobCategory === categoryFilter;
    return matchMetro && matchArea && matchCity && matchCategory;
  });

  const formatTimestamp = (ts: any) => {
    if (!ts) return '—';
    try {
      const date = ts?.toDate ? ts.toDate() : new Date(ts);
      return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { dateStyle: 'short' });
    } catch {
      return '—';
    }
  };

  return (
    <Box sx={{ pt: 2, px: 2, pb: 2 }}>
      {!hideHeader && (
        <PageHeader
          title="Smart Groups"
          subtitle="Applicant pool by geography and industry (derived from applications)"
        />
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="smart-metro-label">Metro</InputLabel>
            <Select
              labelId="smart-metro-label"
              label="Metro"
              value={metroFilter ?? ''}
              onChange={(e) => {
                const v = e.target.value as string;
                setMetroFilter(v || null);
                setAreaFilter(null);
                setCityFilter(null);
              }}
            >
              <MenuItem value="">All metros</MenuItem>
              {metroOptions.map((m) => (
                <MenuItem key={m} value={m}>
                  {formatGeoLabel(m)}
                </MenuItem>
              ))}
              <MenuItem value={OTHER_METRO_VALUE}>Other (non-metro)</MenuItem>
            </Select>
          </FormControl>
          {metroFilter && (
            <IconButton size="small" onClick={clearMetro} aria-label="Clear metro" sx={{ p: 0.5 }}>
              <ClearIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        {metroFilter && metroFilter !== OTHER_METRO_VALUE && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="smart-area-label">Area</InputLabel>
              <Select
                labelId="smart-area-label"
                label="Area"
                value={areaFilter ?? ''}
                displayEmpty
                renderValue={(v) => (v === '' ? 'All Areas' : formatGeoLabel(v))}
                onChange={(e) => {
                  const v = e.target.value as string;
                  setAreaFilter(v || null);
                  setCityFilter(null);
                }}
              >
                <MenuItem value="">All Areas</MenuItem>
                {areaOptions.map((a) => (
                  <MenuItem key={a} value={a}>
                    {formatGeoLabel(a)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {areaFilter && (
              <IconButton size="small" onClick={clearArea} aria-label="Clear area" sx={{ p: 0.5 }}>
                <ClearIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        )}

        {metroFilter && metroFilter !== OTHER_METRO_VALUE && areaFilter && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="smart-city-label">City</InputLabel>
              <Select
                labelId="smart-city-label"
                label="City"
                value={cityFilter ?? ''}
                displayEmpty
                renderValue={(v) => (v === '' ? 'All Cities' : formatGeoLabel(v))}
                onChange={(e) => {
                  const v = e.target.value as string;
                  setCityFilter(v || null);
                }}
              >
                <MenuItem value="">All Cities</MenuItem>
                {cityOptions.map((c) => (
                  <MenuItem key={c} value={c}>
                    {formatGeoLabel(c)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {cityFilter && (
              <IconButton size="small" onClick={clearCity} aria-label="Clear city" sx={{ p: 0.5 }}>
                <ClearIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="smart-category-label" shrink>Category</InputLabel>
            <Select
              labelId="smart-category-label"
              label="Category"
              value={categoryFilter ?? ''}
              displayEmpty
              renderValue={(v) => (v === '' ? 'All Categories' : v)}
              onChange={(e) => {
                const v = e.target.value as string;
                setCategoryFilter(v || null);
              }}
            >
              <MenuItem value="">All Categories</MenuItem>
              {categoryOptions.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {categoryFilter && (
            <IconButton size="small" onClick={clearCategory} aria-label="Clear category" sx={{ p: 0.5 }}>
              <ClearIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        <Button
          variant="contained"
          startIcon={<BuildIcon />}
          onClick={handleBuildReport}
          disabled={loading}
          sx={{
            textTransform: 'none',
            borderRadius: '24px',
            px: 2.5,
            py: 1,
            height: '40px',
            fontWeight: 500,
            fontSize: '14px',
            bgcolor: '#0057B8',
            boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
            '&:hover': {
              bgcolor: '#004a9f',
              boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
            },
            whiteSpace: 'nowrap',
            ml: 'auto',
          }}
        >
          Build
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : !reportBuilt ? (
        <Box
          sx={{
            py: 6,
            textAlign: 'center',
            color: 'text.secondary',
          }}
        >
          <Typography variant="body1">
            Select filters and click <strong>Build</strong> to generate the report.
          </Typography>
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Job Title</TableCell>
                <TableCell>Worksite City</TableCell>
                <TableCell>Company</TableCell>
                <TableCell>Worksite Name</TableCell>
                <TableCell>User City</TableCell>
                <TableCell>Skills</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Applied</TableCell>
                <TableCell align="right">Interview</TableCell>
                <TableCell align="right">AI Score</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      No Smart Groups data match the selected filters. Run the seed script or adjust filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => (
                  <TableRow
                    key={`${row.userId}-${row.applicationId}`}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/users/${row.userId}`)}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PersonIcon fontSize="small" color="action" />
                        {row.userName}
                      </Box>
                    </TableCell>
                    <TableCell>{row.entry.jobTitle || '—'}</TableCell>
                    <TableCell>{row.entry.worksiteCity || '—'}</TableCell>
                    <TableCell>{row.entry.companyName || '—'}</TableCell>
                    <TableCell>{row.entry.worksiteName || '—'}</TableCell>
                    <TableCell>{row.entry.userAddressCity || '—'}</TableCell>
                    <TableCell>
                      {Array.isArray(row.entry.skills) && row.entry.skills.length > 0
                        ? row.entry.skills.slice(0, 3).join(', ') + (row.entry.skills.length > 3 ? '…' : '')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Chip label={row.entry.jobCategory} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>{formatTimestamp(row.entry.timestamp)}</TableCell>
                    <TableCell align="right">
                      {row.interviewScore != null ? row.interviewScore.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {row.aiScore != null ? row.aiScore : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default SmartGroupsPage;
