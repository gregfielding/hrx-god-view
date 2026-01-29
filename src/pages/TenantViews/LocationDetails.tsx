import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Divider,
  CircularProgress,
  Alert,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Avatar,
  IconButton,
  Chip,
  Link as MUILink,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Skeleton,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableSortLabel,
  Autocomplete,
  Tooltip,
  InputAdornment,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  AddTask as AddTaskIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Language as LanguageIcon,
  LinkedIn as LinkedInIcon,
  Work as WorkIcon,
  Facebook as FacebookIcon,
  Dashboard as DashboardIcon,
  Notes as NotesIcon,
  Note as NoteIcon,
  Timeline as TimelineIcon,
  Phone as PhoneIcon,
  Event as EventIcon,
  Email as EmailIcon,
  AttachMoney as DealIcon,
  Person as PersonIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { GoogleMap, MarkerF } from '@react-google-maps/api';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import AddNoteDialog from '../../components/AddNoteDialog';
import CRMNotesTab from '../../components/CRMNotesTab';
import ActivityLogTab from '../../components/ActivityLogTab';
import PageHeader from '../../components/PageHeader';
import CreateTaskDialog from '../../components/CreateTaskDialog';
import { useFavorites } from '../../hooks/useFavorites';
import FavoriteButton from '../../components/FavoriteButton';

interface LocationData {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  type: string;
  division?: string;
  phone?: string;
  coordinates?: any;
  contactCount?: number;
  dealCount?: number;
  salespersonCount?: number;
  activeSalespeople?: { [key: string]: any };
  associations?: {
    contacts?: string[];
    deals?: string[];
    salespeople?: string[];
  };
  createdAt?: any;
  updatedAt?: any;
}

type LocationActivityItem = {
  id: string;
  type: 'task' | 'note' | 'deal_stage' | 'email';
  timestamp: Date;
  title: string;
  description?: string;
  metadata?: any;
};

