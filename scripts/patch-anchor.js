/**
 * Patches @coral-xyz/anchor provider to work with @solana/web3.js >=1.95
 *
 * Anchor 0.32.x constructs SendTransactionError with the old (message, logs)
 * signature, but web3.js >=1.95 expects ({ action, signature, transactionMessage, logs }).
 * This patch rewrites those calls to use the new format.
 */
const fs = require('fs');
const path = require('path');

const patches = [
  {
    file: 'node_modules/@coral-xyz/anchor/dist/cjs/provider.js',
    old: 'new web3_js_1.SendTransactionError(err.message, logs)',
    new: 'new web3_js_1.SendTransactionError({ action: "send", signature: "", transactionMessage: err.message, logs: logs })',
  },
  {
    file: 'node_modules/@coral-xyz/anchor/dist/esm/provider.js',
    old: 'new SendTransactionError(err.message, logs)',
    new: 'new SendTransactionError({ action: "send", signature: "", transactionMessage: err.message, logs: logs })',
  },
];

for (const { file: rel, old, new: replacement } of patches) {
  const file = path.resolve(__dirname, '..', rel);
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, 'utf-8');
  if (!src.includes(old)) {
    console.log(`[patch-anchor] ${rel} — already patched or pattern not found`);
    continue;
  }
  src = src.replaceAll(old, replacement);
  fs.writeFileSync(file, src);
  console.log(`[patch-anchor] ${rel} — patched`);
}
