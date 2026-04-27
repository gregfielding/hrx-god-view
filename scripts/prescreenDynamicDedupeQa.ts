/**
 * Dev/QA: print deterministic dynamic dedupe outcomes for sample core + dynamic answers.
 * Run: npm run qa:prescreen-dedupe
 */
import {
  applyPrescreenDynamicDedupe,
  explainPrescreenDynamicDedupePlan,
} from '../src/shared/prescreenDynamicDedupe';

const samplePlan = [
  { id: 'dyn_shift_punctuality' },
  { id: 'dyn_worksite_commute' },
  { id: 'dyn_job_drug_screen' },
  { id: 'dyn_job_background_check' },
  { id: 'dyn_physical_job_fit' },
];

const answersA = {
  attendance_issues: 'no',
  transportation_plan: 'own_vehicle',
  backup_transportation: 'yes',
  physical_comfort: 'yes',
};

const answersB = {
  attendance_issues: 'yes',
  transportation_plan: 'not_sure_yet',
  backup_transportation: 'no',
  physical_comfort: 'no',
};

function run() {
  console.log('--- Sample plan order ---');
  console.log(samplePlan.map((s) => s.id).join(' → '));

  console.log('\n--- Scenario A: strong reliability + physical yes ---');
  const a = applyPrescreenDynamicDedupe(samplePlan, answersA, {});
  console.log('skipped:', JSON.stringify(a.skipped, null, 2));
  console.log('visible:', a.visibleSteps.map((s) => s.id).join(' → '));

  console.log('\n--- Scenario B: weak transport; physical no ---');
  const b = applyPrescreenDynamicDedupe(samplePlan, answersB, {});
  console.log('skipped:', JSON.stringify(b.skipped, null, 2));
  console.log('visible:', b.visibleSteps.map((s) => s.id).join(' → '));

  console.log('\n--- explainPrescreenDynamicDedupePlan (A) ---');
  console.log(JSON.stringify(explainPrescreenDynamicDedupePlan(samplePlan, answersA, {}), null, 2));
}

run();
