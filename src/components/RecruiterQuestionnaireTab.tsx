import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Checkbox,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Alert,
  Grid,
  Card,
  CardContent,
  CardHeader,
  CircularProgress
} from '@mui/material';
import { Work as WorkIcon } from '@mui/icons-material';

interface RecruiterQuestionnaireTabProps {
  deal: any;
  tenantId: string;
  stageData: any;
  questionnaire: any;
  onQuestionnaireChange: (data: any) => void;
  onSubmit: () => void;
  canSubmit: boolean;
}

const RecruiterQuestionnaireTab: React.FC<RecruiterQuestionnaireTabProps> = ({ 
  deal, 
  tenantId, 
  stageData, 
  questionnaire, 
  onQuestionnaireChange, 
  onSubmit, 
  canSubmit 
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>({});

  // Initialize form data from stage data when component mounts
  useEffect(() => {
    if (stageData && Object.keys(stageData).length > 0) {
      const initialData = {
        // Discovery Stage - matches Deal Stages structure exactly
        discovery: {
          usesAgencies: stageData.discovery?.usesAgencies || false,
          currentStaffCount: stageData.discovery?.currentStaffCount || '',
          currentAgencyCount: stageData.discovery?.currentAgencyCount || '',
          jobTitles: stageData.discovery?.jobTitles || [],
          shifts: stageData.discovery?.shifts || [],
          satisfactionLevel: stageData.discovery?.satisfactionLevel || '',
          struggles: stageData.discovery?.struggles || [],
          onsiteSupervisor: stageData.discovery?.onsiteSupervisor || false,
          seasonalOrYearRound: stageData.discovery?.seasonalOrYearRound || '',
          hasUsedBefore: stageData.discovery?.hasUsedBefore || false,
          lastUsed: stageData.discovery?.lastUsed || '',
          reasonStopped: stageData.discovery?.reasonStopped || '',
          openToUsingAgain: stageData.discovery?.openToUsingAgain || false,
          strugglingToHire: stageData.discovery?.strugglingToHire || false,
          openToAgency: stageData.discovery?.openToAgency || false,
          noInterest: stageData.discovery?.noInterest || false,
          dripMarketingTag: stageData.discovery?.dripMarketingTag || '',
          additionalContacts: stageData.discovery?.additionalContacts || [],
          notes: stageData.discovery?.notes || ''
        },
        // Qualification Stage - matches Deal Stages structure exactly
        qualification: {
          openToNewAgency: stageData.qualification?.openToNewAgency || false,
          decisionMakers: stageData.qualification?.decisionMakers || [],
          mustHave: stageData.qualification?.mustHave || '',
          mustAvoid: stageData.qualification?.mustAvoid || '',
          potentialObstacles: stageData.qualification?.potentialObstacles || [],
          staffPlacementTimeline: {
            starting: stageData.qualification?.staffPlacementTimeline?.starting || '',
            after30Days: stageData.qualification?.staffPlacementTimeline?.after30Days || '',
            after90Days: stageData.qualification?.staffPlacementTimeline?.after90Days || '',
            after180Days: stageData.qualification?.staffPlacementTimeline?.after180Days || ''
          },
          expectedAveragePayRate: stageData.qualification?.expectedAveragePayRate || '',
          expectedAverageMarkup: stageData.qualification?.expectedAverageMarkup || '',
          vendorSetupSteps: {
            step1: stageData.qualification?.vendorSetupSteps?.step1 || '',
            step2: stageData.qualification?.vendorSetupSteps?.step2 || '',
            step3: stageData.qualification?.vendorSetupSteps?.step3 || '',
            step4: stageData.qualification?.vendorSetupSteps?.step4 || ''
          },
          expectedCloseDate: stageData.qualification?.expectedCloseDate || '',
          notes: stageData.qualification?.notes || ''
        },
        // Scoping Stage - matches Deal Stages structure exactly
        scoping: {
          competingAgencies: stageData.scoping?.competingAgencies || '',
          replaceAgency: stageData.scoping?.replaceAgency || false,
          rolloverStaff: stageData.scoping?.rolloverStaff || false,
          onsite: stageData.scoping?.onsite || false,
          compliance: {
            backgroundCheck: stageData.scoping?.compliance?.backgroundCheck || false,
            backgroundCheckDetails: stageData.scoping?.compliance?.backgroundCheckDetails || '',
            drugScreen: stageData.scoping?.compliance?.drugScreen || false,
            drugScreenDetails: stageData.scoping?.compliance?.drugScreenDetails || '',
            eVerify: stageData.scoping?.compliance?.eVerify || false,
            ppe: stageData.scoping?.compliance?.ppe || [],
            dressCode: stageData.scoping?.compliance?.dressCode || ''
          },
          shiftPolicies: {
            timeclockSystem: stageData.scoping?.shiftPolicies?.timeclockSystem || '',
            overtime: stageData.scoping?.shiftPolicies?.overtime || '',
            attendance: stageData.scoping?.shiftPolicies?.attendance || '',
            callOff: stageData.scoping?.shiftPolicies?.callOff || '',
            noCallNoShow: stageData.scoping?.shiftPolicies?.noCallNoShow || '',
            discipline: stageData.scoping?.shiftPolicies?.discipline || '',
            injuryReporting: stageData.scoping?.shiftPolicies?.injuryReporting || ''
          },
          invoicing: {
            poRequired: stageData.scoping?.invoicing?.poRequired || false,
            paymentTerms: stageData.scoping?.invoicing?.paymentTerms || '',
            deliveryMethod: stageData.scoping?.invoicing?.deliveryMethod || '',
            frequency: stageData.scoping?.invoicing?.frequency || ''
          },
          contactRoles: {
            hr: stageData.scoping?.contactRoles?.hr || null,
            operations: stageData.scoping?.contactRoles?.operations || null,
            procurement: stageData.scoping?.contactRoles?.procurement || null,
            billing: stageData.scoping?.contactRoles?.billing || null,
            safety: stageData.scoping?.contactRoles?.safety || null,
            invoice: stageData.scoping?.contactRoles?.invoice || null
          },
          preApproval: stageData.scoping?.preApproval || false,
          notes: stageData.scoping?.notes || ''
        },
        // Ready for Recruiter
        readyForRecruiter: questionnaire.readyForRecruiter || false
      };
      
      setFormData(initialData);
    }
  }, [stageData, questionnaire.readyForRecruiter]);

  const handleFormChange = (section: string, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
  };

  const handleNestedChange = (section: string, subsection: string, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [subsection]: {
          ...prev[section]?.[subsection],
          [field]: value
        }
      }
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Validate required fields for qualifying questions
      const requiredFields = [
        'discovery.usesAgencies',
        'discovery.currentStaffCount',
        'discovery.currentAgencyCount',
        'discovery.jobTitles',
        'discovery.shifts',
        'discovery.onsiteSupervisor',
        'discovery.seasonalOrYearRound'
      ];

      // Additional validation: if usesAgencies is true, currentAgencyCount is required
      if (formData.discovery?.usesAgencies === true && !formData.discovery?.currentAgencyCount) {
        setError('Current Agency Count is required when using staffing agencies');
        setLoading(false);
        return;
      }

      const missingFields = requiredFields.filter(field => {
        const [section, subsection, subfield] = field.split('.');
        if (subsection && subfield) {
          return !formData[section]?.[subsection]?.[subfield];
        }
        return !formData[section]?.[subsection || section];
      });

      if (missingFields.length > 0) {
        setError(`Please complete all required fields: ${missingFields.join(', ')}`);
        setLoading(false);
        return;
      }

      // Save form data back to Deal Stages in Firestore
      try {
        const { doc, updateDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        
        // Update the deal's stage data with the form data
        const updatedStageData = {
          ...stageData,
          discovery: {
            ...stageData.discovery,
            ...formData.discovery
          },
          qualification: {
            ...stageData.qualification,
            ...formData.qualification
          },
          scoping: {
            ...stageData.scoping,
            ...formData.scoping
          }
        };

        // Save to Firestore
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
          stageData: updatedStageData,
          updatedAt: new Date()
        });

        console.log('✅ Recruiter questionnaire data saved to Deal Stages');
      } catch (firestoreError) {
        console.error('Error saving to Firestore:', firestoreError);
        // Continue with submission even if Firestore save fails
      }

      // Update questionnaire with form data
      onQuestionnaireChange({
        ...questionnaire,
        readyForRecruiter: formData.readyForRecruiter,
        formData: formData
      });

      // Call the original onSubmit
      await onSubmit();
      
    } catch (err) {
      setError('Failed to submit questionnaire. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderTextField = (section: string, field: string, label: string, required = false, type = 'text', multiline = false) => (
    <Grid item xs={12} md={6}>
      <TextField
        label={label}
        value={formData[section]?.[field] || ''}
        onChange={(e) => handleFormChange(section, field, e.target.value)}
        fullWidth
        required={required}
        type={type}
        multiline={multiline}
        rows={multiline ? 3 : 1}
        size="small"
        InputLabelProps={type === 'date' ? { shrink: true } : undefined}
      />
    </Grid>
  );

  const renderNumberField = (section: string, field: string, label: string, required = false) => (
    <Grid item xs={12} md={6}>
      <TextField
        label={label}
        value={formData[section]?.[field] || ''}
        onChange={(e) => handleFormChange(section, field, parseFloat(e.target.value) || '')}
        fullWidth
        required={required}
        type="number"
        size="small"
        inputProps={{ min: 0, step: 0.01 }}
      />
    </Grid>
  );

  const renderCheckbox = (section: string, field: string, label: string) => (
    <Grid item xs={12} md={6}>
      <FormControlLabel
        control={
          <Checkbox
            checked={formData[section]?.[field] || false}
            onChange={(e) => handleFormChange(section, field, e.target.checked)}
            color="primary"
          />
        }
        label={label}
      />
    </Grid>
  );

  const renderSelect = (section: string, field: string, label: string, options: string[], required = false) => (
    <Grid item xs={12} md={6}>
      <FormControl fullWidth size="small" required={required}>
        <InputLabel>{label}</InputLabel>
        <Select
          value={formData[section]?.[field] || ''}
          onChange={(e) => handleFormChange(section, field, e.target.value)}
          label={label}
        >
          {options.map((option) => (
            <MenuItem key={option} value={option}>
              {option.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Grid>
  );

  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
          Recruiter Questionnaire
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Complete this comprehensive questionnaire to prepare job orders for the recruiter team. 
          This information will be used to generate detailed job orders in the Recruiter module.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Discovery Stage Section - Qualifying Questions */}
      <Card sx={{ mb: 3 }}>
        <CardHeader 
          title="Qualifying Questions" 
          subheader="Essential information to understand the client's staffing needs"
        />
        <CardContent>
          <Grid container spacing={2}>
            {/* Primary qualifying questions - all required */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2, color: 'primary.main' }}>
                Primary Requirements (All Required)
              </Typography>
            </Grid>
            
            {renderCheckbox('discovery', 'usesAgencies', 'Do they currently use staffing agencies? *')}
            
            {/* Conditional fields based on usesAgencies */}
            {formData.discovery?.usesAgencies && (
              <>
                {renderNumberField('discovery', 'currentStaffCount', 'Current Staff Count *', true)}
                {renderNumberField('discovery', 'currentAgencyCount', 'Current Agency Count *', true)}
              </>
            )}
            
            {renderTextField('discovery', 'struggles', 'Current struggles', false, 'text', true)}
            {renderTextField('discovery', 'jobTitles', 'Job Titles Needed *', true, 'text', true)}
            {renderTextField('discovery', 'shifts', 'Shifts Needed *', true, 'text', true)}
            {renderCheckbox('discovery', 'onsiteSupervisor', 'OnSite Supervisor Required *')}
            {renderSelect('discovery', 'seasonalOrYearRound', 'Seasonal or Year Round *', ['seasonal', 'year_round'], true)}
            
            <Grid item xs={12}>
              <TextField
                label="Additional Notes"
                value={formData.discovery?.notes || ''}
                onChange={(e) => handleFormChange('discovery', 'notes', e.target.value)}
                fullWidth
                multiline
                rows={3}
                size="small"
                placeholder="Any additional information about the client's staffing situation..."
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Qualification Stage Section */}
      <Card sx={{ mb: 3 }}>
        <CardHeader 
          title="Qualification Stage Information" 
          subheader="Client requirements and timeline details"
        />
        <CardContent>
          <Grid container spacing={2}>
            {renderCheckbox('qualification', 'openToNewAgency', 'Open to new agency')}
            {renderTextField('qualification', 'mustHave', 'Must have requirements')}
            {renderTextField('qualification', 'mustAvoid', 'Must avoid')}
            {renderTextField('qualification', 'potentialObstacles', 'Potential obstacles', false, 'text', true)}
            
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Staff Placement Timeline
              </Typography>
            </Grid>
            {renderNumberField('qualification', 'staffPlacementTimeline.starting', 'Starting count', true)}
            {renderNumberField('qualification', 'staffPlacementTimeline.after30Days', 'After 30 days')}
            {renderNumberField('qualification', 'staffPlacementTimeline.after90Days', 'After 90 days')}
            {renderNumberField('qualification', 'staffPlacementTimeline.after180Days', 'After 180 days')}
            
            {renderNumberField('qualification', 'expectedAveragePayRate', 'Expected average pay rate ($/hr) *', true)}
            {renderNumberField('qualification', 'expectedAverageMarkup', 'Expected average markup (%)')}
            {renderTextField('qualification', 'expectedCloseDate', 'Expected close date *', true, 'date')}
            
            <Grid item xs={12}>
              <TextField
                label="Additional Notes"
                value={formData.qualification?.notes || ''}
                onChange={(e) => handleFormChange('qualification', 'notes', e.target.value)}
                fullWidth
                multiline
                rows={3}
                size="small"
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Scoping Stage Section */}
      <Card sx={{ mb: 3 }}>
        <CardHeader 
          title="Scoping Stage Information" 
          subheader="Detailed requirements and compliance information"
        />
        <CardContent>
          <Grid container spacing={2}>
            {renderNumberField('scoping', 'competingAgencies', 'Number of competing agencies')}
            {renderCheckbox('scoping', 'replaceAgency', 'Replacing existing agency')}
            {renderCheckbox('scoping', 'rolloverStaff', 'Rollover existing staff')}
            {renderCheckbox('scoping', 'onsite', 'Onsite work required')}
            
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Compliance Requirements
              </Typography>
            </Grid>
            {renderCheckbox('scoping', 'compliance.backgroundCheck', 'Background check required *')}
            {renderTextField('scoping', 'compliance.backgroundCheckDetails', 'Background check details')}
            {renderCheckbox('scoping', 'compliance.drugScreen', 'Drug screen required *')}
            {renderTextField('scoping', 'compliance.drugScreenDetails', 'Drug screen details')}
            {renderCheckbox('scoping', 'compliance.eVerify', 'E-Verify required')}
            {renderTextField('scoping', 'compliance.ppe', 'PPE requirements')}
            {renderTextField('scoping', 'compliance.dressCode', 'Dress code requirements')}
            
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Shift Policies
              </Typography>
            </Grid>
            {renderTextField('scoping', 'shiftPolicies.timeclockSystem', 'Timeclock system')}
            {renderTextField('scoping', 'shiftPolicies.overtime', 'Overtime policy')}
            {renderTextField('scoping', 'shiftPolicies.attendance', 'Attendance policy')}
            {renderTextField('scoping', 'shiftPolicies.callOff', 'Call-off policy')}
            {renderTextField('scoping', 'shiftPolicies.noCallNoShow', 'No-call no-show policy')}
            {renderTextField('scoping', 'shiftPolicies.discipline', 'Discipline policy')}
            {renderTextField('scoping', 'shiftPolicies.injuryReporting', 'Injury reporting policy')}
            
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Invoicing & Payment
              </Typography>
            </Grid>
            {renderCheckbox('scoping', 'invoicing.poRequired', 'PO required')}
            {renderTextField('scoping', 'invoicing.paymentTerms', 'Payment terms')}
            {renderSelect('scoping', 'invoicing.deliveryMethod', 'Delivery method', ['email', 'portal', 'mail'])}
            {renderSelect('scoping', 'invoicing.frequency', 'Billing frequency', ['weekly', 'biweekly', 'monthly'])}
            
            <Grid item xs={12}>
              <TextField
                label="Additional Notes"
                value={formData.scoping?.notes || ''}
                onChange={(e) => handleFormChange('scoping', 'notes', e.target.value)}
                fullWidth
                multiline
                rows={3}
                size="small"
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Ready for Recruiter Toggle */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Ready for Recruiter
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Toggle this when you're ready to hand off to the recruiter team
              </Typography>
            </Box>
            <Checkbox
              checked={formData.readyForRecruiter}
              onChange={(e) => handleFormChange('readyForRecruiter', 'readyForRecruiter', e.target.checked)}
              color="primary"
            />
          </Box>
        </CardContent>
      </Card>

      {/* Submit Button */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 4 }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleSubmit}
          disabled={!canSubmit || !formData.readyForRecruiter || loading}
          startIcon={loading ? <CircularProgress size={20} /> : <WorkIcon />}
          sx={{ minWidth: 200 }}
        >
          {loading ? 'Submitting...' : 'Submit to Recruiter'}
        </Button>
      </Box>

      {!canSubmit && (
        <Alert severity="info" sx={{ mt: 2 }}>
          This feature is available once the deal reaches "Verbal Agreement" or "Closed Won" stage.
        </Alert>
      )}
    </Box>
  );
};

export default RecruiterQuestionnaireTab;
