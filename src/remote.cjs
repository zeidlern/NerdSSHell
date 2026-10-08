'use strict';
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Control } = require('./control.cjs');
const { closeSshTransport } = require('./ssh-transport.cjs');
const { profile, shellQuote: q, sessionName, tmuxPrefix, PANE_FORMAT, parsePanes, paneKey, fingerprint, knownHostStatus, integer, geometry,
  SESSION_IDENTITY_OPTION, LEGACY_SESSION_IDENTITY_OPTION, SESSION_IDENTITY_FORMAT, parseSessionIdentity } = require('./core.cjs');

function identityCondition(pane) {
  // Legacy-only pane records remain usable; never replace their stable token.
  const observed = pane.sessionIdentityOption || LEGACY_SESSION_IDENTITY_OPTION;
  if (![SESSION_IDENTITY_OPTION, LEGACY_SESSION_IDENTITY_OPTION].includes(observed)) throw new Error('Invalid session identity marker.');
  if (!parseSessionIdentity(pane.sessionToken).sessionToken) throw new Error('Invalid session identity.');
  const other = observed === SESSION_IDENTITY_OPTION ? LEGACY_SESSION_IDENTITY_OPTION : SESSION_IDENTITY_OPTION;
  return `#{&&:#{==:#{${observed}},${pane.sessionToken}},#{||:#{==:#{${other}},},#{==:#{${other}},${pane.sessionToken}}}}`;
}
function identityMatches(value, pane) {
  const identity = parseSessionIdentity(value.trim());
  return identity.sessionToken === pane.sessionToken &&
    (pane.sessionIdentityOption !== SESSION_IDENTITY_OPTION || identity.sessionIdentityOption === SESSION_IDENTITY_OPTION);
}

