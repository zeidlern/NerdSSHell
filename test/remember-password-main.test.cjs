'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { PasswordStore, FILE_NAME } = require('../src/password-store.cjs');
const { profile } = require('../src/core.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const PASSWORD = 'synthetic-login-password-only';
const config = { id: 'fixture', name: 'Disposable connection', host: 'synthetic.invalid', port: 22, username: 'tester', auth: 'password', autoConnect: false, sessionMode: 'persistent' };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function encryption(available = true) {
  // Authenticated synthetic encryption exercises real PasswordStore parsing and
  // persistence without requiring Electron or any real user's credential data.
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => available,
    encryptString(value) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
    },
    decryptString(bytes) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    }
  };
}
async function fixture(t, options = {}) {
  const directory = options.directory || fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-remember-main-'));
  const safeStorage = options.safeStorage || encryption(options.available !== false);
  const handlers = new Map(), events = [], remotes = [], native = [], startupErrors = [], app = new EventEmitter(); let window, consent = true;
  Object.assign(app, { isPackaged: true, setPath() {}, commandLine: { getSwitchValue: () => directory }, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: () => directory, getVersion: () => 'synthetic', quit() {}, exit(code) { startupErrors.push(code); } });
  class Window extends EventEmitter {
    constructor() {
      super(); window = this; this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: 'nerdsshell://app/ui/index.html' };
      this.webContents.send = (_channel, event) => {
        events.push(event);
        if (event.type === 'prompt' && event.kind === 'confirmation') { const answer = consent ? 'choice:0' : null; queueMicrotask(() => handlers.get('nerdsshell:promptReply')({ sender: this.webContents, senderFrame: this.webContents.mainFrame }, event.id, answer, false)); }
        if (event.type === 'prompt' && event.kind === 'host-trust' && options.autoHostTrust !== false) queueMicrotask(() => handlers.get('nerdsshell:promptReply')({ sender: this.webContents, senderFrame: this.webContents.mainFrame }, event.id, consent ? 'trust' : null));
      }; this.webContents.setWindowOpenHandler = () => {};
      this.webContents.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
    }
    isDestroyed() { return false; } isFocused() { return true; } isMinimized() { return false; } flashFrame() {}
    loadURL() { return Promise.resolve(); }
  }
  class FixtureRemote extends EventEmitter {
    constructor(settings, remoteOptions) {
      super(); this.profile = settings; this.options = remoteOptions; this.secrets = remoteOptions.secrets;
      this.panes = []; this.views = new Map(); this.connected = false; this.closing = false; this.disconnects = 0; remotes.push(this);
    }
    async connect() {
      if (options.connect) return options.connect(this);
      return this.authenticate();
    }
    async authenticate({ credentialKind = 'ssh-password', secret = true, error, gate, trust = true } = {}) {
      if (this.secrets.password === undefined) {
        const password = await this.options.ask({ title: 'Synthetic sign in', message: 'Disposable authentication fixture.', secret, credentialKind });
        if (password === null || this.closing) throw new Error('Sign-in cancelled.');
        this.secrets.password = password;
      }
      this.authenticatedPassword = this.secrets.password;
      if (gate) await gate.promise;
      const endpoint = this.profile.host.toLowerCase() + ':' + this.profile.port;
      if (trust && !this.options.pins[endpoint]) {
        if (!await this.options.trust({ host: this.profile.host, port: this.profile.port, fingerprint: 'SHA256:synthetic-fingerprint-only' })) {
          const denied = new Error('Server identity verification cancelled.'); denied.code = 'NERDSSHELL_HOST_VERIFICATION'; throw denied;
        }
        this.options.savePin(endpoint, 'SHA256:synthetic-fingerprint-only');
      }
      if (error) {
        if (error.level === 'client-authentication' && this.passwordFactorAccepted !== true && typeof this.passwordRejected !== 'boolean') this.passwordRejected = true;
        throw error;
      }
      if (this.closing) throw new Error('Sign-in cancelled.');
      if (typeof this.passwordAuthenticated !== 'boolean') this.passwordAuthenticated = credentialKind === 'ssh-password';
      this.connected = true; return this.panes;
    }
    disconnect() { this.disconnects++; this.connected = false; this.closing = true; this.secrets = {}; }
    activeShellCount() { return 0; }
  }
  const electron = { app, safeStorage, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, clipboard: {}, Menu: { setApplicationMenu() {} }, shell: {}, net: {},
    dialog: { showMessageBox: async () => { throw Error('An app-owned confirmation unexpectedly opened a native message box'); },
      showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }),
      showErrorBox: (_title, message) => startupErrors.push(message) } };
  const filename = path.resolve(__dirname, '../src/main.cjs'), req = createRequire(filename), module = { exports: {} };
  const syntheticProcess = Object.create(process); Object.defineProperty(syntheticProcess, 'platform', { value: 'win32' });
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={getStore:()=>store,getConnections:()=>connections,getPrompts:()=>prompts};', {
    require: name => name === 'electron' ? electron : name === './mixed-remote.cjs' ? { MixedRemote: FixtureRemote } : req(name),
    module, __dirname: path.dirname(filename), process: syntheticProcess, Buffer, console: { ...console, error: (...args) => startupErrors.push(args.map(String).join(' ')) },
    setTimeout, clearTimeout, AbortController, Response, URL
  });
  await tick(); assert.deepEqual(startupErrors, [], 'actual main startup succeeds');
  const store = module.exports.getStore(), connections = module.exports.getConnections(), prompts = module.exports.getPrompts();
  assert.ok(store && window && handlers.has('nerdsshell:state'));
  t.after(() => {
    for (const [id, done] of prompts) { done(null); prompts.delete(id); }
    for (const runtime of connections.values()) { runtime.wanted = false; clearTimeout(runtime.timer); runtime.remote?.disconnect(); }
    if (!options.directory) fs.rmSync(directory, { recursive: true, force: true });
  });
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const invoke = (name, ...args) => { const fn = handlers.get('nerdsshell:' + name); assert.equal(typeof fn, 'function', name + ' IPC registered'); return fn(event(), ...args); };
  const h = { directory, safeStorage, store, connections, remotes, native, events, handlers, window, event, invoke,
    passwords: new PasswordStore(directory, safeStorage, { platform: 'win32' }), consent: value => { consent = value; },
    add(value = {}) { return store.putProfile({ ...config, ...value }); },
    connect(id = config.id) { const job = invoke('connect', id); job.catch(() => {}); return job; },
    async prompt(start = 0) {
      for (let i = 0; i < 100; i++) { const found = events.slice(start).find(value => value.type === 'prompt' && prompts.has(value.id)); if (found) return found; await tick(); }
      assert.fail('actual main did not emit the expected live authentication prompt');
    },
    reply(prompt, value = PASSWORD, remember = true) { return invoke('promptReply', prompt.id, value, remember); }
  };
  return h;
}
async function remembered(h, value = {}) {
  const p = h.add(value), job = h.connect(p.id), prompt = await h.prompt();
  assert.equal(prompt.profileId, p.id); assert.equal(prompt.rememberPasswordAvailable, true);
  await h.reply(prompt); await job; assert.equal(h.passwords.get(h.store.data.profiles.find(row => row.id === p.id)), PASSWORD); return p;
}
function assertNoPlaintext(h, values = [PASSWORD]) {
  for (const value of values) {
    assert.equal(JSON.stringify(h.store.data).includes(value), false, 'settings contain no credential');
    assert.equal(JSON.stringify(h.events).includes(value), false, 'renderer events contain no credential');
    for (const filename of fs.readdirSync(h.directory)) {
      const file = path.join(h.directory, filename);
      if (fs.statSync(file).isFile()) assert.equal(fs.readFileSync(file).includes(Buffer.from(value)), false, filename + ' contains no plaintext credential');
    }
  }
}

