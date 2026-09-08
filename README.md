# Naukri Daily Resume Updater

Automatically re-upload the same resume to your Naukri profile using Playwright and GitHub Actions.

The current setup uses an iPhone automation as the **primary trigger**. The iPhone calls the GitHub API and triggers the workflow with `workflow_dispatch`.

GitHub's built-in `schedule` trigger is also kept as a **fallback** in case the iPhone automation fails to trigger the workflow.

## How it works

```text
iPhone Automation
        |
        | GitHub API / workflow_dispatch
        v
GitHub Actions
        |
        v
Firefox + Playwright
        |
        v
Naukri Profile
        |
        v
Resume Uploaded
```

Fallback path:

```text
GitHub scheduled trigger
        |
        v
Check recent workflow_dispatch run
        |
        +---- Recent successful/manual run ----> Skip
        |
        +---- No recent run / failed run -----> Run Naukri update
```

## Features

- Re-uploads the same resume automatically.
- Uses Firefox with Playwright.
- Works on GitHub-hosted runners.
- Uses a saved Playwright authentication state.
- Authentication state is stored as a GitHub Secret and reconstructed only during the workflow run.
- The authentication file is removed after the workflow finishes.
- Supports manual `workflow_dispatch` runs.
- Keeps GitHub's scheduled trigger as a fallback.
- Saves screenshots and error information as GitHub Actions artifacts.
- Detects login/CAPTCHA/access-block pages and stops instead of attempting to bypass them.
- Uses workflow concurrency to prevent overlapping executions.

## Project structure

```text
Naukri-DailyUpdate/
├── .github/
│   └── workflows/
│       └── update-naukri.yml
├── playwright/
│   └── .auth/
│       └── state.json              # Local only, never commit
├── resume/
│   └── Kunal_Sondkar_Cloud_DevOps_Engineer_Resume.pdf
├── scripts/
│   ├── setup-session.ts
│   └── update-resume.ts
├── artifacts/                      # Runtime output, never commit
├── package.json
├── package-lock.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## Requirements

- Node.js 22+
- npm
- Playwright
- A Naukri account
- A valid resume PDF
- A GitHub repository with GitHub Actions enabled
- A GitHub Actions Secret named `NAUKRI_STORAGE_STATE`

## Add Your Resume

Place your resume PDF inside the `resume/` directory.

For example:

```text
resume/
└── Kunal_Sondkar_Cloud_DevOps_Engineer_Resume.pdf
```

### Important: Update the Resume Path

You must update the resume path in **two places**.

### A. GitHub Actions workflow

Open:

```text
.github/workflows/update-naukri.yml
```

Find:

```yaml
RESUME_PATH: 'resume/Kunal_Sondkar_Cloud_DevOps_Engineer_Resume.pdf'
```

Change it to the path of your resume.

For example:

```yaml
RESUME_PATH: 'resume/your_resume.pdf'
```

### B. Update Resume Script

Open:

```text
scripts/update-resume.ts
```

Make sure the default resume path matches your file.

For example:

```ts
const RESUME_PATH = path.resolve(
  process.env.RESUME_PATH ?? 'resume/your_resume.pdf'
);
```

Both paths should point to the same resume file.

> If `RESUME_PATH` is provided as an environment variable, that value takes precedence over the default path in `update-resume.ts`.

## Authentication setup

The Playwright authentication state contains session information such as cookies and local storage.

It must **never be committed to the repository**.

The expected local file is:

```text
playwright/.auth/state.json
```

Generate it with:

```bash
npm install
```
```bash
npx playwright install firefox
```
```bash
npm run bootstrap
```

The browser will open and allow you to log into Naukri manually.

After the session is saved, encode the file as Base64.

### PowerShell

From the project root:

```powershell
$path = (Resolve-Path ".\playwright\.auth\state.json").Path
$state = [IO.File]::ReadAllBytes($path)
$base64 = [Convert]::ToBase64String($state)
$base64 | Set-Clipboard

```

Paste the resulting value into:

```text
GitHub Repository
→ Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

Use:

```text
Name:
NAUKRI_STORAGE_STATE
```

Do not commit `state.json`.

## Local testing

Install dependencies:

```bash
npm ci
```

Install Firefox:

```bash
npx playwright install firefox
```

For a visible local test on PowerShell:

```powershell
$env:HEADLESS="false"
$env:RESUME_PATH="resume/Kunal_Sondkar_Cloud_DevOps_Engineer_Resume.pdf"
$env:AUTH_STATE_PATH="playwright/.auth/state.json"
$env:ARTIFACT_DIR="artifacts"

npm run update
```

A successful run should upload the resume to your Naukri profile.

## GitHub Actions workflow

