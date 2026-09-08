import { firefox, type Page } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROFILE_URL = 'https://www.naukri.com/mnjuser/profile';

const RESUME_PATH = path.resolve(
  process.env.RESUME_PATH ?? 'resume/your_resume.pdf'  //Your Resume Name here
);

const AUTH_STATE_PATH = path.resolve(
  process.env.AUTH_STATE_PATH ?? 'playwright/.auth/state.json'
);

const ARTIFACT_DIR = path.resolve(
  process.env.ARTIFACT_DIR ?? 'artifacts'
);

const headless = process.env.HEADLESS !== 'false';

function log(message: string): void {
  console.log(`[naukri] ${new Date().toISOString()} ${message}`);
}

async function ensureFile(
  filePath: string,
  description: string
): Promise<void> {
  try {
    const stat = await fs.stat(filePath);

    if (!stat.isFile()) {
      throw new Error(`${description} is not a file: ${filePath}`);
    }
  } catch {
    throw new Error(`${description} not found: ${filePath}`);
  }
}

async function captureDebugArtifacts(page: Page): Promise<void> {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const screenshotPath = path.join(
    ARTIFACT_DIR,
    `failure-${timestamp}.png`
  );

  const htmlPath = path.join(
    ARTIFACT_DIR,
    `failure-${timestamp}.html`
  );

  const urlPath = path.join(
    ARTIFACT_DIR,
    `failure-${timestamp}.txt`
  );

  await page
    .screenshot({
      path: screenshotPath,
      fullPage: true,
    })
    .catch(() => undefined);

  const html = await page
    .content()
    .catch(() => '');

  await fs
    .writeFile(htmlPath, html)
    .catch(() => undefined);

  await fs
    .writeFile(
      urlPath,
      [
        `timestamp=${new Date().toISOString()}`,
        `url=${page.url()}`,
        `headless=${headless}`,
        `userAgent=${await page
          .evaluate(() => navigator.userAgent)
          .catch(() => 'unknown')}`,
      ].join('\n')
    )
    .catch(() => undefined);

  log(`Debug artifacts saved to ${ARTIFACT_DIR}`);
}

async function detectBlockingState(page: Page): Promise<void> {
  const url = page.url().toLowerCase();

  const body = (
    await page.locator('body').innerText().catch(() => '')
  ).toLowerCase();

  if (
    url.includes('captcha') ||
    /captcha|verify you are human|access denied/.test(body)
  ) {
    throw new Error(
      'Naukri presented a CAPTCHA or access-block page. No bypass was attempted.'
    );
  }

  if (
    url.includes('login') ||
    /sign in|log in|login/.test(body.slice(0, 3000))
  ) {
    throw new Error(
      'Authenticated Naukri session is not available or has expired.'
    );
  }
}

async function findResumeInput(page: Page) {
  const selectors = [
    'input[type="file"]',
    '#attachCV',
    'input[name="resume"]',
    'input[name="attachCV"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if (await locator.count()) {
      return locator;
    }
  }

  throw new Error(
    'Could not find the Naukri resume file input. The profile page may have changed.'
  );
}

async function main(): Promise<void> {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  await ensureFile(RESUME_PATH, 'Resume');
  await ensureFile(
    AUTH_STATE_PATH,
    'Playwright authentication state'
  );

  const resumeStat = await fs.stat(RESUME_PATH);

  if (resumeStat.size > 300 * 1024) {
    throw new Error(
      `Resume is ${resumeStat.size} bytes. Naukri's current upload page shows a 300 KB maximum.`
    );
  }

  log(`Using resume: ${RESUME_PATH}`);
  log(`Auth state: ${AUTH_STATE_PATH}`);
  log(`Headless: ${headless}`);
  log(`Opening ${PROFILE_URL}`);

  const browser = await firefox.launch({
    headless,

    // Keep Firefox stable in CI.
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const context = await browser.newContext({
    storageState: AUTH_STATE_PATH,

    viewport: {
      width: 1440,
      height: 1000,
    },

    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });

  const page = await context.newPage();

  try {
    page.on('console', (message) => {
      if (message.type() === 'error') {
        log(`Browser console error: ${message.text()}`);
      }
    });

    page.on('requestfailed', (request) => {
      log(
        `Request failed: ${request.method()} ${request.url()}`
      );

      if (request.failure()) {
        log(`Request failure reason: ${request.failure()?.errorText}`);
      }
    });

    try {
      await page.goto(PROFILE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
    } catch (error) {
      log(`Navigation failed: ${String(error)}`);

      await captureDebugArtifacts(page);

      throw error;
    }

    await page
      .waitForLoadState('networkidle', {
        timeout: 15_000,
      })
      .catch(() => undefined);

    await detectBlockingState(page);

    log(`Loaded ${page.url()}`);

    const fileInput = await findResumeInput(page);

    log('Found resume file input.');

    await fileInput.setInputFiles(RESUME_PATH);

    log('Resume file selected.');

    const saveCandidates = [
      page
        .getByRole('button', {
          name: /save|update/i,
        })
        .last(),

      page
        .locator('button:has-text("Save")')
        .last(),

      page
        .locator('button:has-text("Update")')
        .last(),

      page
        .locator('input[type="submit"]')
        .last(),
    ];

    let saveClicked = false;

    for (const button of saveCandidates) {
      if (
        await button.count() &&
        await button.isVisible().catch(() => false)
      ) {
        try {
          await button.click({
            timeout: 5_000,
          });

          saveClicked = true;

          log('Clicked a visible Save/Update control.');

          break;
        } catch {
          // Try the next candidate.
        }
      }
    }

    if (!saveClicked) {
      log(
        'No Save/Update control was needed or found; upload may have triggered automatically.'
      );
    }

    await page.waitForTimeout(5_000);

    await detectBlockingState(page);

    const screenshotPath = path.join(
      ARTIFACT_DIR,
      'success.png'
    );

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    const bodyText = await page
      .locator('body')
      .innerText()
      .catch(() => '');

    const interestingLines = bodyText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) =>
        /resume|updated|uploaded|success/i.test(line)
      )
      .slice(0, 20);

    await fs.writeFile(
      path.join(ARTIFACT_DIR, 'result.txt'),
      [
        `timestamp=${new Date().toISOString()}`,
        `url=${page.url()}`,
        `resume=${RESUME_PATH}`,
        `resume_bytes=${resumeStat.size}`,
        `headless=${headless}`,
        '',
        'resume_related_text=',
        ...interestingLines,
      ].join('\n')
    );

    log(
      'Resume upload flow completed. Check artifacts/success.png and artifacts/result.txt.'
    );
  } catch (error) {
    log(
      `Automation failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    await captureDebugArtifacts(page);

    await fs.writeFile(
      path.join(ARTIFACT_DIR, 'error.txt'),
      [
        new Date().toISOString(),
        error instanceof Error
          ? error.stack ?? error.message
          : String(error),
        `url=${page.url()}`,
      ].join('\n')
    );

    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack ?? error.message
      : error
  );

  process.exit(1);
});
