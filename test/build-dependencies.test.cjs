'use strict';

// The patched build-only glob/minimatch releases cross major versions. Exercise
// the real ASAR and builder consumers, including their production file rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const metadata = require('../package.json');
const asarRequire = createRequire(require.resolve('@electron/asar'));
const builderRequire = createRequire(require.resolve('app-builder-lib'));
const universalRequire = createRequire(require.resolve('@electron/universal'));
const { FileMatcher, getNodeModuleFileMatcher, copyFiles } = builderRequire('./fileMatcher');
const glob = asarRequire('glob');

function temporary(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'nerdsshell-build-deps-'));
  assert.equal(path.dirname(directory), parent);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeFiles(directory, files) {
  for (const [relative, bytes] of Object.entries(files)) {
    const filename = path.join(directory, ...relative.split('/'));
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
  }
}

function listedFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    return entry.isDirectory()
      ? listedFiles(path.join(directory, entry.name), relative + '/')
      : [relative];
  }).sort();
}

test('ASAR, builder and universal retain matching, negation, braces and Windows path semantics', () => {
  const cases = [
    ['src/main.cjs', 'src/**', {}, true],
    ['ui/.hidden', 'ui/**', { dot: true }, true],
    ['src/main.cjs', '!src/**', {}, false],
    ['ui/app.js', '!src/**', {}, true],
    ['node_modules/node-pty/deps/native.c', 'node_modules/node-pty/{src,deps,build}/**/*', {}, true],
    ['node_modules/node-pty/lib/index.js', 'node_modules/node-pty/{src,deps,build}/**/*', {}, false],
    ['native/conpty.node', '*.{node,dll}', { matchBase: true }, true],
    ['native/notes.txt', '*.{node,dll}', { matchBase: true }, false],
    ['root/foo/bar', 'root/!(baz)/*', {}, true],
    ['root/baz/bar', 'root/!(baz)/*', {}, false],
    ['native\\conpty.node', 'native\\*.{node,dll}', { platform: 'win32', windowsPathsNoEscape: true }, true],
    ['C:\\project\\native\\conpty.node', 'C:/project/**/*.node', { platform: 'win32' }, true],
    ['C:\\PROJECT\\native\\conpty.node', 'c:/project/**/*.node', { platform: 'win32', nocase: true }, true],
    ['//server/share/project/native/conpty.node', '//server/share/project/**/*.node', { platform: 'win32' }, true]
  ];
  for (const [name, consumer] of [['asar', asarRequire], ['builder', builderRequire], ['universal', universalRequire]]) {
    const { minimatch, Minimatch } = consumer('minimatch');
    for (const [filename, pattern, options, expected] of cases) {
      assert.equal(minimatch(filename, pattern, options), expected, `${name}: ${filename} / ${pattern}`);
      assert.equal(new Minimatch(pattern, options).match(filename), expected, `${name} compiled: ${filename} / ${pattern}`);
    }
  }
});

test('builder applies production source, native exclusion and ASAR unpack rules', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source');
  const destination = path.join(directory, 'copied');
  const sourceCases = {
    'src/main.cjs': true,
    'ui/app.js': true,
    'ui/branding/logo.png': true,
    'package.json': true,
    'docs/THIRD-PARTY-NOTICES.md': true,
    'LICENSE': true,
    'test/private.test.cjs': false,
    'scripts/build.cjs': false,
    'docs/private.md': false
  };
  const nativeCases = {
    'node_modules/node-pty/src/win/pty.cc': false,
    'node_modules/node-pty/deps/winpty/file.cc': false,
    'node_modules/node-pty/third_party/file.cc': false,
    'node_modules/node-pty/build/Release/pty.node': false,
    'node_modules/node-pty/scripts/install.js': false,
    'node_modules/node-pty/prebuilds/darwin-arm64/pty.node': false,
    'node_modules/node-pty/prebuilds/win32-arm64/conpty.node': false,
    'node_modules/node-pty/prebuilds/win32-x64/conpty.pdb': false,
    'node_modules/node-pty/prebuilds/win32-x64/pty.node': false,
    'node_modules/node-pty/prebuilds/win32-x64/conpty_console_list.node': false,
    'node_modules/node-pty/prebuilds/win32-x64/winpty-agent.exe': false,
    'node_modules/node-pty/prebuilds/win32-x64/winpty.dll': false,
    'node_modules/node-pty/prebuilds/win32-x64/conpty.node': true,
    'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll': true,
    'node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe': true,
    'node_modules/node-pty/lib/index.js': true,
    'node_modules/ssh2/lib/client.js': true,
    'node_modules/ssh2/util/pagent.exe': true
  };
  writeFiles(source, Object.fromEntries(Object.keys({ ...sourceCases, ...nativeCases }).map(name => [name, 'synthetic ' + name])));
  const mainMatcher = new FileMatcher(source, destination, value => value, metadata.build.files);
  const mainFilter = mainMatcher.createFilter();
  for (const [relative, expected] of Object.entries(sourceCases)) {
    const filename = path.join(source, ...relative.split('/'));
    assert.equal(mainFilter(filename, fs.statSync(filename)), expected, relative);
  }
  await copyFiles([mainMatcher], null, false);
  assert.deepEqual(listedFiles(destination), Object.keys(sourceCases).filter(name => sourceCases[name]).sort());

  const nativeMatcher = getNodeModuleFileMatcher(source, destination, value => value, {}, {
    config: metadata.build, debugLogger: { isEnabled: false }
  });
  const nativeFilter = nativeMatcher.createFilter();
  const unpackFilter = new FileMatcher(source, destination, value => value, metadata.build.asarUnpack).createFilter();
  const unpacked = new Set([
    'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
    'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
    'node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
    'node_modules/ssh2/util/pagent.exe'
  ]);
  for (const [relative, expected] of Object.entries(nativeCases)) {
    const filename = path.join(source, ...relative.split('/'));
    const stat = fs.statSync(filename);
    assert.equal(nativeFilter(filename, stat), expected, relative);
    assert.equal(unpackFilter(filename, stat), unpacked.has(relative), `unpack ${relative}`);
  }
});

