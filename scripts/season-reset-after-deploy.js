#!/usr/bin/env node
/**
 * Wait for the app to be live after deployment, then call the season-reset API.
 * Use this after deploying to Railway (or any host): run it once the deploy
 * is triggered; it will wait for the app to respond then reset the season.
 *
 * Usage:
 *   ADMIN_SECRET=your_secret node scripts/season-reset-after-deploy.js
 *   BASE_URL=https://hodlwarz.com ADMIN_SECRET=xxx node scripts/season-reset-after-deploy.js
 *
 * Optional:
 *   WAIT_MAX_MS=120000  (default: 2 min)
 *   WAIT_INTERVAL_MS=10000 (default: 10 s between checks)
 */

require('dotenv').config({ path: '.env.local' });

const BASE_URL = process.env.BASE_URL || process.env.NEXT_PUBLIC_URL || 'https://hodlwarz.com';
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const WAIT_MAX_MS = parseInt(process.env.WAIT_MAX_MS || '120000', 10);
const WAIT_INTERVAL_MS = parseInt(process.env.WAIT_INTERVAL_MS || '10000', 10);

if (!ADMIN_SECRET) {
  console.error('Set ADMIN_SECRET (e.g. in .env.local or env).');
  process.exit(1);
}

const baseUrl = BASE_URL.replace(/\/$/, '');
const resetUrl = `${baseUrl}/api/season-reset`;

function checkLive() {
  return fetch(baseUrl, { method: 'GET', signal: AbortSignal.timeout(15000) })
    .then((res) => res.status === 200)
    .catch(() => false);
}

async function waitForDeploy() {
  const start = Date.now();
  console.log(`Waiting for ${baseUrl} to be live (max ${WAIT_MAX_MS / 1000}s)...`);
  while (Date.now() - start < WAIT_MAX_MS) {
    if (await checkLive()) {
      console.log('App is live.');
      return;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, WAIT_INTERVAL_MS));
  }
  console.error('\nTimed out waiting for app to be live.');
  process.exit(1);
}

async function resetSeason() {
  const res = await fetch(resetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_SECRET}`,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 200) {
    console.log('Season reset OK:', body);
  } else {
    console.error('Season reset failed:', res.status, body?.error || body);
    process.exit(1);
  }
}

(async () => {
  await waitForDeploy();
  await resetSeason();
})();