test('actual main saves only after successful explicit consent and reloads after disconnect and application restart', async t => {
  const gate = deferred(), h = await fixture(t, { connect: remote => remote.authenticate({ gate }) }); h.add();
  const job = h.connect(), prompt = await h.prompt(); assert.equal(prompt.rememberPassword, false);
  await h.reply(prompt); assert.equal(fs.existsSync(path.join(h.directory, FILE_NAME)), false, 'answering alone never writes a password');
  gate.resolve(); await job;
  const state = await h.invoke('state'); assert.equal(state.profiles[0].rememberPassword, true); assert.equal(state.profiles[0].password, undefined);
  assert.equal(h.passwords.get(state.profiles[0]), PASSWORD); assertNoPlaintext(h);
  const diagnostic = await h.invoke('workbenchDiagnostics'); assert.equal(JSON.stringify(diagnostic).includes(PASSWORD), false);
  await h.invoke('disconnect', config.id); assert.equal(h.connections.get(config.id).secrets.password, undefined);
  const promptsBefore = h.events.filter(value => value.type === 'prompt').length; await h.connect();
  assert.equal(h.remotes.at(-1).authenticatedPassword, PASSWORD);
  assert.equal(h.events.filter(value => value.type === 'prompt').length, promptsBefore, 'reconnect retrieves encrypted credential after cache release');
  const restarted = await fixture(t, { directory: h.directory, safeStorage: h.safeStorage }); await restarted.connect();
  assert.equal(restarted.remotes[0].authenticatedPassword, PASSWORD); assert.equal(restarted.events.some(value => value.type === 'prompt'), false);
  assertNoPlaintext(restarted);
});

