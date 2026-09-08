import { firefox, type Page } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const profileUrl = 'https://www.naukri.com/mnjuser/profile';
const statePath = path.resolve('playwright/.auth/state.json');

await fs.mkdir(path.dirname(statePath), { recursive: true });

const browser = await firefox.launch({headless : false});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata'
});
const page = await context.newPage();

await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });

const rl = readline.createInterface({ input, output });
await rl.question('Log into Naukri in the browser. Complete any OTP/CAPTCHA yourself, then press Enter here... ');
await rl.close();

if (page.url().includes('login')) {
  throw new Error(`Login still appears active. Current URL: ${page.url()}`);
}

await context.storageState({ path: statePath });
console.log(`Saved authenticated browser state to ${statePath}`);
console.log('Treat this file like a password. Do not commit it to Git.');

await context.close();
await browser.close();
