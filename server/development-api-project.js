/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.writeFileSync(file, content, 'utf8');
}

function developmentApiConfig(appDir, config) {
  // Next's generated route entry imports patch-fetch -> dynamic-rendering ->
  // React. Its default RSC alias loads the complete page renderer, whose dev
  // async hook traces every Agent promise in this process. Route handlers need
  // React's server exports, not the renderer. Keep the same bundled React
  // version, resolving it directly only in this API-only project.
  const reactServer = path.join(path.dirname(require.resolve('next/dist/compiled/react/package.json', { paths: [appDir] })), 'react.react-server.js');
  const reactAlias = path.relative(path.join(appDir, '.webpilot-dev-api'), reactServer).replaceAll('\\', '/');
  return {
    ...config,
    distDir: '.next',
    typescript: { ...config.typescript, tsconfigPath: 'tsconfig.json' },
    turbopack: { ...config.turbopack, root: appDir,
      resolveAlias: { ...config.turbopack?.resolveAlias,
        'next/dist/server/route-modules/app-page/vendored/rsc/react': reactAlias,
        'next/dist/server/route-modules/app-page/vendored/rsc/react.js': reactAlias } },
    webpack(webpackConfig, context) {
      const configured = config.webpack ? config.webpack(webpackConfig, context) : webpackConfig;
      configured.resolve.alias = { ...configured.resolve.alias, 'react$': reactServer };
      return configured;
    },
  };
}

// API routes run in their own Next project, without page entries or shared
// generated next-env.d.ts/build cache. API imports must also avoid page runtime
// dependencies (for example the next/server barrel) to keep RSC hooks out.
// Turbopack route discovery needs real directories, not a junction to app/api.
function prepareDevelopmentApiProject(appDir, config) {
  const { getRouteRegex } = require('next/dist/shared/lib/router/utils/route-regex');
  const { normalizeAppPath } = require('next/dist/shared/lib/router/utils/app-paths');
  const directory = path.join(appDir, '.webpilot-dev-api');
  const routes = path.join(appDir, 'src', 'app', 'api');
  const mountedRoutes = path.join(directory, 'app', 'api');
  fs.mkdirSync(path.dirname(mountedRoutes), { recursive: true });
  if (fs.existsSync(mountedRoutes) && fs.lstatSync(mountedRoutes).isSymbolicLink()) {
    // Unlink only this generated junction, never recurse into its source target.
    if (fs.realpathSync(mountedRoutes) !== fs.realpathSync(routes)) {
      throw new Error(`Development API routes point to an unexpected directory: ${mountedRoutes}`);
    }
    fs.unlinkSync(mountedRoutes);
  }
  fs.mkdirSync(mountedRoutes, { recursive: true });
  const sourceFiles = (root) => {
    const files = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Unexpected link in API source mirror: ${file}`);
        if (entry.isDirectory()) visit(file);
        else files.push(path.relative(root, file));
      }
    };
    visit(root);
    return files;
  };
  let routeMatchers = [];
  const pageExtensions = new Set(config.pageExtensions || ['tsx', 'ts', 'jsx', 'js']);
  const synchronizeRoutes = () => {
    const expected = new Set(sourceFiles(routes).filter(file => !/\.(test|spec)\.[^.]+$/.test(file)));
    for (const relative of expected) {
      const source = path.join(routes, relative);
      const target = path.join(mountedRoutes, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const content = fs.readFileSync(source);
      if (!fs.existsSync(target) || !content.equals(fs.readFileSync(target))) fs.writeFileSync(target, content);
    }
    for (const relative of sourceFiles(mountedRoutes)) {
      if (!expected.has(relative)) fs.unlinkSync(path.join(mountedRoutes, relative));
    }
    routeMatchers = [...expected].flatMap((relative) => {
      const extension = path.extname(relative).slice(1);
      if (!pageExtensions.has(extension) || path.basename(relative, `.${extension}`) !== 'route') return [];
      const route = `/api/${relative.replaceAll('\\', '/').slice(0, -extension.length - 1)}`;
      if (route.split('/').some(segment => segment.startsWith('_'))) return [];
      return [getRouteRegex(normalizeAppPath(route)).re];
    });
  };
  synchronizeRoutes();
  // Next's development router reloads config from disk independently of the
  // custom server's `conf` option. Give every config reader the same overrides.
  writeIfChanged(path.join(directory, 'next.config.ts'), [
    `import sourceConfig from ${JSON.stringify(path.join(appDir, 'next.config.ts').replaceAll('\\', '/'))};`,
    `import { developmentApiConfig } from ${JSON.stringify(path.join(appDir, 'server/development-api-project.js').replaceAll('\\', '/'))};`,
    'export default async function apiConfig(phase: string) {',
    '  const config = await sourceConfig(phase);',
    '  return developmentApiConfig(process.cwd(), config);',
    '}',
    '',
  ].join('\n'));
  writeIfChanged(path.join(directory, 'package.json'), JSON.stringify({ name: 'webpilot-development-api', private: true }, null, 2) + '\n');
  writeIfChanged(path.join(directory, 'tsconfig.json'), JSON.stringify({
    extends: path.relative(directory, path.resolve(appDir, config.typescript.tsconfigPath)).replaceAll('\\', '/'),
    compilerOptions: { baseUrl: appDir },
    include: ['next-env.d.ts', 'app/**/*.ts', 'instrumentation.ts', '.next/dev/types/**/*.ts'],
    exclude: ['node_modules'],
  }, null, 2) + '\n');
  writeIfChanged(path.join(directory, 'instrumentation.ts'), "export { register } from '../src/instrumentation';\n");
  let synchronizeTimer;
  const watcher = fs.watch(routes, { recursive: true }, () => {
    clearTimeout(synchronizeTimer);
    synchronizeTimer = setTimeout(() => {
      try { synchronizeRoutes(); }
      catch (error) { console.error('[webpilot-server] API source synchronization failed.', error); }
    }, 100);
    synchronizeTimer.unref?.();
  });
  watcher.unref();
  return {
    directory,
    matchesPath(pathname) { return routeMatchers.some(pattern => pattern.test(pathname)); },
    close() { clearTimeout(synchronizeTimer); watcher.close(); },
    config: developmentApiConfig(appDir, config),
  };
}

module.exports = { developmentApiConfig, prepareDevelopmentApiProject };
