'use strict';
// The app stays unelevated. A fixed PowerShell/.NET broker performs Windows UAC
// and owns an authenticated, local-only pipe to its elevated ConPTY helper.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const { consoleText } = require('./console-text.cjs');
const { windowsPowerShellEnvironment } = require('./powershell-environment.cjs');
const MAX_FRAME = 65536;
const quote = s => "'" + s.replaceAll("'", "''") + "'";
function bundledNativeDirectory() {
  const root = path.dirname(__dirname);
  return path.join(root.endsWith('.asar') ? root + '.unpacked' : root, 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'conpty');
}
function bootstrap(source, hash, shell, nativeDirectory = bundledNativeDirectory()) {
  if (!['local:powershell', 'local:pwsh', 'local:cmd'].includes(shell) || !/^[a-f0-9]{64}$/.test(hash) || !path.isAbsolute(source) ||
      typeof nativeDirectory !== 'string' || !path.isAbsolute(nativeDirectory) || nativeDirectory.length > 1024 || /[\x00-\x1f\x7f]/.test(nativeDirectory)) throw new Error('Invalid administrator helper bootstrap.');
  return `$ErrorActionPreference='Stop'; $f=[IO.File]::OpenRead(${quote(source)}); try {$b=New-Object byte[] 131073; $n=0; while($n -lt $b.Length -and ($r=$f.Read($b,$n,$b.Length-$n)) -gt 0){$n+=$r}} finally {$f.Dispose()}; if($n -eq 0 -or $n -gt 131072){throw 'Helper too large'}; $exact=New-Object byte[] $n; [Buffer]::BlockCopy($b,0,$exact,0,$n); $b=$exact; $h=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)).Replace('-','').ToLowerInvariant(); if($h -ne ${quote(hash)}){throw 'Helper integrity failure'}; Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString($b)); [NerdSSHell.ElevatedConsole]::Broker(${quote(source)},${quote(hash)},${quote(nativeDirectory)},${quote(shell)},${process.pid})`;
}
function frame(type, payload = Buffer.alloc(0)) {
  if (!['I', 'S', 'C'].includes(type) || !Buffer.isBuffer(payload) || payload.length > MAX_FRAME || (type === 'S' && payload.length !== 4) || (type === 'C' && payload.length)) throw new Error('Invalid administrator input frame.');
  const header = Buffer.alloc(5); header[0] = type.charCodeAt(0); header.writeUInt32LE(payload.length, 1); return Buffer.concat([header, payload]);
}
class ElevatedPty {
  constructor(child, cleanup, { startupMs = 180000, shellId = 'local:powershell' } = {}) {
    if (!['local:powershell', 'local:pwsh', 'local:cmd'].includes(shellId)) throw new Error('Choose a supported administrator shell.');
    this.shellId = shellId;
    this.child = child; this.events = new EventEmitter(); this.pending = []; this.pendingBytes = 0; this.paused = true; this.ended = false; this.buffer = Buffer.alloc(0); this.decoder = new StringDecoder('utf8'); this.promptText = ''; this.cleanup = cleanup;
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.timer = setTimeout(() => this.fail(new Error('Administrator startup timed out. The console was not retried.')), startupMs);
    child.stdout.on('data', b => this.receive(b));
    child.stderr.on('data', () => {}); // Never expose compiler/launch output or paths as terminal data.
    child.on('error', e => this.fail(new Error('Administrator helper could not start.', { cause: e })));
    child.stdin.on('error', () => this.fail(new Error('Administrator console input ended.')));
    child.stdout.on('error', () => this.fail(new Error('Administrator console output ended.')));
    child.on('exit', code => { this.childExited = true; this.processExitCode = code; clearTimeout(this.stopTimer); });
    // Process exit can precede the last stdout data event. Finish only after
    // stdio closes, or an authenticated E frame after the helper's output drain.
    child.on('close', code => { if (this.buffer.length) this.fail(new Error('Truncated administrator helper output.')); else this.finish(code ?? this.processExitCode ?? 0); });
  }
  receive(bytes) {
    if (this.ended) return;
    this.buffer = Buffer.concat([this.buffer, bytes]);
    while (this.buffer.length >= 5) {
      const type = String.fromCharCode(this.buffer[0]), size = this.buffer.readUInt32LE(1);
      if (!['D', 'R', 'X', 'E', 'F'].includes(type) || size > MAX_FRAME || (['R', 'X'].includes(type) && size) || (type === 'E' && size !== 4) || (type === 'F' && size > 1024)) return this.fail(new Error('Invalid administrator helper response.'));
      if (this.buffer.length < size + 5) return;
      const data = this.buffer.subarray(5, size + 5); this.buffer = this.buffer.subarray(size + 5);
      if (type === 'R') { if (this.started) return this.fail(new Error('Duplicate administrator startup response.')); this.started = true; clearTimeout(this.timer); this.resolve(this); }
      else if (type === 'X') { const error = new Error('Windows administrator approval was cancelled.'); error.code = 'NERDSSHELL_UAC_CANCELLED'; return this.fail(error); }
      else if (type === 'F') return this.fail(new Error('Windows could not open the embedded administrator console. It was not retried.'));
      else if (type === 'E') return this.finish(data.readInt32LE());
      else {
        if (!this.started) return this.fail(new Error('Administrator output preceded authentication.'));
        const text = this.decoder.write(data); this.promptText = (this.promptText + text).slice(-8192);
        if (!text) continue;
        if (this.paused || !this.events.listenerCount('data')) { this.pending.push(text); this.pendingBytes += Buffer.byteLength(text); if (this.pendingBytes > 262144) return this.fail(new Error('Administrator startup output exceeded its limit.')); }
        else this.events.emit('data', text);
      }
    }
  }
  onData(fn) { this.events.on('data', fn); return { dispose: () => this.events.off('data', fn) }; }
  onExit(fn) { if (this.ended) { let disposed = false; setImmediate(() => { if (!disposed) fn({ exitCode: this.exitCode }); }); return { dispose: () => { disposed = true; } }; } this.events.on('exit', fn); return { dispose: () => this.events.off('exit', fn) }; }
  write(text) { if (!this.started || this.ended || this.closing || typeof text !== 'string') throw new Error('Administrator console is not connected.'); const bytes = frame('I', Buffer.from(text)); if (this.child.stdin.writableLength + bytes.length > 262144) throw new Error('Administrator input backpressure limit reached. Input was not queued.'); this.child.stdin.write(bytes); }
  resize(cols, rows) { if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 1000 || rows < 5 || rows > 500) throw new Error('Invalid administrator geometry.'); if (!this.started || this.ended || this.closing) throw new Error('Administrator console is not connected.'); const b = Buffer.alloc(4); b.writeUInt16LE(cols); b.writeUInt16LE(rows, 2); const bytes = frame('S', b); if (this.child.stdin.writableLength + bytes.length > 262144) throw new Error('Administrator input backpressure limit reached. Resize was not queued.'); this.child.stdin.write(bytes); }
  pause() { this.paused = true; this.child.stdout.pause(); }
  resume() { this.paused = false; for (const data of this.pending.splice(0)) this.events.emit('data', data); this.pendingBytes = 0; if (!this.ended) this.child.stdout.resume(); }
  async readyForInput() {
    // Used only for a NEW reviewed task/cwd, before any user can own this PTY.
    const deadline = Date.now() + 20000;
    const prompt = this.shellId === 'local:cmd' ? /(?:^|[\r\n])[A-Za-z]:\\[^\r\n]*>\s*$/ : /PS [^\r\n]*?> /;
    while (!prompt.test(consoleText(this.promptText))) {
      if (this.ended || this.closing || Date.now() > deadline) throw new Error('Administrator shell did not become ready. No startup command was sent.');
      await new Promise(r => setTimeout(r, 50));
    }
    if (this.shellId !== 'local:cmd') await new Promise(r => setTimeout(r, 300));
    if (this.ended || this.closing) throw new Error('Administrator console ended.');
  }
  kill() { if (this.ended || this.closing) return; this.closing = true; try { this.child.stdin.end(frame('C')); } catch {} this.stopTimer = setTimeout(() => { if (!this.childExited) this.child.kill(); }, 2000); }
  fail(error) { if (this.ended) return; this.reject(error); this.kill(); this.buffer = Buffer.alloc(0); this.pending = []; this.pendingBytes = 0; this.finish(-1); }
  finish(exitCode = 0) { if (this.ended) return; this.ended = true; this.exitCode = exitCode; clearTimeout(this.timer); if (!this.started) this.reject(new Error('Administrator helper exited before opening a console.')); const tail = this.decoder.end(); if (tail) { if (this.paused) { this.pending.push(tail); this.pendingBytes += Buffer.byteLength(tail); } else this.events.emit('data', tail); } this.buffer = Buffer.alloc(0); this.events.emit('exit', { exitCode }); this.cleanup(); }
}
async function spawnElevatedPty(shellId, { sourceFile = path.join(__dirname, 'elevated-console.cs'), execute = spawn, systemRoot = process.env.SystemRoot || 'C:\\Windows', nativeDirectory = bundledNativeDirectory() } = {}) {
  if (!['local:powershell', 'local:pwsh', 'local:cmd'].includes(shellId)) throw new Error('Choose a supported administrator shell.');
  const fd = fs.openSync(sourceFile, 'r'), buffer = Buffer.alloc(131073); let length = 0;
  try { if (!fs.fstatSync(fd).isFile()) throw new Error('Administrator helper is unavailable.'); let count; while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null))) length += count; } finally { fs.closeSync(fd); }
  if (!length || length > 131072) throw new Error('Administrator helper is unavailable.');
  const source = buffer.subarray(0, length);
  const hash = createHash('sha256').update(source).digest('hex'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-admin-'));
  const filename = path.join(directory, 'ElevatedConsole.cs');
  let removed = false; const cleanup = () => { if (!removed) { removed = true; try { fs.unlinkSync(filename); } catch {} try { fs.rmdirSync(directory); } catch {} } };
  try {
    fs.writeFileSync(filename, source, { flag: 'wx', mode: 0o600 });
    const child = execute(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap(filename, hash, shellId, nativeDirectory), 'utf16le').toString('base64')], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: windowsPowerShellEnvironment() });
    const pty = new ElevatedPty(child, cleanup, { shellId }); return await pty.ready;
  } catch (error) { cleanup(); throw error; }
}
module.exports = { spawnElevatedPty, ElevatedPty, bootstrap, frame, bundledNativeDirectory };
