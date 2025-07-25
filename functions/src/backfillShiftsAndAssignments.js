"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var admin = require("firebase-admin");
admin.initializeApp();
var db = admin.firestore();
function backfillShiftsAndAssignments() {
    return __awaiter(this, void 0, void 0, function () {
        var shiftsSnap, _i, _a, shiftDoc, shift, jobOrderSnap, jobOrder, customerId, worksiteId, locationIds, assignmentsSnap, _b, _c, assignmentDoc, assignment, shiftSnap, shift, customerId, worksiteId, locationIds;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, db.collection('shifts').get()];
                case 1:
                    shiftsSnap = _d.sent();
                    _i = 0, _a = shiftsSnap.docs;
                    _d.label = 2;
                case 2:
                    if (!(_i < _a.length)) return [3 /*break*/, 6];
                    shiftDoc = _a[_i];
                    shift = shiftDoc.data();
                    if (!shift.jobOrderId)
                        return [3 /*break*/, 5];
                    return [4 /*yield*/, db.collection('jobOrders').doc(shift.jobOrderId).get()];
                case 3:
                    jobOrderSnap = _d.sent();
                    if (!jobOrderSnap.exists)
                        return [3 /*break*/, 5];
                    jobOrder = jobOrderSnap.data();
                    if (!jobOrder)
                        return [3 /*break*/, 5];
                    customerId = jobOrder.customerId || '';
                    worksiteId = jobOrder.worksiteId || '';
                    locationIds = worksiteId ? [worksiteId] : [];
                    return [4 /*yield*/, shiftDoc.ref.update({ customerId: customerId, worksiteId: worksiteId, locationIds: locationIds })];
                case 4:
                    _d.sent();
                    _d.label = 5;
                case 5:
                    _i++;
                    return [3 /*break*/, 2];
                case 6:
                    console.log('Shifts backfilled.');
                    return [4 /*yield*/, db.collection('assignments').get()];
                case 7:
                    assignmentsSnap = _d.sent();
                    _b = 0, _c = assignmentsSnap.docs;
                    _d.label = 8;
                case 8:
                    if (!(_b < _c.length)) return [3 /*break*/, 12];
                    assignmentDoc = _c[_b];
                    assignment = assignmentDoc.data();
                    if (!assignment.shiftId)
                        return [3 /*break*/, 11];
                    return [4 /*yield*/, db.collection('shifts').doc(assignment.shiftId).get()];
                case 9:
                    shiftSnap = _d.sent();
                    if (!shiftSnap.exists)
                        return [3 /*break*/, 11];
                    shift = shiftSnap.data();
                    if (!shift)
                        return [3 /*break*/, 11];
                    customerId = shift.customerId || '';
                    worksiteId = shift.worksiteId || '';
                    locationIds = shift.locationIds || (worksiteId ? [worksiteId] : []);
                    return [4 /*yield*/, assignmentDoc.ref.update({ customerId: customerId, worksiteId: worksiteId, locationIds: locationIds })];
                case 10:
                    _d.sent();
                    _d.label = 11;
                case 11:
                    _b++;
                    return [3 /*break*/, 8];
                case 12:
                    console.log('Assignments backfilled.');
                    return [2 /*return*/];
            }
        });
    });
}
backfillShiftsAndAssignments().then(function () {
    console.log('Backfill complete.');
    process.exit(0);
}).catch(function (err) {
    console.error('Backfill error:', err);
    process.exit(1);
});
