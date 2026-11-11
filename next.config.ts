import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyOrbitEnvironment } from './server/orbit-environment';

// Next compiles TypeScript configuration through a temporary
// next.config.compiled.js. import.meta.url points at that transient file, which
// has already been removed by the time the exported config runs on Windows.
const projectRoot = process.cwd();
applyOrbitEnvironment();
const configFilePath = resolve(projectRoot, 'next.config.ts');
const configRevision = createHash('sha256').update(readFileSync(configFilePath)).digest('hex');
const configuredBasePath = String(process.env.ORBIT_BASE_PATH ?? process.env.WEBPILOT_BASE_PATH ?? '').trim().replace(/^\/+|\/+$/g, '');
const basePath = configuredBasePath ? `/${configuredBasePath}` : '';
const capabilitySource = process.env.WEBPILOT_CAPABILITY_SOURCE === 'npm' ? 'npm' : 'workspace';
const buildCpus = Number(process.env.ORBIT_BUILD_CPUS);

export default function nextConfig(phase: string): NextConfig {
  return {
    basePath,
    typescript: {
      ignoreBuildErrors: process.env.ORBIT_BUILD_TYPECHECK === 'false',
      tsconfigPath: capabilitySource === 'npm' ? 'tsconfig.npm.json'
        : phase === PHASE_DEVELOPMENT_SERVER ? 'tsconfig.json' : 'tsconfig.production.json',
    },
    transpilePackages: ['@cjfclonedeep/capability-sdk'],
    // A running development server must never write into the production build
    // directory. Sharing .next lets dev hot updates corrupt next build manifests.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev-ui' : '.next',
    env: {
      NEXT_PUBLIC_ORBIT_BASE_PATH: basePath,
      NEXT_PUBLIC_WEBPILOT_BASE_PATH: basePath,
    },
    // Do not let Turbopack walk out to an unrelated package-lock.json in a
    // parent directory (for example, the Windows user profile directory).
    turbopack: {
      root: projectRoot,
    },
    // Retain recently visited development routes across normal navigation and
    // editing pauses. The defaults evict inactive entries after just one minute.
    // Keep this bounded because large UI routes share the development process.
    onDemandEntries: {
      maxInactiveAge: 5 * 60 * 1000,
      pagesBufferLength: 10,
    },
    experimental: {
      ...(Number.isInteger(buildCpus) && buildCpus > 0 ? { cpus: buildCpus, webpackBuildWorker: true } : {}),
      // Keep development Flight debug metadata in the HTTP response. A blocked
      // HMR WebSocket must not leave the initial React tree waiting forever.
      reactDebugChannel: false,
      // React.lazy still splits optional viewers into async chunks. The
      // experimental compilation proxies can reference an unavailable loader
      // after HMR, so keep the ordinary Turbopack import graph in both runtimes.
      turbopackLazyDynamicImports: false,
      turbopackLazyDynamicImportsSSR: false,
      turbopackGc: phase === PHASE_DEVELOPMENT_SERVER,
      // Leave the plugin runtime at Next's default.
      // Keep the Webpack fallback/build path at a lower peak, and avoid eagerly
      // loading every route into the long-lived server process.
      webpackMemoryOptimizations: true,
      preloadEntriesOnStart: false,
      // Optimize HeroUI barrel imports in the explicit Webpack path. Turbopack
      // performs its own import analysis; it does not use this setting.
      optimizePackageImports: ['@heroui/react'],
    },
    webpack(config, { dev, isServer }) {
      if (dev) {
        // Webpack otherwise compiles every nested async import during the first
        // route request. Browser Chat owns optional, very large viewers and
        // charting surfaces, so defer CLIENT imports until they are opened.
        // The Node runtime has no module.hot: an inactive lazy-compilation proxy
        // exports a Promise resolved only by HMR, so a provider import can wait
        // forever even after Webpack compiles it. Never install these server proxies.
        config.experiments = {
          ...(config.experiments || {}),
          lazyCompilation: isServer ? false : {
            entries: false,
            imports: true,
          },
        };
      }
      if (dev && process.env.WEBPILOT_DEBUG_WEBPACK_CACHE === '1') {
        config.infrastructureLogging = {
          ...(config.infrastructureLogging || {}),
          debug: /PackFileCacheStrategy/,
          level: 'verbose',
        };
      }
      if (dev && config.cache && typeof config.cache === 'object' && config.cache.type === 'filesystem') {
        // The browser-chat UI produces very large persistent cache packs. Copy
        // deserialized slices into right-sized buffers so a small cached value
        // cannot keep an entire decompressed pack alive in the Node heap. Purge
        // inactive entries through Next's development memory cache policy.
        config.cache.allowCollectingMemory = true;
        // The Windows snapshotter can walk above this workspace while resolving
        // next.config and try to open the user-profile directory as a file
        // (EPERM), silently disabling the entire persistent cache. This exact
        // content hash provides invalidation without that broken snapshot.
        config.cache.version = `${config.cache.version || ''}|webpilot:${configRevision}`;
        config.cache.buildDependencies = {
          ...(config.cache.buildDependencies || {}),
          config: [],
        };
      }
      return config;
    },
    serverExternalPackages: [
      // These published Node libraries do not need application transpilation.
      // Native loading also keeps optional provider, chart, and document trees
      // out of route compilation until execution actually requests them.
      // Browser imports still go through Next's client compiler.
      'ai',
      '@ai-sdk/anthropic',
      '@ai-sdk/gateway',
      '@ai-sdk/openai',
      '@ai-sdk/openai-compatible',
      '@ai-sdk/otel',
      '@ai-sdk/provider',
      'echarts',
      'mammoth',
      'jszip',
      'docx',
      'exceljs',
      'pptxgenjs',
      'xlsx',
      'ws',
      'typeorm',
      'better-sqlite3',
      'pg',
      'patchright',
      'patchright-core',
      'pdfjs-dist',
      '@napi-rs/canvas',
      'ffmpeg-static',
    ],
  };
}
