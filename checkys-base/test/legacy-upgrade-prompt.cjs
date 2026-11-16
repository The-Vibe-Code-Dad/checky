const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.CHECKY_PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHECKY_CHROMIUM_EXECUTABLE || undefined});
  try {
    const page = await browser.newPage({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
    await page.addInitScript(() => {
      const settings = {advanced:{serverUrl:'https://base.example', email:'user@example.test'}};
      const update = {updateAvailable:true, currentVersion:'1.0.8', latestVersion:'2.0.0', downloadUrl:'https://base.example/desktop-updates/checky.exe'};
      window.prompts = []; window.approved = false; window.installs = 0;
      window.confirm = message => { window.prompts.push(message); return window.approved; };
      window.checkyApi = {
        loadState:async()=>({settings, appVersion:'1.0.8'}), listBackups:async()=>[],
        onWindowSyncRequested:callback=>{window.onShow=callback;}, onReminderResetTimes(){}, onVerificationCodeRequested(){},
        syncNow:async()=>({ok:true}), saveSettings:async settings=>({ok:true,settings}),
        listAccessibleChecklists:async()=>({ok:true,checklists:[]}),
        checkForUpdates:async()=>update, installUpdate:async()=>{window.installs++; return update;}
      };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname,'../../checkys-app/renderer/index.html')).href);
    await page.waitForFunction(()=>window.prompts.length === 1);
    assert.match(await page.evaluate(()=>window.prompts[0]), /Install Checky Desktop 2.0.0/);
    await page.evaluate(()=>window.onShow({action:'show'}));
    assert.equal(await page.evaluate(()=>window.prompts.length),1);
    await page.reload();
    await page.locator('#updateAvailableBtn').waitFor();
    assert.deepEqual(await page.evaluate(()=>[window.prompts.length,window.installs]),[0,0]);
    await page.locator('#settingsToggle').click();
    await page.evaluate(()=>{window.approved=true;});
    await page.locator('#checkForUpdatesBtn').click();
    await page.waitForFunction(()=>window.installs === 1);
    assert.equal(await page.evaluate(()=>window.prompts.length),1);
    console.log('PASS foreground migration prompt, cancel, no repeat on restart, manual retry and approved handoff');
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
