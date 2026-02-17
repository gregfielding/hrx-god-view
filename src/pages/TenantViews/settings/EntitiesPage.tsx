/**
 * Entities Page — Phase 1B
 * Manage Entities (Employers of Record) with Overview, Onboarding Workflow, Documents tabs.
 */
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Grid,
  Tabs,
  Tab,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Alert,
  CircularProgress,
  FormControlLabel,
  Switch,
  Divider,
} from '@mui/material';
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import EntityCostCentersTab from './EntityCostCentersTab';
import EntityComplianceTab from './EntityComplianceTab';
import EntityDocumentsTab from './EntityDocumentsTab';
import EntityWorkersCompTab from './EntityWorkersCompTab';

export type EntityTab = 'overview' | 'workflow' | 'documents' | 'compliance' | 'costcenters' | 'workerscomp' | 'export';

export type EntityAddressType = 'mailing' | 'physical' | 'registered_agent';
export type EntityType = 'LLC' | 'Inc' | 'LP' | 'SoleProp' | 'Other';

export interface EntityAddress {
  type: EntityAddressType;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface EntityContacts {
  supportEmail?: string;
  supportPhone?: string;
  hrContactName?: string;
  hrContactEmail?: string;
  payrollContactEmail?: string;
}

export interface WorkersCompSummary {
  carrierName?: string;
  policyNumberMasked?: string;
  claimsPhone?: string;
  wcInfoDocId?: string;
}

export interface EntityDocuments {
  handbookEmployeeDocKey?: string;
  handbookContractorDocKey?: string;
  icAgreementDocKey?: string;
  workersCompInfoDocKey?: string;
}

export interface Entity {
  id: string;
  name: string;
  entityCode: string;
  workerType: 'W2' | '1099' | 'BOTH';
  everifyRequired: boolean;
  defaultRequirementPackageId?: string | null;
  legalName?: string;
  dbaName?: string;
  entityType?: EntityType;
  formationState?: string;
  supportEmail?: string;
  addresses?: EntityAddress[];
  contacts?: EntityContacts;
  workersCompSummary?: WorkersCompSummary;
  documents?: EntityDocuments;
  defaultCostCenterId?: string | null;
  defaultGlCompanyCode?: string | null;
  isActive?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

const WORKER_TYPES = ['W2', '1099', 'BOTH'] as const;
const ENTITY_TYPES: EntityType[] = ['LLC', 'Inc', 'LP', 'SoleProp', 'Other'];
const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

const EntitiesPage: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id;
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [entityTab, setEntityTab] = useState<EntityTab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [packages, setPackages] = useState<{ id: string; name: string }[]>([]);
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([]);
  const [workersCompPolicies, setWorkersCompPolicies] = useState<{ id: string; entityId?: string; displayName: string }[]>([]);

  // Form state for overview tab
  const [form, setForm] = useState<Partial<Entity>>({});

