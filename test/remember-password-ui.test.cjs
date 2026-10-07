'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Node {
  constructor() { Object.assign(this, { children: [], events: {}, value: '', hidden: false, checked: false, disabled: false, textContent: '' }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  setAttribute() {}
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function fixture() {
  const nodes = new Map(), calls = { replies: [], saves: [], connections: [], forgotten: [], notices: [] };
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const form = $('connectionForm'); form.elements = {};
  const defaults = { id: '', name: '', auth: 'agent', rememberPassword: false, autoConnect: true, record: false };
  for (const [name, value] of Object.entries(defaults)) form.elements[name] = Object.assign(new Node(), { type: typeof value === 'boolean' ? 'checkbox' : 'text' });
  form.reset = () => { for (const [name, value] of Object.entries(defaults)) { form.elements[name].disabled = false; form.elements[name][typeof value === 'boolean' ? 'checked' : 'value'] = value; } };
  form.reset();
  class FormData {
    constructor(input) { this.entries = Object.entries(input.elements).filter(([, field]) => !field.disabled && (field.type !== 'checkbox' || field.checked)).map(([name, field]) => [name, field.type === 'checkbox' ? 'on' : field.value]); }
    [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
  }
  const api = { promptReply: async (...args) => calls.replies.push(args), saveProfile: async request => { calls.saves.push(structuredClone(request)); return { ...request, id: request.id || 'saved' }; },
    forgetPassword: async id => { calls.forgotten.push(id); return { ...context.profiles.get(id), rememberPassword: false }; }, onEvent: callback => { api.event = callback; } };
  const element = (_tag, _class, text) => Object.assign(new Node(), { textContent: text });
  const button = (text, action) => Object.assign(new Node(), { textContent: text, action });
  const context = vm.createContext({ $, api, promptId: null, promptProfileId: null, profiles: new Map(), panes: new Map(), statuses: new Map(), views: new Map(),
    sessionDefaults: {}, selectedProfile: '', FormData, element, button, label: p => p.name, newSession() {},
    message: text => calls.notices.push(text), run: promise => Promise.resolve(promise).catch(error => calls.notices.push(error.message)),
    connectProfile: async id => calls.connections.push(id), updateSessionMode() {}, renderConnections() {}, structuredClone });
  vm.runInContext(source.slice(source.indexOf('function editConnection('), source.indexOf('function appearanceFields(')), context);
  vm.runInContext(source.slice(source.indexOf('function showCredentialPrompt('), source.indexOf('function isAppShortcut(')), context);
  vm.runInContext(source.slice(source.indexOf('api.onEvent(event => {'), source.indexOf("$('connectionForm').addEventListener('submit'")), context);
  vm.runInContext(source.slice(source.indexOf("$('connectionForm').addEventListener('submit'"), source.indexOf("$('chooseKey').addEventListener")), context);
  vm.runInContext(source.slice(source.indexOf("$('promptForm').onsubmit"), source.indexOf("$('newSessionForm').onsubmit")), context);
  return { context, $, form, calls, api };
}
const passwordPrompt = { type: 'prompt', id: 'login', profileId: 'fixture', title: 'Password', message: 'Fixture account', secret: true, rememberPasswordAvailable: true, rememberPassword: false };

test('login remembering starts off, follows the profile preference, and submits only explicit consent', () => {
  const f = fixture(); f.api.event(passwordPrompt);
  assert.equal(f.$('promptRememberField').hidden, false); assert.equal(f.$('promptRemember').checked, false);
  f.$('promptValue').value = 'synthetic-only'; f.$('promptRemember').checked = true;
  f.$('promptForm').onsubmit({ preventDefault() {} });
  assert.deepEqual(f.calls.replies, [['login', 'synthetic-only', true]]);
  assert.equal(f.$('promptValue').value, ''); assert.equal(f.$('promptRemember').checked, false); assert.equal(f.$('promptDialog').open, false);
  f.api.event({ ...passwordPrompt, rememberPassword: true }); assert.equal(f.$('promptRemember').checked, true);
  f.$('promptRemember').checked = false; f.$('promptValue').value = 'other-synthetic'; f.context.replyCredentialPrompt();
  assert.deepEqual(f.calls.replies.at(-1), ['login', 'other-synthetic', false]);
});

test('private-key and interactive challenge prompts cannot inherit password-saving consent', () => {
  const f = fixture(); f.api.event({ ...passwordPrompt, rememberPassword: true });
  for (const event of [{ id: 'key', secret: true }, { id: 'challenge', secret: true }, { id: 'plain', secret: false, rememberPasswordAvailable: true }]) {
    f.api.event({ type: 'prompt', title: 'Prompt', message: '', ...event });
    assert.equal(f.$('promptRememberField').hidden, true); assert.equal(f.$('promptRemember').checked, false);
    f.$('promptRemember').checked = true; f.$('promptValue').value = 'synthetic-response'; f.context.replyCredentialPrompt();
    assert.deepEqual(f.calls.replies.at(-1), [event.id, 'synthetic-response', false]);
  }
});

test('button cancellation and Escape clear plaintext and consent without saving an answer', () => {
  for (const cancel of [f => f.$('cancelPrompt').onclick(), f => f.$('promptDialog').events.cancel[0]()]) {
    const f = fixture(); f.api.event({ ...passwordPrompt, rememberPassword: true }); f.$('promptValue').value = 'synthetic-only'; cancel(f);
    assert.deepEqual(f.calls.replies, [['login', null]]); assert.equal(f.$('promptValue').value, ''); assert.equal(f.context.promptId, null);
    assert.equal(f.$('promptRemember').checked, false); assert.equal(f.$('promptRememberField').hidden, true);
  }
});

test('an obsolete prompt cancellation cannot dismiss a new password prompt', () => {
  const f = fixture(); f.api.event(passwordPrompt); f.api.event({ ...passwordPrompt, id: 'current', rememberPassword: true });
  f.$('promptValue').value = 'synthetic-current'; f.api.event({ type: 'promptCancelled', id: 'login' });
  assert.equal(f.context.promptId, 'current'); assert.equal(f.$('promptValue').value, 'synthetic-current'); assert.equal(f.$('promptDialog').open, true);
  f.api.event({ type: 'promptCancelled', id: 'current' });
  assert.equal(f.$('promptValue').value, ''); assert.equal(f.$('promptRemember').checked, false); assert.deepEqual(f.calls.replies, []);
});

test('connection remembering is opt-in and switching authentication removes hidden consent', async () => {
  const f = fixture(); f.context.editConnection();
  assert.equal(f.$('rememberPasswordField').hidden, true); assert.equal(f.form.elements.rememberPassword.checked, false);
  f.context.editConnection({ id: 'fixture', name: 'Fixture', auth: 'password', rememberPassword: true });
  assert.equal(f.$('rememberPasswordField').hidden, false); assert.equal(f.form.elements.rememberPassword.checked, true);
  f.form.events.submit[0]({ preventDefault() {}, target: f.form }); await tick();
  assert.equal(f.calls.saves.at(-1).rememberPassword, true); assert.deepEqual(f.calls.connections, ['fixture']);
  f.form.elements.auth.value = 'key'; f.form.elements.auth.events.change[0]();
  assert.equal(f.$('keyField').hidden, false); assert.equal(f.$('rememberPasswordField').hidden, true);
  assert.equal(f.form.elements.rememberPassword.disabled, true); assert.equal(f.form.elements.rememberPassword.checked, false);
  f.form.events.submit[0]({ preventDefault() {}, target: f.form }); await tick();
  assert.equal(f.calls.saves.at(-1).rememberPassword, false);
  f.form.elements.auth.value = 'password'; f.form.elements.auth.events.change[0](); assert.equal(f.form.elements.rememberPassword.checked, false);
});

test('connection edits never populate or expose saved plaintext passwords', () => {
  const f = fixture(); f.context.editConnection({ id: 'fixture', auth: 'password', rememberPassword: true });
  assert.equal(f.$('promptValue').value, ''); assert.equal(f.form.elements.password, undefined);
  const connectionHtml = html.slice(html.indexOf('<dialog id="connectionDialog">'), html.indexOf('<dialog id="promptDialog">'));
  assert.doesNotMatch(connectionHtml, /<input[^>]+(?:name="password"|type="password")/);
});

test('successful main profile updates refresh the preference without resurrecting removed profiles', () => {
  const f = fixture(); f.context.profiles.set('fixture', { id: 'fixture', auth: 'password', rememberPassword: false });
  f.api.event({ type: 'profile', profile: { id: 'fixture', auth: 'password', rememberPassword: true } });
  assert.equal(f.context.profiles.get('fixture').rememberPassword, true);
  f.context.profiles.delete('fixture'); f.api.event({ type: 'profile', profile: { id: 'fixture', rememberPassword: true } });
  assert.equal(f.context.profiles.has('fixture'), false);
});

test('Forget while a password prompt is open removes stale consent without discarding the typed login password', () => {
  const f = fixture(); f.context.profiles.set('fixture', { id: 'fixture', auth: 'password', rememberPassword: true });
  f.api.event({ ...passwordPrompt, rememberPassword: true }); f.$('promptValue').value = 'synthetic-typed';
  f.api.event({ type: 'profile', profile: { id: 'other', rememberPassword: false } }); assert.equal(f.$('promptRemember').checked, true);
  f.api.event({ type: 'profile', profile: { id: 'fixture', auth: 'password', rememberPassword: false } });
  assert.equal(f.$('promptRemember').checked, false); assert.equal(f.$('promptValue').value, 'synthetic-typed'); assert.equal(f.$('promptDialog').open, true);
  f.context.replyCredentialPrompt(); assert.deepEqual(f.calls.replies, [['login', 'synthetic-typed', false]]);
  assert.equal(f.context.promptProfileId, null);
});

function forgetAction(f) {
  vm.runInContext(source.slice(source.indexOf('function renderConnections('), source.indexOf('function renderTabs(')), f.context);
  f.context.renderConnections();
  return f.$('connections').children.flatMap(box => box.children.flatMap(node => node.children)).find(node => node.textContent === 'Forget password');
}
test('Forget removes the saved preference while a live SSH connection stays connected', async () => {
  const f = fixture(); f.context.profiles.set('fixture', { id: 'fixture', name: 'Fixture', auth: 'password', rememberPassword: true });
  f.context.statuses.set('fixture', { state: 'connected' });
  const action = forgetAction(f); assert.ok(action); await action.action();
  assert.deepEqual(f.calls.forgotten, ['fixture']); assert.equal(f.context.profiles.get('fixture').rememberPassword, false);
  assert.equal(f.context.statuses.get('fixture').state, 'connected'); assert.deepEqual(f.calls.connections, []);
});

test('a delayed Forget response cannot overwrite a newer connection edit or restore a removed profile', async () => {
  for (const removed of [false, true]) {
    const f = fixture(); f.context.profiles.set('fixture', { id: 'fixture', auth: 'password', rememberPassword: true });
    let resolve; f.api.forgetPassword = () => new Promise(done => { resolve = done; });
    const action = forgetAction(f), pending = action.action();
    if (removed) f.context.profiles.delete('fixture'); else f.context.profiles.set('fixture', { id: 'fixture', auth: 'key', name: 'Updated' });
    resolve({ id: 'fixture', auth: 'password', rememberPassword: false }); await pending;
    if (removed) assert.equal(f.context.profiles.has('fixture'), false); else assert.equal(f.context.profiles.get('fixture').auth, 'key');
  }
});

test('password profiles offer Forget without exposing saved credential presence; key profiles do not', () => {
  const f = fixture(); f.context.profiles.set('fixture', { id: 'fixture', auth: 'password', rememberPassword: false }); assert.ok(forgetAction(f));
  f.context.profiles.set('fixture', { id: 'fixture', auth: 'key' }); assert.equal(forgetAction(f), undefined);
});
