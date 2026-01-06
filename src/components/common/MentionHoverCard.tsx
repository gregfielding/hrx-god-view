/**
 * MentionHoverCard Component
 * 
 * Shows a hover card with entity information when hovering over a mention.
 */

import React, { useState, useEffect } from 'react';
import { Popper, Paper, Typography, Box, Avatar, CircularProgress, Link } from '@mui/material';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate } from 'react-router-dom';
import type { Mention } from '../../types/crossSystemMentions';
import PersonIcon from '@mui/icons-material/Person';
import BusinessIcon from '@mui/icons-material/Business';
import HandshakeIcon from '@mui/icons-material/Handshake';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import WorkIcon from '@mui/icons-material/Work';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import TaskIcon from '@mui/icons-material/Task';

interface MentionHoverCardProps {
  mention: Mention;
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}

interface EntityInfo {
  name: string;
  subtitle?: string;
  avatarUrl?: string;
  email?: string;
  phone?: string;
  location?: string;
}

export const MentionHoverCard: React.FC<MentionHoverCardProps> = ({
  mention,
  anchorEl,
  open,
  onClose,
}) => {
  const navigate = useNavigate();
  const [entityInfo, setEntityInfo] = useState<EntityInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !mention) {
      return;
    }

    const fetchEntityInfo = async () => {
      setLoading(true);
      try {
        let info: EntityInfo | null = null;

        switch (mention.type) {
          case 'user': {
            const userDoc = await getDoc(doc(db, 'users', mention.id));
            if (userDoc.exists()) {
              const data = userDoc.data();
              info = {
                name: data.displayName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || mention.label,
                subtitle: data.email || data.jobTitle || undefined,
                avatarUrl: data.avatar || data.avatarUrl,
                email: data.email,
                phone: data.phone,
                location: data.city && data.state ? `${data.city}, ${data.state}` : data.city || data.state || undefined,
              };
            }
            break;
          }
          case 'contact': {
            // Need tenantId for contact lookup - we'll use activeTenant from context
            // For now, try to find it from the mention context or use a global search
            const tenantId = (window as any).__activeTenantId || '';
            if (tenantId) {
              const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', mention.id));
              if (contactDoc.exists()) {
                const data = contactDoc.data();
                info = {
                  name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || mention.label,
                  subtitle: data.jobTitle || data.companyName || data.email || undefined,
                  avatarUrl: data.avatar,
                  email: data.email,
                  phone: data.phone,
                  location: data.city && data.state ? `${data.city}, ${data.state}` : data.city || data.state || undefined,
                };
              }
            }
            break;
          }
          case 'company': {
            const tenantId = (window as any).__activeTenantId || '';
            if (tenantId) {
              const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', mention.id));
              if (companyDoc.exists()) {
                const data = companyDoc.data();
                info = {
                  name: data.companyName || data.name || mention.label,
                  subtitle: data.domain || data.industry || undefined,
                  avatarUrl: data.logo,
                  location: data.city && data.state ? `${data.city}, ${data.state}` : data.city || data.state || undefined,
                };
              }
            }
            break;
          }
          case 'deal': {
            const tenantId = (window as any).__activeTenantId || '';
            if (tenantId) {
              const dealDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_deals', mention.id));
              if (dealDoc.exists()) {
                const data = dealDoc.data();
                info = {
                  name: data.dealName || data.name || mention.label,
                  subtitle: data.companyName || data.stage || data.value ? `$${data.value}` : undefined,
                };
              }
            }
            break;
          }
          case 'job': {
            const tenantId = (window as any).__activeTenantId || '';
            if (tenantId) {
              const jobDoc = await getDoc(doc(db, 'tenants', tenantId, 'jobOrders', mention.id));
              if (jobDoc.exists()) {
                const data = jobDoc.data();
                info = {
                  name: data.jobTitle || data.title || mention.label,
                  subtitle: data.companyName || data.location || data.status || undefined,
                };
              }
            }
            break;
          }
          case 'candidate': {
            const tenantId = (window as any).__activeTenantId || '';
            if (tenantId) {
              const candidateDoc = await getDoc(doc(db, 'tenants', tenantId, 'candidates', mention.id));
              if (candidateDoc.exists()) {
                const data = candidateDoc.data();
                info = {
                  name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || mention.label,
                  subtitle: data.jobTitle || data.email || data.status || undefined,
                  avatarUrl: data.avatar || data.avatarUrl,
                  email: data.email,
                  phone: data.phone,
                };
              }
            }
            break;
          }
          case 'location': {
            const tenantId = (window as any).__activeTenantId || '';
            if (tenantId) {
              const locationDoc = await getDoc(doc(db, 'tenants', tenantId, 'locations', mention.id));
              if (locationDoc.exists()) {
                const data = locationDoc.data();
                info = {
                  name: data.name || data.locationName || mention.label,
                  subtitle: data.address || data.city && data.state ? `${data.city}, ${data.state}` : undefined,
                  location: data.address || (data.city && data.state ? `${data.city}, ${data.state}` : data.city || data.state || undefined),
                };
              }
            }
            break;
          }
          case 'task': {
            const tenantId = (window as any).__activeTenantId || '';
            if (tenantId) {
              const taskDoc = await getDoc(doc(db, 'tenants', tenantId, 'tasks', mention.id));
              if (taskDoc.exists()) {
                const data = taskDoc.data();
                info = {
                  name: data.title || data.name || mention.label,
                  subtitle: data.status || data.priority || data.category || undefined,
                };
              }
            }
            break;
          }
        }

        setEntityInfo(info || { name: mention.label });
      } catch (error) {
        console.error('Error fetching entity info for mention:', error);
        setEntityInfo({ name: mention.label });
      } finally {
        setLoading(false);
      }
    };

    // Debounce the fetch slightly to avoid rapid requests
    const timer = setTimeout(fetchEntityInfo, 300);
    return () => clearTimeout(timer);
  }, [open, mention]);

  const getIcon = () => {
    switch (mention.type) {
      case 'user':
        return <AlternateEmailIcon fontSize="small" />;
      case 'contact':
        return <PersonIcon fontSize="small" />;
      case 'company':
        return <BusinessIcon fontSize="small" />;
      case 'deal':
        return <HandshakeIcon fontSize="small" />;
      case 'job':
        return <WorkIcon fontSize="small" />;
      case 'candidate':
        return <PersonSearchIcon fontSize="small" />;
      case 'location':
        return <LocationOnIcon fontSize="small" />;
      case 'task':
        return <TaskIcon fontSize="small" />;
    }
  };

  const getUrl = () => {
    switch (mention.type) {
      case 'user':
        return `/users/${mention.id}`;
      case 'contact':
        return `/crm/contacts/${mention.id}`;
      case 'company':
        return `/crm/companies/${mention.id}`;
      case 'deal':
        return `/crm/deals/${mention.id}`;
      case 'job':
        return `/recruiter/job-orders/${mention.id}`;
      case 'candidate':
        return `/recruiter/candidates/${mention.id}`;
      case 'location':
        return `/crm/locations/${mention.id}`;
      case 'task':
        return `/tasks/${mention.id}`;
    }
  };

  if (!open || !anchorEl) {
    return null;
  }

  return (
    <Popper
      open={open}
      anchorEl={anchorEl}
      placement="top"
      onMouseLeave={onClose}
      sx={{ zIndex: 1300 }}
    >
      <Paper
        elevation={8}
        sx={{
          p: 2,
          minWidth: 250,
          maxWidth: 350,
          borderRadius: 2,
          boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.15)',
        }}
        onMouseEnter={(e) => e.stopPropagation()}
      >
        {loading ? (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        ) : entityInfo ? (
          <Box>
            <Box display="flex" alignItems="center" gap={1.5} mb={1.5}>
              <Avatar
                src={entityInfo.avatarUrl}
                sx={{
                  width: 48,
                  height: 48,
                  bgcolor: 'primary.light',
                }}
              >
                {getIcon()}
              </Avatar>
              <Box flex={1} minWidth={0}>
                <Typography variant="subtitle1" fontWeight={600} noWrap>
                  {entityInfo.name}
                </Typography>
                {entityInfo.subtitle && (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {entityInfo.subtitle}
                  </Typography>
                )}
              </Box>
            </Box>
            {(entityInfo.email || entityInfo.phone || entityInfo.location) && (
              <Box sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                {entityInfo.email && (
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>
                    📧 {entityInfo.email}
                  </Typography>
                )}
                {entityInfo.phone && (
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>
                    📞 {entityInfo.phone}
                  </Typography>
                )}
                {entityInfo.location && (
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>
                    📍 {entityInfo.location}
                  </Typography>
                )}
              </Box>
            )}
            <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
              <Link
                href={getUrl()}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(getUrl());
                  onClose();
                }}
                sx={{
                  fontSize: '0.75rem',
                  textDecoration: 'none',
                  color: 'primary.main',
                  fontWeight: 500,
                  '&:hover': {
                    textDecoration: 'underline',
                  },
                }}
              >
                View {mention.type === 'user' ? 'Profile' : mention.type === 'contact' ? 'Contact' : mention.type === 'company' ? 'Company' : 'Deal'} →
              </Link>
            </Box>
          </Box>
        ) : (
          <Typography variant="body2">{mention.label}</Typography>
        )}
      </Paper>
    </Popper>
  );
};