const getActivityTypeColor = (type: string): string => {
  const colors: { [key: string]: string } = {
    task: '#10B981',      // Green for completed tasks
    note: '#3B82F6',      // Blue for notes
    deal_stage: '#8B5CF6', // Purple for deal stages
    email: '#F59E0B'      // Orange for emails
  };
  return colors[type] || '#6B7280'; // Gray fallback
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

// Google Maps is loaded globally in App via LoadScript; avoid loading here again

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`location-tabpanel-${index}`}
      aria-labelledby={`location-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

const SectionCard: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <Card sx={{ mb: 3 }}>
    <CardHeader title={title} action={action} titleTypographyProps={{ variant: 'h6' }} sx={{ pb: 0 }} />
    <CardContent sx={{ pt: 2 }}>{children}</CardContent>
  </Card>
);

const RecentActivityWidget: React.FC<{ location: any; tenantId: string }> = ({ location, tenantId }) => {
  const [items, setItems] = useState<LocationActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const load = async () => {
      if (!location?.id || !tenantId) return;
      setLoading(true);
      try {
        const locationId: string = location.id;
        const contactIds: string[] = Array.isArray(location.associations?.contacts) ? location.associations.contacts : [];
        const dealIds: string[] = Array.isArray(location.associations?.deals) ? location.associations.deals : [];

        const aggregated: LocationActivityItem[] = [];

        // Tasks: completed tasks associated to this location
        try {
          const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
          const tq = query(
            tasksRef,
            where('associations.locations', 'array-contains', locationId),
            where('status', '==', 'completed'),
            orderBy('updatedAt', 'desc'),
            limit(5)
          );
          const ts = await getDocs(tq);
          ts.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `task_${docSnap.id}`,
              type: 'task',
              timestamp: d.completedAt ? new Date(d.completedAt) : (d.updatedAt?.toDate?.() || new Date()),
              title: d.title || 'Task completed',
              description: d.description || '',
              metadata: { priority: d.priority, taskType: d.type }
            });
          });
        } catch {}

        // Notes: location + contact + deal notes
        const notesScopes = [
          { coll: 'location_notes', ids: [locationId] },
          { coll: 'contact_notes', ids: contactIds },
          { coll: 'deal_notes', ids: dealIds },
        ];
        for (const scope of notesScopes) {
          for (const id of scope.ids) {
            try {
              const notesRef = collection(db, 'tenants', tenantId, scope.coll);
              const nq = query(notesRef, where('entityId', '==', id), orderBy('timestamp', 'desc'), limit(5));
              const ns = await getDocs(nq);
              ns.forEach((docSnap) => {
                const d = docSnap.data() as any;
                aggregated.push({
                  id: `note_${scope.coll}_${docSnap.id}`,
                  type: 'note',
                  timestamp: d.timestamp?.toDate?.() || new Date(),
                  title: d.category ? `Note (${d.category})` : 'Note',
                  description: d.content,
                  metadata: { authorName: d.authorName, priority: d.priority, source: d.source }
                });
              });
            } catch {}
          }
        }

        // Deal stage progression
        for (const dealId of dealIds) {
          try {
            const stageRef = collection(db, 'tenants', tenantId, 'crm_deals', dealId, 'stage_history');
            const sq = query(stageRef, orderBy('timestamp', 'desc'), limit(5));
            const ss = await getDocs(sq);
            ss.forEach((docSnap) => {
              const d = docSnap.data() as any;
              aggregated.push({
                id: `dealstage_${dealId}_${docSnap.id}`,
                type: 'deal_stage',
                timestamp: d.timestamp?.toDate?.() || new Date(),
                title: `Deal stage: ${d.fromStage || '?'} → ${d.toStage || d.stage || '?'}`,
                description: d.reason || 'Stage updated',
                metadata: { dealId }
              });
            });
          } catch {}
        }

        // Sort by timestamp and take the most recent 5
        aggregated.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setItems(aggregated.slice(0, 5));
      } catch (error) {
        console.error('Error loading recent activity:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [location?.id, tenantId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Skeleton variant="rectangular" height={32} />
        <Skeleton variant="rectangular" height={32} />
        <Skeleton variant="rectangular" height={32} />
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No recent activity
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Activities will appear here as they occur
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((item) => (
        <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
            {item.type === 'task' && <EventIcon sx={{ fontSize: 16 }} />}
            {item.type === 'note' && <NotesIcon sx={{ fontSize: 16 }} />}
            {item.type === 'deal_stage' && <DealIcon sx={{ fontSize: 16 }} />}
            {item.type === 'email' && <EmailIcon sx={{ fontSize: 16 }} />}
          </Avatar>
          <Typography variant="body2" fontSize="0.75rem">
            {item.title}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

const LocationMap: React.FC<{ location: LocationData }> = ({ location }) => {
  // Fallback center (Las Vegas area based on the image)
  const fallbackCenter = { lat: 36.1699, lng: -115.1398 };
  // Always render a marker; start at fallback and then snap to real coordinates when available.
  const [center, setCenter] = useState<{ lat: number; lng: number }>(fallbackCenter);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  // Using MarkerF for reliable rendering within React
  
  useEffect(() => {
    console.log('LocationMap: location data:', location);
    console.log('LocationMap: coordinates:', location.coordinates);
    
    // Use coordinates if available, otherwise try to geocode the address
    if (location.coordinates?.lat && location.coordinates?.lng) {
      console.log('LocationMap: Using existing coordinates (lat/lng)');
      setCenter({
        lat: location.coordinates.lat,
        lng: location.coordinates.lng
      });
    } else if (location.coordinates?.latitude && location.coordinates?.longitude) {
      console.log('LocationMap: Using existing coordinates (latitude/longitude)');
      setCenter({
        lat: location.coordinates.latitude,
        lng: location.coordinates.longitude
      });
    } else if (location.coordinates?._lat != null && location.coordinates?._long != null) {
      // Firestore GeoPoint-like serialization
      console.log('LocationMap: Using existing coordinates (_lat/_long)');
      setCenter({
        lat: Number(location.coordinates._lat),
        lng: Number(location.coordinates._long),
      });
    } else if (location.address || location.city || location.state) {
      // Try to geocode the address
      const address = [
        location.address,
        location.city,
        location.state,
        location.zipCode
      ].filter(Boolean).join(', ');
      
      console.log('LocationMap: Geocoding address:', address);
      
      if (address) {
        if (!(window as any).google?.maps?.Geocoder) return;
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address }, (results, status) => {
          console.log('LocationMap: Geocoding result:', status, results);
          if (status === 'OK' && results && results[0]) {
            const lat = results[0].geometry.location.lat();
            const lng = results[0].geometry.location.lng();
            console.log('LocationMap: Setting center to:', { lat, lng });
            setCenter({ lat, lng });
          }
        });
      }
    }
  }, [location]);

  // Marker is rendered via MarkerF in JSX

  if (!(window as any).google) {
    return (
      <Box sx={{ height: 360, bgcolor: 'grey.100', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  console.log('LocationMap: Rendering map with center:', center);
  
  

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: '360px' }}
      center={center}
      zoom={12}
      onLoad={(m) => setMapInstance(m)}
      onUnmount={() => setMapInstance(null)}
    >
      {/* Render marker at center */}
      <MarkerF
        key={`${center.lat},${center.lng}`}
        position={center}
        onClick={() => {
          try {
            if (mapInstance) {
              mapInstance.panTo(center);
              const currentZoom = mapInstance.getZoom() || 12;
              if (currentZoom < 14) mapInstance.setZoom(14);
            }
          } catch {}
        }}
      />
    </GoogleMap>
  );
};

// Link component for activity items
const LinkForActivity: React.FC<{ it: LocationActivityItem; tenantId: string; companyId: string }> = ({ it, tenantId, companyId }) => {
  // Basic heuristics using metadata: for deal_stage use metadata.dealId; for email prefer metadata.dealId else first contact; for task/note no direct id unless captured – link to location as fallback
  let href: string | null = null;
  let label = 'Open';
  if (it.type === 'deal_stage' && it.metadata?.dealId) {
    href = `/crm/deals/${it.metadata.dealId}`;
    label = 'View Deal';
  } else if (it.type === 'email') {
    const dealId = it.metadata?.dealId;
    const contactId = Array.isArray(it.metadata?.contacts) ? it.metadata.contacts[0] : it.metadata?.contactId;
    if (dealId) {
      href = `/crm/deals/${dealId}`;
      label = 'View Deal';
    } else if (contactId) {
      href = `/contacts/${contactId}`;
      label = 'View Contact';
    }
  }
  if (!href) {
    href = `/crm/companies/${companyId}`;
    label = 'View Company';
  }
  return (
    <Button size="small" href={href} target="_self" variant="text">{label}</Button>
  );
};

// Location Activity Tab Component
const LocationActivityTab: React.FC<{ location: LocationData; tenantId: string; companyId: string }> = ({ location, tenantId, companyId }) => {
  const [items, setItems] = useState<LocationActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'note' | 'deal_stage' | 'email'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    const load = async () => {
      if (!location?.id || !tenantId) return;
      setLoading(true);
      setError('');
      try {
        const locationId: string = location.id;
        const contactIds: string[] = Array.isArray(location.associations?.contacts) ? location.associations.contacts : [];
        const dealIds: string[] = Array.isArray(location.associations?.deals) ? location.associations.deals : [];

        const aggregated: LocationActivityItem[] = [];

        // Tasks: completed tasks associated to this location
        try {
          const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
          const tq = query(
            tasksRef,
            where('associations.locations', 'array-contains', locationId),
            where('status', '==', 'completed'),
            orderBy('updatedAt', 'desc'),
            limit(200)
          );
          const ts = await getDocs(tq);
          ts.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `task_${docSnap.id}`,
              type: 'task',
              timestamp: d.completedAt ? new Date(d.completedAt) : (d.updatedAt?.toDate?.() || new Date()),
              title: d.title || 'Task completed',
              description: d.description || '',
              metadata: { priority: d.priority, taskType: d.type }
            });
          });
        } catch {}

        // Notes: location + contact + deal notes
        const notesScopes = [
          { coll: 'location_notes', ids: [locationId] },
          { coll: 'contact_notes', ids: contactIds },
          { coll: 'deal_notes', ids: dealIds },
        ];
        for (const scope of notesScopes) {
          for (const id of scope.ids) {
            try {
              const notesRef = collection(db, 'tenants', tenantId, scope.coll);
              const nq = query(notesRef, where('entityId', '==', id), orderBy('timestamp', 'desc'), limit(200));
              const ns = await getDocs(nq);
              ns.forEach((docSnap) => {
                const d = docSnap.data() as any;
                aggregated.push({
                  id: `note_${scope.coll}_${docSnap.id}`,
                  type: 'note',
                  timestamp: d.timestamp?.toDate?.() || new Date(),
                  title: d.category ? `Note (${d.category})` : 'Note',
                  description: d.content,
                  metadata: { authorName: d.authorName, priority: d.priority, source: d.source }
                });
              });
            } catch {}
          }
        }

        // Deal stage progression: subcollection stage_history under each deal
        for (const dealId of dealIds) {
          try {
            const stageRef = collection(db, 'tenants', tenantId, 'crm_deals', dealId, 'stage_history');
            const sq = query(stageRef, orderBy('timestamp', 'desc'), limit(100));
            const ss = await getDocs(sq);
            ss.forEach((docSnap) => {
              const d = docSnap.data() as any;
              aggregated.push({
                id: `dealstage_${dealId}_${docSnap.id}`,
                type: 'deal_stage',
                timestamp: d.timestamp?.toDate?.() || new Date(),
                title: `Deal stage: ${d.fromStage || '?'} → ${d.toStage || d.stage || '?'}`,
                description: d.reason || 'Stage updated',
                metadata: { dealId }
              });
            });
          } catch {}
        }

        // Emails: email_logs filtered by locationId and by each contactId
        try {
          const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
          const lq = query(emailsRef, where('locationId', '==', locationId), orderBy('timestamp', 'desc'), limit(200));
          const ls = await getDocs(lq);
          ls.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `email_location_${docSnap.id}`,
              type: 'email',
              timestamp: d.timestamp?.toDate?.() || new Date(),
              title: `Email: ${d.subject || '(no subject)'}`,
              description: d.bodySnippet,
              metadata: { from: d.from, to: d.to, direction: d.direction }
            });
          });
          for (const contactId of contactIds) {
            try {
              const cq2 = query(emailsRef, where('contactId', '==', contactId), orderBy('timestamp', 'desc'), limit(200));
              const cs2 = await getDocs(cq2);
              cs2.forEach((docSnap) => {
                const d = docSnap.data() as any;
                aggregated.push({
                  id: `email_contact_${contactId}_${docSnap.id}`,
                  type: 'email',
                  timestamp: d.timestamp?.toDate?.() || new Date(),
                  title: `Email: ${d.subject || '(no subject)'}`,
                  description: d.bodySnippet,
                  metadata: { from: d.from, to: d.to, direction: d.direction }
                });
              });
            } catch {}
          }
        } catch {}

        // Sort newest first
        aggregated.sort((a, b) => (b.timestamp?.getTime?.() || 0) - (a.timestamp?.getTime?.() || 0));
        setItems(aggregated);
        setPage(1);
      } catch (e: any) {
        setError(e?.message || 'Failed to load activity');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [location?.id, tenantId]);

  // Derived list after filters
  const filtered = items.filter((it) => {
    if (typeFilter !== 'all' && it.type !== typeFilter) return false;
    if (startDate) {
      const s = new Date(startDate + 'T00:00:00');
      if (it.timestamp < s) return false;
    }
    if (endDate) {
      const e = new Date(endDate + 'T23:59:59');
      if (it.timestamp > e) return false;
    }
    return true;
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mt: 0, mb: 1, px: 3 }}>
        <Box display="flex" alignItems="center" gap={1}>
          <TimelineIcon /><Typography variant="h6">Location Activity</Typography>
        </Box>
        {/* Filters */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Type</InputLabel>
            <Select value={typeFilter} label="Type" onChange={(e) => { setTypeFilter(e.target.value as any); setPage(1); }}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="task">Tasks</MenuItem>
              <MenuItem value="note">Notes</MenuItem>
              <MenuItem value="deal_stage">Deal Stages</MenuItem>
              <MenuItem value="email">Emails</MenuItem>
            </Select>
          </FormControl>
          <TextField
            type="date"
            size="small"
            label="Start"
            InputLabelProps={{ shrink: true }}
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          />
          <TextField
            type="date"
            size="small"
            label="End"
            InputLabelProps={{ shrink: true }}
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          />
          <Typography variant="body2" color="text.secondary">
            {total} results
          </Typography>
        </Box>
      </Box>
      <Card>
        <CardContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
          ) : filtered.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography color="text.secondary">No activity yet.</Typography>
              <Typography variant="caption" color="text.secondary">Completed tasks, notes, deal stage changes, and emails will appear here.</Typography>
            </Box>
          ) : (
            <TableContainer 
              component={Paper} 
              variant="outlined"
              sx={{
                overflowX: 'auto',
                borderRadius: '8px',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
              }}
            >
              <Table sx={{ minWidth: 1000 }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Type
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Title
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Description
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      When
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }} align="right">
                      Link
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageItems.map((it) => (
                    <TableRow 
                      key={it.id}
                      sx={{
                        height: '48px',
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: '#F9FAFB'
                        }
                      }}
                    >
                      <TableCell sx={{ py: 1 }}>
                        <Chip 
                          size="small" 
                          label={it.type.replace('_', ' ')} 
                          sx={{
                            fontSize: '0.75rem',
                            height: 24,
                            fontWeight: 600,
                            backgroundColor: getActivityTypeColor(it.type),
                            color: 'white'
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 1, px: 2 }}>
                        <Typography sx={{
                          variant: "body2",
                          color: "#111827",
                          fontSize: '0.875rem',
                          fontWeight: 500
                        }}>
                          {it.title}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{
                          variant: "body2",
                          color: "#6B7280",
                          fontSize: '0.875rem',
                          maxWidth: 420,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {it.description}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{
                          variant: "body2",
                          color: "#6B7280",
                          fontSize: '0.875rem'
                        }}>
                          {it.timestamp?.toLocaleString?.()}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }} align="right">
                        <LinkForActivity it={it} tenantId={tenantId} companyId={companyId!} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {/* Pagination */}
          {filtered.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
              <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <Typography variant="caption">Page {page} of {totalPages}</Typography>
              <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

const LocationDetails: React.FC = () => {
  const { companyId, locationId } = useParams<{ companyId: string; locationId: string }>();
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites('contacts');
  
  const [location, setLocation] = useState<LocationData | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [locationContacts, setLocationContacts] = useState<any[]>([]);
  const [locationDeals, setLocationDeals] = useState<any[]>([]);
  const [companyDivisions, setCompanyDivisions] = useState<string[]>([]);
  const [rebuildingActive, setRebuildingActive] = useState(false);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isEditingLocationDetails, setIsEditingLocationDetails] = useState(false);
  const [jobOrders, setJobOrders] = useState<any[]>([]);
  const [loadingJobOrders, setLoadingJobOrders] = useState(false);

  const opportunitiesSectionRef = useRef<HTMLDivElement | null>(null);
  const jobOrdersSectionRef = useRef<HTMLDivElement | null>(null);

  // Contacts tab state (match Company > Contacts layout)
  const [contactsSearchQuery, setContactsSearchQuery] = useState('');
  const [contactsSortField, setContactsSortField] = useState<string>('name');
  const [contactsSortDirection, setContactsSortDirection] = useState<'asc' | 'desc'>('asc');
  const [contactsDialogOpen, setContactsDialogOpen] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactsSuccess, setContactsSuccess] = useState(false);
  const [contactsSuccessMessage, setContactsSuccessMessage] = useState('');
  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
    linkedInUrl: '',
    contactType: 'Unknown',
    tags: [] as string[],
    isActive: true,
    notes: '',
  });

  const scrollToDashboardSection = (ref: React.RefObject<HTMLDivElement | null>) => {
    setTabValue(0);
    // Wait for tab content to render before scrolling
    window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const getInitials = (name: string) => {
    const cleaned = (name || '').trim();
    if (!cleaned) return '?';
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return cleaned[0].toUpperCase();
  };

  const getAvatarColor = (name: string) => {
    // Match the soft deterministic palette used elsewhere
    const colors = [
      { bg: '#EEF2FF', fg: '#3730A3' },
      { bg: '#ECFDF5', fg: '#047857' },
      { bg: '#FFFBEB', fg: '#B45309' },
      { bg: '#FEE2E2', fg: '#B91C1C' },
      { bg: '#E0F2FE', fg: '#0369A1' },
      { bg: '#F3E8FF', fg: '#6D28D9' },
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    const c = colors[hash % colors.length];
    return { backgroundColor: c.bg, color: c.fg };
  };

  useEffect(() => {
    if (!companyId || !locationId || !tenantId) {
      return;
    }
    
    const loadLocationData = async () => {
      try {
        setLoading(true);
        
        // Load company data
        const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId));
        if (!companyDoc.exists()) {
          setError('Company not found');
          return;
        }
        setCompany({ id: companyDoc.id, ...companyDoc.data() });
        
        // Load location data
        const locationDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId));
        if (!locationDoc.exists()) {
          setError('Location not found');
          return;
        }
        
        const locationData = { id: locationDoc.id, ...locationDoc.data() } as LocationData;
        setLocation(locationData);

        // Load location-scoped contacts
        try {
          const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
          let contactsList: any[] = [];
          try {
            const q1 = query(contactsRef, where('associations.locations', 'array-contains', locationId));
            const snap1 = await getDocs(q1 as any);
            contactsList = snap1.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          } catch {}
          if (contactsList.length === 0) {
            try {
              const q2 = query(contactsRef, where('locationId', '==', locationId));
              const snap2 = await getDocs(q2 as any);
              contactsList = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            } catch {}
          }
          setLocationContacts(contactsList);
        } catch (contactsErr) {
          console.warn('Failed to load location contacts:', contactsErr);
          setLocationContacts([]);
        }

        // Load location-scoped deals/opportunities
        try {
          const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
          let dealsList: any[] = [];
          try {
            const q1 = query(dealsRef, where('associations.locations', 'array-contains', locationId));
            const snap1 = await getDocs(q1 as any);
            dealsList = snap1.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          } catch {}
          if (dealsList.length === 0) {
            try {
              const q2 = query(dealsRef, where('locationId', '==', locationId));
              const snap2 = await getDocs(q2 as any);
              dealsList = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            } catch {}
          }
          setLocationDeals(dealsList);
        } catch (dealsErr) {
          console.warn('Failed to load location deals:', dealsErr);
          setLocationDeals([]);
        }

        // Load company divisions
        try {
          const divisionsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'divisions');
          const divisionsSnapshot = await getDocs(divisionsRef);
          const divisions = divisionsSnapshot.docs.map(doc => doc.data().name || doc.id).filter(Boolean);
          setCompanyDivisions(divisions);
        } catch (divisionsErr) {
          console.warn('Failed to load company divisions:', divisionsErr);
          setCompanyDivisions([]);
        }

        // Load job orders for this location
        await loadJobOrdersForLocation();
        
      } catch (err: any) {
        console.error('Error loading location data:', err);
        setError(err.message || 'Failed to load location data');
      } finally {
        setLoading(false);
      }
    };

    loadLocationData();
  }, [companyId, locationId, tenantId]);

  const loadJobOrdersForLocation = async () => {
    if (!locationId || !tenantId) {
      setJobOrders([]);
      return;
    }
    
    try {
      setLoadingJobOrders(true);
      const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
      
      // Query job orders where worksiteId matches the location ID
      const locationQuery = query(jobOrdersRef, where('worksiteId', '==', locationId));
      const snapshot = await getDocs(locationQuery);
      
      const jobOrdersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setJobOrders(jobOrdersData);
    } catch (err) {
      console.error('Error loading job orders for location:', err);
      setJobOrders([]);
    } finally {
      setLoadingJobOrders(false);
    }
  };



  const handleDelete = async () => {
    if (!location || !tenantId) return;
    
    setDeleting(true);
    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId!, 'locations', locationId!);
      await deleteDoc(locationRef);
      navigate(`/crm/companies/${companyId}?tab=1`);
    } catch (err: any) {
      console.error('Error deleting location:', err);
      setError(err.message || 'Failed to delete location');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleFieldChange = async (field: string, value: any) => {
    if (!location || !tenantId) return;
    
    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId!, 'locations', locationId!);
      await updateDoc(locationRef, {
        [field]: value,
        updatedAt: new Date()
      });
      
      setLocation({ ...location, [field]: value });
    } catch (err: any) {
      console.error('Error updating location field:', err);
      setError(err.message || 'Failed to update location');
    }
  };

  const navigateBackToCompany = () => {
    // Try to get the source tab from the current URL state
    const currentUrl = new URL(window.location.href);
    const sourceTab = currentUrl.searchParams.get('sourceTab');
    
    if (sourceTab) {
      navigate(`/crm/companies/${companyId}?tab=${sourceTab}`);
      return;
    }
    
    // Fallback: check referrer for tab information
    const referrer = document.referrer;
    if (referrer.includes('/crm/companies/') && referrer.includes('tab=')) {
      try {
        const referrerUrl = new URL(referrer);
        const tab = referrerUrl.searchParams.get('tab');
        if (tab) {
          navigate(`/crm/companies/${companyId}?tab=${tab}`);
          return;
        }
      } catch (err) {
        // Could not parse referrer URL
      }
    }
    
    // Default to locations tab (tab=1) since this is a location details page
    navigate(`/crm/companies/${companyId}?tab=1`);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={navigateBackToCompany}
        >
          Back to Company
        </Button>
      </Box>
    );
  }

  if (!location) {
    return (
          <Box sx={{ p: 3 }}>
      <Typography variant="h6" color="error" gutterBottom>
        Location not found
      </Typography>
      <Button
        variant="outlined"
        startIcon={<ArrowBackIcon />}
        onClick={navigateBackToCompany}
      >
        Back to Company
      </Button>
    </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Record-spec header + tab pills */}
      <PageHeader
        title={
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
              {/* Avatar - match record pages (Company/Contact) */}
              <Avatar
                src={company?.logo || undefined}
                sx={{
                  width: 108,
                  height: 108,
                  bgcolor: company?.logo ? 'transparent' : 'primary.main',
                  fontSize: '40px',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {((company?.companyName || company?.name || 'C') as string).charAt(0).toUpperCase()}
              </Avatar>

              {/* Three-line content area - matches avatar height */}
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: 108,
                }}
              >
                {/* Line 1: Location Name + Type chip */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0, flexWrap: 'wrap' }}>
                  <Typography
                    variant="h6"
                    sx={{
                      fontSize: { xs: '20px', md: '24px' },
                      fontWeight: 600,
                      lineHeight: 1.2,
                    }}
                  >
                    {location.name}
                  </Typography>
                  {!!location.type && (
                    <Chip
                      label={location.type}
                      size="small"
                      sx={{ height: 28, borderRadius: 1, fontWeight: 500, fontSize: '0.8125rem' }}
                    />
                  )}
                </Box>

                {/* Line 2: Address line (right below title) */}
                {(() => {
                  const parts = [location.address, location.city, location.state, location.zipCode].filter(Boolean);
                  const full = parts.join(', ');
                  if (!full) return null;
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                      <LocationIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                      <Typography variant="body2" sx={{ fontSize: '14px', color: 'rgba(0,0,0,0.55)' }} noWrap>
                        {full}
                      </Typography>
                    </Box>
                  );
                })()}

                {/* Line 3: Icon row (own row, below address) */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                  <Tooltip title="Add Task">
                    <IconButton
                      size="small"
                      onClick={() => setShowCreateTaskDialog(true)}
                      sx={{
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        },
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <AddTaskIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Add Note">
                    <IconButton
                      size="small"
                      onClick={() => setShowAddNoteDialog(true)}
                      sx={{
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        },
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <NoteIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Tooltip>
                  {!!company?.website && (
                    <Tooltip title="Visit website">
                      <IconButton
                        size="small"
                        onClick={() => {
                          const raw = String(company.website || '');
                          const url = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
                          window.open(url, '_blank');
                        }}
                        sx={{
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                          },
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <LanguageIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {!!location.phone && (
                    <Tooltip title="Call location">
                      <IconButton
                        size="small"
                        onClick={() => window.open(`tel:${location.phone}`, '_blank')}
                        sx={{
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                          },
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <PhoneIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>

                {/* Line 4: Associations row (Company / Contacts / Opportunities / Job Orders) */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  {!!company && (
                    <>
                      <BusinessIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'rgb(74, 144, 226)',
                          cursor: 'pointer',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                        onClick={() => navigate(`/crm/companies/${companyId}`)}
                      >
                        {company?.companyName || company?.name || 'Company'}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'rgba(0,0,0,0.35)', mx: 0.25 }}>
                        •
                      </Typography>
                    </>
                  )}

                  <PersonIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'rgb(74, 144, 226)',
                      cursor: 'pointer',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                    onClick={() => setTabValue(1)}
                  >
                    Contacts ({locationContacts?.length ?? 0})
                  </Typography>

                  <Typography variant="body2" sx={{ color: 'rgba(0,0,0,0.35)', mx: 0.25 }}>
                    •
                  </Typography>

                  <DealIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'rgb(74, 144, 226)',
                      cursor: 'pointer',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                    onClick={() => scrollToDashboardSection(opportunitiesSectionRef)}
                  >
                    Opportunities ({locationDeals?.length ?? 0})
                  </Typography>

                  <Typography variant="body2" sx={{ color: 'rgba(0,0,0,0.35)', mx: 0.25 }}>
                    •
                  </Typography>

                  <WorkIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'rgb(74, 144, 226)',
                      cursor: 'pointer',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                    onClick={() => scrollToDashboardSection(jobOrdersSectionRef)}
                  >
                    Job Orders ({jobOrders?.length ?? 0})
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        }
        filters={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant={tabValue === 0 ? 'contained' : 'text'}
              onClick={() => setTabValue(0)}
              sx={{
                borderRadius: '999px',
                fontSize: '14px',
                px: 1.5,
                py: 0.75,
                ...(tabValue === 0
                  ? { bgcolor: '#0057B8', color: 'white', fontWeight: 500 }
                  : { bgcolor: 'rgba(0, 0, 0, 0.04)', color: 'rgba(0, 0, 0, 0.7)', fontWeight: 400 }),
              }}
              startIcon={<DashboardIcon fontSize="small" />}
            >
              Dashboard
            </Button>
            <Button
              variant={tabValue === 1 ? 'contained' : 'text'}
              onClick={() => setTabValue(1)}
              sx={{
                borderRadius: '999px',
                fontSize: '14px',
                px: 1.5,
                py: 0.75,
                ...(tabValue === 1
                  ? { bgcolor: '#0057B8', color: 'white', fontWeight: 500 }
                  : { bgcolor: 'rgba(0, 0, 0, 0.04)', color: 'rgba(0, 0, 0, 0.7)', fontWeight: 400 }),
              }}
              startIcon={<PersonIcon fontSize="small" />}
            >
              Contacts
            </Button>
            <Button
              variant={tabValue === 2 ? 'contained' : 'text'}
              onClick={() => setTabValue(2)}
              sx={{
                borderRadius: '999px',
                fontSize: '14px',
                px: 1.5,
                py: 0.75,
                ...(tabValue === 2
                  ? { bgcolor: '#0057B8', color: 'white', fontWeight: 500 }
                  : { bgcolor: 'rgba(0, 0, 0, 0.04)', color: 'rgba(0, 0, 0, 0.7)', fontWeight: 400 }),
              }}
              startIcon={<NotesIcon fontSize="small" />}
            >
              Notes
            </Button>
            <Button
              variant={tabValue === 3 ? 'contained' : 'text'}
              onClick={() => setTabValue(3)}
              sx={{
                borderRadius: '999px',
                fontSize: '14px',
                px: 1.5,
                py: 0.75,
                ...(tabValue === 3
                  ? { bgcolor: '#0057B8', color: 'white', fontWeight: 500 }
                  : { bgcolor: 'rgba(0, 0, 0, 0.04)', color: 'rgba(0, 0, 0, 0.7)', fontWeight: 400 }),
              }}
              startIcon={<TimelineIcon fontSize="small" />}
            >
              Activity
            </Button>
          </Box>
        }
        rightActions={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={navigateBackToCompany}>
              Back
            </Button>
          </Box>
        }
      />

      {/* Main Content */}
      <Box sx={{ px: { xs: 2, md: 3 }, pt: 2, pb: 3, flex: 1, minHeight: 0, overflow: 'auto' }}>
        {/* Tab Panels */}
        <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Main column (left + center) */}
          <Grid item xs={12} md={9}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Location Details (full width of main column) */}
              <Card>
                <CardHeader 
                  title="Location Details" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <IconButton
                      size="small"
                      onClick={() => setIsEditingLocationDetails(!isEditingLocationDetails)}
                      sx={{ 
                        color: isEditingLocationDetails ? 'primary.main' : 'text.secondary',
                        '&:hover': {
                          bgcolor: 'action.hover'
                        }
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  }
                />
                <CardContent sx={{ p: 2 }}>
                  {isEditingLocationDetails ? (
                    // Edit Mode - Show Input Fields
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <TextField
                        label="Location Name"
                        defaultValue={location.name}
                        onBlur={(e) => handleFieldChange('name', e.target.value)}
                        size="small"
                        fullWidth
                      />
                      
                      <TextField
                        label="Address"
                        defaultValue={location.address}
                        onBlur={(e) => handleFieldChange('address', e.target.value)}
                        size="small"
                        fullWidth
                      />
                      
                      <Grid container spacing={2}>
                        <Grid item xs={6}>
                          <TextField
                            label="City"
                            defaultValue={location.city}
                            onBlur={(e) => handleFieldChange('city', e.target.value)}
                            size="small"
                            fullWidth
                          />
                        </Grid>
                        <Grid item xs={3}>
                          <TextField
                            label="State"
                            defaultValue={location.state}
                            onBlur={(e) => handleFieldChange('state', e.target.value)}
                            size="small"
                            fullWidth
                          />
                        </Grid>
                        <Grid item xs={3}>
                          <TextField
                            label="ZIP Code"
                            defaultValue={location.zipCode}
                            onBlur={(e) => handleFieldChange('zipCode', e.target.value)}
                            size="small"
                            fullWidth
                          />
                        </Grid>
                      </Grid>
                      
                      <TextField
                        label="Location Code"
                        defaultValue={(location as any).code || ''}
                        onBlur={(e) => handleFieldChange('code', e.target.value)}
                        size="small"
                        fullWidth
                      />
                      
                      <TextField
                        label="Phone Number"
                        defaultValue={location.phone || ''}
                        onBlur={(e) => handleFieldChange('phone', e.target.value)}
                        size="small"
                        fullWidth
                        InputProps={{ startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                      />
                      
                      <Autocomplete
                        fullWidth
                        freeSolo
                        size="small"
                        options={[
                          'Office',
                          'Warehouse',
                          'Plant',
                          'Distribution Center',
                          'Manufacturing',
                          'Retail',
                          'Branch',
                          'Headquarters',
                          'Data Center',
                          'Call Center',
                          'Research & Development',
                          'Training Center',
                          'Service Center',
                          'Showroom',
                          'Storage Facility',
                          'Hotel',
                          'Medical Clinic',
                          'Hospital',
                          'Retirement Home',
                          'Sports Arena',
                          'Sports Stadium',
                          'Golf Course',
                          'Race Track',
                          'Fairgrounds',
                          'Concert Venue',
                          'Convention Center',
                          'College',
                          'High School',
                          'Dining Hall',
                        ]}
                        value={location.type || ''}
                        onChange={(_, newValue) => {
                          if (newValue !== null && newValue !== location.type) {
                            handleFieldChange('type', newValue);
                          }
                        }}
                        onBlur={(e) => {
                          const inputValue = (e.target as HTMLInputElement).value;
                          if (inputValue && inputValue !== location.type) {
                            handleFieldChange('type', inputValue);
                          }
                        }}
                        renderInput={(params) => (
                          <TextField 
                            {...params} 
                            label="Type"
                            onBlur={(e) => {
                              const inputValue = e.target.value;
                              if (inputValue && inputValue !== location.type) {
                                handleFieldChange('type', inputValue);
                              }
                            }}
                          />
                        )}
                      />
                      
                      {companyDivisions.length > 0 && (
                        <FormControl fullWidth size="small">
                          <InputLabel>Division</InputLabel>
                          <Select
                            value={location.division || ''}
                            label="Division"
                            onChange={(e) => handleFieldChange('division', e.target.value)}
                          >
                            <MenuItem value="">
                              <em>Select a division</em>
                            </MenuItem>
                            {companyDivisions.map((division) => (
                              <MenuItem key={division} value={division}>
                                {division}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}
                    </Box>
                  ) : (
                    // View Mode - Show as Read-Only Text with Better Visual Hierarchy
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {/* Location Information Section */}
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Location Information
                        </Typography>
                        <Grid container spacing={2}>
                          {location.name && (
                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LocationIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Location Name
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                    {location.name}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {(location.address || location.city || location.state || location.zipCode) && (
                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LocationIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Address
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                                    {[location.address, location.city, location.state, location.zipCode]
                                      .filter(Boolean)
                                      .join(', ') || '-'}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {location.phone && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <PhoneIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Phone Number
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {location.phone}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {(location as any).code && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Location Code
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {(location as any).code}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {location.type && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Type
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {location.type}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {location.division && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <BusinessIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Division
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {location.division}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    </Box>
                  )}
                </CardContent>
              </Card>
              {/* Location Map (below Location Details) */}
              <Card>
                <CardHeader title="Location Map" />
                <CardContent>
                  <LocationMap location={location} />
                </CardContent>
              </Card>

              {/* Opportunities (location-scoped) */}
              <Box ref={opportunitiesSectionRef}>
                <Card>
                  <CardHeader title="Opportunities" titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }} />
                  <CardContent sx={{ p: 2 }}>
                    {locationDeals && locationDeals.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {locationDeals
                          .slice()
                          .sort((a: any, b: any) => (b.expectedRevenue || 0) - (a.expectedRevenue || 0))
                          .slice(0, 5)
                          .map((deal: any) => (
                            <Box
                              key={deal.id}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                p: 1,
                                borderRadius: 1,
                                bgcolor: 'grey.50',
                                cursor: 'pointer',
                                '&:hover': { bgcolor: 'grey.100' },
                              }}
                              onClick={() => navigate(`/crm/deals/${deal.id}`)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  navigate(`/crm/deals/${deal.id}`);
                                }
                              }}
                            >
                              <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}>
                                <BusinessIcon sx={{ fontSize: 16 }} />
                              </Avatar>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight="medium">
                                  {deal.name || deal.title || 'Unknown Deal'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {(deal.expectedRevenue ? `$${Number(deal.expectedRevenue).toLocaleString()}` : '')}
                                  {deal.stage ? ` • ${deal.stage}` : ''}
                                </Typography>
                              </Box>
                            </Box>
                          ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No location-specific opportunities
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Box>
            </Box>
          </Grid>

          {/* Right Column - Activity + Salespeople + Job Orders */}
          <Grid item xs={12} md={3}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Recent Activity (top of right column) */}
              <Card>
                <CardHeader 
                  title="Recent Activity" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  <RecentActivityWidget location={location} tenantId={tenantId} />
                </CardContent>
              </Card>

              {/* Active Salespeople */}
              <Card>
                <CardHeader 
                  title="Company Active Salespeople" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <Button size="small" disabled={rebuildingActive} onClick={async () => {
                      try {
                        setRebuildingActive(true);
                        const functions = getFunctions();
                        // Try the location-specific function first, fallback to company function
                        let fn;
                        try {
                          fn = httpsCallable(functions, 'rebuildLocationActiveSalespeople');
                          const resp: any = await fn({ tenantId, locationId });
                          const data = resp?.data || {};
                          if (data.ok) {
                            setLocalSuccess(`Active salespeople updated (${data.count ?? data.updated ?? 0})`);
                          } else if (data.error) {
                            setLocalError(`Rebuild failed: ${data.error}`);
                          } else {
                            setLocalSuccess('Rebuild requested');
                          }
                        } catch (locationError) {
                          // Fallback to company-level rebuild
                          console.log('Location-specific rebuild failed, trying company-level:', locationError);
                          fn = httpsCallable(functions, 'rebuildCompanyActiveSalespeople');
                          const resp: any = await fn({ tenantId, companyId });
                          const data = resp?.data || {};
                          if (data.ok) {
                            setLocalSuccess(`Company active salespeople updated (${data.count ?? data.updated ?? 0})`);
                          } else if (data.error) {
                            setLocalError(`Rebuild failed: ${data.error}`);
                          } else {
                            setLocalSuccess('Company rebuild requested');
                          }
                        }
                        // Light refresh - refresh both location and company data
                        try {
                          await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId!, 'locations', locationId!));
                          await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId!));
                        } catch {}
                      } catch (e) {
                        console.error('Rebuild active salespeople – error', e);
                        setLocalError('Failed to rebuild active salespeople');
                      } finally {
                        setRebuildingActive(false);
                      }
                    }}>{rebuildingActive ? 'Rebuilding…' : 'Rebuild'}</Button>
                  }
                />
                <CardContent sx={{ p: 2 }}>
                  {company?.activeSalespeople && Object.keys(company.activeSalespeople).length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {Object.values(company.activeSalespeople as any)
                        .sort((a: any, b: any) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
                        .slice(0, 5)
                        .map((sp: any) => (
                          <Box key={sp.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50' }}>
                            <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>
                              {(sp.displayName || sp.firstName || 'S').charAt(0)}
                            </Avatar>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="body2" fontWeight="medium">
                                {sp.displayName || `${sp.firstName || ''} ${sp.lastName || ''}`.trim() || sp.email || 'Unknown'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {sp.jobTitle || sp.department || ''}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No recent salesperson activity</Typography>
                  )}
                </CardContent>
              </Card>

              {/* Job Orders */}
              <Box ref={jobOrdersSectionRef}>
                <Card>
                  <CardHeader title="Job Orders" titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }} />
                  <CardContent sx={{ p: 2 }}>
                    {loadingJobOrders ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Skeleton variant="rectangular" height={32} />
                        <Skeleton variant="rectangular" height={32} />
                        <Skeleton variant="rectangular" height={32} />
                      </Box>
                    ) : jobOrders.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {jobOrders
                          .sort((a: any, b: any) => {
                            // Sort by status priority (open > draft > on_hold > filled > cancelled)
                            const statusPriority: Record<string, number> = {
                              open: 5,
                              draft: 4,
                              on_hold: 3,
                              filled: 2,
                              completed: 2,
                              cancelled: 1,
                            };
                            const aPriority = statusPriority[a.status] || 0;
                            const bPriority = statusPriority[b.status] || 0;
                            if (aPriority !== bPriority) {
                              return bPriority - aPriority;
                            }
                            // Then sort by created date (newest first)
                            const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                            const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                            return bDate.getTime() - aDate.getTime();
                          })
                          .slice(0, 5)
                          .map((jobOrder: any) => {
                            // Format status
                            const statusLabels: Record<string, string> = {
                              open: 'Open',
                              draft: 'Draft',
                              on_hold: 'On Hold',
                              filled: 'Filled',
                              completed: 'Completed',
                              cancelled: 'Cancelled',
                            };
                            const statusLabel = statusLabels[jobOrder.status] || jobOrder.status || 'Unknown';

                            // Format job order number
                            const jobOrderNumber =
                              jobOrder.jobOrderNumber || jobOrder.jobOrderSeq?.toString().padStart(4, '0') || 'N/A';

                            return (
                              <Box
                                key={jobOrder.id}
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1,
                                  p: 1,
                                  borderRadius: 1,
                                  bgcolor: 'grey.50',
                                  cursor: 'pointer',
                                  '&:hover': {
                                    bgcolor: 'grey.100',
                                  },
                                }}
                                onClick={() => navigate(`/crm/job-orders/${jobOrder.id}`)}
                                role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { 
                                if (e.key === 'Enter' || e.key === ' ') { 
                                  e.preventDefault(); 
                                  navigate(`/crm/job-orders/${jobOrder.id}`); 
                                } 
                              }}
                            >
                              <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                                <WorkIcon sx={{ fontSize: 16 }} />
                              </Avatar>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight="medium">
                                  {jobOrder.jobOrderName || jobOrder.jobTitle || 'Unknown Job Order'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  #{jobOrderNumber} • {statusLabel}
                                </Typography>
                              </Box>
                            </Box>
                          );
                        })}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No job orders for this location</Typography>
                  )}
                </CardContent>
              </Card>
            </Box>
            </Box>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Box sx={{ p: 0, pt: 2 }}>
          {/* Header with Search and Add Contact Button (match Company > Contacts) */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0, mb: 1, py: 0, px: 0, gap: 2 }}>
            <Typography variant="h6" fontWeight={700}>
              Contacts
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {/* Keep the same control footprint as Company Contacts tab; pinned to this location */}
              <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
                <Select
                  value={location?.name || ''}
                  disabled
                  displayEmpty
                  sx={{
                    height: 36,
                    fontSize: '0.875rem',
                    backgroundColor: 'white',
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
                  }}
                >
                  <MenuItem value={location?.name || ''}>
                    <em>{location?.name || 'This Location'}</em>
                  </MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 120, height: 36 }}>
                <Select
                  value={location?.state || ''}
                  disabled
                  displayEmpty
                  sx={{
                    height: 36,
                    fontSize: '0.875rem',
                    backgroundColor: 'white',
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
                  }}
                >
                  <MenuItem value={location?.state || ''}>
                    <em>{location?.state || 'State'}</em>
                  </MenuItem>
                </Select>
              </FormControl>
              <TextField
                size="small"
                variant="outlined"
                placeholder="Search by name or email..."
                value={contactsSearchQuery}
                onChange={(e) => setContactsSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                  endAdornment: contactsSearchQuery && (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setContactsSearchQuery('')} sx={{ p: 0.5 }}>
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{
                  width: 280,
                  height: 36,
                  '& .MuiOutlinedInput-root': {
                    height: 36,
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    fontSize: '0.875rem',
                    '& fieldset': { borderColor: '#E5E7EB' },
                    '&:hover fieldset': { borderColor: '#D1D5DB' },
                  },
                }}
              />
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setContactsDialogOpen(true)}>
                Add Contact
              </Button>
            </Box>
          </Box>

          {/* Error Display */}
          {contactsError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setContactsError(null)}>
              {contactsError}
            </Alert>
          )}

          {(() => {
            const base = Array.isArray(locationContacts) ? locationContacts : [];
            const q = contactsSearchQuery.trim().toLowerCase();
            let filtered = base;
            if (q) {
              filtered = filtered.filter((c: any) => {
                const name = (c.fullName || c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || '').toLowerCase();
                const email = (c.email || '').toLowerCase();
                return name.includes(q) || email.includes(q);
              });
            }

            const getSortableValue = (c: any, field: string) => {
              switch (field) {
                case 'name':
                  return (c.fullName || c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || '').toLowerCase();
                case 'location':
                  return (location?.name || '').toLowerCase();
                case 'city':
                  return ((c.city || location?.city || '') as string).toLowerCase();
                case 'state':
                  return ((c.state || location?.state || '') as string).toLowerCase();
                default:
                  return '';
              }
            };

            const sorted = filtered.slice().sort((a: any, b: any) => {
              const av = getSortableValue(a, contactsSortField);
              const bv = getSortableValue(b, contactsSortField);
              if (av < bv) return contactsSortDirection === 'asc' ? -1 : 1;
              if (av > bv) return contactsSortDirection === 'asc' ? 1 : -1;
              return 0;
            });

            const handleSort = (field: string) => {
              if (contactsSortField === field) {
                setContactsSortDirection(contactsSortDirection === 'asc' ? 'desc' : 'asc');
              } else {
                setContactsSortField(field);
                setContactsSortDirection('asc');
              }
            };

            if (sorted.length === 0) {
              return (
                <Box py={4} textAlign="center">
                  <PersonIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    {q ? 'No contacts match your search' : 'No Contacts Found'}
                  </Typography>
                  {q && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Try adjusting your search terms
                    </Typography>
                  )}
                </Box>
              );
            }

            return (
              <TableContainer
                component={Paper}
                variant="outlined"
                sx={{
                  overflowX: 'auto',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
                }}
              >
                <Table sx={{ minWidth: 1400 }}>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                      <TableCell sx={{ width: 48, borderBottom: '1px solid #E5E7EB', py: 1.5 }} />
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        <TableSortLabel
                          active={contactsSortField === 'name'}
                          direction={contactsSortField === 'name' ? contactsSortDirection : 'asc'}
                          onClick={() => handleSort('name')}
                        >
                          Name
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Title
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Email
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Phone
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        <TableSortLabel
                          active={contactsSortField === 'location'}
                          direction={contactsSortField === 'location' ? contactsSortDirection : 'asc'}
                          onClick={() => handleSort('location')}
                        >
                          Location
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        <TableSortLabel
                          active={contactsSortField === 'city'}
                          direction={contactsSortField === 'city' ? contactsSortDirection : 'asc'}
                          onClick={() => handleSort('city')}
                        >
                          City
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        <TableSortLabel
                          active={contactsSortField === 'state'}
                          direction={contactsSortField === 'state' ? contactsSortDirection : 'asc'}
                          onClick={() => handleSort('state')}
                        >
                          State
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        LinkedIn
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sorted.map((c: any) => (
                      <TableRow
                        key={c.id}
                        onClick={() => {
                          const currentParams = new URLSearchParams(window.location.search);
                          currentParams.set('tab', '1'); // Contacts tab
                          navigate(`/contacts/${c.id}?returnTo=${encodeURIComponent(window.location.pathname + '?' + currentParams.toString())}`);
                        }}
                        sx={{
                          height: '48px',
                          cursor: 'pointer',
                          '&:hover': { backgroundColor: '#F9FAFB' },
                        }}
                      >
                        <TableCell sx={{ py: 1, px: 1, width: 48 }} onClick={(e) => e.stopPropagation()}>
                          <FavoriteButton
                            itemId={c.id}
                            favoriteType="contacts"
                            isFavorite={isFavorite}
                            toggleFavorite={toggleFavorite}
                            size="small"
                            showTooltip={true}
                          />
                        </TableCell>
                        <TableCell sx={{ py: 1, px: 2 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Avatar
                              src={c.avatar}
                              sx={{
                                width: 36,
                                height: 36,
                                fontWeight: 600,
                                fontSize: '0.875rem',
                                ...(c.avatar ? {} : getAvatarColor(c.fullName || c.name || c.firstName || c.lastName || 'Unknown')),
                              }}
                            >
                              {!c.avatar && getInitials(c.fullName || c.name || c.firstName || c.lastName || 'Unknown')}
                            </Avatar>
                            <Typography sx={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>
                              {c.fullName || c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed Contact'}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ color: '#374151', fontSize: '0.875rem' }}>
                            {c.jobTitle || c.title || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ color: '#374151', fontSize: '0.875rem' }}>
                            {c.email || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ color: '#374151', fontSize: '0.875rem' }}>
                            {c.phone || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ color: '#374151', fontSize: '0.875rem' }}>
                            {location?.name || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ color: '#374151', fontSize: '0.875rem' }}>
                            {c.city || location?.city || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ color: '#374151', fontSize: '0.875rem' }}>
                            {c.state || location?.state || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          {(() => {
                            const linkedinUrl = c.linkedinUrl || c.linkedin || c.linkedInUrl || c.linkedIn;
                            if (linkedinUrl) {
                              return (
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(linkedinUrl, '_blank');
                                  }}
                                  color="primary"
                                  title="Open LinkedIn Profile"
                                  sx={{ fontSize: 16, color: '#0077B5' }}
                                >
                                  <LinkedInIcon />
                                </IconButton>
                              );
                            }
                            return (
                              <Typography sx={{ color: '#9CA3AF', fontSize: '0.875rem' }}>
                                -
                              </Typography>
                            );
                          })()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            );
          })()}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <CRMNotesTab
          entityId={location.id}
          entityType="location"
          entityName={`${company?.name || ''} - ${location.name}`.trim()}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <LocationActivityTab location={location} tenantId={tenantId} companyId={companyId!} />
      </TabPanel>

      {/* Add Note Dialog */}
      <AddNoteDialog
        open={showAddNoteDialog}
        onClose={() => setShowAddNoteDialog(false)}
        entityId={location.id}
        entityType="location"
        entityName={`${company?.name || ''} - ${location.name}`.trim()}
        tenantId={tenantId}
        contacts={locationContacts.map((c: any) => ({
          id: c.id,
          fullName: c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown Contact',
          email: c.email || '',
          title: c.jobTitle || c.title || ''
        }))}
      />

      {/* Add Contact Dialog (preselect Company + Location) */}
      <Dialog open={contactsDialogOpen} onClose={() => setContactsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add New Contact</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Company"
                value={company?.companyName || company?.name || ''}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Location"
                value={location?.name || ''}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First Name"
                value={contactForm.firstName}
                onChange={(e) => setContactForm((p) => ({ ...p, firstName: e.target.value }))}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last Name"
                value={contactForm.lastName}
                onChange={(e) => setContactForm((p) => ({ ...p, lastName: e.target.value }))}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Phone"
                value={contactForm.phone}
                onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Job Title"
                value={contactForm.jobTitle}
                onChange={(e) => setContactForm((p) => ({ ...p, jobTitle: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="LinkedIn URL"
                placeholder="https://www.linkedin.com/in/username"
                value={contactForm.linkedInUrl}
                onChange={(e) => setContactForm((p) => ({ ...p, linkedInUrl: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Contact Type</InputLabel>
                <Select
                  value={contactForm.contactType}
                  label="Contact Type"
                  onChange={(e) => setContactForm((p) => ({ ...p, contactType: String(e.target.value) }))}
                >
                  <MenuItem value="Decision Maker">Decision Maker</MenuItem>
                  <MenuItem value="Influencer">Influencer</MenuItem>
                  <MenuItem value="Gatekeeper">Gatekeeper</MenuItem>
                  <MenuItem value="Referrer">Referrer</MenuItem>
                  <MenuItem value="Evaluator">Evaluator</MenuItem>
                  <MenuItem value="Unknown">Unknown</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                <Typography variant="body2" color="text.secondary">
                  Active Contact is set automatically.
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={3}
                value={contactForm.notes}
                onChange={(e) => setContactForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info">
                <Typography variant="body2">
                  This contact will be automatically associated with{' '}
                  <strong>{company?.companyName || company?.name || 'Company'}</strong>
                  {' '}and{' '}
                  <strong>{location?.name || 'this location'}</strong>.
                </Typography>
              </Alert>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContactsDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!tenantId || !companyId || !locationId) return;
              if (!contactForm.firstName || !contactForm.lastName) {
                setContactsError('First name and last name are required');
                return;
              }
              setSavingContact(true);
              setContactsError(null);
              try {
                const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
                const { db } = await import('../../firebase');

                const contactData: any = {
                  firstName: contactForm.firstName,
                  lastName: contactForm.lastName,
                  email: contactForm.email,
                  phone: contactForm.phone,
                  jobTitle: contactForm.jobTitle,
                  linkedInUrl: (contactForm.linkedInUrl || '').trim(),
                  contactType: contactForm.contactType,
                  tags: [],
                  isActive: true,
                  notes: contactForm.notes,
                  fullName: `${contactForm.firstName} ${contactForm.lastName}`.trim(),
                  tenantId,
                  companyId,
                  companyName: company?.companyName || company?.name || '',
                  locationId,
                  locationName: location?.name || '',
                  associations: {
                    companies: [companyId],
                    locations: [locationId],
                  },
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                  salesOwnerId: currentUser?.uid || null,
                  accountOwnerId: currentUser?.uid || null,
                };

                const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
                const docRef = await addDoc(contactsRef, contactData);

                // Update list immediately so the new contact appears without refresh
                setLocationContacts((prev) => [
                  { id: docRef.id, ...contactData, createdAt: new Date(), updatedAt: new Date() },
                  ...(Array.isArray(prev) ? prev : []),
                ]);

                setContactForm({
                  firstName: '',
                  lastName: '',
                  email: '',
                  phone: '',
                  jobTitle: '',
                  linkedInUrl: '',
                  contactType: 'Unknown',
                  tags: [],
                  isActive: true,
                  notes: '',
                });
                setContactsDialogOpen(false);
                setContactsSuccessMessage('Contact added successfully!');
                setContactsSuccess(true);
              } catch (e: any) {
                console.error('Error adding contact:', e);
                setContactsError(e?.message || 'Failed to add contact');
              } finally {
                setSavingContact(false);
              }
            }}
            variant="contained"
            disabled={savingContact || !contactForm.firstName || !contactForm.lastName}
            startIcon={savingContact ? <CircularProgress size={16} /> : null}
          >
            {savingContact ? 'Saving...' : 'Save Contact'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Contacts success snackbar */}
      <Snackbar open={contactsSuccess} autoHideDuration={6000} onClose={() => setContactsSuccess(false)}>
        <Alert onClose={() => setContactsSuccess(false)} severity="success">
          {contactsSuccessMessage}
        </Alert>
      </Snackbar>

      {/* Create Task Dialog */}
      {showCreateTaskDialog && (
        <CreateTaskDialog
          open={showCreateTaskDialog}
          onClose={() => setShowCreateTaskDialog(false)}
          loading={taskSubmitting}
          currentUserId={currentUser?.uid || ''}
          contacts={locationContacts}
          salespeople={[]}
          prefilledData={{
            assignedTo: currentUser?.uid || '',
            associations: {
              companies: companyId ? [companyId] : [],
              locations: locationId ? [locationId] : [],
              contacts: locationContacts.map((c: any) => c.id).filter(Boolean),
              deals: [],
              salespeople: currentUser?.uid ? [currentUser.uid] : [],
            },
          }}
          onSubmit={async (taskData) => {
            if (!tenantId || taskSubmitting) return;
            setTaskSubmitting(true);
            try {
              const { TaskService } = await import('../../utils/taskService');
              const taskService = TaskService.getInstance();

              const assignedTo = currentUser?.uid
                || (Array.isArray((taskData as any).assignedTo) ? (taskData as any).assignedTo[0] : (taskData as any).assignedTo)
                || '';

              await taskService.createTask({
                ...(taskData as any),
                tenantId,
                createdBy: currentUser?.uid || '',
                assignedTo,
                associations: {
                  ...(taskData as any).associations,
                  companies: companyId ? [companyId] : [],
                  locations: locationId ? [locationId] : [],
                  contacts: locationContacts.map((c: any) => c.id).filter(Boolean),
                },
              });
            } catch (e) {
              console.error('Error creating task:', e);
            } finally {
              setTaskSubmitting(false);
              setShowCreateTaskDialog(false);
            }
          }}
        />
      )}

      {/* Delete Contact Button - Bottom of page */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        mt: 9,
        pb: 3 
      }}>
        <Button 
          variant="outlined" 
          color="error"
          sx={{ 
            borderColor: 'error.main',
            '&:hover': {
              borderColor: 'error.dark',
              backgroundColor: 'error.light'
            }
          }}
          startIcon={<DeleteIcon />}
          onClick={() => setDeleteDialogOpen(true)}
        >
          Delete Location
        </Button>
      </Box>

      {/* Local snackbars for rebuild feedback */}
      <Snackbar open={!!localSuccess} autoHideDuration={3000} onClose={() => setLocalSuccess(null)}>
        <Alert severity="success" onClose={() => setLocalSuccess(null)} sx={{ width: '100%' }}>
          {localSuccess}
        </Alert>
      </Snackbar>
      <Snackbar open={!!localError} autoHideDuration={4000} onClose={() => setLocalError(null)}>
        <Alert severity="error" onClose={() => setLocalError(null)} sx={{ width: '100%' }}>
          {localError}
        </Alert>
      </Snackbar>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">Confirm Deletion</DialogTitle>
        <DialogContent>
          <Typography id="delete-dialog-description">
            Are you sure you want to delete this location? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} color="primary">
            Cancel
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
      </Box>
    </Box>
  );
};

export default LocationDetails; 