import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));
const evidence=process.env.WB_EVIDENCE_DIR??resolve(root,'..','evidence','electron');
export default defineConfig({
  testDir:'./tests',testMatch:'electron.spec.mjs',workers:1,fullyParallel:false,
  timeout:90000,expect:{timeout:15000},
  outputDir:resolve(evidence,'test-results'),
  reporter:[['list'],['json',{outputFile:resolve(evidence,'test-results.json')}]],
});
