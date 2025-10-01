# Forms (Registry-powered)

- DealFormRenderer.tsx renders stage fields using Field Registry metadata and dealStageAdapter for get/set.
- Feature flag to enable renderer in DealDetails: set localStorage.feature.replatformDealForms = 'true'.

Files:
- dealStageAdapter.ts: translation layer between registry fieldIds and deal.stageData.* paths.
- dealStages/discovery.ts: ordered fieldIds and optional overrides per stage.

Usage:
<DealFormRenderer deal={deal} tenantId={tenantId} stage="discovery" featureEnabled={true} />

Notes:
- No Firestore shape changes; adapter writes back to existing stageData.
- Add fields gradually by appending to stage fieldIds.
