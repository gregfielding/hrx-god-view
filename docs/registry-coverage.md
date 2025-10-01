# Registry Coverage

This document tracks fields migrated to the Field Registry and where they are wired in UI/Mapping.

| Field ID | Type | Used By | UI wired (JobOrderForm) | Mapping | Notes |
|---|---|---|---|---|---|
| jobTitle | text | Both | yes | yes | |
| experienceLevel | select | Both | yes | yes | coerces via mapping |
| notes | textarea | JobOrder | yes | n/a | |
| payRate | currency | Both | yes | yes | toNumberSafe |
| startDate | date | Both | yes | yes | toISODate |
| workersNeeded | number | JobOrder | yes | yes | toNumberSafe |
| estimatedRevenue | currency | JobOrder | yes | yes | toNumberSafe |
| companyId | text | JobOrder | label only | n/a | |
| companyName | text | JobOrder | label only | n/a | |
| worksiteId | text | JobOrder | label only | n/a | |
| worksiteName | text | JobOrder | label only | n/a | |
| priority | select | JobOrder | yes | yes | default 'low' |
| shiftType | select | JobOrder | yes | yes | default 'day' |

Remaining candidates:
- Additional selects as discovered (TBD)
- Phase 3: Deal stage fields via adapter + stage configs