/** One authenticated connection; one control channel per opened remote session. */
class Remote extends EventEmitter {
  constructor(settings, { ask, trust, savePin, pins = {}, clientFactory, knownHosts, secrets = {} } = {}) {
    super(); this.profile = profile(settings); this.ask = ask; this.trust = trust; this.savePin = savePin;
    this.pins = pins; this.secrets = secrets; this.clientFactory = clientFactory || (() => new (require('ssh2').Client)());
    this.knownHosts = knownHosts; this.client = null; this.connected = false; this.panes = [];
    this.controls = new Map(); this.opening = new Map(); this.views = new Map(); this.closing = false;
    this.prefix = tmuxPrefix(this.profile); this.discovering = null; this.pendingCommands = new Set();
  }
  async connect() {
    const p = this.profile; const client = this.client = this.clientFactory();
    let privateKey, passphrase, password, hostVerified = false;
    const current = () => this.client === client && !this.closing;
    const authenticationAllowed = () => current() && hostVerified;
    const blockUnverified = () => {
      if (authenticationAllowed()) return true;
      if (!current()) return false;
      const error = new Error('Server identity has not been verified. Connection blocked.');
      error.code = 'NERDSSHELL_HOST_VERIFICATION'; this.verificationError = this.lastError = error;
      this.cancelSignIn?.(error); this.disconnect(); this.emit('disconnected', error);
      return false;
    };
    if (p.auth === 'key') {
      const stat = fs.statSync(p.keyPath); if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Choose a private key file smaller than 1 MB.');
      privateKey = fs.readFileSync(p.keyPath);
      const parsed = require('ssh2').utils.parseKey(privateKey);
      if (parsed instanceof Error && /encrypted|passphrase/i.test(parsed.message)) {
        passphrase = this.secrets.passphrase ?? await this.ask({ title: `Unlock key for ${p.name}`, message: 'The passphrase is kept only in memory until you disconnect.', secret: true });
        if (passphrase === null || this.closing) throw new Error('Sign-in cancelled.'); this.secrets.passphrase = passphrase;
      } else if (parsed instanceof Error) throw parsed;
    } else if (p.auth === 'password') {
      password = this.secrets.password ?? await this.ask({ title: `Sign in to ${p.name}`, message: `${p.username}@${p.host}`, secret: true, credentialKind: 'ssh-password' });
      if (password === null || this.closing) throw new Error('Sign-in cancelled.'); this.secrets.password = password;
    }
    if (this.closing) throw new Error('Sign-in cancelled.');
    const options = { host: p.host, port: p.port, username: p.username, readyTimeout: 180000,
      keepaliveInterval: 15000, keepaliveCountMax: 3, privateKey, passphrase, password,
      tryKeyboard: true, hostVerifier: (key, done) => {
        // ssh2's callback verifier must return undefined; a returned Promise
        // is treated as an immediate synchronous approval by the pinned API.
        if (!current()) return;
        hostVerified = false;
        this.verifyHost(key).then(accepted => {
          if (!current()) return;
          const permitted = hostVerified = accepted === true;
          if (!permitted) {
            const error = new Error('Server identity verification cancelled. Connection blocked.');
            error.code = 'NERDSSHELL_HOST_VERIFICATION'; this.verificationError = this.lastError = error;
          }
          try { done(permitted); } catch { hostVerified = false; blockUnverified(); }
        }, reason => {
          if (!current()) return;
          const error = reason instanceof Error ? reason : new Error('Server identity verification failed. Connection blocked.');
          error.code = 'NERDSSHELL_HOST_VERIFICATION';
          this.verificationError = this.lastError = error;
          try { done(false); } catch { blockUnverified(); }
        });
      } };
    if (p.auth === 'agent') {
      options.agent = process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK;
      if (!options.agent) throw new Error('No SSH agent is available. Choose a private key file or password in the connection settings.');
    }
    // Observe the same default password-method order used by pinned ssh2. A
    // rejected password followed by successful keyboard-interactive sign-in
    // must not make that rejected password eligible for permanent storage.
    let lastAuth, passwordPartial = false, authIndex = 0;
    this.passwordAuthenticated = false; this.passwordRejected = false; this.passwordFactorAccepted = false;
    const authOrder = ['none', p.auth === 'password' ? 'password' : p.auth === 'key' ? 'publickey' : 'agent', 'keyboard-interactive'];
    options.authHandler = (_methodsLeft, partialSuccess) => {
      if (!blockUnverified()) return false;
      if (p.auth === 'password' && lastAuth === 'password') {
        if (partialSuccess === true) passwordPartial = this.passwordFactorAccepted = true;
        else this.passwordRejected = true;
      }
      lastAuth = authOrder[authIndex++] || false;
      return lastAuth;
    };
    client.on('keyboard-interactive', async (_name, instructions, _language, prompts, finish) => {
      if (!blockUnverified()) return;
      try {
        const answers = [];
        for (const prompt of prompts) {
          const a = await this.ask({ title: `Sign in to ${p.name}`, message: `${instructions}\n${prompt.prompt}`.slice(0, 2000), secret: !prompt.echo });
          if (!current() || !blockUnverified()) return;
          if (a === null) { finish([]); return; }
          answers.push(a);
        }
        if (authenticationAllowed()) finish(answers);
      } catch { if (authenticationAllowed()) finish([]); }
    });
    client.on('error', e => { this.lastError = this.verificationError || e; });
    client.on('close', () => {
      if (this.client !== client) return;
      this.connected = false;
      this.clearConnectionWork(new Error('Connection lost. Command completion is unknown; no command was retried.'));
      this.client = null; this.secrets = {};
      if (!this.closing) this.emit('disconnected', this.lastError || new Error('Connection lost. Remote sessions have not been terminated.'));
    });
    await new Promise((resolve, reject) => {
      let finished = false;
      const complete = error => {
        if (finished) return; finished = true;
        client.off('ready', ready); client.off('error', failed); client.off('close', closed);
        if (this.cancelSignIn === cancelled) this.cancelSignIn = null;
        if (error) reject(error); else resolve();
      };
      const failed = error => complete(this.lastError || error);
      const closed = () => complete(this.lastError || new Error('Connection closed before sign-in completed.'));
      const cancelled = error => complete(error || new Error('Sign-in cancelled.'));
      const ready = () => {
        if (!blockUnverified()) { complete(this.verificationError || new Error('Sign-in cancelled.')); return; }
        this.passwordAuthenticated = p.auth === 'password' && (lastAuth === 'password' || passwordPartial);
        if (this.passwordAuthenticated) this.passwordFactorAccepted = true;
        complete();
      };
      this.cancelSignIn = cancelled;
      client.once('ready', ready); client.once('error', failed); client.once('close', closed);
      try { client.connect(options); } catch (error) { complete(error); }
    });
    if (this.closing || this.client !== client) throw new Error('Sign-in cancelled.');
    this.connected = true;
    await this.ensureSupport();
    await this.discover();
    return this.panes;
  }
  async verifyHost(key) {
    if (this.closing) return false;
    const client = this.client;
    const p = this.profile; const target = `${p.host.toLowerCase()}:${p.port}`;
    let known = this.knownHosts;
    if (known === undefined) {
      try { known = fs.readFileSync(path.join(os.homedir(), '.ssh', 'known_hosts'), 'utf8'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; known = ''; }
    }
    const status = knownHostStatus(known, p.host, p.port, key); const fp = fingerprint(key);
    if (status === 'revoked') throw new Error(`The server key for ${p.host} is marked revoked in known_hosts. Connection blocked.`);
    const pin = this.pins[target];
    if (pin && pin !== fp) throw new Error(`The identity of ${p.host} has changed. Connection blocked. Expected ${pin}; received ${fp}. Verify this independently before resetting trust.`);
    if (status === 'changed' && !pin) throw new Error(`The identity of ${p.host} differs from your OpenSSH known_hosts file. Connection blocked. Received ${fp}.`);
    if (pin || status === 'trusted') return true;
    const accepted = await this.trust({ host: p.host, port: p.port, fingerprint: fp });
    if (!accepted || this.closing || this.client !== client) return false;
    this.pins[target] = fp; await this.savePin?.(target, fp); return true;
  }
  exec(command, { timeout = 20000, input, maxBytes = 8 * 1024 * 1024 } = {}) {
    if (this.profile.terminalType === 'generic') return Promise.reject(new Error('Network-device connections never execute server probes or task commands. Use the interactive terminal.'));
    if (!this.connected || this.closing) return Promise.reject(new Error('Not connected.'));
    const client = this.client;
    return new Promise((resolve, reject) => {
      const chunks = { stdout: [], stderr: [] };
      let channel, timer, settled = false, received = 0, onOutput, onErrorOutput, onError, onClose;
      const operation = { cancel: error => finish(error) };
      const finish = (error, result) => {
        if (settled) return; settled = true;
        clearTimeout(timer); this.pendingCommands.delete(operation);
        if (channel) {
          if (onOutput) channel.off('data', onOutput);
          if (onErrorOutput) channel.stderr.off('data', onErrorOutput);
          if (onError) channel.off('error', onError);
          if (onClose) channel.off('close', onClose);
          // ssh2 may publish a late error after a cancelled channel is closed.
          channel.on('error', ignoreClosedChannelError);
        }
        chunks.stdout.length = 0; chunks.stderr.length = 0;
        if (error) { try { channel?.close(); } catch {} reject(error); } else resolve(result);
      };
      this.pendingCommands.add(operation);
      timer = setTimeout(() => finish(new Error('The server command timed out. Its completion is unknown; it was not retried.')), timeout);
      const opened = (error, stream) => {
        if (error) { finish(error); return; }
        if (settled) { stream.on('error', ignoreClosedChannelError); try { stream.close(); } catch {} return; }
        channel = stream;
        if (client !== this.client || !this.connected || this.closing) { finish(new Error('Connection changed. Command completion is unknown; no command was retried.')); return; }
        const receive = target => data => {
          if (settled) return;
          received += data.length;
          if (received > maxBytes) { finish(new Error('Remote response exceeds the safety limit.')); return; }
          target.push(Buffer.from(data));
        };
        onOutput = receive(chunks.stdout); onErrorOutput = receive(chunks.stderr);
        onError = error => finish(error);
        onClose = code => finish(null, { code: code ?? -1, stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') });
        channel.on('data', onOutput); channel.stderr.on('data', onErrorOutput);
        channel.on('error', onError); channel.on('close', onClose);
        try { channel.end(input); } catch (error) { finish(error); }
      };
      try { client.exec(command, opened); } catch (error) { finish(error); }
    });
  }
  clearConnectionWork(error) {
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    this.cancelSignIn?.();
    for (const operation of [...this.pendingCommands]) operation.cancel(error);
    this.opening.clear();
    for (const control of this.controls.values()) control.detach(); this.controls.clear();
    for (const view of this.views.values()) { view.active = false; view.initialized = false; }
    this.views.clear();
  }
  async checked(command, options) {
    const r = await this.exec(command, options);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Server command failed (${r.code}).`).trim().slice(-4000));
    return r.stdout;
  }
  async ensureSupport() {
    let r = await this.exec('command -v tmux >/dev/null 2>&1 && tmux -V');
    if (r.code !== 0) {
      const permitted = await this.ask({ title: 'Enable persistent sessions', message: 'This server needs tmux, the small server-side component NerdSSHell manages for you. Install it with Ubuntu/Debian apt? This requires administrator permission.', confirm: true });
      if (!permitted) throw new Error('Persistent-session support is not installed. No server changes were made.');
      const root = (await this.checked('id -u')).trim() === '0';
      let input;
      if (!root) {
        const noninteractive = await this.exec('sudo -n true');
        if (noninteractive.code !== 0) {
          const pw = await this.ask({ title: 'Server administrator password', message: 'Used once for sudo on this server. It is not saved or logged.', secret: true });
          if (pw === null) throw new Error('Setup cancelled.'); input = pw + '\n';
        }
      }
      const install = 'command -v apt-get >/dev/null && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y tmux';
      await this.checked(root ? `sh -c ${q(install)}` : `sudo ${input === undefined ? '-n' : "-S -p ''"} -- sh -c ${q(install)}`, { input, timeout: 300000 });
      r = await this.exec('tmux -V');
    }
    const match = /tmux (\d+)\.(\d+)/.exec(r.stdout);
    if (!match || Number(match[1]) < 3 || Number(match[1]) === 3 && Number(match[2]) < 2) throw new Error('Persistent-session support requires tmux 3.2 or newer. NerdSSHell will not change an existing server configuration automatically.');
    this.serverVersion = match[0];
  }
  async discover() {
    if (this.discovering) return this.discovering;
    this.discovering = this._discover().finally(() => { this.discovering = null; }); return this.discovering;
  }
  async _discover() {
    const client = this.client;
    const current = () => this.connected && !this.closing && this.client === client;
    const assertCurrent = () => { if (!current()) throw new Error('Connection changed while discovering sessions.'); };
    assertCurrent();
    const command = `${this.prefix} list-panes -a -F ${q(PANE_FORMAT)}`;
    let r = await this.exec(command);
    assertCurrent();
    if (r.code !== 0) {
      if (/no server running|No such file or directory|no sessions/i.test(r.stderr)) r = { ...r, stdout: '' };
      else throw new Error(r.stderr.trim() || 'Could not discover persistent sessions.');
    }
    let panes = parsePanes(r.stdout);
    const missing = [...new Map(panes.filter(x => !x.sessionToken).map(x => [x.sessionId, x])).values()];
    // Metadata only: discovery never creates a session, window, shell or job.
    // Check both markers inside the server command so a stale response cannot
    // overwrite a newer identity or downgrade a concurrently migrated session.
    // Legacy-only sessions are read as-is; reconnect need not migrate their metadata.
    for (const pane of missing) {
      assertCurrent();
      const token = pane.sessionToken || randomUUID();
      const condition = `#{&&:#{==:#{${SESSION_IDENTITY_OPTION}},},#{==:#{${LEGACY_SESSION_IDENTITY_OPTION}},${pane.sessionToken}}}`;
      // Publish the compatibility marker first: older clients must see the same
      // UUID before the new marker becomes visible. Ordinary synchronous tmux
      // commands drain together, but an owner-configured set-option hook can
      // yield; recheck before the second write rather than assuming a transaction.
      const currentCondition = `#{&&:#{==:#{${SESSION_IDENTITY_OPTION}},},#{==:#{${LEGACY_SESSION_IDENTITY_OPTION}},${token}}}`;
      const publishCurrent = 'if-shell -F -t ' + pane.sessionId + ' ' + q(currentCondition) + ' ' +
        q('set-option -o -t ' + pane.sessionId + ' ' + SESSION_IDENTITY_OPTION + ' ' + token) + ' ' + q('display-message -p NERDSSHELL_IDENTITY_CHANGED');
      const assign = 'set-option -o -t ' + pane.sessionId + ' ' + LEGACY_SESSION_IDENTITY_OPTION + ' ' + token + ' ; ' + publishCurrent;
      await this.checked(`${this.prefix} if-shell -F -t ${q(pane.sessionId)} ${q(condition)} ${q(assign)} ${q('display-message -p NERDSSHELL_IDENTITY_CHANGED')}`);
      assertCurrent();
    }
    if (missing.length) { panes = parsePanes(await this.checked(command)); assertCurrent(); }
    this.panes = panes.map(p => ({ ...p, profileId: this.profile.id, key: paneKey(this.profile.id, p.sessionToken, p.paneId) }));
    for (const [key, view] of this.views) {
      // A mixed connection shares the view registry with ordinary SSH channels.
      // tmux discovery may reconcile only its own persistent views.
      if (view.pane.standard) continue;
      const found = this.panes.find(p => p.key === key);
      if (found && !found.dead) view.pane = found; else { view.active = false; this.emit('ended', key); this.views.delete(key); }
    }
    for (const [sid, c] of this.controls) if (!this.panes.some(p => p.sessionId === sid && p.sessionToken === c.sessionToken)) { c.detach(); this.controls.delete(sid); }
    for (const [sid, opening] of this.opening) if (!this.panes.some(p => p.sessionId === sid && p.sessionToken === opening.token)) this.opening.delete(sid);
    this.emit('panes', this.panes); return this.panes;
  }
  pane(key) { const p = this.panes.find(x => x.key === key); if (!p) throw new Error('This session is no longer available. Refresh the session list.'); return p; }
  async control(pane) {
    if (!this.connected || this.closing) throw new Error('Not connected.');
    const sid = pane.sessionId, token = pane.sessionToken;
    const pending = this.opening.get(sid);
    if (pending?.token === token) return pending.task;
    if (pending) this.opening.delete(sid);
    const existing = this.controls.get(sid);
    if (existing && !existing.closed && existing.sessionToken === token && existing.verified) return existing;
    if (existing && (existing.sessionToken !== token || !existing.verified)) { existing.detach(); if (this.controls.get(sid) === existing) this.controls.delete(sid); }
    const opening = { token, task: null };
    const current = () => this.opening.get(sid) === opening && this.connected && !this.closing;
    const task = (async () => {
      const identity = await this.checked(`${this.prefix} display-message -p -t ${q(sid)} ${q(SESSION_IDENTITY_FORMAT)}`);
      if (!current()) throw new Error('View changed while attaching.');
      if (!identityMatches(identity, pane)) throw new Error('The session identity changed. Refresh the session list before attaching.');
      // Targeted safety override only; never write ~/.tmux.conf or change global mouse/key settings.
      const option = await this.checked(`${this.prefix} if-shell -F -t ${q(sid)} ${q(identityCondition(pane))} ${q('set-option -t ' + sid + ' destroy-unattached off')} ${q('display-message -p NERDSSHELL_IDENTITY_CHANGED')}`);
      if (!current()) throw new Error('View changed while attaching.');
      if (option.includes('NERDSSHELL_IDENTITY_CHANGED')) throw new Error('The session identity changed. Refresh the session list before attaching.');
      const stream = await new Promise((resolve, reject) => this.client.exec(`${this.prefix} -C attach-session -t ${q(sid)}`, (e, s) => e ? reject(e) : resolve(s)));
      if (!current() || ![...this.views.values()].some(v => v.active && v.pane.sessionId === sid && v.pane.sessionToken === token)) {
        stream.destroy(); throw new Error('View closed while attaching. Remote work was left running.');
      }
      const control = new Control(stream); control.sessionToken = token; control.verified = false; this.controls.set(sid, control);
      control.on('output', (pid, bytes) => {
        if (this.controls.get(sid) !== control || !control.verified || !this.connected || this.closing) return;
        for (const view of this.views.values()) if (view.pane.sessionId === sid && view.pane.sessionToken === token && view.pane.paneId === pid && view.active && view.initialized) this.emit('output', view.pane.key, bytes);
      });
      control.on('notification', message => {
        if (this.controls.get(sid) !== control || !control.verified || !this.connected || this.closing) return;
        if (message.startsWith('%pause ')) {
          const pid = message.split(' ')[1]; const view = [...this.views.values()].find(v => v.pane.sessionId === sid && v.pane.sessionToken === token && v.pane.paneId === pid && v.active);
          if (view) {
            this.emit('notice', 'The display fell behind server output. Refreshing from retained server history; some earlier output may be unavailable.');
            this.snapshot(view.pane.key).then(() => control.request(`refresh-client -A ${q(pid + ':continue')}`)).catch(e => this.emit('notice', e.message));
          }
        } else if (/^%(sessions-changed|session-renamed|window-add|window-close|window-renamed|layout-change)/.test(message)) {
          clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => this.discover().catch(e => this.emit('notice', e.message)), 350);
        }
      });
      control.on('closed', () => {
        if (this.controls.get(sid) !== control) return;
        this.controls.delete(sid);
        for (const v of this.views.values()) if (v.pane.sessionId === sid && v.pane.sessionToken === token && v.active) { v.initialized = false; this.emit('detached', v.pane.key); }
      });
      try {
        await control.ready;
        await control.request('refresh-client -f pause-after=5');
        if (!current() || this.controls.get(sid) !== control) throw new Error('View changed while attaching.');
        const attachedIdentity = await this.checked(`${this.prefix} display-message -p -t ${q(sid)} ${q(SESSION_IDENTITY_FORMAT)}`);
        if (!current() || this.controls.get(sid) !== control) throw new Error('View changed while attaching.');
        if (!identityMatches(attachedIdentity, pane)) throw new Error('The session identity changed during attachment. Refresh the session list before opening.');
        control.verified = true;
        return control;
      } catch (error) { control.detach(); throw error; }
    })().finally(() => { if (this.opening.get(sid) === opening) this.opening.delete(sid); });
    opening.task = task; this.opening.set(sid, opening); return task;
  }
  async open(key) {
    const pane = this.pane(key); if (pane.dead) throw new Error('This session has ended. Create a new session rather than restarting it implicitly.');
    const prior = this.views.get(key); if (prior?.active && prior.initialized) return pane;
    const view = { pane, active: true, initialized: false, snapshotSerial: 0 };
    this.views.set(key, view);
    await this.control(pane);
    if (this.views.get(key) !== view || !view.active) return pane;
    await this.snapshot(key); return pane;
  }
  async snapshot(key) {
    const view = this.views.get(key); if (!view?.active) return;
    const serial = view.snapshotSerial = (view.snapshotSerial || 0) + 1;
    view.initialized = false;
    const current = () => this.views.get(key) === view && view.active && view.snapshotSerial === serial && this.connected && !this.closing;
    const pane = this.pane(key); const c = await this.control(pane);
    if (!current() || this.controls.get(pane.sessionId) !== c) return;
    const values = (await c.request(`display-message -p -t ${q(pane.paneId)} ${q('#{pane_width}|#{pane_height}|#{cursor_x}|#{cursor_y}|#{alternate_on}|#{keypad_cursor_flag}|#{mouse_standard_flag}|#{mouse_button_flag}|#{mouse_any_flag}|#{mouse_sgr_flag}|#{bracketed_paste_flag}|#{cursor_flag}')}`)).map(b => b.toString()).join('');
    if (!current() || this.controls.get(pane.sessionId) !== c) return;
    const m = values.split('|').map(Number);
    const { cols, rows } = geometry(m[0], m[1]);
    const history = m[4] ? 0 : this.profile.scrollback;
    const { unescapeOctal } = require('./core.cjs');
    await c.request(`capture-pane -p -e -C -t ${q(pane.paneId)} -S -${history}`, body => {
      if (!current() || this.controls.get(pane.sessionId) !== c) return;
      const content = Buffer.concat(body.flatMap((line, i) => i ? [Buffer.from('\r\n'), unescapeOctal(line)] : [unescapeOctal(line)]));
      this.emit('snapshot', key, { data: content.toString('base64'), cols, rows, cursorX: m[2], cursorY: m[3], alternate: !!m[4], modes: m.slice(5) });
      view.initialized = true;
    });
  }
  async input(key, data) {
    const v = this.views.get(key);
    if (!this.connected || !v?.active || !v.initialized) throw new Error('Not connected. Input was not sent.');
    if (typeof data !== 'string' || Buffer.byteLength(data) > 1024 * 1024) throw new Error('Paste exceeds 1 MB. Upload it as a file instead.');
    const size = Buffer.byteLength(data);
    if (!size) return;
    // Reserve a place synchronously, before any await. The transport serializes
    // individual commands; this per-view chain serializes whole keyboard/paste events.
    if ((v.inputMessages || 0) >= 256 || size > 2 * 1024 * 1024 - (v.inputBytes || 0)) {
      throw new Error('Input queue is full. This input was not sent.');
    }
    const bytes = Buffer.from(data), serial = v.inputSerial || 0, snapshotSerial = v.snapshotSerial;
    const admittedControl = this.controls.get(v.pane.sessionId);
    const current = () => this.views.get(key) === v && v.active && v.initialized &&
      (v.inputSerial || 0) === serial && v.snapshotSerial === snapshotSerial &&
      this.connected && !this.closing && this.controls.get(v.pane.sessionId) === admittedControl && !admittedControl?.closed;
    v.inputMessages = (v.inputMessages || 0) + 1; v.inputBytes = (v.inputBytes || 0) + size;
    const send = (v.inputTail || Promise.resolve()).then(async () => {
      if (!current()) throw new Error('View changed while sending input. Remaining input was discarded.');
      const c = await this.control(v.pane);
      if (c !== admittedControl || !current()) throw new Error('View changed while sending input. Remaining input was discarded.');
      // Hex input cannot become a shell expansion or a tmux command. Recheck at
      // actual transport dispatch too: another pane may be using the same channel.
      for (let i = 0; i < bytes.length; i += 512) {
        if (!current()) throw new Error('View changed while sending input. Remaining input was discarded.');
        await c.request(`send-keys -H -t ${q(v.pane.paneId)} ${[...bytes.subarray(i, i + 512)].map(x => x.toString(16).padStart(2, '0')).join(' ')}`, undefined, current);
      }
      if (!current()) throw new Error('View changed while sending input. Remaining input was discarded.');
    });
    v.inputTail = send.catch(() => {
      // Never send an already-queued Enter after a failed/partial paste. A later
      // deliberate input event gets a new serial; old events are never replayed.
      if ((v.inputSerial || 0) === serial) v.inputSerial = serial + 1;
    });
    return send.finally(() => { v.inputMessages--; v.inputBytes -= size; });
  }
  async resize(key, cols, rows) {
    integer(cols, 20, 1000, 'columns'); integer(rows, 5, 500, 'rows');
    const view = this.views.get(key); if (!view?.active) return;
    const p = this.pane(key); const c = await this.control(p);
    if (this.views.get(key) !== view || !view.active || !this.connected || this.closing || this.controls.get(p.sessionId) !== c) return;
    // Existing split windows keep their pane topology. Single-pane windows follow their own app view.
    if (p.windowPanes === 1) {
      await c.request(`resize-window -t ${q(p.windowId)} -x ${cols} -y ${rows}`);
    } else {
      await c.request(`resize-pane -t ${q(p.paneId)} -x ${cols} -y ${rows}`);
    }
  }
  closeView(key) {
    const view = this.views.get(key); if (!view) return; view.active = false; this.views.delete(key);
    if (![...this.views.values()].some(v => v.pane.sessionId === view.pane.sessionId && v.pane.sessionToken === view.pane.sessionToken && v.active)) {
      const control = this.controls.get(view.pane.sessionId);
      if (control && (control.sessionToken === undefined || control.sessionToken === view.pane.sessionToken)) {
        control.detach(); this.controls.delete(view.pane.sessionId);
      }
      if (this.opening.get(view.pane.sessionId)?.token === view.pane.sessionToken) this.opening.delete(view.pane.sessionId);
    }
  }
  async createTask(name, code) { return this.create(name, require('./action-catalog.cjs').taskCommand(code)); }
  async create(name, launchCommand) {
    sessionName(name);
    // Only this explicit action creates a process. Reconnect and discovery never call it.
    // history-limit is fixed when a pane is created. Configure a new session around an
    // app-owned temporary sleep window, then create the user's shell with the correct limit.
    const created = (await this.checked(`${this.prefix} new-session -d -s ${q(name)} -x 120 -y 36 -P -F ${q('#{session_id} #{window_id}')} ${q('exec sleep 60')}`)).trim();
    const match = /^(\$\d+) (@\d+)$/.exec(created);
    if (!match) throw new Error('Could not identify the new session. Creation was not retried.');
    const [, sid, placeholder] = match;
    await this.checked(`${this.prefix} set-option -t ${q(sid)} history-limit ${this.profile.scrollback}`);
    await this.checked(`${this.prefix} set-option -t ${q(sid)} destroy-unattached off`);
    const actualWindow = (await this.checked(`${this.prefix} new-window -d -t ${q(sid)} -n Shell -P -F ${q('#{window_id}')}${launchCommand === undefined ? '' : ' ' + q(launchCommand)}`)).trim();
    if (!/^@\d+$/.test(actualWindow)) throw new Error('The new shell could not be identified. Creation was not retried.');
    await this.checked(`${this.prefix} kill-window -t ${q(placeholder)}`);
    await this.checked(`${this.prefix} select-window -t ${q(actualWindow)}`);
    await this.discover();
    const p = this.panes.find(p => p.sessionId === sid);
    if (!p) throw new Error('The new session exited before it could be opened. Its launch was not retried.');
    return p;
  }
  async rename(key, name) {
    const p = this.pane(key); sessionName(name);
    const result = await this.checked(`${this.prefix} if-shell -F -t ${q(p.sessionId)} ${q(identityCondition(p))} ${q('rename-session -t ' + p.sessionId + ' ' + q(name))} ${q('display-message -p NERDSSHELL_IDENTITY_CHANGED')}`);
    if (result.includes('NERDSSHELL_IDENTITY_CHANGED')) throw new Error('The remote session identity changed. It was not renamed.');
    return this.discover();
  }
  async endSession(key) {
    const p = this.pane(key);
    // Evaluate the identity and kill within one server command; avoid an ID-reuse race.
    const result = await this.checked(`${this.prefix} if-shell -F -t ${q(p.sessionId)} ${q(identityCondition(p))} ${q('kill-session -t ' + p.sessionId)} ${q('display-message -p NERDSSHELL_IDENTITY_CHANGED')}`);
    if (result.includes('NERDSSHELL_IDENTITY_CHANGED')) throw new Error('The remote session identity changed. It was not terminated.');
    return this.discover();
  }
  sftp() { if (!this.connected) return Promise.reject(new Error('Not connected.')); return new Promise((resolve, reject) => this.client.sftp((e, s) => e ? reject(e) : resolve(s))); }
  disconnect() {
    this.closing = true; this.connected = false;
    this.clearConnectionWork(new Error('Disconnected. Command completion is unknown; no command was retried.'));
    // Drop this object's references. The caller separately decides whether retry secrets survive.
    // JavaScript and the SSH library do not promise secure memory zeroization.
    const client = this.client; this.client = null; this.secrets = {}; closeSshTransport(client);
  }
}
function ignoreClosedChannelError() {}
module.exports = { Remote };