test('builder normalizes Windows patterns and preserves ordered exclusions and re-inclusion', t => {
  const source = temporary(t);
  const cases = {
    'native/conpty.node': true,
    'native/conpty.dll': true,
    'native/debug.pdb': false,
    'native/debug.map': false,
    'native/.metadata': true,
    'native/terminal-name.dll': true,
    'private/blocked.txt': false,
    'private/allowed.txt': true,
    'ui/app.js': false
  };
  writeFiles(source, Object.fromEntries(Object.keys(cases).map(name => [name, name])));
  const matcher = new FileMatcher(source, source, value => value, [
    'native\\**\\*', '!native\\**\\*.{pdb,map}',
    'private\\**\\*', '!private\\**\\*', 'private\\allowed.txt'
  ]);
  const filter = matcher.createFilter();
  for (const [relative, expected] of Object.entries(cases)) {
    const filename = path.join(source, ...relative.split('/'));
    assert.equal(filter(filename, fs.statSync(filename)), expected, relative);
  }
});

test('ASAR 4 creates and extracts packed and brace-selected unpacked bytes with glob exclusions', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source');
  const archive = path.join(directory, 'fixture.asar');
  const output = path.join(directory, 'extracted');
  const files = {
    'package.json': Buffer.from('{"name":"disposable-fixture"}'),
    'src/main.cjs': Buffer.from('module.exports = true;\n'),
    'ui/.metadata': Buffer.from('hidden file'),
    'native/conpty.node': Buffer.from([0, 1, 2, 255]),
    'native/conpty.dll': Buffer.from([4, 5, 6, 0]),
    'tools/helper.exe': Buffer.from([7, 8, 9, 0])
  };
  writeFiles(source, { ...files, 'ignored/secret.txt': 'must not be packed' });
  const asar = await import(pathToFileURL(require.resolve('@electron/asar')).href);
  await asar.createPackageWithOptions(source, archive, {
    unpack: '*.{node,dll,exe}', globOptions: { ignore: ['**/ignored/**'] }
  });
  assert.ok(asar.listPackage(archive).every(name => !name.includes('ignored')));
  for (const [relative, bytes] of Object.entries(files)) {
    assert.deepEqual(asar.extractFile(archive, relative), bytes, relative);
    const unpacked = /\.(?:node|dll|exe)$/.test(relative);
    assert.equal(Boolean(asar.statFile(archive, relative).unpacked), unpacked, relative);
    assert.equal(fs.existsSync(path.join(archive + '.unpacked', ...relative.split('/'))), unpacked, relative);
  }
  asar.extractAll(archive, output);
  assert.deepEqual(listedFiles(output), Object.keys(files).sort());
  for (const [relative, bytes] of Object.entries(files)) {
    assert.deepEqual(fs.readFileSync(path.join(output, ...relative.split('/'))), bytes);
  }
});

test('ASAR crawl cannot package files through an outside-directory link', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source');
  const outside = path.join(directory, 'outside');
  writeFiles(source, { 'main.cjs': 'fixture' });
  writeFiles(outside, { 'private.txt': 'outside fixture bytes' });
  fs.symlinkSync(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const asar = await import(pathToFileURL(require.resolve('@electron/asar')).href);
  await assert.rejects(asar.createPackage(source, path.join(directory, 'blocked.asar')), /outside|out of|escapes/i);
});