test('password login without remembering remains memory-only and explicit unchecked consent disables remembering', async t => {
  for (const rememberPassword of [false, true]) {
    const h = await fixture(t); h.add({ rememberPassword }); const job = h.connect(), prompt = await h.prompt();
    assert.equal(prompt.rememberPassword, rememberPassword); await h.reply(prompt, PASSWORD, false); await job;
    assert.equal(h.passwords.get(h.store.data.profiles[0]), null); assert.equal(h.store.data.profiles[0].rememberPassword, false);
    assert.equal(h.connections.get(config.id).secrets.password, PASSWORD); assertNoPlaintext(h);
  }
});

test('rejected password, canceled identity verification and canceled prompt never create a remembered credential', async t => {
  for (const reason of ['authentication', 'trust', 'prompt']) {
    const error = Object.assign(new Error('Synthetic authentication rejected.'), { level: 'client-authentication' });
    const h = await fixture(t, { connect: remote => remote.authenticate({ error: reason === 'authentication' ? error : undefined }) }); h.add();
    if (reason === 'trust') h.consent(false);
    const job = h.connect(), prompt = await h.prompt(); await h.reply(prompt, reason === 'prompt' ? null : PASSWORD, true);
    await assert.rejects(job, /auth|identity|cancel/i); assert.equal(h.passwords.get(h.store.data.profiles[0]), null);
    assert.equal(fs.existsSync(path.join(h.directory, FILE_NAME)), false); assert.equal(h.connections.get(config.id).secrets.password, undefined); assertNoPlaintext(h);
  }
});

test('rejected remembered authentication evicts encrypted and runtime credentials without automatic retry', async t => {
  let reject = false;
  const h = await fixture(t, { connect: remote => remote.authenticate({ error: reject ? Object.assign(new Error('Rejected.'), { level: 'client-authentication' }) : undefined }) });
  await remembered(h); await h.invoke('disconnect', config.id); reject = true;
  await assert.rejects(h.connect(), error => error.level === 'client-authentication');
  assert.equal(h.passwords.get(h.store.data.profiles[0]), null); const runtime = h.connections.get(config.id);
  assert.equal(runtime.wanted, false); assert.equal(runtime.secrets.password, undefined); assert.equal(runtime.timer == null, true); assertNoPlaintext(h);
});

test('rejected remembered password followed by successful interactive fallback is removed without closing the authenticated connection', async t => {
  const OTP = 'synthetic-fallback-answer-only'; let fallback = false;
  const h = await fixture(t, { connect: async remote => {
    if (!fallback) return remote.authenticate();
    remote.passwordRejected = true; remote.passwordAuthenticated = false;
    const answer = await remote.options.ask({ title: 'Interactive fallback', message: 'Synthetic challenge.', secret: true, credentialKind: 'keyboard-interactive' });
    assert.equal(answer, OTP); return remote.authenticate();
  } });
  await remembered(h); await h.invoke('disconnect', config.id); fallback = true;
  const job = h.connect(), challenge = await h.prompt(); assert.equal(challenge.rememberPasswordAvailable, false);
  await h.reply(challenge, OTP, false); await job;
  const runtime = h.connections.get(config.id), remote = runtime.remote;
  assert.equal(remote.connected, true); assert.equal(remote.disconnects, 0); assert.equal(runtime.state, 'connected');
  assert.equal(h.passwords.get(h.store.data.profiles[0]), null);
  assert.equal(runtime.secrets.password, undefined); assert.equal(remote.secrets.password, undefined);
  assert.ok(h.events.some(value => value.type === 'notice' && /rejected and removed/i.test(value.message))); assertNoPlaintext(h, [PASSWORD, OTP]);
});

