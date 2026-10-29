import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../inspectra/package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage(); const failures=[]; page.on('pageerror',e=>failures.push(e.message));
 await page.route('**/*',route => route.request().url().startsWith('http://127.0.0.1:4185/') ? route.continue() : route.abort());
 await page.goto('http://127.0.0.1:4185/shivax');
 await page.getByRole('button',{name:'Run RUDRA demo'}).click();
 await page.getByRole('button',{name:'Approve fixture capture'}).click();
 await page.getByRole('status').filter({hasText:'Task progress: completed'}).waitFor();
 assert.ok(await page.getByText(/fontSize: expected/).count()); assert.equal(failures.length,0,failures.join('\n'));
 await page.reload(); await page.getByRole('button',{name:'Run RUDRA demo'}).click();
 await page.getByRole('button',{name:'Deny fixture capture'}).click();
 await page.getByRole('status').filter({hasText:'Task progress: failed'}).waitFor();
 console.log('Chromium: approved workflow returned measured findings; denied workflow failed; no page errors or external requests.');
} finally {await browser.close();}

