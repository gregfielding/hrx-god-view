/**
 * Gate for job-order hiring automation (phase 6 queue, auto-advance eligibility, gig fallback).
 * When false, the Hiring tab still saves policy drafts but forces automation off in Firestore
 * and sets `hiringAutomationPaused` on the job order for Cloud Functions.
 */
export const JOB_ORDER_HIRING_AUTOMATION_ENABLED = false;