test('accepted remembered password factor survives a rejected OTP while retry credentials and automatic recovery stop', async t => {
  const OTP = 'synthetic-rejected-one-time-answer-only'; let failedOTP = false;
  const h = await fixture(t, { connect: async remote => {
    if (!failedOTP) return remote.authenticate();
    remote.passwordFactorAccepted = true; remote.passwordRejected = false;
    const answer = await remote.options.ask({ title: 'One-time challenge', message: 'Synthetic challenge.', secret: true, credentialKind: 'keyboard-interactive' });
    assert.equal(answer, OTP);
    return remote.authenticate({ error: Object.assign(new Error('Synthetic multi-factor authentication rejected.'), { level: 'client-authentication' }) });
  } });
  await remembered(h); await h.invoke('disconnect', config.id); failedOTP = true;
  const job = h.connect(), challenge = await h.prompt(); assert.equal(challenge.rememberPasswordAvailable, false);
  await h.reply(challenge, OTP, false); await assert.rejects(job, error => error.level === 'client-authentication');
  assert.equal(h.passwords.get(h.store.data.profiles[0]), PASSWORD, 'the server already accepted the stored password as an authentication factor');
  const runtime = h.connections.get(config.id); assert.equal(runtime.wanted, false); assert.equal(runtime.timer == null, true);
  assert.equal(runtime.secrets.password, undefined); assert.equal(runtime.remote.secrets.password, undefined);
  assert.equal(runtime.remote.connected, false); assertNoPlaintext(h, [PASSWORD, OTP]);
});

test('Forget clears saved and cached passwords without disconnecting active remote work', async t => {
  const h = await fixture(t); await remembered(h); const runtime = h.connections.get(config.id), remote = runtime.remote, disconnected = remote.disconnects;
  const result = await h.invoke('forgetPassword', config.id);
  assert.equal(result.id, config.id); assert.equal(result.rememberPassword, false); assert.equal(result.password, undefined);
  assert.equal(h.passwords.get(result), null); assert.equal(runtime.secrets.password, undefined); assert.equal(remote.secrets.password, undefined);
  assert.equal(remote.disconnects, disconnected); assert.equal(remote.connected, true); assert.equal(runtime.state, 'connected'); assertNoPlaintext(h);
});

test('Forget during a pending successful login prevents late credential persistence', async t => {
  const gate = deferred(), h = await fixture(t, { connect: remote => remote.authenticate({ gate }) }); h.add();
  const job = h.connect(), prompt = await h.prompt(); await h.reply(prompt); await h.invoke('forgetPassword', config.id);
  gate.resolve(); await job; assert.equal(h.passwords.get(h.store.data.profiles[0]), null);
  assert.equal(h.store.data.profiles[0].rememberPassword, false); assert.equal(h.connections.get(config.id).secrets.password, undefined); assertNoPlaintext(h);
});

test('a canceled stale prompt cannot restore remembered credentials after disconnect', async t => {
  const h = await fixture(t); h.add(); const job = h.connect(), prompt = await h.prompt();
  await h.invoke('disconnect', config.id); await h.reply(prompt, PASSWORD, true); await job;
  assert.equal(h.passwords.get(h.store.data.profiles[0]), null); assert.equal(h.store.data.profiles[0].rememberPassword, false);
  assert.equal(h.connections.get(config.id).secrets.password, undefined); assertNoPlaintext(h);
});

test('endpoint, authentication and remembering edits evict saved credentials; harmless display edits preserve them', async t => {
  for (const change of [{ host: 'other.invalid' }, { port: 2222 }, { username: 'other' }, { auth: 'agent' }, { rememberPassword: false }]) {
    const h = await fixture(t); await remembered(h); const original = h.store.data.profiles[0];
    const edited = await h.invoke('saveProfile', { ...original, ...change });
    assert.equal(h.passwords.get(profile({ ...original, auth: 'password' })), null, JSON.stringify(change));
    assert.equal(edited.password, undefined); assert.equal(h.connections.has(config.id), false); assertNoPlaintext(h);
  }
  const h = await fixture(t); await remembered(h);
  const renamed = await h.invoke('saveProfile', { ...h.store.data.profiles[0], name: 'Another display name' });
  assert.equal(h.passwords.get(renamed), PASSWORD); assert.equal(renamed.rememberPassword, true); assertNoPlaintext(h);
});

