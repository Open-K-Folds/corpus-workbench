import {defineConfig} from '@playwright/test';
const baseURL='http://127.0.0.1:18912';
export default defineConfig({
  testDir:'tests',workers:1,fullyParallel:false,timeout:30000,
  outputDir:'../.runtime/browser-results',reporter:[['list'],['json',{outputFile:'../.runtime/browser-results.json'}]],
  // Authoring journeys exercise the saved split workspace. Studio acceptance
  // uses a fresh origin and the actual first-launch layout and appearance.
  use:{baseURL,viewport:{width:1440,height:1000},storageState:{cookies:[],origins:[{origin:baseURL,localStorage:[
    {name:'wb-studio-layout',value:'editing'},{name:'wb-theme',value:'light'},
  ]}]},launchOptions:process.env.WB_CHROME?{executablePath:process.env.WB_CHROME}:{},screenshot:'only-on-failure'},
});
