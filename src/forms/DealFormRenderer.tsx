import React, { useEffect, useMemo, useState } from 'react';
import { Box, Grid, TextField, FormControl, InputLabel, Select, MenuItem, FormControlLabel, Checkbox } from '@mui/material';
import { getFieldDef } from '../fields/useFieldDef';
import { getValue, setValue } from './dealStageAdapter';
import { discoveryFieldIds, discoveryOverrides } from './dealStages/discovery';
import { qualificationFieldIds, qualificationOverrides } from './dealStages/qualification';
import { scopingFieldIds, scopingOverrides } from './dealStages/scoping';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

type DealFormRendererProps = {
  deal: any;
  tenantId: string;
  stage: 'discovery' | 'qualification' | 'scoping';
  onSaved?: () => void;
  featureEnabled?: boolean;
};

export const DealFormRenderer: React.FC<DealFormRendererProps> = ({ deal, tenantId, stage, onSaved, featureEnabled = false }) => {
  const fieldIds = useMemo(() => {
    if (stage === 'discovery') return discoveryFieldIds;
    if (stage === 'qualification') return qualificationFieldIds;
    if (stage === 'scoping') return scopingFieldIds;
    return [];
  }, [stage]);
  const overrides = useMemo(() => {
    if (stage === 'discovery') return discoveryOverrides;
    if (stage === 'qualification') return qualificationOverrides;
    if (stage === 'scoping') return scopingOverrides as any;
    return {} as any;
  }, [stage]);
  const [draft, setDraft] = useState<any>(deal);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(deal);
  }, [deal?.id]);

  if (!featureEnabled) {
    return null;
  }

  const handleChange = (fieldId: string, value: any) => {
    setDraft((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      setValue(fieldId, value, next);
      return next;
    });
  };

  const handleBlur = async () => {
    if (!tenantId || !draft?.id) return;
    try {
      setSaving(true);
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', draft.id), {
        stageData: draft.stageData || {},
        updatedAt: new Date()
      });
      onSaved && onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Grid container spacing={2}>
        {fieldIds.map((fieldId) => {
          const def = getFieldDef(fieldId);
          const ov = overrides[fieldId] || {};
          const label = def?.label || fieldId;
          const value = getValue(fieldId, draft) ?? '';

          switch (def?.type) {
            case 'boolean':
              return (
                <Grid key={fieldId} item xs={12} md={6}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={!!value}
                        onChange={(e) => handleChange(fieldId, e.target.checked)}
                        onBlur={handleBlur}
                      />
                    }
                    label={label}
                  />
                </Grid>
              );
            case 'select':
              return (
                <Grid key={fieldId} item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>{label}</InputLabel>
                    <Select
                      value={value}
                      label={label}
                      onChange={(e) => handleChange(fieldId, e.target.value)}
                      onBlur={handleBlur}
                    >
                      {(def.options || []).map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              );
            default:
              return (
                <Grid key={fieldId} item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label={label}
                    value={value}
                    onChange={(e) => handleChange(fieldId, e.target.value)}
                    onBlur={handleBlur}
                    required={!!ov.required}
                  />
                </Grid>
              );
          }
        })}
      </Grid>
      {/* saving state reserved for future inline indicator */}
    </Box>
  );
};

export default DealFormRenderer;


