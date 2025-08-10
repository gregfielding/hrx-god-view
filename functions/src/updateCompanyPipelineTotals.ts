import { onCall } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

interface PipelineTotals {
  low: number;
  high: number;
  dealCount: number;
}

interface ClosedTotals {
  total: number;
  dealCount: number;
}

interface LocationTotals {
  pipelineValue: PipelineTotals;
  closedValue: ClosedTotals;
}

interface DivisionTotals {
  [divisionName: string]: {
    pipelineValue: PipelineTotals;
    closedValue: ClosedTotals;
    locations: string[];
  };
}

interface CompanyTotals {
  pipelineValue: PipelineTotals;
  closedValue: ClosedTotals;
  divisions: DivisionTotals;
  locations: LocationTotals[];
}

// Utility function to calculate expected revenue range from qualification data
const calculateExpectedRevenueRange = (stageData: any) => {
  if (!stageData?.qualification) {
    return { min: 0, max: 0, hasData: false };
  }

  const qualData = stageData.qualification;
  const payRate = qualData.expectedAveragePayRate || 16; // Default to $16
  const markup = qualData.expectedAverageMarkup || 40; // Default to 40%
  const timeline = qualData.staffPlacementTimeline;

  if (!timeline) {
    return { min: 0, max: 0, hasData: false };
  }

  // Calculate bill rate: pay rate + markup
  const billRate = payRate * (1 + markup / 100);
  
  // Annual hours per employee (2080 full-time hours)
  const annualHoursPerEmployee = 2080;
  
  // Calculate annual revenue per employee
  const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
  
  // Get starting and 180-day numbers
  const startingCount = timeline.starting || 0;
  const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
  
  // Calculate revenue range
  const minRevenue = annualRevenuePerEmployee * startingCount;
  const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
  
  return {
    min: minRevenue,
    max: maxRevenue,
    hasData: startingCount > 0 || after180DaysCount > 0
  };
};

