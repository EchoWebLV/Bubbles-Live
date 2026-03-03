#!/usr/bin/env node
/**
 * Call the season-reset API on a running server (e.g. production).
 * Usage:
 *   ADMIN_SECRET=your_secret node scripts/season-reset-production.js
 *   BASE_URL=https://hodlwarz.com ADMIN_SECRET=xxx node scripts/season-reset-production.js
 *
 * Requires: BASE_URL (default https://hodlwarz.com), ADMIN_SECRET
 */

require('dotenv').config({ path: '.env.local' });

const BASE_URL = process.env.BASE_URL || process.env.NEXT_PUBLIC_URL || 'https://hodlwarz.com';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('Set ADMIN_SECRET (e.g. in .env.local or env).');
  process.exit(1);
}

const url = `${BASE_URL.replace(/\/$/, '')}/api/season-reset`;

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ADMIN_SECRET}`,
  },
})
  .then((res) => res.json().then((body) => ({ status: res.status, body })))
  .then(({ status, body }) => {
    if (status === 200) {
      console.log('Season reset OK:', body);
    } else {
      console.error('Season reset failed:', status, body?.error || body);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('Request failed:', err.message);
    process.exit(1);
  });
