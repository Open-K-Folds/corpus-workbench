import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests',workers:1,fullyParallel:false,timeout:30000,
  outputDir:'../.runtime/browser-results',reporter:[['list'],['json',{outputFile:'../.runtime/browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:18912',viewport:{width:1440,height:1000},launchOptions:process.env.WB_CHROME?{executablePath:process.env.WB_CHROME}:{},screenshot:'only-on-failure'},
});
