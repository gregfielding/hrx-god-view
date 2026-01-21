import React, { useState } from 'react';
import { Box, Typography, Tooltip, Chip, Stack, IconButton, Badge, Collapse } from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import SecurityIcon from '@mui/icons-material/Security';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PsychologyIcon from '@mui/icons-material/Psychology';
import LanguageIcon from '@mui/icons-material/Language';
import SchoolIcon from '@mui/icons-material/School';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

interface QuickInfoBarProps {
  // Document access
  resume?: {
    fileName: string;
    downloadUrl?: string;
    storagePath?: string;
  } | null;
  certifications?: Array<{
    name: string;
    fileUrl?: string;
    fileName?: string;
  }>;
  onResumeClick: () => void;
  onCertificationsClick: () => void;
  
  // Metrics
  profileScore?: number;
  certificationsCount?: number;
  activeApplicationsCount?: number;
  
  // At a Glance
  yearsExperience?: string;
  educationLevel?: string;
  primarySkills?: string[];
  languages?: string[]; // Array of language strings
  behavioralTraits?: string[]; // Array of behavioral/personality traits
  onSkillsClick?: () => void;
  
  // Compliance
  workEligibility?: boolean;
  backgroundCheckStatus?: string;
  vaccinationStatus?: string;
  onWorkEligibilityClick?: () => void;
  onBackgroundCheckClick?: () => void;
  onVaccinationClick?: () => void;
  
  onTabChange?: (tabLabel: string) => void; // For navigation to tabs
  
  isAdminView?: boolean;
}

type StatusType = 'complete' | 'pending' | 'failed' | 'unknown';

