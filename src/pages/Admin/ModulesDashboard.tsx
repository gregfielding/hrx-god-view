import React, { useState, useEffect } from 'react';
import { Box, Typography, Paper, Tabs, Tab, Grid, Switch, FormControlLabel, Checkbox, FormGroup, Chip, CircularProgress, Button } from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

const exampleModules = [
  {
    name: 'Timesheets',
    description: 'Track and submit hours worked',
    family: 'functional',
    settingsSchema: { requireGeoLocation: 'boolean', allowManualEdits: 'boolean' },
    rolesVisibleTo: ['hrx-admin', 'customer-admin', 'worker'],
    defaultEnabled: false,
    aiRecommendsByDefault: false,
    status: 'Active on 12 customers',
    tags: ['Functional', 'Revenue-generating'],
    badge: 'Beta',
    dependencies: [],
    lastUsed: '2024-06-01',
    engagement: 'High',
    screenshots: ['/img/timesheets1.png', '/img/timesheets2.png'],
    adminNotes: 'Depends on Shifts module. Roadmap: add overtime support.',
  },
  {
    name: 'Mindfulness',
    description: 'Daily wellness check-ins and exercises',
    family: 'behavioral',
    settingsSchema: { dailyReminder: 'boolean' },
    rolesVisibleTo: ['worker'],
    defaultEnabled: false,
    aiRecommendsByDefault: true,
    status: 'Active on 7 customers',
    tags: ['Behavioral', 'Worker-Facing', 'AI-only'],
    badge: 'New',
    dependencies: [],
    lastUsed: '2024-05-28',
    engagement: 'Medium',
    screenshots: ['/img/mindfulness1.png'],
    adminNotes: 'No dependencies. Roadmap: add mood tracking.',
  },
  {
    name: 'Burnout Risk Detection',
    description: 'AI-powered prediction of worker burnout risk',
    family: 'ai-enhanced',
    settingsSchema: { enableAlerts: 'boolean', riskLevel: 'enum:Low,Medium,High' },
    rolesVisibleTo: ['hrx-admin', 'customer-admin'],
    defaultEnabled: false,
    aiRecommendsByDefault: true,
    status: 'Coming Soon',
    tags: ['AI-only'],
    badge: 'Coming Soon',
    dependencies: ['Timesheets', 'Mindfulness'],
  },
  {
    name: 'Shift Bidding',
    description: 'Allow workers to bid on open shifts',
    family: 'functional',
    settingsSchema: { allowOverbidding: 'boolean' },
    rolesVisibleTo: ['worker'],
    defaultEnabled: false,
    aiRecommendsByDefault: false,
  },
  {
    name: 'Motivation',
    description: 'Motivational nudges and recognition',
    family: 'behavioral',
    settingsSchema: { enableBadges: 'boolean' },
    rolesVisibleTo: ['worker'],
    defaultEnabled: false,
    aiRecommendsByDefault: true,
  },
];

const families = [
  { key: 'functional', label: 'Functional' },
  { key: 'behavioral', label: 'Behavioral' },
  { key: 'ai-enhanced', label: 'AI Enhanced' },
];

const roleLabels: Record<string, string> = {
  'hrx-admin': 'HRX Admin',
  'customer-admin': 'Customer Admin',
  'worker': 'Worker',
};

const roleIcons: Record<string, string> = {
  'hrx-admin': '👤',
  'customer-admin': '🧑‍💼',
  'worker': '👷',
};

