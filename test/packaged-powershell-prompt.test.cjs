'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { waitForPowerShellPrompt, scriptLiteral } = require('../scripts/Packaged-LocalPowerShell-Smoke.cjs');
const token = '11111111-2222-4333-8444-555555555555', key = 'local:powershell/standard-' + token;
const prompt = 'PS C:\\Users\\fixture> ';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const h = { line: prompt, observations: [], advances: 0, evaluations: 0, inputs: 0, async advance() {} };
  const view = { ready: true, locked: false, generation: 1, fitQueued: false, wrapper: { hidden: false }, render: Promise.resolve(),
    pane: { key, profileId: 'local:powershell', shellId: 'local:powershell', sessionToken: token, local: true, administrator: false },
    smokeOutput: '', terminal: { buffer: { active: { baseY: 0, cursorY: 0, getLine: () => ({ translateToString: () => h.line }) } } } };
  const views = new Map([[key, view]]), api = Object.freeze({ input() { h.inputs++; throw Error('Prompt observation must not send input'); } });
  const context = vm.createContext({ window: {}, views, api }); context.window = context;
  const evaluate = async expression => { h.evaluations++; return await vm.runInContext(expression, context); };
  const wait = async (expression, message) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await evaluate(expression); h.observations.push(result);
      if (result) return;
      h.advances++; await h.advance(attempt);
    }
    throw Error(message);
  };
  return Object.assign(h, { view, views, context, evaluate, wait, observe: after => waitForPowerShellPrompt({ evaluate, wait, key, after }) });
}

test('PowerShell result before the next native prompt cannot accept a stale displayed prompt', async () => {
  const h = fixture(); h.view.smokeOutput = 'RESULT_7\r\n';
  h.advance = async () => { h.view.smokeOutput += prompt; };
  await h.observe('RESULT_7'); assert.deepEqual(h.observations, [false, true]);
  assert.equal(h.inputs, 0); assert.equal(h.context.__smokePowerShellPrompts, undefined);
});

test('PowerShell prompt readiness waits for the actual queued renderer write', async () => {
  const h = fixture(), render = deferred(); h.view.render = render.promise;
  h.view.smokeOutput = 'RESULT_7\r\n' + prompt;
  const pending = h.observe('RESULT_7'); await tick(); assert.equal(h.observations.length, 0);
  render.resolve(); await pending; assert.deepEqual(h.observations, [true]); assert.equal(h.inputs, 0);
});

test('PowerShell prompt before the result, editing echo and an unfinished title cannot establish readiness', async () => {
  for (const raw of [prompt + '\r\nRESULT_7', 'RESULT_7\r\n' + prompt + 'Write-Output next', 'RESULT_7\r\n\x1b]0;' + prompt]) {
    const h = fixture(); h.view.smokeOutput = raw;
    await assert.rejects(h.observe('RESULT_7'), /did not return a fresh rendered prompt/);
    assert.equal(h.observations.length, 8); assert.equal(h.inputs, 0); assert.equal(h.context.__smokePowerShellPrompts, undefined);
  }
});

test('PowerShell raw prompt and Unicode result still require a matching rendered cursor line', async () => {
  const h = fixture(), marker = 'RESULT_é漢字😀';
  h.view.smokeOutput = Buffer.from(marker + '\r\n\x1b[32m' + prompt + '\x1b[0m', 'utf8').toString('latin1');
  h.line = 'Still rendering output'; h.advance = async () => { h.line = prompt; };
  await h.observe(marker); assert.deepEqual(h.observations, [false, true]); assert.equal(h.inputs, 0);
});

test('PowerShell prompt readiness rejects replaced view, generation, token and shell identity while draining', async () => {
  for (const change of ['view', 'generation', 'token', 'shell', 'administrator', 'ready', 'locked']) {
    const h = fixture(), render = deferred(); h.view.render = render.promise;
    const pending = h.observe(); const rejected = assert.rejects(pending, /prompt target changed/);
    await tick();
    if (change === 'view') h.views.set(key, { ...h.view });
    if (change === 'generation') h.view.generation++;
    if (change === 'token') h.view.pane.sessionToken = 'replacement';
    if (change === 'shell') h.view.pane.shellId = 'local:pwsh';
    if (change === 'administrator') h.view.pane.administrator = true;
    if (change === 'ready') h.view.ready = false;
    if (change === 'locked') h.view.locked = true;
    render.resolve(); await rejected;
    assert.equal(h.inputs, 0); assert.equal(h.context.__smokePowerShellPrompts, undefined);
  }
});

test('PowerShell prompt observation excludes foreign keys and unbounded markers before renderer access', async () => {
  for (const other of ['fixture/standard-' + token, 'local:cmd/standard-' + token, 'local:powershell-admin/standard-' + token, 'local:powershell/standard-bad', {}, null]) {
    const h = fixture(); await assert.rejects(waitForPowerShellPrompt({ evaluate: h.evaluate, wait: h.wait, key: other }), /owned ordinary PowerShell key/);
    assert.equal(h.evaluations, 0);
  }
  const h = fixture(); await assert.rejects(h.observe('x'.repeat(1025)), /bounded marker/); assert.equal(h.evaluations, 0);
});

test('PowerShell queued fit and hidden pane cannot accept a prompt until that rendered view is usable', async () => {
  for (const change of ['fitQueued', 'hidden']) {
    const h = fixture(); if (change === 'fitQueued') h.view.fitQueued = true; else h.view.wrapper.hidden = true;
    h.advance = async () => { h.view.fitQueued = false; h.view.wrapper.hidden = false; };
    await h.observe(); assert.deepEqual(h.observations, [false, true]); assert.equal(h.inputs, 0);
  }
});

test('PowerShell changed renderer chain is drained on a new observation rather than treated as complete', async () => {
  const h = fixture(), render = deferred(); h.view.render = render.promise;
  const pending = h.observe(); await tick(); h.view.render = Promise.resolve(); render.resolve();
  await pending; assert.deepEqual(h.observations, [false, true]); assert.equal(h.inputs, 0);
});

test('debugger literals preserve controls and Unicode without exposing HTML delimiters or injecting statements', async () => {
  for (const value of ['</script><script>injected=true</script>', '\";injected=true;//', "'\\\n\r\t\b\f\0\u2028\u2029é漢字😀"]) {
    const literal = scriptLiteral(value), context = vm.createContext({ injected: false });
    assert.doesNotMatch(literal, /[<>\u2028\u2029]/);
    assert.equal(vm.runInContext(literal, context), value); assert.equal(context.injected, false);
    const h = fixture(); h.view.smokeOutput = Buffer.from(value + '\r\n' + prompt, 'utf8').toString('latin1');
    await h.observe(value); assert.deepEqual(h.observations, [true]); assert.equal(h.context.injected, undefined); assert.equal(h.inputs, 0);
  }
});
