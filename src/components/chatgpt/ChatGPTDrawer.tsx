/**
 * ChatGPT Drawer Component
 * 
 * Drawer container for ChatGPT functionality.
 * Can display general chat or scoped chat (e.g., Sales Coach for a contact).
 */

import React, { useEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { doc, getDoc } from 'firebase/firestore';
import { useChatGPT } from '../../contexts/ChatGPTContext';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import AIAssistantChat from '../AIAssistantChat';
import SalesCoach from '../SalesCoach';

const ChatGPTDrawer: React.FC = () => {
  const {
    isOpen,
    scope,
    closeChatGPT,
    setScope,
  } = useChatGPT();
  const { user, tenantId } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const location = useLocation();
  const params = useParams();

  const drawerRef = useRef<HTMLDivElement>(null);

  // Auto-detect scope from current route when drawer opens
  useEffect(() => {
    let cancelled = false;
    if (isOpen && (!scope || scope.type === 'general')) {
      // Check if we're on a contact/company/deal detail page
      const path = location.pathname;

      const contactIdFromPath =
        params.contactId ||
        (path.match(/^\/(?:crm\/)?contacts\/([^/]+)/)?.[1] ?? null) ||
        (path.match(/^\/contacts\/([^/]+)/)?.[1] ?? null);

      const companyIdFromPath =
        params.companyId ||
        (path.match(/^\/crm\/companies\/([^/]+)/)?.[1] ?? null) ||
        (path.match(/^\/companies\/([^/]+)/)?.[1] ?? null);

      const dealIdFromPath =
        params.dealId ||
        (path.match(/^\/crm\/deals\/([^/]+)/)?.[1] ?? null) ||
        (path.match(/^\/deals\/([^/]+)/)?.[1] ?? null);

      const normalizeAssocIds = (value: any): string[] => {
        if (!Array.isArray(value)) return [];
        return value
          .map((v: any) => (typeof v === 'string' ? v : v?.id))
          .filter(Boolean);
      };

      if (contactIdFromPath && tenantId) {
        // We're on a contact detail page - fetch contact and set scope
        const contactId = contactIdFromPath;
        const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
        getDoc(contactRef)
          .then((contactSnap) => {
            if (!contactSnap.exists() || cancelled) return;
            const contactData = contactSnap.data() as any;
            const contactName = contactData.fullName || contactData.firstName || contactData.lastName || 'Contact';
            console.log('[ChatGPTDrawer] Auto-detected contact page, setting scope:', contactName);
            setScope({
              type: 'sales_coach',
              entityType: 'contact',
              entityId: contactId,
              entityName: contactName,
              tenantId: tenantId,
              contactCompany: contactData.companyName || contactData.company?.name,
              contactTitle: contactData.jobTitle || contactData.title,
              associations: {
                contacts: [{ id: contactId, ...contactData }],
              },
            });
          })
          .catch((err) => {
            console.error('[ChatGPTDrawer] Error fetching contact:', err);
          });
      } else if (companyIdFromPath && tenantId) {
        // We're on a company detail page
        const companyId = companyIdFromPath;
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
        getDoc(companyRef)
          .then((companySnap) => {
            if (!companySnap.exists() || cancelled) return;
            const companyData = companySnap.data() as any;
            const companyName = companyData.companyName || companyData.name || 'Company';
            console.log('[ChatGPTDrawer] Auto-detected company page, setting scope:', companyName);
            setScope({
              type: 'sales_coach',
              entityType: 'company',
              entityId: companyId,
              entityName: companyName,
              tenantId: tenantId,
              associations: {
                companies: [{ id: companyId, ...companyData }],
              },
            });
          })
          .catch((err) => {
            console.error('[ChatGPTDrawer] Error fetching company:', err);
          });
      } else if (dealIdFromPath && tenantId) {
        // We're on a deal detail page
        const dealId = dealIdFromPath;
        const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
        (async () => {
          try {
            const dealSnap = await getDoc(dealRef);
            if (!dealSnap.exists() || cancelled) return;

            const dealData = dealSnap.data() as any;
            const dealName = dealData.name || 'Deal';

            // Try to load company + contacts for richer Sales Coach context (best-effort)
            const companyId =
              dealData.companyId ||
              dealData.primaryCompanyId ||
              normalizeAssocIds(dealData.associations?.companies)[0] ||
              null;

            const contactIds = normalizeAssocIds(dealData.associations?.contacts).slice(0, 10);
            const salespersonIds = normalizeAssocIds(dealData.associations?.salespeople).slice(0, 10);

            const [companySnap, contactSnaps, salespersonSnaps] = await Promise.all([
              companyId ? getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId)) : Promise.resolve(null as any),
              Promise.all(
                contactIds.map(async (id) => {
                  const snap = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', id));
                  return snap.exists() ? ({ id, ...(snap.data() as any) } as any) : null;
                })
              ),
              Promise.all(
                salespersonIds.map(async (id) => {
                  // Salespeople are typically in root users collection
                  const snap = await getDoc(doc(db, 'users', id));
                  if (snap.exists()) return ({ id, ...(snap.data() as any) } as any);
                  // Fallback to tenant users if needed
                  const snap2 = await getDoc(doc(db, 'tenants', tenantId, 'users', id));
                  return snap2.exists() ? ({ id, ...(snap2.data() as any) } as any) : null;
                })
              ),
            ]);

            if (cancelled) return;

            const company =
              companySnap && typeof companySnap.exists === 'function' && companySnap.exists()
                ? ({ id: companyId, ...(companySnap.data() as any) } as any)
                : null;

            console.log('[ChatGPTDrawer] Auto-detected deal page, setting Sales Coach scope:', dealName);
            setScope({
              type: 'sales_coach',
              entityType: 'deal',
              entityId: dealId,
              entityName: dealName,
              tenantId: tenantId,
              dealStage: dealData.stage,
              associations: {
                deals: [{ id: dealId, ...dealData }],
                companies: company ? [company] : [],
                contacts: contactSnaps.filter(Boolean),
                salespeople: salespersonSnaps.filter(Boolean),
                locations: [], // (optional) can be added later if needed
              },
            });
          } catch (err) {
            console.error('[ChatGPTDrawer] Error fetching deal/company/contacts for Sales Coach:', err);
          }
        })();
      } else {
        // Not on a detail page, set to general
        setScope({ type: 'general' });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, location.pathname, params, tenantId, scope, setScope]);

  // Determine what to show based on scope
  const isSalesCoach = scope?.type === 'sales_coach' && scope.entityId && scope.entityType;
  const isGeneral = !scope || scope.type === 'general';

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC closes drawer
      if (e.key === 'Escape' && isOpen) {
        closeChatGPT();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeChatGPT]);

  // Debug: Log scope for troubleshooting
  useEffect(() => {
    if (isOpen && scope) {
      console.log('[ChatGPTDrawer] Scope:', scope, 'isSalesCoach:', isSalesCoach, 'entityName:', scope.entityName);
    }
  }, [isOpen, scope, isSalesCoach]);

  if (!user || !tenantId) return null;

  return (
    <Drawer
      anchor={isMobile ? 'bottom' : 'right'}
      open={isOpen}
      onClose={closeChatGPT}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '100%', md: '60vw' },
          minWidth: { xs: '100%', md: '600px' },
          height: { xs: '82vh', md: '100vh' },
          maxHeight: { xs: '82vh', md: '100vh' },
          borderRadius: { xs: '24px 24px 0 0', md: 0 },
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transitionProperty: 'transform',
        },
      }}
      ModalProps={{
        keepMounted: true,
      }}
    >
      <Box
        ref={drawerRef}
        role="dialog"
        aria-label="ChatGPT"
        sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2.5,
            py: 1.75,
            borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
            backgroundColor: '#FFFFFF',
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '999px',
                background: 'rgba(0, 87, 184, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RocketLaunchIcon sx={{ fontSize: 18, color: '#0057B8' }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {(() => {
                  if (scope?.type === 'sales_coach' && scope.entityName) {
                    return `Sales Coach: ${scope.entityName}`;
                  } else if (scope?.type === 'sales_coach') {
                    return 'Sales Coach';
                  } else {
                    return 'ChatGPT';
                  }
                })()}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
                {scope?.type === 'sales_coach'
                  ? 'AI sales assistant'
                  : 'AI-powered assistant'
                }
              </Typography>
            </Box>
          </Box>

          <IconButton
            aria-label="Close ChatGPT"
            size="small"
            onClick={closeChatGPT}
            sx={{ color: 'text.secondary' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Content Area */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            backgroundColor: '#F9FAFB',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {isSalesCoach && scope ? (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <SalesCoach
                entityType={scope.entityType!}
                entityId={scope.entityId!}
                entityName={scope.entityName || 'Unknown'}
                tenantId={scope.tenantId || tenantId}
                dealStage={scope.dealStage}
                contactCompany={scope.contactCompany}
                contactTitle={scope.contactTitle}
                associations={scope.associations}
                hideHeader
                height="100%"
              />
            </Box>
          ) : (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 2 }}>
              <AIAssistantChat
                tenantId={tenantId}
                userId={user.uid}
                threadId={undefined}
                onThreadCreated={() => {}}
                showThreadListPanel={false}
                title="ChatGPT"
              />
            </Box>
          )}
        </Box>
      </Box>
    </Drawer>
  );
};

export default ChatGPTDrawer;