test('deleting a profile removes its encrypted password and cannot affect another profile', async t => {
  const h = await fixture(t); await remembered(h); await remembered(h, { id: 'second', host: 'second.invalid' });
  assert.equal(await h.invoke('deleteProfile', config.id), true); assert.equal(h.store.data.profiles.some(row => row.id === config.id), false);
  assert.equal(h.passwords.get(profile(config)), null); assert.equal(h.passwords.get(h.store.data.profiles[0]), PASSWORD);
  assert.equal(h.connections.has(config.id), false); assertNoPlaintext(h);
});

test('canceled connection edits and deletion preserve both remembered credentials and active work', async t => {
  const h = await fixture(t); await remembered(h); const original = h.store.data.profiles[0], remote = h.connections.get(config.id).remote;
  remote.shells = new Map([['fixture/synthetic-standard', { dead: false }]]); remote.activeShellCount = () => 1;
  h.consent(false);
  await assert.rejects(h.invoke('saveProfile', { ...original, host: 'other.invalid' }), /edit cancelled/i);
  assert.equal(await h.invoke('deleteProfile', config.id), false);
  assert.equal(h.passwords.get(original), PASSWORD); assert.equal(h.store.data.profiles[0], original);
  assert.equal(remote.disconnects, 0); assert.equal(remote.connected, true); assert.equal(remote.secrets.password, PASSWORD); assertNoPlaintext(h);
});

test('unavailable account encryption forbids persistence while ordinary password authentication still works', async t => {
  const h = await fixture(t, { available: false }); h.add(); const job = h.connect(), prompt = await h.prompt();
  assert.equal(prompt.rememberPasswordAvailable, false);
  await assert.rejects(h.reply(prompt, PASSWORD, true), /encryption|remember|available/i);
  await h.reply(prompt, PASSWORD, false); await job;
  assert.equal(h.connections.get(config.id).remote.connected, true); assert.equal(h.store.data.profiles[0].rememberPassword, false);
  assert.equal(fs.existsSync(path.join(h.directory, FILE_NAME)), false); assertNoPlaintext(h);
});

test('key passphrases, OTPs and nonsensitive prompts cannot request SSH password persistence', async t => {
  for (const kind of ['key-passphrase', 'keyboard-interactive', undefined]) {
    const h = await fixture(t, { connect: remote => remote.authenticate({ credentialKind: kind === undefined ? 'other' : kind }) }); h.add({ auth: kind === 'key-passphrase' ? 'key' : 'password', keyPath: kind === 'key-passphrase' ? 'synthetic-key' : '' });
    const job = h.connect(), prompt = await h.prompt(); assert.equal(prompt.rememberPasswordAvailable, false);
    await assert.rejects(h.reply(prompt, PASSWORD, true), /remember|password|credential/i);
    await h.reply(prompt, PASSWORD, false); await job; assert.equal(fs.existsSync(path.join(h.directory, FILE_NAME)), false);
    assert.equal(h.store.data.profiles[0].rememberPassword, false); assertNoPlaintext(h);
  }
});

test('remembering consent is scoped to its profile and never reused by another simultaneous sign-in', async t => {
  const h = await fixture(t); h.add(); h.add({ id: 'second', host: 'second.invalid' });
  const first = h.connect(), second = h.connect('second'), a = await h.prompt();
  assert.equal(a.profileId, config.id); await h.reply(a, PASSWORD, true);
  const b = await h.prompt(); assert.equal(b.profileId, 'second'); assert.equal(b.rememberPassword, false);
  await h.reply(b, 'synthetic-second-password-only', false); await Promise.all([first, second]);
  assert.equal(h.passwords.get(h.store.data.profiles.find(row => row.id === config.id)), PASSWORD);
  assert.equal(h.passwords.get(h.store.data.profiles.find(row => row.id === 'second')), null);
  assertNoPlaintext(h, [PASSWORD, 'synthetic-second-password-only']);
});