const QuickInfoBar: React.FC<QuickInfoBarProps> = ({
  resume,
  certifications = [],
  onResumeClick,
  onCertificationsClick,
  profileScore,
  certificationsCount = 0,
  activeApplicationsCount = 0,
  yearsExperience,
  educationLevel,
  primarySkills = [],
  languages = [],
  behavioralTraits = [],
  onSkillsClick,
  workEligibility,
  backgroundCheckStatus,
  vaccinationStatus,
  onWorkEligibilityClick,
  onBackgroundCheckClick,
  onVaccinationClick,
  onTabChange,
  isAdminView = false,
}) => {
  const getStatusIcon = (status: StatusType) => {
    switch (status) {
      case 'complete':
        return <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />;
      case 'pending':
        return <WarningIcon sx={{ fontSize: 16, color: 'warning.main' }} />;
      case 'failed':
        return <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />;
      default:
        return <HelpOutlineIcon sx={{ fontSize: 16, color: 'text.disabled' }} />;
    }
  };

  const getStatusType = (value: any, positiveValues: string[] = []): StatusType => {
    if (value === undefined || value === null) return 'unknown';
    if (typeof value === 'boolean') {
      return value ? 'complete' : 'failed';
    }
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (positiveValues.includes(normalized)) return 'complete';
      if (normalized === 'pending') return 'pending';
      if (normalized === 'failed' || normalized === 'expired') return 'failed';
      return 'unknown';
    }
    return 'unknown';
  };

  const workEligibilityStatus = getStatusType(workEligibility);
  const backgroundCheckStatusType = getStatusType(backgroundCheckStatus, ['passed', 'complete']);
  const vaccinationStatusType = (() => {
    if (!vaccinationStatus) return 'unknown' as StatusType;
    const normalized = vaccinationStatus.toLowerCase();
    if (normalized === 'up to date' || normalized === 'complete' || normalized === 'current') return 'complete' as StatusType;
    if (normalized === 'pending') return 'pending' as StatusType;
    if (normalized === 'exempt') return 'complete' as StatusType;
    return 'unknown' as StatusType;
  })();

  if (!isAdminView) {
    return null;
  }

  return (
    <Box
      sx={{
        mt: 1.5,
        pt: 1.5,
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* At a Glance Section - Enhanced Tag Board */}
      {(yearsExperience || educationLevel || (primarySkills && primarySkills.length > 0) || (languages && languages.length > 0) || (behavioralTraits && behavioralTraits.length > 0)) && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500, mb: 0.5, display: 'block' }}>
            AT A GLANCE
          </Typography>
          <Stack spacing={0.75}>
            {/* Experience & Education Row */}
            {(yearsExperience || educationLevel) && (
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                {yearsExperience && (
                  <Tooltip 
                    title="Years of Experience"
                    componentsProps={{
                      tooltip: {
                        sx: { color: 'white' }
                      }
                    }}
                  >
                    <Chip
                      size="small"
                      icon={<WorkHistoryIcon sx={{ fontSize: 14 }} />}
                      label={`${yearsExperience} ${yearsExperience === '1' ? 'Year' : 'Years'} Exp`}
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        bgcolor: 'grey.100',
                        fontWeight: 500,
                      }}
                    />
                  </Tooltip>
                )}
                {educationLevel && (
                  <Tooltip 
                    title="Highest Education Level"
                    componentsProps={{
                      tooltip: {
                        sx: { color: 'white' }
                      }
                    }}
                  >
                    <Chip
                      size="small"
                      icon={<SchoolIcon sx={{ fontSize: 14 }} />}
                      label={educationLevel}
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        bgcolor: 'grey.100',
                        fontWeight: 500,
                      }}
                    />
                  </Tooltip>
                )}
              </Stack>
            )}

            {/* Skills Row - Blue */}
            {primarySkills && primarySkills.length > 0 && (
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', mr: 0.5 }}>
                  💼 Skills:
                </Typography>
                {primarySkills.slice(0, 5).map((skill, index) => (
                  <Chip
                    key={index}
                    size="small"
                    label={skill}
                    onClick={onSkillsClick}
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      bgcolor: '#2196F3',
                      color: 'white',
                      fontWeight: 500,
                      cursor: onSkillsClick ? 'pointer' : 'default',
                      '&:hover': onSkillsClick ? {
                        bgcolor: '#1976D2',
                      } : {},
                    }}
                  />
                ))}
                {primarySkills.length > 5 && (
                  <Tooltip 
                    title={`${primarySkills.length - 5} more skills`}
                    componentsProps={{
                      tooltip: {
                        sx: { color: 'white' }
                      }
                    }}
                  >
                    <Chip
                      size="small"
                      label={`+${primarySkills.length - 5}`}
                      onClick={onSkillsClick}
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        bgcolor: 'grey.200',
                        fontWeight: 500,
                        cursor: onSkillsClick ? 'pointer' : 'default',
                      }}
                    />
                  </Tooltip>
                )}
              </Stack>
            )}

            {/* Languages Row - Green */}
            {languages && languages.length > 0 && (
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', mr: 0.5 }}>
                  🌍 Languages:
                </Typography>
                {languages.slice(0, 5).map((lang, index) => {
                  const langLabel = typeof lang === 'string' ? lang : (typeof lang === 'object' && lang !== null && 'language' in lang ? String((lang as any).language) : String(lang || ''));
                  return (
                    <Chip
                      key={index}
                      size="small"
                      label={langLabel}
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        bgcolor: '#4CAF50',
                        color: 'white',
                        fontWeight: 500,
                      }}
                    />
                  );
                })}
                {languages.length > 5 && (
                  <Chip
                    size="small"
                    label={`+${languages.length - 5}`}
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      bgcolor: 'grey.200',
                      fontWeight: 500,
                    }}
                  />
                )}
              </Stack>
            )}

            {/* Behavioral Traits Row - Yellow */}
            {behavioralTraits && behavioralTraits.length > 0 && (
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', mr: 0.5 }}>
                  🧠 Soft Skills:
                </Typography>
                {behavioralTraits.slice(0, 5).map((trait, index) => (
                  <Chip
                    key={index}
                    size="small"
                    label={trait}
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      bgcolor: '#FFC107',
                      color: '#000',
                      fontWeight: 500,
                    }}
                  />
                ))}
                {behavioralTraits.length > 5 && (
                  <Chip
                    size="small"
                    label={`+${behavioralTraits.length - 5}`}
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      bgcolor: 'grey.200',
                      fontWeight: 500,
                    }}
                  />
                )}
              </Stack>
            )}
          </Stack>
        </Box>
      )}

      {/* Metrics Section */}
      {(profileScore !== undefined || certificationsCount > 0 || activeApplicationsCount > 0) && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500, mb: 0.5, display: 'block' }}>
            METRICS
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {profileScore !== undefined && (
              <Tooltip
                title={
                  profileScore >= 80 
                    ? `Score ${profileScore} = Very competitive candidate. Profile is complete and ready for placement.`
                    : profileScore >= 60
                    ? `Score ${profileScore} = Good candidate. Some information may need updates.`
                    : profileScore >= 40
                    ? `Score ${profileScore} = Needs resume update. Missing key information.`
                    : `Score ${profileScore} = Missing key info. Profile requires significant completion.`
                }
                componentsProps={{
                  tooltip: {
                    sx: { color: 'white' }
                  }
                }}
              >
                <Chip
                  size="small"
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        Score:
                      </Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        {profileScore}
                      </Typography>
                    </Box>
                  }
                  sx={{
                    height: 22,
                    fontSize: '0.7rem',
                    bgcolor: profileScore >= 80 ? 'success.light' : profileScore >= 60 ? 'warning.light' : 'error.light',
                    '& .MuiChip-label': {
                      px: 1,
                    },
                  }}
                />
              </Tooltip>
            )}
            {certificationsCount > 0 && (
              <Tooltip 
                title="Number of certifications and licenses on file"
                componentsProps={{
                  tooltip: {
                    sx: { color: 'white' }
                  }
                }}
              >
                <Chip
                  size="small"
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        Certs:
                      </Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        {certificationsCount}
                      </Typography>
                    </Box>
                  }
                  sx={{
                    height: 22,
                    fontSize: '0.7rem',
                    bgcolor: 'grey.100',
                    '& .MuiChip-label': {
                      px: 1,
                    },
                  }}
                />
              </Tooltip>
            )}
            {activeApplicationsCount > 0 && (
              <Tooltip 
                title="Number of active job applications"
                componentsProps={{
                  tooltip: {
                    sx: { color: 'white' }
                  }
                }}
              >
                <Chip
                  size="small"
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        Applications:
                      </Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        {activeApplicationsCount}
                      </Typography>
                    </Box>
                  }
                  sx={{
                    height: 22,
                    fontSize: '0.7rem',
                    bgcolor: 'grey.100',
                    '& .MuiChip-label': {
                      px: 1,
                    },
                  }}
                />
              </Tooltip>
            )}
          </Stack>
        </Box>
      )}

      {/* Compliance Status Section */}
      {(workEligibility !== undefined || backgroundCheckStatus || vaccinationStatus) && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500, mb: 0.5, display: 'block' }}>
            COMPLIANCE
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {workEligibility !== undefined && (
              <Tooltip title={`Work Eligibility: ${workEligibility ? 'Eligible' : 'Not Eligible'}`}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: onWorkEligibilityClick ? 'pointer' : 'default',
                    '&:hover': onWorkEligibilityClick ? { opacity: 0.7 } : {},
                  }}
                  onClick={onWorkEligibilityClick}
                >
                  {getStatusIcon(workEligibilityStatus)}
                  <Chip
                    size="small"
                    label="Work Eligible"
                    color={workEligibilityStatus === 'complete' ? 'success' : workEligibilityStatus === 'failed' ? 'error' : 'default'}
                    sx={{ height: 22, fontSize: '0.7rem', fontWeight: 500 }}
                  />
                </Box>
              </Tooltip>
            )}
            {backgroundCheckStatus && (
              <Tooltip title={`Background Check: ${backgroundCheckStatus}`}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: onBackgroundCheckClick ? 'pointer' : 'default',
                    '&:hover': onBackgroundCheckClick ? { opacity: 0.7 } : {},
                  }}
                  onClick={onBackgroundCheckClick}
                >
                  {getStatusIcon(backgroundCheckStatusType)}
                  <Chip
                    size="small"
                    label="Background"
                    color={backgroundCheckStatusType === 'complete' ? 'success' : backgroundCheckStatusType === 'pending' ? 'warning' : backgroundCheckStatusType === 'failed' ? 'error' : 'default'}
                    sx={{ height: 22, fontSize: '0.7rem', fontWeight: 500 }}
                  />
                </Box>
              </Tooltip>
            )}
            {vaccinationStatus && (
              <Tooltip title={`Vaccination Status: ${vaccinationStatus}`}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: onVaccinationClick ? 'pointer' : 'default',
                    '&:hover': onVaccinationClick ? { opacity: 0.7 } : {},
                  }}
                  onClick={onVaccinationClick}
                >
                  {getStatusIcon(vaccinationStatusType)}
                  <Chip
                    size="small"
                    label="Vaccination"
                    color={vaccinationStatusType === 'complete' ? 'success' : vaccinationStatusType === 'pending' ? 'warning' : vaccinationStatusType === 'failed' ? 'error' : 'default'}
                    sx={{ height: 22, fontSize: '0.7rem', fontWeight: 500 }}
                  />
                </Box>
              </Tooltip>
            )}
          </Stack>
        </Box>
      )}
    </Box>
  );
};

export default QuickInfoBar;

