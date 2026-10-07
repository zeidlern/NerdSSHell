'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { Duplex } = require('node:stream');
const { createHash } = require('node:crypto');
const { StandardRemote } = require('./standard-remote.cjs');
const { scriptText } = require('./action-catalog.cjs');
const { syntaxBootstrap } = require('./local-powershell.cjs');
const { AsyncLocalStorage } = require('node:async_hooks');
const { spawnElevatedPty } = require('./elevated-pty.cjs');
const { consoleText } = require('./console-text.cjs');
const { windowsPowerShellEnvironment } = require('./powershell-environment.cjs');
const NATIVE_HASHES = Object.freeze({
  "conpty.node": "ec2fd8545c30e051ee3fa17d26127f7e615919814879c7f746cf4c80845226e0",
  "conpty/conpty.dll": "3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff",
  "conpty/OpenConsole.exe": "7f68c840226505004215c0b82d4e502c24b5bc3f4b93c4baaaa19bd679c0def8"
}); // Filled from the reviewed, integrity-checked node-pty 1.2.0-beta.15 tarball.
function installedShells({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return [];
  const windows = env.SystemRoot || 'C:\\Windows', programs = env.ProgramFiles || 'C:\\Program Files';
  return [
    { id: 'local:powershell', name: 'Windows PowerShell', family: 'powershell', executable: path.win32.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
    { id: 'local:pwsh', name: 'PowerShell 7', family: 'powershell', executable: path.win32.join(programs, 'PowerShell', '7', 'pwsh.exe') },
    { id: 'local:cmd', name: 'Command Prompt', family: 'cmd', executable: path.win32.join(windows, 'System32', 'cmd.exe') }
  ].filter(s => path.win32.isAbsolute(s.executable) && exists(s.executable));
}
function shellFamily(id) {
  if (id === 'local:cmd') return 'cmd';
  if (id === 'local:powershell' || id === 'local:pwsh') return 'powershell';
  throw new Error('Choose a supported local shell.');
}
function cmdPromptReady(text) {
  return /(?:^|[\r\n])[A-Za-z]:\\[^\r\n]*>\s*$/.test(consoleText(text));
}
function waitForCmdInput(pty, timeoutMs = 20000, signal) {
  // Observe only this newly owned console. Its output is already buffered by
  // PtyChannel while we wait for CMD's fixed process-local default prompt.
  return new Promise((resolve, reject) => {
    let text = '', settled = false;
    const disposables = [];
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); for (const item of disposables) item.dispose(); error ? reject(error) : resolve(); };
    const cancel = () => finish(signal.reason instanceof Error ? signal.reason : new Error('Command Prompt startup was cancelled.'));
    const timer = setTimeout(() => finish(new Error('Command Prompt did not become ready. No startup command was sent.')), timeoutMs);
    const watch = item => { if (settled) item.dispose(); else disposables.push(item); };
    try {
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      watch(pty.onData(data => { text = (text + data).slice(-8192); if (cmdPromptReady(text)) finish(); }));
      if (!settled) watch(pty.onExit(() => finish(new Error('Command Prompt ended before startup text could be sent.'))));
    } catch (error) { finish(error); }
  });
}
function verifyNativePty(root) {
  for (const [relative, expected] of Object.entries(NATIVE_HASHES)) {
    const file = path.join(root, ...relative.split('/'));
    if (!fs.lstatSync(file).isFile() || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== expected) throw new Error('Local-console native component failed integrity verification. Reinstall a verified build.');
  }
}
function launchArguments(command, shellId = 'local:powershell') {
  const family = shellFamily(shellId);
  if (command !== undefined) {
    command = scriptText(command);
    // Windows CreateProcess has an argument-length limit. No temporary script containing secrets.
    if (Buffer.byteLength(command) > 8192) throw new Error('Local reviewed commands are limited to 8 KiB. Open a script file deliberately for larger jobs.');
  }
  if (family === 'cmd') {
    // /d disables the registry AutoRun hooks. Reviewed CMD text is submitted
    // to its newly owned input stream after readiness, never put into argv or
    // wrapped in a PowerShell script. This also retains multiline paste behavior.
    if (command?.split('\n').some(line => line.length > 8191)) throw new Error('A Command Prompt input line exceeds 8,191 characters.');
    return ['/d'];
  }
  const args = ['-NoLogo', '-NoProfile', '-NoExit'];
  args.push('-EncodedCommand', Buffer.from(syntaxBootstrap() + (command || ''), 'utf16le').toString('base64'));
  return args;
}
/** Adapts a ConPTY to the existing ordered, bounded StandardRemote shell lifecycle. */
class PtyChannel extends Duplex {
  constructor(pty) {
    super({ highWaterMark: 65536, autoDestroy: true }); this.pty = pty; this.exited = false;
    // Pinned node-pty 1.2.0-beta.15 leaves its DLL-mode conout worker's server alive
    // after EOF, and its kill path only disposes that worker on later output.
    // Capture only this PTY's transport; never enumerate processes or workers.
    const agent = pty._agent;
    this.dllTransport = agent?._useConptyDll === true
      ? { agent, input: agent._inSocket, output: agent._outSocket, connection: agent._conoutSocketWorker } : null;
    this.disposables = [pty.onData(data => { if (!this.destroyed && !this.push(Buffer.from(data, 'utf8'))) pty.pause(); }),
      pty.onExit(() => { if (this.exited) return; pty.resume(); this.exited = true; this.push(null); this.end(); })];
  }
  _read() { if (!this.exited) this.pty.resume(); }
  _write(bytes, _encoding, callback) { try { this.pty.write(bytes.toString('utf8')); setImmediate(callback); } catch (e) { callback(e); } }
  _destroy(error, callback) {
    for (const d of this.disposables || []) d.dispose();
    const transport = this.dllTransport; this.dllTransport = null;
    const closedBeforeOutput = transport && !this.exited && this.pty._isReady === false;
    try {
      if (!this.exited) {
        if (transport) this.pty.resume(); // Keep the owned output pipe draining during native close.
        if (closedBeforeOutput) {
          // Public kill() waits for first output. A cancelled startup must not
          // leave its native close queued behind the worker we are releasing.
          this.pty._deferreds = []; this.pty._close(); transport.agent.kill();
        } else this.pty.kill();
      }
    } catch {}
    // On natural exit autoDestroy reaches here only after buffered output is
    // consumed. Retain node-pty's one-second worker drain grace on explicit close.
    if (transport) {
      try { if (!transport.input.destroyed) transport.input.destroy(); } catch (cause) { error ||= cause; }
      if (closedBeforeOutput) {
        // Before READY the socket may never connect and therefore gets no EOF.
        // Close it after the worker's existing drain grace; a late READY event
        // must not reconnect a socket that we already considered released.
        const closeOutput = () => transport.output.destroy(), worker = transport.connection._worker;
        try { if (worker && worker.threadId !== -1) worker.once('exit', closeOutput); else closeOutput(); } catch (cause) { error ||= cause; }
      }
      try { transport.connection.dispose(); } catch (cause) { error ||= cause; }
    }
    this.exited = true; callback(error);
  }
  setWindow(rows, cols) { if (!this.exited && !this.destroyed) this.pty.resize(cols, rows); }
  close() { this.destroy(); }
}
class LocalRemote extends StandardRemote {
  constructor(shell, { spawn, nativeRoot, home = os.homedir(), elevatedSpawn = spawnElevatedPty } = {}) {
    const baseId = shell?.baseId || shell?.id, family = shellFamily(baseId), administrator = shell.administrator === true;
    if (shell.id !== baseId + (administrator ? '-admin' : '')) throw new Error('Invalid local shell identity.');
    // The public profile validator deliberately cannot create the reserved local: namespace.
    super({ id: 'local-placeholder', host: 'localhost', username: 'local', auth: 'password', name: 'This PC' });
    this.profile = Object.freeze({ ...this.profile, id: shell.id, name: `This PC / ${shell.name}`, host: os.hostname(), username: os.userInfo().username,
      local: true, sessionType: 'local', persistent: false, shellId: baseId, shellFamily: family, administrator, record: false });
    this.shell = Object.freeze({ ...shell, baseId, family, administrator }); this.home = home; this.nativeRoot = nativeRoot; this.spawn = spawn;
    this.launchContext = new AsyncLocalStorage(); this.elevatedSpawn = elevatedSpawn;
    if (shell.administrator) this.openTimeoutMs = 190000;
    const client = this.client = new EventEmitter(); client.end = () => client.emit('close');
    const open = async (geometry, command, callback, validateOpening = () => {}) => {
      let pty, channel;
      try {
        if (!this.connected || this.closing) throw new Error('Local console is disconnected.');
        const launch = this.launchContext.getStore(), cwd = this.home;
        const args = launchArguments(command, baseId); // Validate before spawn or UAC.
        if (this.shell.administrator) {
          // CMD expands percent/exclamation content even inside quoted paths.
          // Do not turn a picked directory into elevated command text. The
          // normal Administrator launcher uses the elevated account's home.
          if (family === 'cmd' && cwd !== os.homedir()) throw new Error('Administrator Command Prompt opens in its account home. Change folders in the console after it opens.');
          // Nothing runs until Windows consent and helper authentication finish.
          // Reviewed startup text is sent only to this newly owned console.
          pty = await this.elevatedSpawn(this.shell.baseId);
          let startup = family === 'powershell' && cwd !== os.homedir() ? `Set-Location -LiteralPath '${cwd.replaceAll("'", "''")}'; ` : '';
          if (command !== undefined) startup += scriptText(command);
          if (startup) await pty.readyForInput();
          if (!this.connected || this.closing) throw new Error('Local console closed during Windows approval.');
          validateOpening();
          launch?.validate?.();
          pty.resize(geometry.cols, geometry.rows);
          if (startup) pty.write((family === 'cmd' ? startup.replace(/\r\n|\n/g, '\r') : startup) + '\r');
        } else {
          if (!this.spawn) { if (this.nativeRoot) verifyNativePty(this.nativeRoot); this.spawn = require('node-pty').spawn; }
          validateOpening(); launch?.validate?.();
          pty = this.spawn(this.shell.executable, args, {
          name: 'xterm-256color', cols: geometry.cols, rows: geometry.rows, cwd,
          env: baseId === 'local:powershell' ? windowsPowerShellEnvironment() : { ...process.env, ...(family === 'cmd' ? { PROMPT: '$P$G' } : {}) }, useConpty: true, useConptyDll: true
          });
          if (family === 'cmd' && command !== undefined) {
            channel = new PtyChannel(pty);
            const abort = new AbortController();
            const cancelled = () => { try { validateOpening(); } catch (error) { abort.abort(error); } };
            this.on('ended', cancelled); client.on('close', cancelled);
            try { await waitForCmdInput(pty, 20000, abort.signal); }
            finally { this.off('ended', cancelled); client.off('close', cancelled); }
            validateOpening(); launch?.validate?.();
            pty.write(scriptText(command).replace(/\r\n|\n/g, '\r') + '\r');
          }
        }
        // ConPTY DLL mode avoids node-pty's child_process.fork cleanup path: RunAsNode stays disabled.
        callback(null, channel || new PtyChannel(pty));
      } catch (error) { if (channel) channel.destroy(); else pty?.kill(); callback(error); }
    };
    this.client.shell = (geometry, callback) => open(geometry, undefined, callback);
    this.client.exec = (command, options, callback) => open(options.pty, command, callback);
    this.client.openLocalShell = open;
    this.inputWindow = new Map();
  }
  emit(type, ...args) {
    // StandardRemote supplies the nonpersistent lifecycle. Publish local
    // identity before the first panes/snapshot event, including rediscovery.
    if (this.shell) {
      const local = { local: true, sessionType: 'local', persistent: false, shellId: this.shell.baseId,
        shellFamily: this.shell.family, administrator: this.shell.administrator };
      if (type === 'panes') for (const pane of args[0]) Object.assign(pane, local, { command: this.shell.name });
      else if (type === 'snapshot') Object.assign(args[1], local);
    }
    return super.emit(type, ...args);
  }
  async connect() { if (this.closing) throw new Error('Local console was closed.'); this.connected = true; return this.discover(); }
  async create(name, command, launch = {}) {
    const pane = await this.launchContext.run(launch, () => super.create(name, command)); pane.local = true; pane.administrator = !!this.shell.administrator; pane.command = this.shell.name; return pane;
  }
  async createTask(name, code, launch) { return this.create(name, scriptText(code), launch); }
  async input(key, data) {
    if (typeof data !== 'string' || Buffer.byteLength(data) > 65536) throw new Error('Local console paste is limited to 64 KiB.');
    const now = Date.now(), prior = this.inputWindow.get(key);
    const bucket = prior && now - prior.at < 1000 ? prior : { at: now, bytes: 0 };
    if (bucket.bytes + Buffer.byteLength(data) > 262144) throw new Error('Local input rate limit reached. Input was not queued for later.');
    bucket.bytes += Buffer.byteLength(data); this.inputWindow.set(key, bucket); return super.input(key, data);
  }
  finishShell(record) { if (record) this.inputWindow.delete(record.pane.key); super.finishShell(record); }
  async sftp() { throw new Error('SFTP belongs to remote connections. Use Windows Explorer for local files.'); }
}
module.exports = { LocalRemote, PtyChannel, installedShells, shellFamily, launchArguments, cmdPromptReady, waitForCmdInput, syntaxBootstrap, verifyNativePty, NATIVE_HASHES };