test('password plus keyboard-interactive authentication persists only the explicitly remembered login password', async t => {
  const OTP = 'synthetic-one-time-answer-only';
  const h = await fixture(t, { connect: async remote => {
    remote.secrets.password = await remote.options.ask({ title: 'Login password', message: 'Synthetic login.', secret: true, credentialKind: 'ssh-password' });
    const challenge = await remote.options.ask({ title: 'One-time challenge', message: 'Synthetic OTP.', secret: true, credentialKind: 'keyboard-interactive' });
    assert.equal(challenge, OTP); return remote.authenticate();
  } }); h.add();
  const job = h.connect(), login = await h.prompt(); await h.reply(login);
  const challenge = await h.prompt(); assert.equal(challenge.rememberPasswordAvailable, false);
  await assert.rejects(h.reply(challenge, OTP, true), /remember|password|credential/i);
  await h.reply(challenge, OTP, false); await job;
  assert.equal(h.passwords.get(h.store.data.profiles[0]), PASSWORD); assertNoPlaintext(h, [PASSWORD, OTP]);
});

test('successful interactive fallback does not remember an SSH password that the server did not authenticate', async t => {
  const h = await fixture(t, { connect: async remote => {
    await remote.authenticate(); remote.passwordAuthenticated = false; return remote.panes;
  } }); h.add(); const job = h.connect(), prompt = await h.prompt(); await h.reply(prompt); await job;
  assert.equal(h.connections.get(config.id).remote.connected, true);
  assert.equal(h.passwords.get(h.store.data.profiles[0]), null); assert.equal(h.store.data.profiles[0].rememberPassword, false);
  assert.ok(h.events.some(value => value.type === 'notice' && /not authenticate|not remembered/i.test(value.message)));
  assertNoPlaintext(h);
});

test('successful sign-in without positive password authentication proof cannot persist a credential', async t => {
  const h = await fixture(t, { connect: async remote => {
    await remote.authenticate(); delete remote.passwordAuthenticated; return remote.panes;
  } }); h.add(); const job = h.connect(), prompt = await h.prompt(); await h.reply(prompt); await job;
  assert.equal(h.connections.get(config.id).remote.connected, true); assert.equal(h.connections.get(config.id).remote.passwordAuthenticated, undefined);
  assert.equal(h.passwords.get(h.store.data.profiles[0]), null); assert.equal(h.store.data.profiles[0].rememberPassword, false);
  assert.ok(h.events.some(value => value.type === 'notice' && /not authenticate|not remembered/i.test(value.message)));
  assertNoPlaintext(h);
});

test('encryption write failures preserve successful sign-in and report a sanitized unsaved preference', async t => {
  const safeStorage = encryption(); safeStorage.encryptString = () => { throw new Error('Synthetic provider failure: ' + PASSWORD); };
  const h = await fixture(t, { safeStorage }); h.add(); const job = h.connect(), prompt = await h.prompt(); await h.reply(prompt); await job;
  assert.equal(h.connections.get(config.id).remote.connected, true); assert.equal(h.connections.get(config.id).state, 'connected');
  assert.equal(h.store.data.profiles[0].rememberPassword, false); assert.equal(h.passwords.get(h.store.data.profiles[0]), null);
  assert.ok(h.events.some(value => value.type === 'notice' && /could not be saved/i.test(value.message)));
  assert.equal(fs.existsSync(path.join(h.directory, FILE_NAME)), false); assertNoPlaintext(h);
});

test('settings write failures cannot leave an orphaned saved password or disrupt successful sign-in', async t => {
  const h = await fixture(t); h.add(); h.store.data.pins[config.host + ':' + config.port] = 'SHA256:synthetic-fingerprint-only'; const before = fs.readFileSync(h.store.file);
  h.store.save = () => { throw new Error('Synthetic settings failure: ' + PASSWORD); };
  const job = h.connect(), prompt = await h.prompt(); await h.reply(prompt); await job;
  assert.equal(h.connections.get(config.id).remote.connected, true); assert.equal(h.connections.get(config.id).state, 'connected');
  assert.equal(h.store.data.profiles[0].rememberPassword, false); assert.equal(h.passwords.get(h.store.data.profiles[0]), null);
  assert.deepEqual(fs.readFileSync(h.store.file), before); assert.equal(fs.existsSync(path.join(h.directory, FILE_NAME)), false);
  assert.ok(h.events.some(value => value.type === 'notice' && /could not be saved/i.test(value.message))); assertNoPlaintext(h);
});