export const updateCompanyPipelineTotals = onCall(async (request) => {
  try {
    const { tenantId, companyId } = request.data;
    const db = admin.firestore();
    
    // Get company data
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      throw new Error(`Company ${companyId} not found`);
    }
    
    // Get all deals for this company
    const dealsRef = db.collection(`tenants/${tenantId}/crm_deals`);
    const dealsQuery = dealsRef.where('companyId', '==', companyId);
    const dealsSnapshot = await dealsQuery.get();
    
    const deals = dealsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    // Get company locations
    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
    const locationsSnapshot = await locationsRef.get();
    const locations = locationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    // Initialize totals structure
    const companyTotals: CompanyTotals = {
      pipelineValue: { low: 0, high: 0, dealCount: 0 },
      closedValue: { total: 0, dealCount: 0 },
      divisions: {},
      locations: []
    };

    // Calculate totals for each location
    const locationTotals: { [locationId: string]: LocationTotals } = {};
    
    for (const location of locations) {
      const locationDeals = deals.filter(deal => deal.locationId === location.id);
      
      // Calculate pipeline deals for this location
      const pipelineDeals = locationDeals.filter(deal => 
        deal.status !== 'closed' && deal.status !== 'lost'
      );
      
      let locationPipelineLow = 0;
      let locationPipelineHigh = 0;
      
      pipelineDeals.forEach(deal => {
        // Calculate revenue range from qualification data
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        
        if (revenueRange.hasData) {
          locationPipelineLow += revenueRange.min;
          locationPipelineHigh += revenueRange.max;
        }
      });

      // Calculate closed deals for this location
      const closedDeals = locationDeals.filter(deal => 
        deal.status === 'closed'
      );
      
      let locationClosedValue = 0;
      
      closedDeals.forEach(deal => {
        // Calculate revenue range from qualification data
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        
        if (revenueRange.hasData) {
          // Use average of min and max for closed deals
          locationClosedValue += (revenueRange.min + revenueRange.max) / 2;
        }
      });

      const locationTotal: LocationTotals = {
        pipelineValue: {
          low: locationPipelineLow,
          high: locationPipelineHigh,
          dealCount: pipelineDeals.length
        },
        closedValue: {
          total: locationClosedValue,
          dealCount: closedDeals.length
        }
      };

      locationTotals[location.id] = locationTotal;
      companyTotals.locations.push(locationTotal);

      // Update location document with its totals
      const locationRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${location.id}`);
      await locationRef.update({
        pipelineValue: locationTotal.pipelineValue,
        closedValue: locationTotal.closedValue,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Aggregate to divisions if location has a division
      if (location.division) {
        if (!companyTotals.divisions[location.division]) {
          companyTotals.divisions[location.division] = {
            pipelineValue: { low: 0, high: 0, dealCount: 0 },
            closedValue: { total: 0, dealCount: 0 },
            locations: []
          };
        }
        
        const division = companyTotals.divisions[location.division];
        division.pipelineValue.low += locationPipelineLow;
        division.pipelineValue.high += locationPipelineHigh;
        division.pipelineValue.dealCount += pipelineDeals.length;
        division.closedValue.total += locationClosedValue;
        division.closedValue.dealCount += closedDeals.length;
        division.locations.push(location.id);
      }

      // Aggregate to company totals
      companyTotals.pipelineValue.low += locationPipelineLow;
      companyTotals.pipelineValue.high += locationPipelineHigh;
      companyTotals.pipelineValue.dealCount += pipelineDeals.length;
      companyTotals.closedValue.total += locationClosedValue;
      companyTotals.closedValue.dealCount += closedDeals.length;
    }

    // Handle deals without specific locations (aggregate to company level)
    const dealsWithoutLocation = deals.filter(deal => !deal.locationId);
    
    if (dealsWithoutLocation.length > 0) {
      const pipelineDeals = dealsWithoutLocation.filter(deal => 
        deal.status !== 'closed' && deal.status !== 'lost'
      );
      
      let companyPipelineLow = 0;
      let companyPipelineHigh = 0;
      
      pipelineDeals.forEach(deal => {
        // Calculate revenue range from qualification data
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        
        if (revenueRange.hasData) {
          companyPipelineLow += revenueRange.min;
          companyPipelineHigh += revenueRange.max;
        }
      });

      const closedDeals = dealsWithoutLocation.filter(deal => 
        deal.status === 'closed'
      );
      
      let companyClosedValue = 0;
      
      closedDeals.forEach(deal => {
        // Calculate revenue range from qualification data
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        
        if (revenueRange.hasData) {
          // Use average of min and max for closed deals
          companyClosedValue += (revenueRange.min + revenueRange.max) / 2;
        }
      });

      // Add to company totals
      companyTotals.pipelineValue.low += companyPipelineLow;
      companyTotals.pipelineValue.high += companyPipelineHigh;
      companyTotals.pipelineValue.dealCount += pipelineDeals.length;
      companyTotals.closedValue.total += companyClosedValue;
      companyTotals.closedValue.dealCount += closedDeals.length;
    }

    // Update company document with hierarchical totals
    await companyRef.update({
      pipelineValue: companyTotals.pipelineValue,
      closedValue: companyTotals.closedValue,
      divisionTotals: companyTotals.divisions,
      locationTotals: locationTotals,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Updated company ${companyId} hierarchical pipeline totals:`, {
      company: {
        pipeline: companyTotals.pipelineValue,
        closed: companyTotals.closedValue
      },
      divisions: Object.keys(companyTotals.divisions).length,
      locations: companyTotals.locations.length
    });

    return {
      success: true,
      companyTotals
    };

  } catch (error) {
    console.error('❌ Error updating pipeline totals:', error);
    throw new Error(`Failed to update pipeline totals: ${error}`);
  }
});