// This macOS merger strips only POSIX leading slashes from ASAR entries;
// its ASAR 3 dependency produces backslash-prefixed entries on Windows.
// Builder invokes it only from macPackager. Keep the synthetic POSIX coverage
// here while the actual Windows builder, ASAR and advisory tests run separately.
test('universal ASAR merger still enforces its unique-file glob allowlist', {
  skip: process.platform === 'win32' ? '@electron/universal merges macOS bundles and requires POSIX ASAR paths.' : false
}, async t => {
  const directory = temporary(t);
  const x64Source = path.join(directory, 'x64');
  const armSource = path.join(directory, 'arm64');
  writeFiles(x64Source, { 'common.txt': 'shared content', 'unique-x64.dat': 'x64 fixture' });
  writeFiles(armSource, { 'common.txt': 'shared content', 'unique-arm64.dat': 'arm64 fixture' });
  const asar = universalRequire('@electron/asar');
  const { mergeASARs } = universalRequire('./asar-utils');
  const x64AsarPath = path.join(directory, 'x64.asar');
  const arm64AsarPath = path.join(directory, 'arm64.asar');
  await asar.createPackage(x64Source, x64AsarPath);
  await asar.createPackage(armSource, arm64AsarPath);
  const outputAsarPath = path.join(directory, 'merged.asar');
  const options = { x64AsarPath, arm64AsarPath, outputAsarPath };
  await assert.rejects(mergeASARs({ ...options, singleArchFiles: 'different-*.dat' }), /not covered by.*allowList/);
  await mergeASARs({ ...options, singleArchFiles: 'unique-{x64,arm64}.dat' });
  assert.equal(asar.extractFile(outputAsarPath, 'common.txt').toString(), 'shared content');
  assert.equal(asar.extractFile(outputAsarPath, 'unique-x64.dat').toString(), 'x64 fixture');
  assert.equal(asar.extractFile(outputAsarPath, 'unique-arm64.dat').toString(), 'arm64 fixture');
});

test('minimatch rejects globparts amplification while retaining ordinary level-2 matching', () => {
  // Bound CPU and memory even if a future resolution reintroduces the advisory.
  // All input is synthetic; the child never reads application or user files.
  const probe = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', `
    const assert = require('node:assert/strict');
    const { Minimatch } = require(process.argv[1]);
    const pattern = Array(30).fill('**/../a/b').join('/');
    assert.throws(() => new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 }), RangeError);
    assert.throws(() => new Minimatch(pattern, { optimizationLevel: 2 }), RangeError);
    const ordinary = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
    assert.equal(ordinary.match('x/a/b/y/c/d'), true);
    assert.equal(ordinary.match('../a/b/../c/d'), true);
  `, asarRequire.resolve('minimatch')], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  assert.ifError(probe.error);
  assert.equal(probe.status, 0, probe.stderr);
});

function traversalTree(directory, depth = 3) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'fixture.txt'), 'fixture');
  if (depth > 0) for (const branch of ['a', 'b', 'c']) traversalTree(path.join(directory, branch), depth - 1);
}

function abortingFilesystem(controller, reason) {
  let calls = 0;
  const beforeRead = () => { if (++calls === 1) controller.abort(reason); };
  return {
    calls: () => calls,
    fs: {
      ...fs,
      readdir(...args) { beforeRead(); return fs.readdir(...args); },
      readdirSync(...args) { beforeRead(); return fs.readdirSync(...args); }
    }
  };
}

test('glob stops background directory reads when an asynchronous walk is aborted', async t => {
  const directory = temporary(t);
  traversalTree(directory);
  const controller = new AbortController();
  const reason = new Error('disposable glob cancellation');
  const counted = abortingFilesystem(controller, reason);
  await assert.rejects(glob.glob('**', { cwd: directory, signal: controller.signal, fs: counted.fs }), error => error === reason);
  assert.equal(counted.calls(), 1);
  // Allow the in-flight first read to finish; it must not start another walk.
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(counted.calls(), 1);
});

test('glob stops directory reads when a synchronous stream is aborted', async t => {
  const directory = temporary(t);
  traversalTree(directory);
  const controller = new AbortController();
  const reason = new Error('disposable glob stream cancellation');
  const counted = abortingFilesystem(controller, reason);
  await new Promise((resolve, reject) => {
    const stream = glob.globStreamSync('**', { cwd: directory, signal: controller.signal, fs: counted.fs });
    stream.once('error', error => {
      try { assert.equal(error, reason); resolve(); } catch (failure) { reject(failure); }
    });
    stream.once('end', () => reject(new Error('Aborted glob stream completed successfully')));
    stream.resume();
  });
  assert.equal(counted.calls(), 1);
});
