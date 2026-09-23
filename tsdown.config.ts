import { defineConfig } from 'tsdown';

/**
 * Two bundles, one per half, with distinct filenames because both would
 * otherwise default to `lib/index.js` and the second would overwrite the first.
 *
 * The host half is a plain Node ESM module. The client half is the browser
 * module the web app loads through its module loader, which supplies `react`
 * and the primitives package via `require` — so those stay external and are
 * imported by the loader's factory rather than bundled.
 */
export default defineConfig([
  {
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib',
    // Force .js: the ESM default is .mjs, but package.json "main" and the
    // bundle loader both expect lib/index.js.
    outExtensions: () => ({ js: '.js' }),
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    clean: false,
    dts: false,
    deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery'] },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    // The web app's module loader is CommonJS-shaped: it evaluates the file as
    // `factory(require)` and takes the factory's return value as the exports.
    // ESM output would execute without ever calling `__ModuleLoader__.load`,
    // which the loader reports as "loaded without registering <id>". So the
    // client half is CJS, and scripts/wrap-client.mjs then seats it in the
    // `window.__ModuleLoader__.load({ id, factory })` envelope.
    outExtensions: () => ({ js: '.js' }),
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    clean: false,
    dts: false,
    deps: {
      neverBundle: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@deepseek-ai/dsh-client-ui-primitives',
      ],
    },
  },
]);