// 🔥 AUTOMATIC TRIGGER: Update pipeline totals when a deal is updated
export const onDealUpdated = onDocumentUpdated('tenants/{tenantId}/crm_deals/{dealId}', async (event) => {
  try {
    const dealData = event.data?.after?.data();
    const dealId = event.params.dealId;
    const tenantId = event.params.tenantId;

    if (!dealData || !dealData.companyId) {
      console.log(`⚠️ Deal ${dealId} has no companyId, skipping pipeline update`);
      return;
    }

    console.log(`🔄 Deal ${dealId} updated, triggering pipeline totals update for company ${dealData.companyId}`);

    const db = admin.firestore();
    
    // Get company data
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${dealData.companyId}`);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      console.log(`⚠️ Company ${dealData.companyId} not found, skipping pipeline update`);
      return;
    }
    
    // Get all deals for this company
    const dealsRef = db.collection(`tenants/${tenantId}/crm_deals`);
    const dealsQuery = dealsRef.where('companyId', '==', dealData.companyId);
    const dealsSnapshot = await dealsQuery.get();
    
    const deals = dealsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    // Get company locations
    const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${dealData.companyId}/locations`);
    const locationsSnapshot = await locationsRef.get();
    const locations = locationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    // Initialize totals structure
    const companyTotals: CompanyTotals = {
      pipelineValue: { low: 0, high: 0, dealCount: 0 },
      closedValue: { total: 0, dealCount: 0 },
      divisions: {},
      locations: []
    };

    // Calculate totals for each location
    const locationTotals: { [locationId: string]: LocationTotals } = {};
    
    for (const location of locations) {
      const locationDeals = deals.filter(deal => deal.locationId === location.id);
      
      // Calculate pipeline deals for this location
      const pipelineDeals = locationDeals.filter(deal => 
        deal.status !== 'closed' && deal.status !== 'lost'
      );
      
      let locationPipelineLow = 0;
      let locationPipelineHigh = 0;
      
      pipelineDeals.forEach(deal => {
        // Calculate revenue range from qualification data
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        
        if (revenueRange.hasData) {
          locationPipelineLow += revenueRange.min;
          locationPipelineHigh += revenueRange.max;
        }
      });

      // Calculate closed deals for this location
      const closedDeals = locationDeals.filter(deal => 
        deal.status === 'closed'
      );
      
      let locationClosedValue = 0;
      
      closedDeals.forEach(deal => {
        // Calculate revenue range from qualification data
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        
        if (revenueRange.hasData) {
          // Use average of min and max for closed deals
          locationClosedValue += (revenueRange.min + revenueRange.max) / 2;
        }
      });

      const locationTotal: LocationTotals = {
        pipelineValue: {
          low: locationPipelineLow,
          high: locationPipelineHigh,
          dealCount: pipelineDeals.length
        },
        closedValue: {
          total: locationClosedValue,
          dealCount: closedDeals.length
        }
      };

      locationTotals[location.id] = locationTotal;
      companyTotals.locations.push(locationTotal);

      // Update location document with its totals
      const locationRef = db.doc(`tenants/${tenantId}/crm_companies/${dealData.companyId}/locations/${location.id}`);
      await locationRef.update({
        pipelineValue: locationTotal.pipelineValue,
        closedValue: locationTotal.closedValue,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Aggregate to divisions if location has a division
      if (location.division) {
        if (!companyTotals.divisions[location.division]) {
          companyTotals.divisions[location.division] = {
            pipelineValue: { low: 0, high: 0, dealCount: 0 },
            closedValue: { total: 0, dealCount: 0 },
            locations: []
          };
        }
        
        const division = companyTotals.divisions[location.division];
        division.pipelineValue.low += locationPipelineLow;
        division.pipelineValue.high += locationPipelineHigh;
        division.pipelineValue.dealCount += pipelineDeals.length;
        division.closedValue.total += locationClosedValue;
        division.closedValue.dealCount += closedDeals.length;
        division.locations.push(location.id);
      }

      // Aggregate to company totals
      companyTotals.pipelineValue.low += locationPipelineLow;
      companyTotals.pipelineValue.high += locationPipelineHigh;
      companyTotals.pipelineValue.dealCount += pipelineDeals.length;
      companyTotals.closedValue.total += locationClosedValue;
      companyTotals.closedValue.dealCount += closedDeals.length;
    }

    // Handle deals without specific locations (aggregate to company level)
    const dealsWithoutLocation = deals.filter(deal => !deal.locationId);
    
    if (dealsWithoutLocation.length > 0) {
      const pipelineDeals = dealsWithoutLocation.filter(deal => 
        deal.status !== 'closed' && deal.status !== 'lost'
      );
      
      let companyPipelineLow = 0;
      let companyPipelineHigh = 0;
      
      pipelineDeals.forEach(deal => {
        // Calculate revenue range from qualification data
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        
        if (revenueRange.hasData) {
          companyPipelineLow += revenueRange.min;
          companyPipelineHigh += revenueRange.max;
        }
      });

      const closedDeals = dealsWithoutLocation.filter(deal => 
        deal.status === 'closed'
      );
      
      let companyClosedValue = 0;
      
      closedDeals.forEach(deal => {
        // Calculate revenue range from qualification data
        const revenueRange = calculateExpectedRevenueRange(deal.stageData);
        
        if (revenueRange.hasData) {
          // Use average of min and max for closed deals
          companyClosedValue += (revenueRange.min + revenueRange.max) / 2;
        }
      });

      // Add to company totals
      companyTotals.pipelineValue.low += companyPipelineLow;
      companyTotals.pipelineValue.high += companyPipelineHigh;
      companyTotals.pipelineValue.dealCount += pipelineDeals.length;
      companyTotals.closedValue.total += companyClosedValue;
      companyTotals.closedValue.dealCount += closedDeals.length;
    }

    // Update company document with hierarchical totals
    await companyRef.update({
      pipelineValue: companyTotals.pipelineValue,
      closedValue: companyTotals.closedValue,
      divisionTotals: companyTotals.divisions,
      locationTotals: locationTotals,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Successfully updated pipeline totals for company ${dealData.companyId} after deal ${dealId} update`);

  } catch (error) {
    console.error('❌ Error in automatic pipeline update trigger:', error);
    // Don't throw - we don't want to fail the deal update if pipeline update fails
  }
}); 