The workflow supports two triggers.

### Primary trigger: iPhone automation

The iPhone Shortcut/Automation sends a GitHub API request that triggers:

```text
workflow_dispatch
```

This is the preferred trigger because GitHub's scheduled workflows can be delayed.

### Fallback trigger: GitHub schedule

The workflow also contains a scheduled trigger.

The schedule should be treated as a backup rather than an exact-time scheduler.

When the scheduled workflow starts, it checks for a recent `workflow_dispatch` run from the same workflow.

The intended behavior is:

```text
Recent manual run succeeded
    → skip fallback

Recent manual run is running
    → skip fallback

Recent manual run failed/cancelled
    → run fallback

No recent manual run
    → run fallback
```

## Workflow concurrency

The workflow uses:

```yaml
concurrency:
  group: naukri-resume-update
  cancel-in-progress: false
```

`cancel-in-progress: false` is intentional.

If an iPhone-triggered workflow is still running when the scheduled fallback starts, the second workflow should wait rather than cancelling the first one.

## Resume file

The workflow currently expects:

```text
resume/Kunal_Sondkar_Cloud_DevOps_Engineer_Resume.pdf
```

If the file name changes, update the `RESUME_PATH` environment variable in the workflow.

The script also validates the resume file size before uploading.

## Debugging

The workflow saves runtime artifacts under:

```text
artifacts/
```

These may include:

```text
success.png
result.txt
error.txt
failure-*.png
failure-*.html
failure-*.txt
```

The workflow uploads this directory as a GitHub Actions artifact for up to 7 days.

Check the artifacts when:

- Naukri changes its page structure.
- The resume upload control cannot be found.
- The session expires.
- Naukri returns an access-block or CAPTCHA page.
- A browser/network error occurs.

## Common errors

### `ERR_HTTP2_PROTOCOL_ERROR`

This has occurred intermittently on GitHub-hosted runners while accessing Naukri.

The automation has also successfully run from GitHub Actions, so this should be treated as a transient/environment-specific network failure unless it becomes persistent.

### `NS_ERROR_NET_RESET`

This has also occurred during Firefox navigation on a GitHub-hosted runner.

Again, it is a navigation/network failure, not necessarily an authentication or resume-upload problem.

### `Could not find the Naukri resume file input`

This indicates that the Naukri page loaded but the expected resume file input was not found.

Possible causes include:

- Naukri changed its page structure.
- The page did not fully load.
- Naukri returned a different page variant.
- The profile was not in the expected state.

Check the downloaded failure artifacts before changing selectors.

### CAPTCHA or access-block page

The automation intentionally stops when it detects a CAPTCHA or access-block page.

It does not attempt to bypass CAPTCHA or other anti-bot protections.

## Security

Never commit:

```text
playwright/.auth/state.json
node_modules/
artifacts/
.env
```

Recommended `.gitignore`:

```gitignore
node_modules/
playwright/.auth/
artifacts/
.env
```

The Naukri authentication state should be treated like a password because it may contain active session information.

The GitHub Actions workflow reconstructs the authentication state temporarily from:

```text
NAUKRI_STORAGE_STATE
```

and deletes the temporary file after the job finishes.

## Dependencies

Install dependencies with:

```bash
npm ci
```

Do not commit `node_modules`.

Commit both:

```text
package.json
package-lock.json
```

`package-lock.json` keeps dependency versions reproducible between local development and GitHub Actions.

## Useful commands

Install dependencies:

```bash
npm ci
```

Install Firefox:

```bash
npx playwright install firefox
```

Create/update the local authenticated session:

```bash
npm run bootstrap
```

Run the Naukri update:

```bash
npm run update
```

## Current scheduling design

The system intentionally uses two scheduling mechanisms:

```text
Primary
 iPhone Automation
      ↓
 GitHub workflow_dispatch
      ↓
 Naukri update

Fallback
 GitHub schedule
      ↓
 Check recent manual run
      ↓
 Run only when required
```

The iPhone automation exists because GitHub's built-in scheduled workflow trigger is not guaranteed to execute at the exact cron time.

The fallback exists so that the automation can still update Naukri if the iPhone fails to trigger the workflow.

## Maintenance

The main parts that may require maintenance are:

- Naukri page selectors in `scripts/update-resume.ts`
- Playwright/browser versions
- Naukri authentication state
- iPhone automation/GitHub API token
- Resume file path

If the Naukri UI changes, inspect the GitHub Actions artifacts first and then update the selectors accordingly.

## Disclaimer

This project automates activity on a third-party website.

Use it responsibly and stop the automation if Naukri presents account-security warnings, persistent CAPTCHA/access blocks, or other restrictions.
