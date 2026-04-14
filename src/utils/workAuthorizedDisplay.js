"use strict";
/**
 * Work Authorized (authorized to work in the US) display helpers.
 * Only workEligibilityAttestation.authorizedToWorkUS is used; legacy workEligibility is ignored
 * so that "Skipped" is shown until the user has completed the attestation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkAuthorizedStatus = getWorkAuthorizedStatus;
exports.getWorkAuthorizedLabel = getWorkAuthorizedLabel;
exports.compareWorkAuthorized = compareWorkAuthorized;
/**
 * Derive display status from user data.
 * - yes: user completed attestation and authorizedToWorkUS === true
 * - no: user completed attestation and authorizedToWorkUS === false
 * - skipped: not completed (no attestation or authorizedToWorkUS not set)
 * We do not use legacy workEligibility so that workers who haven't completed the step show Skipped.
 */
function getWorkAuthorizedStatus(user) {
    if (user == null || typeof user !== 'object')
        return 'skipped';
    const u = user;
    const attestation = u.workEligibilityAttestation;
    if (attestation != null && typeof attestation === 'object' && typeof attestation.authorizedToWorkUS === 'boolean') {
        return attestation.authorizedToWorkUS ? 'yes' : 'no';
    }
    return 'skipped';
}
function getWorkAuthorizedLabel(status) {
    switch (status) {
        case 'yes': return 'Yes';
        case 'no': return 'No';
        case 'skipped': return 'Skipped';
    }
}
/** For table sort: order yes first, then no, then skipped (or configurable). */
function compareWorkAuthorized(a, b) {
    const order = { yes: 0, no: 1, skipped: 2 };
    return order[a] - order[b];
}
//# sourceMappingURL=workAuthorizedDisplay.js.map