const ModulesDashboard: React.FC = () => {
  const [sideTab, setSideTab] = useState(0);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [roleAccess, setRoleAccess] = useState<Record<string, string[]>>({});
  const [modules, setModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedModule, setSelectedModule] = useState<any | null>(null);

  useEffect(() => {
    const fetchModules = async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(collection(db, 'modules'));
        const mods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (mods.length > 0) {
          setModules(mods);
        } else {
          setModules(exampleModules);
        }
        setError(null);
      } catch (err) {
        setModules(exampleModules);
        setError(null); // Do NOT show error if fallback is available
      } finally {
        setLoading(false);
      }
    };
    fetchModules();
  }, []);

  const handleToggle = (moduleName: string) => {
    setEnabled((prev) => ({ ...prev, [moduleName]: !prev[moduleName] }));
  };

  const handleRoleChange = (moduleName: string, role: string) => {
    setRoleAccess((prev) => {
      const current = prev[moduleName] || [];
      return {
        ...prev,
        [moduleName]: current.includes(role)
          ? current.filter((r) => r !== role)
          : [...current, role],
      };
    });
  };

  const handleCardClick = (mod: any) => {
    setSelectedModule(mod);
    setDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setSelectedModule(null);
  };

  return (
    <Box sx={{ p: 2, width: '100%', display: 'flex', alignItems: 'flex-start' }}>
      <Box sx={{ width: 80, mr: 3 }}>
        <Tabs
          orientation="vertical"
          value={sideTab}
          onChange={(_, v) => setSideTab(v)}
          sx={{ borderRight: 1, borderColor: 'divider', width: 100 }}
        >
          <Tab label={<Box sx={{ width: 100, textAlign: 'right', pr: 2 }}>Functional</Box>} />
          <Tab label={<Box sx={{ width: 100, textAlign: 'right', pr: 2 }}>Behavioral</Box>} />
          <Tab label={<Box sx={{ width: 100, textAlign: 'right', pr: 2 }}>AI Enhanced</Box>} />
        </Tabs>
      </Box>
      <Box sx={{ flex: 1 }}>
        {sideTab === 0 && (
          <>
            <Box display="flex" justifyContent="flex-end" mb={2}>
              <Button variant="contained" color="primary" onClick={() => { setSelectedModule({}); setDrawerOpen(true); }}>Create Module</Button>
            </Box>
            <Box>
              {modules.filter((m) => m.family === 'functional').map((mod) => (
                <Paper key={mod.name} sx={{ p: 3, mb: 3, width: '100%', cursor: 'pointer', position: 'relative' }} elevation={3} onClick={() => handleCardClick(mod)}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      {mod.tags && mod.tags.map((tag: string) => (
                        <Chip key={tag} label={tag} size="small" sx={{ mr: 0.5 }} />
                      ))}
                      {mod.badge && (
                        <Chip label={mod.badge} color="warning" size="small" />
                      )}
                      {mod.status && (
                        <Chip label={mod.status} color="info" size="small" />
                      )}
                    </Box>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      {mod.rolesVisibleTo && mod.rolesVisibleTo.map((role: string) => (
                        <span key={role} title={roleLabels[role] || role} style={{ fontSize: 18 }}>{roleIcons[role]}</span>
                      ))}
                    </Box>
                  </Box>
                  <Typography variant="subtitle1" fontWeight={600}>{mod.name}</Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>{mod.description}</Typography>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    {mod.lastUsed && (
                      <Chip label={`Last Used: ${mod.lastUsed}`} size="small" color="default" />
                    )}
                    {mod.engagement && (
                      <Chip label={`Engagement: ${mod.engagement}`} size="small" color="success" />
                    )}
                  </Box>
                  <Box mb={2}>
                    <FormGroup row>
                      {mod.rolesVisibleTo.map((role: string) => (
                        <FormControlLabel
                          key={role}
                          control={
                            <Checkbox
                              checked={roleAccess[mod.name]?.includes(role) ?? false}
                              onChange={() => handleRoleChange(mod.name, role)}
                            />
                          }
                          label={roleLabels[role] || role}
                        />
                      ))}
                    </FormGroup>
                  </Box>
                  {mod.aiRecommendsByDefault && (
                    <Chip label="AI Recommended" color="success" size="small" sx={{ mb: 1, mr: 1 }} />
                  )}
                  <Box mt={2}>
                    {mod.settingsSchema && Object.entries(mod.settingsSchema).map(([key, type]) => (
                      <Typography key={key} variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                        {`${key} `}<em>({String(type)})</em>
                      </Typography>
                    ))}
                  </Box>
                </Paper>
              ))}
            </Box>
          </>
        )}
        {sideTab === 1 && (
          <>
            <Box display="flex" justifyContent="flex-end" mb={2}>
              <Button variant="contained" color="primary" onClick={() => { setSelectedModule({}); setDrawerOpen(true); }}>Create Module</Button>
            </Box>
            <Box>
              {modules.filter((m) => m.family === 'behavioral').map((mod) => (
                <Paper key={mod.name} sx={{ p: 3, mb: 3, width: '100%', cursor: 'pointer', position: 'relative' }} elevation={3} onClick={() => handleCardClick(mod)}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      {mod.tags && mod.tags.map((tag: string) => (
                        <Chip key={tag} label={tag} size="small" sx={{ mr: 0.5 }} />
                      ))}
                      {mod.badge && (
                        <Chip label={mod.badge} color="warning" size="small" />
                      )}
                      {mod.status && (
                        <Chip label={mod.status} color="info" size="small" />
                      )}
                    </Box>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      {mod.rolesVisibleTo && mod.rolesVisibleTo.map((role: string) => (
                        <span key={role} title={roleLabels[role] || role} style={{ fontSize: 18 }}>{roleIcons[role]}</span>
                      ))}
                    </Box>
                  </Box>
                  <Typography variant="subtitle1" fontWeight={600}>{mod.name}</Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>{mod.description}</Typography>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    {mod.lastUsed && (
                      <Chip label={`Last Used: ${mod.lastUsed}`} size="small" color="default" />
                    )}
                    {mod.engagement && (
                      <Chip label={`Engagement: ${mod.engagement}`} size="small" color="success" />
                    )}
                  </Box>
                  <Box mb={2}>
                    <FormGroup row>
                      {mod.rolesVisibleTo.map((role: string) => (
                        <FormControlLabel
                          key={role}
                          control={
                            <Checkbox
                              checked={roleAccess[mod.name]?.includes(role) ?? false}
                              onChange={() => handleRoleChange(mod.name, role)}
                            />
                          }
                          label={roleLabels[role] || role}
                        />
                      ))}
                    </FormGroup>
                  </Box>
                  {mod.aiRecommendsByDefault && (
                    <Chip label="AI Recommended" color="success" size="small" sx={{ mb: 1, mr: 1 }} />
                  )}
                  <Box mt={2}>
                    {mod.settingsSchema && Object.entries(mod.settingsSchema).map(([key, type]) => (
                      <Typography key={key} variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                        {`${key} `}<em>({String(type)})</em>
                      </Typography>
                    ))}
                  </Box>
                </Paper>
              ))}
            </Box>
          </>
        )}
        {sideTab === 2 && (
          <>
            <Box display="flex" justifyContent="flex-end" mb={2}>
              <Button variant="contained" color="primary" onClick={() => { setSelectedModule({}); setDrawerOpen(true); }}>Create Module</Button>
            </Box>
            <Box>
              {modules.filter((m) => m.family === 'ai-enhanced').map((mod) => (
                <Paper key={mod.name} sx={{ p: 3, mb: 3, width: '100%', cursor: 'pointer', position: 'relative' }} elevation={3} onClick={() => handleCardClick(mod)}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      {mod.tags && mod.tags.map((tag: string) => (
                        <Chip key={tag} label={tag} size="small" sx={{ mr: 0.5 }} />
                      ))}
                      {mod.badge && (
                        <Chip label={mod.badge} color="warning" size="small" />
                      )}
                      {mod.status && (
                        <Chip label={mod.status} color="info" size="small" />
                      )}
                    </Box>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      {mod.rolesVisibleTo && mod.rolesVisibleTo.map((role: string) => (
                        <span key={role} title={roleLabels[role] || role} style={{ fontSize: 18 }}>{roleIcons[role]}</span>
                      ))}
                    </Box>
                  </Box>
                  <Typography variant="subtitle1" fontWeight={600}>{mod.name}</Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>{mod.description}</Typography>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    {mod.lastUsed && (
                      <Chip label={`Last Used: ${mod.lastUsed}`} size="small" color="default" />
                    )}
                    {mod.engagement && (
                      <Chip label={`Engagement: ${mod.engagement}`} size="small" color="success" />
                    )}
                  </Box>
                  <Box mb={2}>
                    <FormGroup row>
                      {mod.rolesVisibleTo.map((role: string) => (
                        <FormControlLabel
                          key={role}
                          control={
                            <Checkbox
                              checked={roleAccess[mod.name]?.includes(role) ?? false}
                              onChange={() => handleRoleChange(mod.name, role)}
                            />
                          }
                          label={roleLabels[role] || role}
                        />
                      ))}
                    </FormGroup>
                  </Box>
                  {mod.aiRecommendsByDefault && (
                    <Chip label="AI Recommended" color="success" size="small" sx={{ mb: 1, mr: 1 }} />
                  )}
                  <Box mt={2}>
                    {mod.settingsSchema && Object.entries(mod.settingsSchema).map(([key, type]) => (
                      <Typography key={key} variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                        {`${key} `}<em>({String(type)})</em>
                      </Typography>
                    ))}
                  </Box>
                </Paper>
              ))}
            </Box>
          </>
        )}
      </Box>
      {/* Module Detail Drawer/Modal */}
      {selectedModule && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: { xs: '100%', sm: 400, md: 500 },
            height: '100vh',
            bgcolor: 'background.paper',
            boxShadow: 24,
            zIndex: 1300,
            p: 3,
            display: drawerOpen ? 'block' : 'none',
            overflowY: 'auto',
          }}
        >
          <Typography variant="h6" gutterBottom>{selectedModule.name}</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>{selectedModule.description}</Typography>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            {selectedModule.tags && selectedModule.tags.map((tag: string) => (
              <Chip key={tag} label={tag} size="small" sx={{ mr: 0.5 }} />
            ))}
            {selectedModule.badge && (
              <Chip label={selectedModule.badge} color="warning" size="small" />
            )}
            {selectedModule.status && (
              <Chip label={selectedModule.status} color="info" size="small" />
            )}
          </Box>
          <Box display="flex" alignItems="center" gap={0.5} mb={2}>
            {selectedModule.rolesVisibleTo && selectedModule.rolesVisibleTo.map((role: string) => (
              <span key={role} title={roleLabels[role] || role} style={{ fontSize: 18 }}>{roleIcons[role]}</span>
            ))}
          </Box>
          {selectedModule.dependencies && selectedModule.dependencies.length > 0 && (
            <Box mb={2}>
              <Chip label={`Requires: ${selectedModule.dependencies.join(', ')}`} color="error" size="small" />
            </Box>
          )}
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            {selectedModule.lastUsed && (
              <Chip label={`Last Used: ${selectedModule.lastUsed}`} size="small" color="default" />
            )}
            {selectedModule.engagement && (
              <Chip label={`Engagement: ${selectedModule.engagement}`} size="small" color="success" />
            )}
          </Box>
          {selectedModule.screenshots && selectedModule.screenshots.length > 0 && (
            <Box mb={2}>
              <Typography variant="caption" color="text.secondary">Screenshots/Preview:</Typography>
              <Box display="flex" gap={1} mt={1}>
                {selectedModule.screenshots.map((src: string, idx: number) => (
                  <img key={idx} src={src} alt="screenshot" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }} />
                ))}
              </Box>
            </Box>
          )}
          {selectedModule.adminNotes && (
            <Box mb={2}>
              <Typography variant="caption" color="text.secondary">Admin Notes:</Typography>
              <Typography variant="body2" color="text.secondary">{selectedModule.adminNotes}</Typography>
            </Box>
          )}
          <Button variant="outlined" sx={{ mt: 1, mr: 2 }} onClick={() => {/* TODO: implement edit mode */}}>Edit</Button>
          <Button onClick={handleDrawerClose} sx={{ mt: 2 }}>Close</Button>
        </Box>
      )}
    </Box>
  );
};

export default ModulesDashboard; 