test('new credential IPC rejects foreign windows, same-origin subframes and navigated frames before mutation', async t => {
  const h = await fixture(t); await remembered(h); await h.invoke('disconnect', config.id);
  await h.invoke('forgetPassword', config.id); const job = h.connect(), prompt = await h.prompt(), before = JSON.stringify(h.store.data);
  for (const [name, args] of [['forgetPassword', [config.id]], ['promptReply', [prompt.id, PASSWORD, true]]]) {
    const invoke = h.handlers.get('nerdsshell:' + name);
    await assert.rejects(invoke({ ...h.event(), sender: {} }, ...args), /Untrusted request/);
    await assert.rejects(invoke({ ...h.event(), senderFrame: { url: h.window.webContents.mainFrame.url } }, ...args), /Untrusted request/);
    h.window.webContents.mainFrame.url = 'https://synthetic.invalid/';
    try { await assert.rejects(invoke(h.event(), ...args), /Untrusted request/); }
    finally { h.window.webContents.mainFrame.url = 'nerdsshell://app/ui/index.html'; }
    assert.equal(JSON.stringify(h.store.data), before);
  }
  for (const invalid of [null, 'true', 1, {}, []]) await assert.rejects(h.reply(prompt, PASSWORD, invalid), /Invalid|remember/i);
  for (const invalid of [undefined, {}, [], 'x'.repeat(4097)]) await assert.rejects(h.invoke('promptReply', prompt.id, invalid, true), /Invalid|response/i);
  await h.reply(prompt, PASSWORD, false); await job; assert.equal(h.passwords.get(h.store.data.profiles[0]), null); assertNoPlaintext(h);
});


test('simultaneous unknown servers serialize host approvals, reject unexpected replies and bind acceptance to the current transport', async t => {
  const h = await fixture(t, { autoHostTrust: false }); h.add({ id: 'first-host' }); h.add({ id: 'second-host' });
  const first = h.connect('first-host'), second = h.connect('second-host');
  first.catch(() => {}); second.catch(() => {});
  const loginOne = await h.prompt(); await h.reply(loginOne, PASSWORD, false);
  const loginTwo = await h.prompt(h.events.indexOf(loginOne) + 1); await h.reply(loginTwo, PASSWORD, false);
  const approval = await h.prompt(h.events.indexOf(loginTwo) + 1); await tick();
  assert.equal(approval.kind, 'host-trust'); assert.equal(approval.rememberPasswordAvailable, false);
  assert.match(approval.message, /synthetic.invalid:22/); assert.match(approval.message, /SHA256:synthetic-fingerprint-only/);
  assert.equal(h.native.length, 0); assert.equal(h.events.filter(e => e.type === 'prompt' && e.kind === 'host-trust').length, 1);
  await h.reply(approval, 'yes', false); await assert.rejects(first, { code: 'NERDSSHELL_HOST_VERIFICATION' });
  const next = await h.prompt(h.events.indexOf(approval) + 1); assert.equal(next.kind, 'host-trust');
  await h.invoke('disconnect', 'second-host'); await second;
  await h.reply(next, 'trust', false);
  assert.deepEqual(h.store.data.pins, {}); assert.equal(h.passwords.get(h.store.data.profiles[0]), null);
});


test('approval for a replaced host transport cannot pin an identity or save its login password', async t => {
  const h = await fixture(t, { autoHostTrust: false }); h.add();
  const connecting = h.connect(), login = await h.prompt(); await h.reply(login, PASSWORD, true);
  const approval = await h.prompt(h.events.indexOf(login) + 1);
  const original = h.connections.get(config.id).remote;
  h.connections.get(config.id).remote = new original.constructor(original.profile, original.options);
  await h.reply(approval, 'trust', false); await connecting;
  assert.deepEqual(h.store.data.pins, {}); assert.equal(original.closing, true);
  assert.equal(h.passwords.get(h.store.data.profiles[0]), null); assertNoPlaintext(h);
});