  useEffect(() => {
    if (!tenantId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [entitiesSnap, packagesSnap, costCentersSnap, workersCompSnap] = await Promise.all([
          getDocs(collection(db, 'tenants', tenantId, 'entities')),
          getDocs(collection(db, 'tenants', tenantId, 'requirement_packages')),
          getDocs(collection(db, 'tenants', tenantId, 'entity_cost_centers')),
          getDocs(collection(db, 'tenants', tenantId, 'workers_comp')),
        ]);
        const entitiesList: Entity[] = entitiesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Entity, 'id'>),
        }));
        setEntities(entitiesList);
        setPackages(
          packagesSnap.docs.map((d) => ({
            id: d.id,
            name: (d.data() as { name?: string }).name || d.id,
          }))
        );
        setCostCenters(
          costCentersSnap.docs.map((d) => ({
            id: d.id,
            name: (d.data() as { name?: string }).name || d.id,
          }))
        );
        setWorkersCompPolicies(
          workersCompSnap.docs.map((d) => {
            const data = d.data() as { entityId?: string; carrierName?: string; state?: string };
            return {
              id: d.id,
              entityId: data.entityId,
              displayName: [data.carrierName, data.state].filter(Boolean).join(' — ') || d.id,
            };
          })
        );
        if (entitiesList.length > 0 && !selectedEntity) {
          setSelectedEntity(entitiesList[0]);
          setForm({ ...entitiesList[0] });
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load entities');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId]);

  useEffect(() => {
    if (selectedEntity) {
      setForm({
        ...selectedEntity,
        defaultRequirementPackageId: selectedEntity.defaultRequirementPackageId ?? null,
        defaultCostCenterId: selectedEntity.defaultCostCenterId ?? null,
        isActive: selectedEntity.isActive ?? true,
      });
    }
  }, [selectedEntity]);

  const handleSaveDocuments = async (documents: EntityDocuments) => {
    if (!tenantId || !selectedEntity) return;
    setSaving(true);
    setError(null);
    try {
      await setDoc(
        doc(db, p.entity(tenantId, selectedEntity.id)),
        { documents, updatedAt: serverTimestamp() },
        { merge: true }
      );
      setSelectedEntity({ ...selectedEntity, documents });
      setEntities((prev) =>
        prev.map((e) => (e.id === selectedEntity.id ? { ...e, documents } : e))
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOverview = async () => {
    if (!tenantId || !selectedEntity) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const ref = doc(db, p.entity(tenantId, selectedEntity.id));
      const payload: Record<string, any> = {
        name: form.name,
        entityCode: form.entityCode,
        workerType: form.workerType,
        everifyRequired: form.everifyRequired ?? false,
        defaultRequirementPackageId: form.defaultRequirementPackageId || null,
        legalName: form.legalName || null,
        dbaName: form.dbaName || null,
        entityType: form.entityType || null,
        formationState: form.formationState || null,
        supportEmail: form.contacts?.supportEmail ?? form.supportEmail ?? null,
        defaultCostCenterId: form.defaultCostCenterId || null,
        defaultGlCompanyCode: form.defaultGlCompanyCode || null,
        isActive: form.isActive ?? true,
        updatedAt: serverTimestamp(),
      };
      if (form.addresses?.length) payload.addresses = form.addresses;
      if (form.contacts) payload.contacts = form.contacts;
      if (form.workersCompSummary) payload.workersCompSummary = form.workersCompSummary;
      await setDoc(ref, payload, { merge: true });
      setSelectedEntity({ ...selectedEntity, ...form });
      setEntities((prev) =>
        prev.map((e) => (e.id === selectedEntity.id ? { ...e, ...form } : e))
      );
      setSuccess('Entity saved');
    } catch (err: any) {
      setError(err?.message || 'Failed to save entity');
    } finally {
      setSaving(false);
    }
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Select a tenant to manage entities.</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, width: '100%', height: '100%' }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
        Entities (Employers of Record)
      </Typography>

      <Grid container spacing={2} sx={{ height: 'calc(100% - 48px)' }}>
        {/* Left: Entities list */}
        <Grid item xs={12} md={4}>
          <Paper variant="outlined" sx={{ height: '100%', overflow: 'auto' }}>
            <List dense disablePadding>
              {entities.map((e) => (
                <ListItemButton
                  key={e.id}
                  selected={selectedEntity?.id === e.id}
                  onClick={() => setSelectedEntity(e)}
                >
                  <ListItemText
                    primary={e.name}
                    secondary={`${e.entityCode} • ${e.workerType}`}
                    primaryTypographyProps={{ fontWeight: 600 }}
                  />
                </ListItemButton>
              ))}
              {entities.length === 0 && (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    No entities yet. Run the seed script to create default entities.
                  </Typography>
                </Box>
              )}
            </List>
          </Paper>
        </Grid>

        {/* Right: Entity detail */}
        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {selectedEntity ? (
              <>
                <Tabs
                  value={entityTab}
                  onChange={(_, v) => setEntityTab(v)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
                >
                  <Tab label="Overview" value="overview" />
                  <Tab label="Cost Centers" value="costcenters" />
                  <Tab label="Compliance / States" value="compliance" />
                  <Tab label="Workers Comp" value="workerscomp" />
                  <Tab label="Onboarding Workflow" value="workflow" />
                  <Tab label="Documents" value="documents" />
                  <Tab label="Export / Integrations" value="export" />
                </Tabs>
                <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                  {error && (
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                      {error}
                    </Alert>
                  )}
                  {success && (
                    <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
                      {success}
                    </Alert>
                  )}

                  {entityTab === 'overview' && (
                    <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480 }}>
                      <TextField
                        label="Name"
                        value={form.name || ''}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        fullWidth
                        required
                      />
                      <TextField
                        label="Entity Code"
                        value={form.entityCode || ''}
                        onChange={(e) => setForm((f) => ({ ...f, entityCode: e.target.value }))}
                        placeholder="e.g. C1WF"
                        fullWidth
                        helperText="Used in payroll export"
                      />
                      <FormControl fullWidth>
                        <InputLabel>Worker Type</InputLabel>
                        <Select
                          value={form.workerType || 'W2'}
                          label="Worker Type"
                          onChange={(e) => setForm((f) => ({ ...f, workerType: e.target.value as Entity['workerType'] }))}
                        >
                          {WORKER_TYPES.map((t) => (
                            <MenuItem key={t} value={t}>{t}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={form.everifyRequired ?? false}
                            onChange={(e) => setForm((f) => ({ ...f, everifyRequired: e.target.checked }))}
                          />
                        }
                        label="E-Verify required"
                      />
                      <FormControl fullWidth>
                        <InputLabel>Default Requirement Package</InputLabel>
                        <Select
                          value={form.defaultRequirementPackageId || ''}
                          label="Default Requirement Package"
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              defaultRequirementPackageId: e.target.value || null,
                            }))
                          }
                        >
                          <MenuItem value="">None</MenuItem>
                          {packages.map((pkg) => (
                            <MenuItem key={pkg.id} value={pkg.id}>
                              {pkg.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TextField
                        label="Legal Name"
                        value={form.legalName || ''}
                        onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
                        fullWidth
                      />
                      <TextField
                        label="DBA Name"
                        value={form.dbaName || ''}
                        onChange={(e) => setForm((f) => ({ ...f, dbaName: e.target.value }))}
                        fullWidth
                        placeholder="Doing Business As"
                      />
                      <FormControl fullWidth>
                        <InputLabel>Entity Type</InputLabel>
                        <Select
                          value={form.entityType || ''}
                          label="Entity Type"
                          onChange={(e) => setForm((f) => ({ ...f, entityType: (e.target.value || null) as EntityType | undefined }))}
                        >
                          <MenuItem value="">None</MenuItem>
                          {ENTITY_TYPES.map((t) => (
                            <MenuItem key={t} value={t}>{t}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl fullWidth>
                        <InputLabel>Formation State</InputLabel>
                        <Select
                          value={form.formationState || ''}
                          label="Formation State"
                          onChange={(e) => setForm((f) => ({ ...f, formationState: e.target.value || null }))}
                        >
                          <MenuItem value="">None</MenuItem>
                          {US_STATES.map((s) => (
                            <MenuItem key={s} value={s}>{s}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Typography variant="subtitle2" color="text.secondary">Mailing Address</Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            label="Street"
                            value={form.addresses?.[0]?.line1 || ''}
                            onChange={(e) => setForm((f) => ({
                              ...f,
                              addresses: [{
                                type: 'mailing',
                                line1: e.target.value,
                                city: f.addresses?.[0]?.city || '',
                                state: f.addresses?.[0]?.state || '',
                                zip: f.addresses?.[0]?.zip || '',
                              }],
                            }))}
                            fullWidth
                          />
                        </Grid>
                        <Grid item xs={6}>
                          <TextField
                            label="City"
                            value={form.addresses?.[0]?.city || ''}
                            onChange={(e) => setForm((f) => {
                              const prev = f.addresses?.[0] || { type: 'mailing' as const, line1: '', city: '', state: '', zip: '' };
                              return { ...f, addresses: [{ ...prev, city: e.target.value }] };
                            })}
                            fullWidth
                          />
                        </Grid>
                        <Grid item xs={3}>
                          <FormControl fullWidth>
                            <InputLabel>State</InputLabel>
                            <Select
                              value={form.addresses?.[0]?.state || ''}
                              label="State"
                              onChange={(e) => setForm((f) => {
                                const prev = f.addresses?.[0] || { type: 'mailing' as const, line1: '', city: '', zip: '', state: '' };
                                return { ...f, addresses: [{ ...prev, state: e.target.value }] };
                              })}
                            >
                              <MenuItem value="">—</MenuItem>
                              {US_STATES.map((s) => (
                                <MenuItem key={s} value={s}>{s}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={3}>
                          <TextField
                            label="ZIP"
                            value={form.addresses?.[0]?.zip || ''}
                            onChange={(e) => setForm((f) => {
                              const prev = f.addresses?.[0] || { type: 'mailing' as const, line1: '', city: '', state: '', zip: '' };
                              return { ...f, addresses: [{ ...prev, zip: e.target.value }] };
                            })}
                            fullWidth
                          />
                        </Grid>
                      </Grid>
                      <TextField
                        label="Support Email"
                        type="email"
                        value={form.contacts?.supportEmail ?? form.supportEmail ?? ''}
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          contacts: { ...f.contacts, supportEmail: e.target.value },
                          supportEmail: e.target.value,
                        }))}
                        fullWidth
                      />
                      <TextField
                        label="Support Phone"
                        value={form.contacts?.supportPhone || ''}
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          contacts: { ...f.contacts, supportPhone: e.target.value },
                        }))}
                        fullWidth
                      />
                      <FormControl fullWidth>
                        <InputLabel>Default Cost Center</InputLabel>
                        <Select
                          value={form.defaultCostCenterId || ''}
                          label="Default Cost Center"
                          onChange={(e) => setForm((f) => ({ ...f, defaultCostCenterId: e.target.value || null }))}
                        >
                          <MenuItem value="">None</MenuItem>
                          {costCenters.map((cc) => (
                            <MenuItem key={cc.id} value={cc.id}>{cc.name}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TextField
                        label="Default GL Company Code"
                        value={form.defaultGlCompanyCode || ''}
                        onChange={(e) => setForm((f) => ({ ...f, defaultGlCompanyCode: e.target.value || null }))}
                        fullWidth
                        placeholder="e.g. C1SL"
                      />
                      <FormControl fullWidth>
                        <InputLabel>Workers Comp Policy (summary link)</InputLabel>
                        <Select
                          value={form.workersCompSummary?.wcInfoDocId || ''}
                          label="Workers Comp Policy (summary link)"
                          onChange={(e) => setForm((f) => ({
                            ...f,
                            workersCompSummary: e.target.value
                              ? { ...f.workersCompSummary, wcInfoDocId: e.target.value }
                              : undefined,
                          }))}
                        >
                          <MenuItem value="">None</MenuItem>
                          {workersCompPolicies.filter((wc) => !selectedEntity || wc.entityId === selectedEntity.id).map((wc) => (
                            <MenuItem key={wc.id} value={wc.id}>{wc.displayName}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={form.isActive ?? true}
                            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                          />
                        }
                        label="Active"
                      />
                      <Button
                        variant="contained"
                        onClick={handleSaveOverview}
                        disabled={saving}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </Box>
                  )}

                  {entityTab === 'costcenters' && (
                    <EntityCostCentersTab
                      tenantId={tenantId}
                      entityId={selectedEntity?.id ?? null}
                    />
                  )}
                  {entityTab === 'compliance' && (
                    <EntityComplianceTab
                      tenantId={tenantId}
                      entityId={selectedEntity?.id ?? null}
                    />
                  )}
                  {entityTab === 'workerscomp' && (
                    <EntityWorkersCompTab
                      tenantId={tenantId}
                      entityId={selectedEntity?.id ?? null}
                    />
                  )}
                  {entityTab === 'workflow' && (
                    <Alert severity="info">
                      Onboarding Workflow (checkbox matrix) — Coming in next phase.
                    </Alert>
                  )}
                  {entityTab === 'documents' && (
                    <EntityDocumentsTab
                      tenantId={tenantId}
                      entityId={selectedEntity?.id ?? null}
                      entityDocuments={selectedEntity?.documents}
                      onSave={handleSaveDocuments}
                    />
                  )}
                  {entityTab === 'export' && (
                    <Alert severity="info">
                      Export / Integrations — Everee payroll, entityCode usage. Coming in Phase 2.
                    </Alert>
                  )}
                </Box>
              </>
            ) : (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">
                  Select an entity or run the seed script to create default entities.
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default EntitiesPage;
