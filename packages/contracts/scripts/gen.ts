import { compileFromFile } from 'json-schema-to-typescript';
import fs from 'node:fs/promises';
import path from 'node:path';

const INPUTS = [
  'firestore/schemas/messageThreads.schema.json',
  'firestore/schemas/messages.schema.json',
  'firestore/schemas/jobs_board_posts.schema.json',
  'firestore/schemas/applications.schema.json',
  'firestore/schemas/candidates.schema.json',
  'firestore/schemas/features.schema.json',
];

async function run() {
  console.log('🔄 Starting code generation...');
  
  // Ensure output directory exists
  await fs.mkdir('codegen/ts', { recursive: true });
  
  // Generate TypeScript interfaces from JSON schemas
  for (const schemaPath of INPUTS) {
    try {
      console.log(`📝 Generating types for ${schemaPath}...`);
      const ts = await compileFromFile(schemaPath, { 
        bannerComment: '',
        style: {
          singleQuote: true,
          trailingComma: 'es5',
        }
      });
      
      const name = path.basename(schemaPath, '.schema.json');
      const outputPath = `codegen/ts/${name}.d.ts`;
      
      await fs.writeFile(outputPath, ts, 'utf8');
      console.log(`✅ Generated ${outputPath}`);
    } catch (error) {
      console.error(`❌ Error generating types for ${schemaPath}:`, error);
      throw error;
    }
  }
  
  // Create index file that re-exports all types
  const indexContent = `// Auto-generated index file for HRX Contracts
// Generated on: ${new Date().toISOString()}

export * from './messageThreads';
export * from './messages';
export * from './jobs_board_posts';
export * from './applications';
export * from './candidates';
export * from './features';

// Collection names (for type safety)
export const COLLECTIONS = {
  MESSAGE_THREADS: 'messageThreads',
  MESSAGES: 'messages',
  JOBS_BOARD_POSTS: 'jobs_board_posts',
  APPLICATIONS: 'applications',
  CANDIDATES: 'candidates',
  FEATURES: 'features',
} as const;

// Status enums (for type safety)
export const APPLICATION_STATUSES = [
  'new',
  'screened', 
  'advanced',
  'interview',
  'offer_pending',
  'hired',
  'rejected',
  'withdrawn'
] as const;

export const CANDIDATE_STATUSES = [
  'applicant',
  'active_employee',
  'inactive',
  'hired',
  'rejected',
  'terminated',
  'completed'
] as const;

export const PIPELINE_STAGES = [
  'applicant',
  'screened',
  'interview',
  'offer',
  'hired'
] as const;

export const POST_STATUSES = [
  'draft',
  'posted',
  'paused',
  'closed'
] as const;

export const POST_VISIBILITY = [
  'public',
  'private',
  'internal'
] as const;

export const MESSAGE_SENDER_TYPES = [
  'recruiter',
  'candidate',
  'ai',
  'system'
] as const;

export const MESSAGE_DELIVERY_STATUS = [
  'queued',
  'sent',
  'delivered',
  'read'
] as const;
`;

  await fs.writeFile('codegen/ts/index.d.ts', indexContent, 'utf8');
  console.log('✅ Generated codegen/ts/index.d.ts');
  
  // Create package.json for the generated types
  const packageJson = {
    name: '@hrx/contracts-types',
    version: '0.1.0',
    description: 'Generated TypeScript types for HRX Contracts',
    main: 'index.js',
    types: 'index.d.ts',
    files: ['*.d.ts'],
    private: true
  };
  
  await fs.writeFile('codegen/ts/package.json', JSON.stringify(packageJson, null, 2), 'utf8');
  console.log('✅ Generated codegen/ts/package.json');
  
  console.log('🎉 Code generation completed successfully!');
}

run().catch((error) => {
  console.error('💥 Code generation failed:', error);
  process.exit(1);
});
