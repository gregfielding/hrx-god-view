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
  Breadcrumbs,
  Link as MUILink,
  Paper,
  Tabs,
  Tab,
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
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Language as LanguageIcon,
  LinkedIn as LinkedInIcon,
  Work as WorkIcon,
  Facebook as FacebookIcon,
  Dashboard as DashboardIcon,
  Notes as NotesIcon,
  Timeline as TimelineIcon,
  Phone as PhoneIcon,
  Event as EventIcon,
  Email as EmailIcon,
  AttachMoney as DealIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { GoogleMap } from '@react-google-maps/api';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import AddNoteDialog from '../../components/AddNoteDialog';
import CRMNotesTab from '../../components/CRMNotesTab';
import ActivityLogTab from '../../components/ActivityLogTab';

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
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const markerClickRef = useRef<google.maps.MapsEventListener | null>(null);
  
  // Fallback center (Las Vegas area based on the image)
  const fallbackCenter = { lat: 36.1699, lng: -115.1398 };

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

  // Create/update plain JS marker once the map and center are ready
  useEffect(() => {
    const g = (window as any).google as typeof google | undefined;
    if (!g || !mapInstance || !center) return;
    // Marker
    if (!markerRef.current) {
      markerRef.current = new g.maps.Marker({
        position: center,
        map: mapInstance,
        title: location.name || 'Location',
        zIndex: 999999,
        icon: {
          url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
          scaledSize: new g.maps.Size(40, 40),
        },
      });
      console.log('Plain JS marker created:', markerRef.current.getPosition()?.toUrlValue());
    } else {
      const pos = markerRef.current.getPosition();
      const lat = pos?.lat();
      const lng = pos?.lng();
      if (lat !== center.lat || lng !== center.lng) {
        markerRef.current.setPosition(center);
      }
      if (!markerRef.current.getMap()) markerRef.current.setMap(mapInstance);
    }
    // (Re)attach click listener to recenter map when pin is clicked
    if (markerClickRef.current) {
      markerClickRef.current.remove();
      markerClickRef.current = null;
    }
    markerClickRef.current = markerRef.current.addListener('click', () => {
      try {
        mapInstance.panTo(center);
        const currentZoom = mapInstance.getZoom() || 12;
        if (currentZoom < 14) mapInstance.setZoom(14);
      } catch {}
    });
  }, [mapInstance, center, location.name]);

  if (!(window as any).google) {
    return (
      <Box sx={{ height: 360, bgcolor: 'grey.100', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!center) {
    console.log('LocationMap: No center found, using fallback');
    return (
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '360px' }}
        center={fallbackCenter}
        zoom={12}
      >
      </GoogleMap>
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
      href = `/crm/contacts/${contactId}`;
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
  const { tenantId } = useAuth();
  
  const [location, setLocation] = useState<LocationData | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [locationContacts, setLocationContacts] = useState<any[]>([]);
  const [locationDeals, setLocationDeals] = useState<any[]>([]);
  const [companyDivisions, setCompanyDivisions] = useState<string[]>([]);
  const [rebuildingActive, setRebuildingActive] = useState(false);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        
      } catch (err: any) {
        console.error('Error loading location data:', err);
        setError(err.message || 'Failed to load location data');
      } finally {
        setLoading(false);
      }
    };

    loadLocationData();
  }, [companyId, locationId, tenantId]);



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

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
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
    <Box sx={{ p: 0 }}>
      {/* Breadcrumbs */}
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs aria-label="breadcrumb">
          <MUILink underline="hover" color="inherit" href="/crm" onClick={(e) => { e.preventDefault(); navigate('/crm'); }}>
            CRM
          </MUILink>
          <MUILink underline="hover" color="inherit" href="/companies" onClick={(e) => { e.preventDefault(); navigate('/crm?tab=companies'); }}>
            Companies
          </MUILink>
          <MUILink underline="hover" color="inherit" href={`/crm/companies/${companyId}`} onClick={(e) => { e.preventDefault(); navigate(`/crm/companies/${companyId}`); }}>
            {company?.companyName || company?.name || 'Company'}
          </MUILink>
          <Typography color="text.primary">{location.name}</Typography>
        </Breadcrumbs>
      </Box>

      {/* Enhanced Header - Persistent Location Information */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Company Logo/Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={company?.logo}
                alt={company?.companyName || company?.name}
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: 'primary.main',
                  fontSize: '2rem',
                  fontWeight: 'bold'
                }}
              >
                {(company?.companyName || company?.name || 'C').charAt(0).toUpperCase()}
              </Avatar>
            </Box>

            {/* Location Information */}
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                    {location.name}
                  </Typography>
                </Box>
                
                {/* Location Type */}
                <Chip
                  label={location.type}
                  size="medium"
                  sx={{
                    bgcolor: 'primary.50',
                    color: 'text.primary',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                    height: 28,
                    maxWidth: 'fit-content',
                    my: 0.5,
                    '& .MuiChip-label': {
                      px: 1,
                      py: 0.5
                    }
                  }}
                />
                
                {/* Company Name */}
                <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <BusinessIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                  <MUILink
                    underline="hover"
                    color="primary"
                    href={`/crm/companies/${companyId}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/crm/companies/${companyId}`);
                    }}
                    sx={{ cursor: 'pointer', fontWeight: 'normal' }}
                  >
                    {company?.companyName || company?.name}
                  </MUILink>
                </Typography>

              {/* Location Phone Number */}
              {location.phone && (
                <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <PhoneIcon sx={{ fontSize: 16 }} />
                  {location.phone}
                </Typography>
              )}

              {/* Location Address */}
              {(location.address || location.city || location.state) && (
                <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationIcon sx={{ fontSize: 16 }} />
                  {[
                    location.address,
                    location.city,
                    location.state,
                    location.zipCode
                  ].filter(Boolean).join(', ')}
                </Typography>
              )}

              {/* Company Social Media Icons */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0 }}>
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company?.website ? 'primary.main' : 'text.disabled',
                    bgcolor: company?.website ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company?.website ? 'primary.dark' : 'text.disabled',
                      bgcolor: company?.website ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company?.website) {
                      let url = company.website;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company?.website ? 'Visit Website' : 'Add Website URL'}
                >
                  <LanguageIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company?.linkedin ? 'primary.main' : 'text.disabled',
                    bgcolor: company?.linkedin ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company?.linkedin ? 'primary.dark' : 'text.disabled',
                      bgcolor: company?.linkedin ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company?.linkedin) {
                      let url = company.linkedin;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company?.linkedin ? 'Open LinkedIn' : 'Add LinkedIn URL'}
                >
                  <LinkedInIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company?.indeed ? 'primary.main' : 'text.disabled',
                    bgcolor: company?.indeed ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company?.indeed ? 'primary.dark' : 'text.disabled',
                      bgcolor: company?.indeed ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company?.indeed) {
                      let url = company.indeed;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company?.indeed ? 'View Jobs on Indeed' : 'Add Indeed URL'}
                >
                  <WorkIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company?.facebook ? 'primary.main' : 'text.disabled',
                    bgcolor: company?.facebook ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company?.facebook ? 'primary.dark' : 'text.disabled',
                      bgcolor: company?.facebook ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company?.facebook) {
                      let url = company.facebook;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company?.facebook ? 'View Facebook Page' : 'Add Facebook URL'}
                >
                  <FacebookIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Box>


            </Box>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button 
              variant="outlined" 
              startIcon={<AddIcon />}
              onClick={() => setShowAddNoteDialog(true)}
              size="small"
            >
              Add Note
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Tabs Navigation */}
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 1 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Location details tabs"
        >
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DashboardIcon fontSize="small" />
                Dashboard
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <NotesIcon fontSize="small" />
                Notes
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TimelineIcon fontSize="small" />
                Activity
              </Box>
            } 
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
            <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Left Column - Location Details */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Location Details */}
              <SectionCard title="Location Details">
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
                    label="Phone Number"
                    defaultValue={location.phone || ''}
                    onBlur={(e) => handleFieldChange('phone', e.target.value)}
                    size="small"
                    fullWidth
                    InputProps={{ startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                  />
                  
                  <FormControl fullWidth size="small">
                    <InputLabel>Type</InputLabel>
                    <Select
                      value={location.type || ''}
                      label="Type"
                      onChange={(e) => handleFieldChange('type', e.target.value)}
                    >
                      <MenuItem value="Office">Office</MenuItem>
                      <MenuItem value="Warehouse">Warehouse</MenuItem>
                      <MenuItem value="Plant">Plant</MenuItem>
                      <MenuItem value="Distribution Center">Distribution Center</MenuItem>
                      <MenuItem value="Manufacturing">Manufacturing</MenuItem>
                      <MenuItem value="Retail">Retail</MenuItem>
                      <MenuItem value="Branch">Branch</MenuItem>
                      <MenuItem value="Headquarters">Headquarters</MenuItem>
                      <MenuItem value="Data Center">Data Center</MenuItem>
                      <MenuItem value="Call Center">Call Center</MenuItem>
                      <MenuItem value="Research & Development">Research & Development</MenuItem>
                      <MenuItem value="Training Center">Training Center</MenuItem>
                      <MenuItem value="Service Center">Service Center</MenuItem>
                      <MenuItem value="Showroom">Showroom</MenuItem>
                      <MenuItem value="Storage Facility">Storage Facility</MenuItem>
                      <MenuItem value="Hotel">Hotel</MenuItem>
                      <MenuItem value="Medical Clinic">Medical Clinic</MenuItem>
                      <MenuItem value="Hospital">Hospital</MenuItem>
                      <MenuItem value="Retirement Home">Retirement Home</MenuItem>
                    </Select>
                  </FormControl>
                  
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
              </SectionCard>
            </Box>
          </Grid>

          {/* Center Column - Location Intelligence */}
          <Grid item xs={12} md={5}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Recent Activity */}
              <Card>
                <CardHeader 
                  title="Recent Activity" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  <RecentActivityWidget location={location} tenantId={tenantId} />
                </CardContent>
              </Card>

              {/* Location Map */}
              <Card>
                <CardHeader title="Location Map" />
                <CardContent>
                  <LocationMap location={location} />
                </CardContent>
              </Card>


            </Box>
          </Grid>

          {/* Right Column - Opportunities + Contacts + Salespeople */}
          <Grid item xs={12} md={3}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Opportunities (location-scoped) */}
              <Card>
                <CardHeader 
                  title="Opportunities" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
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
                              cursor: 'pointer' 
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
                                {(deal.expectedRevenue ? `$${Number(deal.expectedRevenue).toLocaleString()}` : '')}{deal.stage ? ` • ${deal.stage}` : ''}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No location-specific opportunities</Typography>
                  )}
                </CardContent>
              </Card>

              {/* Contacts at this Location */}
              <Card>
                <CardHeader 
                  title="Contacts at this Location" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {locationContacts && locationContacts.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {locationContacts.slice(0, 5).map((c: any) => (
                        <Box
                          key={c.id}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                          onClick={() => navigate(`/crm/contacts/${c.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/crm/contacts/${c.id}`); } }}
                        >
                          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                            {c.firstName?.charAt(0) || c.name?.charAt(0) || 'C'}
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown Contact'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {c.jobTitle || c.title || ''}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No contacts associated to this location</Typography>
                  )}
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
            </Box>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <CRMNotesTab
          entityId={location.id}
          entityType="location"
          entityName={`${company?.name || ''} - ${location.name}`.trim()}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
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
  );
};

export default LocationDetails; 