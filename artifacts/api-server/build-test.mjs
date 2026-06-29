import { createRequire } from "node:module";
import path              from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

const COMMON = {
  platform:  "node",
  bundle:    true,
  format:    "esm",
  logLevel:  "info",
  alias: {
    "@shared": path.resolve(artifactDir, "../../shared"),
  },
  nodePaths: [
    path.resolve(artifactDir, "node_modules"),
    path.resolve(artifactDir, "../../node_modules"),
  ],
  external: [
    "*.node", "sharp", "better-sqlite3", "sqlite3", "canvas",
    "bcrypt", "argon2", "fsevents", "pg-native",
  ],
  sourcemap: "linked",
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
};

await Promise.all([
  esbuild({
    ...COMMON,
    entryPoints: [path.resolve(artifactDir, "src/scripts/test-e2e-p2p.ts")],
    outfile:     path.resolve(artifactDir, "dist/test-e2e-p2p.mjs"),
  }),
  esbuild({
    ...COMMON,
    entryPoints: [path.resolve(artifactDir, "src/scripts/test-reclaim.ts")],
    outfile:     path.resolve(artifactDir, "dist/test-reclaim.mjs"),
  }),
  esbuild({
    ...COMMON,
    entryPoints: [path.resolve(artifactDir, "src/scripts/test-fix-verification.ts")],
    outfile:     path.resolve(artifactDir, "dist/test-fix-verification.mjs"),
  }),
  esbuild({
    ...COMMON,
    entryPoints: [path.resolve(artifactDir, "src/scripts/sweep-stuck-offers.ts")],
    outfile:     path.resolve(artifactDir, "dist/sweep-stuck-offers.mjs"),
  }),
  esbuild({
    ...COMMON,
    entryPoints: [path.resolve(artifactDir, "src/scripts/onchain-sweep.ts")],
    outfile:     path.resolve(artifactDir, "dist/onchain-sweep.mjs"),
  }),
  esbuild({
    ...COMMON,
    entryPoints: [path.resolve(artifactDir, "src/scripts/test-engines-onchain.ts")],
    outfile:     path.resolve(artifactDir, "dist/test-engines-onchain.mjs"),
  }),
]);
