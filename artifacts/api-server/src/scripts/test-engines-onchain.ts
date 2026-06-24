/**
 * On-chain Engine Ping Test — WARP · FLUX · PULSE
 * ─────────────────────────────────────────────────
 * Calls GET /api/warp/engine-ping (oracle-auth protected) on the running
 * server, which runs all engine health checks + a real 1-MIST self-transfer
 * server-side (where the private keys are held).
 *
 * Requires no private keys locally — all execution happens inside Railway.
 *
 * Run locally (against a running Railway deployment):
 *   API_BASE=https://your-service.railway.app \
 *   ADMIN_PASSWORD=your-admin-pw \
 *   node ./build-test.mjs && \
 *   node --enable-source-maps ./dist/test-engines-onchain.mjs
 *
 * Run against local dev server:
 *   API_BASE=http://localhost:8080  ADMIN_PASSWORD=... pnpm test:engines
 */

const API_BASE       = (process.env.API_BASE       || 'http://localhost:8080').replace(/\/$/, '');
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD  || '').trim();

const W    = 58;
const PASS = (msg: string) => console.log(`  ✅  ${msg}`);
const FAIL = (msg: string) => console.log(`  ❌  ${msg}`);
const INFO = (msg: string) => console.log(`  ℹ️   ${msg}`);

async function run() {
  const bar = '═'.repeat(W);
  console.log(`\n${bar}`);
  console.log('  SuiBets — Engine On-Chain Ping  (WARP · FLUX · PULSE)');
  console.log(bar);
  INFO(`Target: ${API_BASE}/api/warp/engine-ping`);

  if (!ADMIN_PASSWORD) {
    FAIL('ADMIN_PASSWORD env var not set');
    process.exit(1);
  }

  let body: any;
  try {
    const t0  = Date.now();
    const res = await fetch(`${API_BASE}/api/warp/engine-ping`, {
      headers: { 'x-admin-key': ADMIN_PASSWORD },
    });
    const ms  = Date.now() - t0;
    body      = await res.json();
    INFO(`HTTP ${res.status}  (${ms} ms round-trip)`);
    if (res.status === 401) { FAIL('Unauthorized — wrong ADMIN_PASSWORD'); process.exit(1); }
    if (res.status === 503) { FAIL(`Service unavailable: ${body?.error}`); process.exit(1); }
  } catch (e: any) {
    FAIL(`Fetch failed — is the server running at ${API_BASE}?\n     ${e.message}`);
    process.exit(1);
  }

  // ── Results ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(W)}`);
  console.log('  RESULTS');
  console.log('─'.repeat(W));

  const checks: Array<[string, boolean, string]> = [
    ['keypair + oracle cap',   body.keypairOk,     body.adminAddress ? `addr: ${body.adminAddress.slice(0, 16)}…` : body.keypairError ?? ''],
    ['self-transfer (live TX)',body.selfTransferOk, body.selfTransferDigest ? `https://suiexplorer.com/txblock/${body.selfTransferDigest}?network=mainnet` : body.selfTransferError ?? ''],
    ['WARP healthCheck',       body.warp?.ok ?? false, body.warp?.message ?? ''],
    ['FLUX healthCheck',       body.flux?.ok ?? false, body.flux?.message ?? ''],
    ['PULSE healthCheck',      body.pulse?.ok ?? false, body.pulse?.message ?? ''],
  ];

  let allPassed = true;
  for (const [label, ok, detail] of checks) {
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon}  ${label.padEnd(28)} ${ok ? 'PASS' : 'FAIL'}  ${detail}`);
    if (!ok) allPassed = false;
  }

  console.log(bar);
  if (allPassed) {
    console.log('\n  🚀  ALL ENGINES OPERATIONAL — production settlement is live\n');
    process.exit(0);
  } else {
    console.log('\n  ⚠️   ONE OR MORE CHECKS FAILED — check Railway env vars\n');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('\n  FATAL:', err.message ?? err);
  process.exit(1);
});
