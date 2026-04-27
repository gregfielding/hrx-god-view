import React, { useMemo, useState } from 'react';
import { 
  Box, 
  Card, 
  CardHeader, 
  CardContent, 
  Typography, 
  Chip, 
  Stack, 
  Alert,
  Autocomplete,
  TextField,
  useTheme, 
  useMediaQuery,
  Divider
} from '@mui/material';
import { AddCircle, CheckCircle, Star } from '@mui/icons-material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../../firebase';
import onetSkills from '../../../data/onetSkills.json';
import onetJobTitles from '../../../data/onetJobTitles.json';

type Props = {
  value: any;
  onChange: (v: any) => void;
  context?: 'application' | 'profile';
  tenantId?: string;
  jobId?: string;
  jobPosting?: any;
};

const SkillsStep: React.FC<Props> = ({ value, onChange, context = 'application', tenantId, jobId, jobPosting }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const debounceRef = React.useRef<any>(null);
  const debouncedUpdate = (ref: any, data: any) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try { await updateDoc(ref, data); } catch {}
    }, 500);
  };

  // Get required skills from job posting
  // Check multiple possible field names and locations
  const requiredSkills = useMemo(() => {
    if (!jobPosting) {
      console.log('🔍 SkillsStep: No jobPosting provided');
      return [];
    }
    
    // Try multiple field names and locations
    const skills = jobPosting.skills || 
                   jobPosting.skillsRequired || 
                   jobPosting.requiredSkills ||
                   (jobPosting.requirements && Array.isArray(jobPosting.requirements.skills) ? jobPosting.requirements.skills : []) ||
                   (jobPosting.scoping && Array.isArray(jobPosting.scoping.skills) ? jobPosting.scoping.skills : []) ||
                   [];
    
    const normalized = Array.isArray(skills) 
      ? skills.filter(Boolean).map((s: any) => typeof s === 'string' ? s : (s?.name || s))
      : [];
    
    console.log('🔍 SkillsStep - Required Skills:', {
      jobPostingId: jobPosting.id,
      skillsField: jobPosting.skills,
      skillsRequiredField: jobPosting.skillsRequired,
      requiredSkillsField: jobPosting.requiredSkills,
      normalizedSkills: normalized,
      count: normalized.length
    });
    
    return normalized;
  }, [jobPosting]);

  // Get user's current skills
  const userSkills = useMemo(() => {
    const skills = value?.skills || [];
    if (!Array.isArray(skills)) return [];
    return skills.map((s: any) => {
      if (typeof s === 'string') return s;
      return s?.name || String(s);
    });
  }, [value?.skills]);

  // Separate required and optional skills
  const requiredSkillsAdded = useMemo(() => {
    return userSkills.filter(skill => requiredSkills.includes(skill));
  }, [userSkills, requiredSkills]);

  const optionalSkills = useMemo(() => {
    return userSkills.filter(skill => !requiredSkills.includes(skill));
  }, [userSkills, requiredSkills]);

  // Flatten all skills from onetSkills.json with categories
  const allAvailableSkillsWithCategories = useMemo(() => {
    const skillsMap: { [key: string]: { name: string; category: string } } = {};
    if (onetSkills && Array.isArray(onetSkills)) {
      onetSkills.forEach((skill: any) => {
        const skillName = skill?.name || skill;
        const category = skill?.category || 'Other';
        if (skillName && typeof skillName === 'string' && !skillsMap[skillName]) {
          skillsMap[skillName] = { name: skillName, category };
        }
      });
    }
    return skillsMap;
  }, []);

  const allAvailableSkills = useMemo(() => {
    return Object.keys(allAvailableSkillsWithCategories).sort();
  }, [allAvailableSkillsWithCategories]);

  // Find similar skills based on job title and required skills, grouped by category
  const suggestedSkillsByCategory = useMemo(() => {
    if (!jobPosting) return {};
    
    const jobTitle = (jobPosting.jobTitle || '').toLowerCase();
    const postTitle = (jobPosting.postTitle || '').toLowerCase();
    const allText = `${jobTitle} ${postTitle} ${requiredSkills.join(' ')}`.toLowerCase();
    
    // Keywords to match against
    const keywords: string[] = [];
    if (allText.includes('cook') || allText.includes('chef') || allText.includes('kitchen') || allText.includes('food')) {
      keywords.push('cook', 'cooking', 'food', 'kitchen', 'chef', 'prep', 'baking', 'cooking level', 'culinary', 'food safety', 'food handling', 'food service', 'food preparation', 'food presentation', 'food cost', 'butcher', 'sous chef', 'head chef', 'executive chef', 'pastry');
    }
    if (allText.includes('clean') || allText.includes('housekeep') || allText.includes('janitor')) {
      keywords.push('cleaning', 'housekeeping', 'sanitation', 'deep cleaning');
    }
    if (allText.includes('serve') || allText.includes('wait') || allText.includes('server')) {
      keywords.push('table service', 'customer service', 'waiting', 'serving');
    }
    if (allText.includes('warehouse') || allText.includes('forklift') || allText.includes('inventory')) {
      keywords.push('forklift', 'warehouse', 'inventory', 'shipping', 'receiving');
    }
    if (allText.includes('manufactur') || allText.includes('production') || allText.includes('assembly')) {
      keywords.push('manufacturing', 'production', 'assembly', 'quality control');
    }
    if (allText.includes('maintenance') || allText.includes('repair') || allText.includes('technician')) {
      keywords.push('maintenance', 'repair', 'troubleshooting', 'equipment maintenance');
    }
    
    // Find skills that match keywords
    const matches: { [category: string]: string[] } = {};
    Object.values(allAvailableSkillsWithCategories).forEach(({ name, category }) => {
      const skillLower = name.toLowerCase();
      if (keywords.some(keyword => skillLower.includes(keyword.toLowerCase()))) {
        if (!userSkills.includes(name) && !requiredSkills.includes(name)) {
          if (!matches[category]) matches[category] = [];
          matches[category].push(name);
        }
      }
    });
    
    // Also include skills that are similar to required skills
    requiredSkills.forEach((reqSkill: string) => {
      const reqLower = reqSkill.toLowerCase();
      Object.values(allAvailableSkillsWithCategories).forEach(({ name, category }) => {
        const skillLower = name.toLowerCase();
        if (skillLower.includes(reqLower) || reqLower.includes(skillLower)) {
          if (!userSkills.includes(name) && !requiredSkills.includes(name)) {
            if (!matches[category]) matches[category] = [];
            if (!matches[category].includes(name)) {
              matches[category].push(name);
            }
          }
        }
      });
    });
    
    // Sort skills within each category alphabetically
    Object.keys(matches).forEach(category => {
      matches[category].sort();
    });
    
    // Limit total to 18 skills, prioritizing Industry-Specific Skills
    const prioritized: { [category: string]: string[] } = {};
    const categoryOrder = ['Industry-Specific Skills', 'Technical Skills', 'Social Skills', 'Basic Skills', 'Resource Management Skills', 'Equipment Use/Maintenance Skills'];
    let total = 0;
    
    categoryOrder.forEach(cat => {
      if (matches[cat] && total < 18) {
        const remaining = 18 - total;
        prioritized[cat] = matches[cat].slice(0, remaining);
        total += prioritized[cat].length;
      }
    });
    
    // Add any remaining categories
    Object.keys(matches).forEach(cat => {
      if (!prioritized[cat] && total < 18) {
        const remaining = 18 - total;
        prioritized[cat] = matches[cat].slice(0, remaining);
        total += prioritized[cat].length;
      }
    });
    
    return prioritized;
  }, [jobPosting, requiredSkills, userSkills, allAvailableSkillsWithCategories]);

  // Skills that are required but not yet added by user
  const missingRequiredSkills = useMemo(() => {
    return requiredSkills.filter((skill: string) => !userSkills.includes(skill));
  }, [requiredSkills, userSkills]);

  // Check if all required skills are added
  const allRequiredSkillsAdded = useMemo(() => {
    return requiredSkills.length > 0 && missingRequiredSkills.length === 0;
  }, [requiredSkills.length, missingRequiredSkills.length]);

  // Handle adding a skill
  const handleAddSkill = (skillName: string) => {
    if (userSkills.includes(skillName)) return;
    
    // Get current skills from value, ensuring we work with the actual data structure
    const currentSkills = value?.skills || [];
    
    // Normalize existing skills to objects, then add new one
    const normalizedExisting = currentSkills.map((s: any) => {
      if (typeof s === 'string') {
        return { name: s, source: 'custom' as const, type: 'Other' };
      }
      // If already an object, preserve it but ensure it has required fields
      return {
        name: s?.name || String(s),
        source: s?.source || 'custom' as const,
        type: s?.type || 'Other'
      };
    });
    
    // Add new skill
    const normalizedSkills = [...normalizedExisting, { name: skillName, source: 'custom' as const, type: 'Other' }];
    
    onChange({ ...value, skills: normalizedSkills });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { 
        skills: normalizedSkills, 
        updatedAt: serverTimestamp() 
      });
    }
  };

  // Handle removing a skill
  const handleRemoveSkill = (skillName: string) => {
    const newSkills = userSkills.filter(s => {
      const name = typeof s === 'string' ? s : (s?.name || s);
      return name !== skillName;
    });
    const normalizedSkills = newSkills.map(s => typeof s === 'string' ? { name: s, source: 'custom' as const, type: 'Other' } : s);
    
    onChange({ ...value, skills: normalizedSkills });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { 
        skills: normalizedSkills, 
        updatedAt: serverTimestamp() 
      });
    }
  };

  // Handle autocomplete selection
  const handleAutocompleteChange = (_: any, newValue: string | null) => {
    if (newValue && !userSkills.includes(newValue)) {
      handleAddSkill(newValue);
    }
  };

  // Helper to get category display name with better grouping
  const getCategoryDisplayName = (category: string, skills: string[]): string => {
    // Check if skills are kitchen/food related
    const hasKitchen = skills.some(s => {
      const lower = s.toLowerCase();
      return lower.includes('cook') || lower.includes('chef') || lower.includes('baking') || 
             lower.includes('grill') || lower.includes('kitchen') || lower.includes('culinary');
    });
    
    const hasSafety = skills.some(s => {
      const lower = s.toLowerCase();
      return lower.includes('safety') || lower.includes('sanitation') || lower.includes('storage') || 
             lower.includes('handling') || lower.includes('haccp') || lower.includes('servsafe');
    });
    
    if (hasKitchen && category === 'Industry-Specific Skills') return 'Kitchen Skills';
    if (hasSafety && category === 'Industry-Specific Skills') return 'Food Handling & Safety';
    if (category.includes('Industry')) {
      if (skills.some(s => s.toLowerCase().includes('clean') || s.toLowerCase().includes('housekeep'))) {
        return 'Cleaning Skills';
      }
      if (skills.some(s => s.toLowerCase().includes('warehouse') || s.toLowerCase().includes('inventory'))) {
        return 'Warehouse Skills';
      }
    }
    
    const categoryMap: { [key: string]: string } = {
      'Industry-Specific Skills': 'Industry Skills',
      'Technical Skills': 'Technical Skills',
      'Social Skills': 'Customer Service Skills',
      'Basic Skills': 'General Skills',
      'Resource Management Skills': 'Management Skills',
      'Equipment Use/Maintenance Skills': 'Equipment Skills'
    };
    
    return categoryMap[category] || category;
  };

  // Get job role context for suggested skills
  const getJobRoleContext = () => {
    if (!jobPosting) return '';
    const jobTitle = (jobPosting.jobTitle || '').toLowerCase();
    const postTitle = (jobPosting.postTitle || '').toLowerCase();
    const allText = `${jobTitle} ${postTitle}`.toLowerCase();
    
    if (allText.includes('cook') || allText.includes('chef') || allText.includes('kitchen')) {
      return 'kitchen + food service';
    }
    if (allText.includes('cna') || allText.includes('nurse') || allText.includes('care')) {
      return 'CNA / care';
    }
    if (allText.includes('clean') || allText.includes('housekeep')) {
      return 'cleaning / housekeeping';
    }
    if (allText.includes('warehouse')) {
      return 'warehouse / logistics';
    }
    return 'this role';
  };

  return (
    <Box>
      {/* Required Skills Section */}
      {requiredSkills.length > 0 && (
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            🔑 Required Skills
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Must confirm before continuing
          </Typography>
          
          <Box 
            sx={{ 
              p: 2, 
              bgcolor: 'warning.50',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'warning.200'
            }}
          >
            <Stack spacing={1}>
              {requiredSkills.map((skill: string) => {
                const hasSkill = userSkills.includes(skill);
                return (
                  <Chip
                    key={skill}
                    label={hasSkill ? `✔ ${skill}` : skill}
                    onClick={() => !hasSkill && handleAddSkill(skill)}
                    color={hasSkill ? 'success' : 'default'}
                    variant={hasSkill ? 'filled' : 'outlined'}
                    sx={{
                      fontWeight: hasSkill ? 600 : 500,
                      cursor: hasSkill ? 'default' : 'pointer',
                      height: 40,
                      fontSize: '0.95rem',
                      transition: 'all 0.2s ease',
                      '&:hover': hasSkill ? {} : {
                        bgcolor: 'warning.main',
                        color: 'white',
                        borderColor: 'warning.main',
                        transform: 'scale(1.02)'
                      }
                    }}
                  />
                );
              })}
            </Stack>
          </Box>
        </Box>
      )}

      {/* Your Skills Section */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          ➕ Your Skills
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Add skills to qualify for more roles & higher pay
        </Typography>

        {/* Show added optional skills ABOVE search */}
        {optionalSkills.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {optionalSkills.map((skillName: string) => (
                <Chip
                  key={skillName}
                  label={skillName}
                  onDelete={() => handleRemoveSkill(skillName)}
                  color="default"
                  sx={{
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                    }
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {/* Search field */}
        <Autocomplete
          freeSolo
          options={allAvailableSkills}
          value={null}
          onChange={handleAutocompleteChange}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Type a skill… Baking, Food Safety, Prep Cook"
              fullWidth
            />
          )}
          sx={{ mb: 2 }}
        />

        {/* Empty state */}
        {optionalSkills.length === 0 && (
          <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              👋 You haven't added any extra skills yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Start typing or tap one below — it only takes a second.
            </Typography>
          </Box>
        )}
      </Box>

      {/* Suggested Skills Section */}
      {Object.keys(suggestedSkillsByCategory).length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            ⭐ Recommended Skills
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Relevant to this {getJobRoleContext()} role
          </Typography>
          
          <Box 
            sx={{ 
              p: 2, 
              bgcolor: 'grey.50', 
              borderRadius: 1, 
              border: '1px solid',
              borderColor: 'divider'
            }}
          >
            {Object.entries(suggestedSkillsByCategory).map(([category, skills], categoryIndex) => (
              <Box key={category} sx={{ mb: categoryIndex < Object.keys(suggestedSkillsByCategory).length - 1 ? 2.5 : 0 }}>
                <Typography 
                  variant="subtitle2" 
                  sx={{ 
                    fontWeight: 600, 
                    mb: 1.5, 
                    color: 'text.primary',
                    fontSize: '0.9rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}
                >
                  {getCategoryDisplayName(category, skills)}
                </Typography>
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {skills.map((skill) => {
                    const isSelected = userSkills.includes(skill);
                    return (
                      <Chip
                        key={skill}
                        label={skill}
                        onClick={() => !isSelected && handleAddSkill(skill)}
                        variant={isSelected ? 'filled' : 'outlined'}
                        color={isSelected ? 'success' : 'default'}
                        icon={isSelected ? <CheckCircle /> : undefined}
                        sx={{
                          cursor: isSelected ? 'default' : 'pointer',
                          transition: 'all 0.2s ease',
                          '&:hover': isSelected ? {} : { 
                            bgcolor: 'primary.light', 
                            color: 'white', 
                            borderColor: 'primary.light',
                            transform: 'translateY(-2px)',
                            boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                          },
                          '&:active': {
                            transform: 'translateY(0px)'
                          },
                          '& .MuiChip-icon': { color: 'inherit' }
                        }}
                      />
                    );
                  })}
                </Stack>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default SkillsStep;
