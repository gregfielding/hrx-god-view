import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import WorkersTable from '../../componentBlocks/WorkersTable';
import type { TenantRoleDefaultsDoc } from '../../shared/tenantRoleDefaults';

interface CompanyDirectoryProps {
  search?: string;
  onSearchChange?: (value: string) => void;
}

const CompanyDirectory: React.FC<CompanyDirectoryProps> = ({
  search = '',
  onSearchChange,
}) => {
  const { tenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  
  const effectiveTenantId = activeTenant?.id || tenantId;
  
  const [contacts, setContacts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // tenants/{tid}/settings/roleDefaults — drives the inline Roles chips
  // on the Workforce table. The doc is optional; treat missing as `{}` so
  // the chips render as "no one assigned" instead of crashing.
  const [tenantRoleDefaults, setTenantRoleDefaults] = useState<TenantRoleDefaultsDoc>({});
  // tenants/{tid}/settings/workforceDirectory — currently just an
  // `allowedEmailDomains: string[]` whitelist used to hide external /
  // partner / vendor users (e.g. legacy admins from acquired tools)
  // from the company directory. When the array is empty or missing,
  // the filter is a no-op so existing tenants don't suddenly empty
  // out. Set via Firestore console for now; a settings UI is a
  // follow-up.
  const [allowedEmailDomains, setAllowedEmailDomains] = useState<string[]>([]);

  // Create breadcrumb path
  const breadcrumbPath = [
    { label: 'Workforce Management', href: '/workforce' },
    { label: 'Company Directory' }
  ];

  useEffect(() => {
    if (effectiveTenantId) {
      fetchData();
    }
  }, [effectiveTenantId]);

  // Live subscription to the four tenant-role-default arrays so the chips
  // in the Workforce table update immediately when an admin flips a toggle
  // (including from another tab). `onSnapshot` is one read + cheap deltas
  // — fine to keep mounted for the life of this page.
  useEffect(() => {
    if (!effectiveTenantId) {
      setTenantRoleDefaults({});
      return;
    }
    const ref = doc(db, 'tenants', effectiveTenantId, 'settings', 'roleDefaults');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setTenantRoleDefaults(snap.exists() ? (snap.data() as TenantRoleDefaultsDoc) : {});
      },
      (err) => {
        console.warn('roleDefaults subscription failed:', err);
        setTenantRoleDefaults({});
      },
    );
    return () => unsub();
  }, [effectiveTenantId]);

  // Live subscription to tenants/{tid}/settings/workforceDirectory.
  // Currently we only consume `allowedEmailDomains: string[]`. Empty /
  // missing means "show everyone" — the filter only kicks in when the
  // tenant has explicitly configured a whitelist, so we don't break
  // tenants that haven't opted in.
  useEffect(() => {
    if (!effectiveTenantId) {
      setAllowedEmailDomains([]);
      return;
    }
    const ref = doc(db, 'tenants', effectiveTenantId, 'settings', 'workforceDirectory');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        const raw = data.allowedEmailDomains;
        const list = Array.isArray(raw)
          ? raw
              .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
              .map((v) => v.trim().toLowerCase())
          : [];
        setAllowedEmailDomains(list);
      },
      (err) => {
        console.warn('workforceDirectory subscription failed:', err);
        setAllowedEmailDomains([]);
      },
    );
    return () => unsub();
  }, [effectiveTenantId]);

  const fetchData = async () => {
    if (!effectiveTenantId) return;
    
    setLoading(true);
    try {
      // Fetch all data in parallel
      await Promise.all([
        fetchContacts(),
        fetchLocations(),
        fetchDepartments(),
        fetchDivisions(),
        fetchRegions()
      ]);
    } catch (error) {
      console.error('Error fetching company directory data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchContacts = async () => {
    if (!effectiveTenantId) return;
    
    try {
      const functions = getFunctions();
      const getUsersByTenantFn = httpsCallable(functions, 'getUsersByTenant');
      
      const result = await getUsersByTenantFn({
        tenantId: effectiveTenantId,
        _cacheBust: Date.now() // Force fresh data
      });
      const data = result.data as { users: any[], count: number };
      setContacts(data.users || []);
    } catch (err: any) {
      console.error('Error fetching contacts:', err);
      // Fallback to direct Firestore query. Prefer a server-side filter on
      // the `tenantId` field so we don't pull every user in the system (the
      // previous behavior loaded ~2k docs and spammed the console); if that
      // throws we fall back to an in-memory filter as a last resort.
      try {
        let tenantUsers: any[] = [];
        try {
          const scopedSnapshot = await getDocs(
            query(collection(db, 'users'), where('tenantId', '==', effectiveTenantId))
          );
          tenantUsers = scopedSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        } catch (scopedErr) {
          console.warn('Scoped fallback query failed, using full-scan fallback', scopedErr);
          const allUsersSnapshot = await getDocs(collection(db, 'users'));
          const allUsers = allUsersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          tenantUsers = allUsers.filter((user: any) => {
            if (user.tenantId === effectiveTenantId) return true;
            if (user.tenantIds && user.tenantIds[effectiveTenantId]) return true;
            return false;
          });
        }
        setContacts(tenantUsers);
      } catch (fallbackErr) {
        console.error('Fallback query also failed:', fallbackErr);
        setContacts([]);
      }
    }
  };

  const fetchLocations = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = query(collection(db, 'tenants', effectiveTenantId, 'locations'));
      const snapshot = await getDocs(q);
      const locationData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setLocations(locationData);
    } catch (err: any) {
      console.warn('Could not fetch locations:', err);
      setLocations([]);
    }
  };

  const fetchDepartments = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch departments:', err);
      setDepartments([]);
    }
  };

  const fetchDivisions = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'divisions');
      const snapshot = await getDocs(q);
      setDivisions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch divisions:', err);
      setDivisions([]);
    }
  };

  const fetchRegions = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'regions');
      const snapshot = await getDocs(q);
      const regionData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setRegions(regionData);
    } catch (err: any) {
      console.warn('Could not fetch regions:', err);
      setRegions([]);
    }
  };

  // Filter for company directory workers. Two stages:
  //   1) Security level 5, 6, or 7 (per-tenant or legacy field).
  //   2) Optional email-domain whitelist from
  //      `tenants/{tid}/settings/workforceDirectory.allowedEmailDomains`.
  //      When empty/missing, the email filter is a no-op so existing
  //      tenants don't suddenly empty out. Hides external/partner/vendor
  //      users (e.g. legacy admins from acquired tools) without needing
  //      to flag each one individually.
  // Memoized so the per-contact scan only re-runs when the inputs
  // actually change (previously this re-ran on every render because it
  // was a plain function called inline in JSX).
  const companyDirectoryWorkers = useMemo(() => {
    const domains = allowedEmailDomains;
    const filterByDomain = domains.length > 0;
    return contacts.filter((c: any) => {
      let workerLevel: any = null;

      // Check tenantIds map first (new structure)
      if (c.tenantIds && effectiveTenantId && c.tenantIds[effectiveTenantId]) {
        workerLevel = c.tenantIds[effectiveTenantId].securityLevel;
      }
      // Fall back to direct securityLevel field (old structure)
      else if (c.securityLevel) {
        workerLevel = c.securityLevel;
      }

      const securityOk =
        workerLevel === 5 ||
        workerLevel === 6 ||
        workerLevel === 7 ||
        workerLevel === '5' ||
        workerLevel === '6' ||
        workerLevel === '7';
      if (!securityOk) return false;

      if (!filterByDomain) return true;

      // Strip `+alias` from the local part before extracting domain so
      // common alias-style addresses (`first+work@c1staffing.com`) match.
      const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
      if (!email) return false;
      const at = email.lastIndexOf('@');
      if (at === -1 || at === email.length - 1) return false;
      const domain = email.slice(at + 1);
      return domains.includes(domain);
    });
  }, [contacts, effectiveTenantId, allowedEmailDomains]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ ml: 2 }}>
          Loading company directory...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <WorkersTable
        contacts={companyDirectoryWorkers}
        locations={locations}
        departments={departments}
        divisions={divisions}
        regions={regions}
        selectedWorkers={[]}
        handleWorkerSelection={() => {}}
        handleSelectAll={() => {}}
        navigateToUser={(userId) => navigate(`/workforce/users/${userId}`)}
        contextType="agency"
        loading={false}
        search={search}
        onSearchChange={onSearchChange || (() => {})}
        effectiveTenantId={effectiveTenantId}
        tenantRoleDefaults={tenantRoleDefaults}
      />
    </Box>
  );
};

export default CompanyDirectory;
