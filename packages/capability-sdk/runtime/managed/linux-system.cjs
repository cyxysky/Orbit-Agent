const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function environment(cache) {
  const root = path.join(cache, 'sysroot');
  const triplet = process.arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
  return {
    LD_LIBRARY_PATH: [path.join(root, 'usr/lib', triplet), path.join(root, 'lib', triplet), path.join(root, 'usr/lib/libreoffice/program'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    FONTCONFIG_FILE: path.join(cache, 'fonts.conf'),
    XDG_CACHE_HOME: path.join(cache, '.cache'),
  };
}
async function prepareApt(cache, run) {
  const apt = path.join(cache, '.apt');
  await fsp.mkdir(path.join(apt, 'archives/partial'), { recursive: true });
  await fsp.mkdir(path.join(apt, 'lists/partial'), { recursive: true });
  const options = ['-o', 'Dir::Cache::archives=' + path.join(apt, 'archives'), '-o', 'Dir::State::lists=' + path.join(apt, 'lists'), '-o', 'APT::Sandbox::User=' + (process.getuid?.() === 0 ? 'root' : process.env.USER || 'root'), '-o', 'Debug::NoLocking=1'];
  // Download and extract into the persistent component volume, never apt-install into the container layer.
  await run('apt-get', [...options, 'update']);
  const configuration = path.join(apt, 'apt.conf');
  await fsp.writeFile(configuration, 'Dir::State::lists ' + JSON.stringify(path.join(apt, 'lists')) + ';\nDir::Cache::archives ' + JSON.stringify(path.join(apt, 'archives')) + ';\nDebug::NoLocking "true";\n');
  return { options, environment: { ...process.env, APT_CONFIG: configuration } };
}
async function installSystemPackages(cache, packages, run) {
  if (!packages.length || packages.some(name => !/^[a-z0-9][a-z0-9+.-]*$/.test(name))) throw new Error('Invalid Linux runtime packages.');
  const { options } = await prepareApt(cache, run);
  const apt = path.join(cache, '.apt');
  await run('apt-get', [...options, 'install', '-y', '--download-only', '--reinstall', '--no-install-recommends', ...packages]);
  const root = path.join(cache, 'sysroot');
  await fsp.mkdir(root, { recursive: true });
  for (const file of await fsp.readdir(path.join(apt, 'archives'))) if (file.endsWith('.deb')) {
    const archive = path.join(apt, 'archives', file);
    await run('dpkg-deb', ['-x', archive, root]);
    await fsp.unlink(archive);
  }
  const fontDirectories = [path.join(root, 'usr/share/fonts'), '/usr/share/fonts'].filter(file => fs.existsSync(file));
  await fsp.writeFile(path.join(cache, 'fonts.conf'), '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>' + fontDirectories.map(file => '<dir>' + file.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</dir>').join('') + '<cachedir>' + path.join(cache, '.cache/fontconfig') + '</cachedir></fontconfig>');
  return root;
}
async function wrapExecutable(cache, filename, extra = {}) {
  const original = filename + '.capability-original';
  if (fs.existsSync(original)) return filename;
  await fsp.rename(filename, original);
  const variables = { ...environment(cache), ...extra };
  await fsp.writeFile(filename, '#!/bin/sh\n' + Object.entries(variables).map(([key, value]) => 'export ' + key + '=' + quote(value)).join('\n') + '\nexec ' + quote(original) + ' "$@"\n', { mode: 0o755 });
  return filename;
}
async function installOffice(cache, packages, run) {
  const version = await run('/usr/bin/python3', ['-c', 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")'], { capture: true });
  const pythonPackages = ['python3', 'python3-minimal', 'python' + version, 'python' + version + '-minimal', 'libpython' + version + '-minimal', 'libpython' + version + '-stdlib'];
  const root = await installSystemPackages(cache, [...packages.filter(name => name !== 'ffmpeg'), ...pythonPackages], run);
  const program = path.join(root, 'usr/lib/libreoffice/program');
  const executable = await wrapExecutable(cache, path.join(program, 'soffice'));
  const pythonVersion = 'python' + version;
  if (!pythonVersion) throw new Error('LibreOffice runtime did not include its matching Python.');
  const python = path.join(cache, 'bin/uno-python');
  await fsp.mkdir(path.dirname(python), { recursive: true });
  const variables = { ...environment(cache), PYTHONHOME: path.join(root, 'usr'), PYTHONPATH: [program, path.join(root, 'usr/lib/python3/dist-packages')].join(':'), UNO_PATH: program };
  await fsp.writeFile(python, '#!/bin/sh\n' + Object.entries(variables).map(([key, value]) => 'export ' + key + '=' + quote(value)).join('\n') + '\nexec ' + quote(path.join(root, 'usr/bin', pythonVersion)) + ' "$@"\n', { mode: 0o755 });
  return { libreoffice: executable, unoPython: python };
}
module.exports = { environment, prepareApt, installSystemPackages, wrapExecutable, installOffice };
