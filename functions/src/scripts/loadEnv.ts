/**
 * Load functions/.env and optionally functions/.env.<projectId> for local scripts.
 * Uses override: false so existing process.env (e.g. TRANSLATION_WORKER_URL from CLI) is never overwritten.
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

export function loadEnvForScripts(): void {
  const functionsDir = fs.existsSync(path.join(process.cwd(), 'functions', '.env'))
    ? path.join(process.cwd(), 'functions')
    : process.cwd();

  const envPath = path.join(functionsDir, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (projectId) {
    const projectEnvPath = path.join(functionsDir, '.env.' + projectId);
    if (fs.existsSync(projectEnvPath)) {
      dotenv.config({ path: projectEnvPath, override: false });
    }
  }
}
