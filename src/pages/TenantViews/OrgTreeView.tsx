import React, { useState, useEffect } from 'react';
import { Box, Typography, IconButton, Collapse, Paper, CircularProgress, Alert, Chip, Tooltip } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import EditIcon from '@mui/icons-material/Edit';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SecurityIcon from '@mui/icons-material/Security';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

interface OrgTreeViewProps {
  tenantId: string;
}

// Mock data for badges (will be replaced with real data later)
const getMockBadges = (nodeType: string, nodeId: string) => {
  if (nodeType === 'Division') {
    return {
      jsiScore: 7.2,
      burnoutRisk: 'medium',
      openRoles: 3
    };
  } else if (nodeType === 'Department') {
    return {
      jsiScore: 6.8,
      burnoutRisk: 'high',
      openRoles: 1
    };
  } else {
    return {
      jsiScore: 7.5,
      burnoutRisk: 'low',
      openRoles: 0
    };
  }
};

const getRiskColor = (risk: string) => {
  switch (risk) {
    case 'high': return 'error';
    case 'medium': return 'warning';
    case 'low': return 'success';
    default: return 'default';
  }
};

const TreeNode: React.FC<{ node: any; level?: number }> = ({ node, level = 0 }) => {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const badges = getMockBadges(node.type, node.id);
  const isSystemManaged = node.isSystem || node.id === 'auto_flex';
  const isFlexDivision = node.id === 'auto_flex';

  return (
    <Box sx={{ ml: level * 3, mb: 1 }}>
      <Paper 
        sx={{ 
          p: 2, 
          borderRadius: 2, 
          boxShadow: 1,
          ...(isSystemManaged && {
            border: '2px solid',
            borderColor: 'primary.main',
            backgroundColor: 'rgba(25, 118, 210, 0.04)',
          }),
          ...(isFlexDivision && {
            border: '2px solid',
            borderColor: 'secondary.main',
            backgroundColor: 'rgba(156, 39, 176, 0.04)',
          })
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {hasChildren && (
            <IconButton size="small" onClick={() => setOpen((o) => !o)}>
              {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          )}
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', ml: hasChildren ? 1 : 5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {node.name}
            </Typography>
            <Typography variant="caption" sx={{ ml: 2, color: 'text.secondary' }}>
              {node.type}
            </Typography>
            {node.headcount && (
              <Chip 
                label={`${node.headcount} people`} 
                size="small" 
                sx={{ ml: 2 }} 
                color="primary" 
                variant="outlined"
              />
            )}
            {isSystemManaged && (
              <Tooltip title="System-managed division">
                <SecurityIcon fontSize="small" color="primary" sx={{ ml: 1 }} />
              </Tooltip>
            )}
            {isFlexDivision && (
              <Chip
                label="Flex"
                size="small"
                color="secondary"
                variant="outlined"
                sx={{ ml: 1, fontSize: '0.7rem', height: '20px' }}
              />
            )}
          </Box>
          
          {/* Badges */}
          <Box sx={{ display: 'flex', gap: 1, mr: 2 }}>
            <Tooltip title="Job Satisfaction Index">
              <Chip 
                label={`JSI: ${badges.jsiScore}`} 
                size="small" 
                color={badges.jsiScore >= 7 ? 'success' : badges.jsiScore >= 5 ? 'warning' : 'error'}
                variant="outlined"
              />
            </Tooltip>
            <Tooltip title="Burnout Risk">
              <Chip 
                label={`Burnout: ${badges.burnoutRisk}`} 
                size="small" 
                color={getRiskColor(badges.burnoutRisk)}
                variant="outlined"
              />
            </Tooltip>
            {badges.openRoles > 0 && (
              <Tooltip title="Open Roles">
                <Chip 
                  label={`${badges.openRoles} open`} 
                  size="small" 
                  color="info"
                  variant="outlined"
                />
              </Tooltip>
            )}
          </Box>

          {/* Action Icons */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={isSystemManaged ? "System-managed - cannot edit" : "Edit"}>
              <span>
                <IconButton size="small" disabled={isSystemManaged}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Assign Lead">
              <IconButton size="small">
                <PersonAddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="More Actions">
              <IconButton size="small">
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Paper>
      {hasChildren && (
        <Collapse in={open} timeout="auto" unmountOnExit>
          {node.children.map((child: any) => (
            <TreeNode key={child.id} node={child} level={level + 1} />
          ))}
        </Collapse>
      )}
    </Box>
  );
};

const OrgTreeView: React.FC<OrgTreeViewProps> = ({ tenantId }) => {
  const [tree, setTree] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        // Fetch divisions
        const divisionsSnap = await getDocs(collection(db, 'tenants', tenantId, 'divisions'));
        const divisions = divisionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'Division', children: [] }));
        
        // Fetch departments
        const departmentsSnap = await getDocs(collection(db, 'tenants', tenantId, 'departments'));
        const departments = departmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'Department', children: [] }));
        
        // Fetch job titles from settings
        const settingsSnap = await getDoc(doc(db, 'tenants', tenantId, 'settings', 'main'));
        const jobTitles = settingsSnap.exists() ? (settingsSnap.data().jobTitles || []) : [];
        
        // Fetch workforce to count people per job title
        const workforceSnap = await getDocs(collection(db, 'users'));
        const workforce = workforceSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((user: any) => user.tenantId === tenantId && user.role === 'Worker');
        
        // Count people per job title
        const jobTitleCounts: Record<string, number> = {};
        workforce.forEach((worker: any) => {
          const jobTitle = worker.jobTitle || 'Unknown';
          jobTitleCounts[jobTitle] = (jobTitleCounts[jobTitle] || 0) + 1;
        });
        
        // Create job title nodes
        const jobTitleNodes = jobTitles.map((jobTitle: any) => ({
          id: `job_${jobTitle.title || jobTitle}`,
          name: jobTitle.title || jobTitle,
          type: 'Job Title',
          headcount: jobTitleCounts[jobTitle.title || jobTitle] || 0,
          children: []
        }));
        
        // Build tree: assign departments to their division, then job titles to departments
        const divisionMap: Record<string, any> = {};
        divisions.forEach(div => { divisionMap[div.id] = { ...div, children: [] }; });
        
        departments.forEach(dept => {
          const divisionId = (dept as any).division || (dept as any).divisionId;
          if (divisionId && divisionMap[divisionId]) {
            // Add job titles to this department (for now, all job titles go to all departments)
            // TODO: Filter job titles by department if we have that data
            divisionMap[divisionId].children.push({
              ...dept,
              children: jobTitleNodes
            });
          }
        });
        
        // Sort divisions to put Flex division first if it exists
        const sortedDivisions = Object.values(divisionMap).sort((a: any, b: any) => {
          if (a.id === 'auto_flex') return -1;
          if (b.id === 'auto_flex') return 1;
          return (a.name || '').localeCompare(b.name || '');
        });
        
        setTree(sortedDivisions);
      } catch (err: any) {
        setError(err.message || 'Failed to load org structure');
      }
      setLoading(false);
    };
    fetchData();
  }, [tenantId]);

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!tree.length) return <Typography>No divisions found.</Typography>;

  return (
    <Box>
      {tree.map((node: any) => (
        <TreeNode key={node.id} node={node} />
      ))}
    </Box>
  );
};

export default OrgTreeView; 