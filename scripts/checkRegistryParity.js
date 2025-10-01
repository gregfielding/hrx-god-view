/*
  Checks parity between DealStageForms fields and registry.ts definitions.
  - Extracts field IDs used in getFieldDef('...') within DealStageForms.tsx
  - Extracts field keys passed to handleStageDataChange('<stage>', '<field>', ...)
  - Extracts registry ids and paths from registry.ts
  - Reports missing registry ids and fields not covered by any registry path tail
*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dealStageFormsPath = path.join(root, 'src', 'components', 'DealStageForms.tsx');
const registryPath = path.join(root, 'src', 'fields', 'registry.ts');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function extractDealFields(dealCode) {
  const getFieldDefIds = Array.from(
    dealCode.matchAll(/getFieldDef\('\s*([\w\.\-]+)\s*'\)/g)
  ).map(m => m[1]);

  const stageChangeFields = Array.from(
    dealCode.matchAll(/handleStageDataChange\('\w+'\s*,\s*'([\w]+)'/g)
  ).map(m => m[1]);

  return {
    getFieldDefIds: unique(getFieldDefIds),
    stageChangeFields: unique(stageChangeFields)
  };
}

function extractRegistry(regCode) {
  // Extract entries like: key: { id: '...', ..., path: '...' }
  const entryRegex = /(\w+)\s*:\s*\{[\s\S]*?id:\s*'([^']+)'[\s\S]*?\}/g;
  const pathRegex = /path:\s*'([^']+)'/;
  const ids = new Set();
  const keys = new Set();
  const paths = new Set();
  const pathTails = new Set();

  let m;
  while ((m = entryRegex.exec(regCode))) {
    const key = m[1];
    const idMatch = m[2];
    keys.add(key);
    ids.add(idMatch);
    const block = m[0];
    const p = block.match(pathRegex);
    if (p && p[1]) {
      paths.add(p[1]);
      const tail = p[1].split('.').pop();
      if (tail) pathTails.add(tail);
    }
  }
  return { ids, keys, paths, pathTails };
}

function main() {
  const dealCode = read(dealStageFormsPath);
  const regCode = read(registryPath);

  const deal = extractDealFields(dealCode);
  const reg = extractRegistry(regCode);

  const missingIds = deal.getFieldDefIds.filter(id => !reg.ids.has(id));

  const uncoveredStageFields = deal.stageChangeFields.filter(fieldId => {
    if (reg.ids.has(fieldId)) return false;
    if (reg.pathTails.has(fieldId)) return false;
    return true;
  });

  console.log('Registry Parity Report');
  console.log('=======================');
  console.log(`getFieldDef ids used in DealStageForms: ${deal.getFieldDefIds.length}`);
  console.log(`handleStageDataChange fields: ${deal.stageChangeFields.length}`);
  console.log(`Registry ids: ${reg.ids.size}, keys: ${reg.keys.size}, paths: ${reg.paths.size}`);
  console.log('');

  if (missingIds.length === 0) {
    console.log('✓ All getFieldDef ids are present in registry ids.');
  } else {
    console.log('✗ Missing registry ids for getFieldDef calls:');
    missingIds.sort().forEach(id => console.log('  -', id));
  }

  console.log('');
  if (uncoveredStageFields.length === 0) {
    console.log('✓ All handleStageDataChange fields are covered by registry ids or path tails.');
  } else {
    console.log('✗ Fields used in handleStageDataChange not covered by any registry id or path:');
    uncoveredStageFields.sort().forEach(id => console.log('  -', id));
  }

  console.log('\nTip: coverage accepts either a matching registry id or a registry path ending with the field name.');
}

main();


