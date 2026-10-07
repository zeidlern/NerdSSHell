'use strict';
// The detector consumes xterm's already-parsed live screen. Silence, BEL, a
// terminal title and a shell prompt are never sufficient reasons to alert.
(function (root) {
  const DEFAULTS = Object.freeze({ enabled: true, audio: true, desktop: true, visual: true });
  const LABELS = Object.freeze({ confirmation: 'Confirmation requested', selection: 'Selection requested',
    password: 'Authentication input requested', input: 'Input requested' });
  const MAX_ROWS = 32, MAX_TEXT = 32768, MAX_LINE = 4096;
  let sequence = 0;
  const clean = value => String(value || '').slice(0, MAX_LINE).replace(/[\x00-\x1f\x7f-\x9f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const undecorate = value => clean(value).replace(/^[│┃║]\s?/, '').replace(/\s?[│┃║]$/, '').trim();
  const hash = value => { let result = 2166136261; for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619); return (result >>> 0).toString(16); };
  function readScreen(terminal) {
    const buffer = terminal.buffer.active, absoluteCursor = buffer.baseY + buffer.cursorY;
    const start = Math.max(buffer.baseY, absoluteCursor - 23);
    const end = buffer.type === 'alternate' ? Math.min(buffer.baseY + terminal.rows - 1, start + MAX_ROWS - 1) : absoluteCursor;
    const lines = []; let size = 0, cursorLine = 0;
    for (let row = start; row <= end && size < MAX_TEXT; row++) {
      const line = buffer.getLine(row), value = (line?.translateToString(true) || '').slice(0, Math.min(MAX_LINE, MAX_TEXT - size));
      size += value.length;
      if (line?.isWrapped && lines.length) lines[lines.length - 1] = (lines.at(-1) + value).slice(0, MAX_LINE);
      else lines.push(value);
      if (row === absoluteCursor) cursorLine = lines.length - 1;
    }
    const cursorRow = buffer.getLine(absoluteCursor);
    return { lines, cursorLine, type: buffer.type,
      cursorSuffix: (cursorRow?.translateToString(true, buffer.cursorX) || '').slice(0, MAX_LINE) };
  }
  function shellLine(text) {
    return /^(?:\([^)]{1,80}\)\s*)?(?:PS(?:\s+[^>]{0,180})?>|[A-Za-z]:\\[^>]{0,180}>)/i.test(text) ||
      /^(?:\([^)]{1,80}\)\s*)?(?:[\w.-]+@[\w.-]+:[^$#]{0,180}|(?:ba|z|k|fi)?sh(?:-[\d.]+)?)\s*[$#](?:\s|$)/i.test(text) || /^[$#](?:\s|$)/.test(text);
  }
  function logLine(text) {
    return /^(?:\[?(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR)\]?[\s:]|\d{4}-\d\d-\d\d[ T]|(?:example|output|prompt|expected|printed|log):\s)/i.test(text);
  }
  function directKind(text) {
    if (!text || logLine(text) || shellLine(text)) return '';
    if (/^(?:\[sudo\]\s*)?(?:(?:enter|re-enter|confirm|current|new)\s+)?(?:[^\s:]{1,100}'s\s+)?(?:password|passphrase|pin|verification code|one[- ]time (?:code|password)|otp)(?:\s+(?:for|for key)\s+[^\n]{1,180})?\s*:\s*$/i.test(text)) return 'password';
    if (/^\[Y\]\s+Yes\b/i.test(text) && /\[N\]\s+No\b/i.test(text) && /:\s*$/.test(text)) return 'confirmation';
    if (/(?:\[\s*(?:y(?:es)?\s*[/|,]\s*n(?:o)?|n(?:o)?\s*[/|,]\s*y(?:es)?)\s*\]|\(\s*(?:y(?:es)?\s*[/|,]\s*n(?:o)?|n(?:o)?\s*[/|,]\s*y(?:es)?)(?:\s*\/\s*\[fingerprint\])?\s*\))\s*[?:>]?$/.test(text.toLowerCase())) return 'confirmation';
    if (/^(?:(?:[?❯›]\s*)|(?:please\s+))?(?:are you sure|would you like|do you want|may i|shall i|should i|can i|allow\b|approve\b|continue\b|proceed\b|confirm\b)[^\n]{0,250}\?\s*$/i.test(text)) return 'confirmation';
    if (/^(?:press|hit)\s+(?:\[?(?:enter|return|any key|space|y|n|esc(?:ape)?)\]?)[^\n]{0,160}\b(?:continue|confirm|proceed|accept|cancel|exit|submit)[\s.!:…]*$/i.test(text)) return 'confirmation';
    if (/^(?:please\s+)?(?:enter|type|select|choose)\s+(?:(?:an?|the|your)\s+)?(?:choice|option|selection|response|answer|input|name|username|value|command|number)(?:[^\n]{0,100})?:\s*$/i.test(text) ||
      /^(?:please\s+)?type\s+[^\n]{1,80}\s+to\s+(?:confirm|continue|proceed)[.:]?\s*$/i.test(text) ||
      /^waiting for (?:your )?(?:approval|confirmation|input|response)[.:…!]?$/i.test(text)) return 'input';
    return '';
  }
  function classifyPrompt(screen, shellPhase = '') {
    if (!screen || !Array.isArray(screen.lines) || shellPhase === 'prompt') return null;
    const lines = screen.lines.slice(0, MAX_ROWS).map(undecorate), cursor = Math.min(lines.length - 1, Math.max(0, screen.cursorLine || 0));
    if (!lines.length) return null;
    // A normal shell prompt (including a typed command) ends an earlier
    // interaction. Historical questions above it must not remain actionable.
    if (shellLine(lines[cursor])) return null;
    let locus = cursor;
    if (!lines[locus] || /^[>❯›]\s*$/.test(lines[locus])) locus--;
    const tail = lines[locus] || '';
    // A cursor within existing text normally belongs to an editor, not an
    // input prompt. Alternate-screen menus are evaluated separately below.
    const direct = !clean(screen.cursorSuffix) ? directKind(tail) : '';
    const context = lines.slice(Math.max(0, cursor - 23), Math.min(lines.length, cursor + 9)).filter(Boolean);
    if (!context.length || (screen.type !== 'alternate' && shellLine(tail))) return null;
    const joined = context.join('\n');
    const choices = context.filter(line => /^(?:[>❯›●○]\s*)?(?:\d{1,2}[.)]\s+|\[[ x✓]\]\s+)/.test(line));
    const menuQuestion = context.find(line => !logLine(line) && (/\?/.test(line) && /(?:would you like|do you want|allow|approve|select|choose|which|what|how)/i.test(line)));
    const navigation = /(?:use (?:the )?arrow keys|↑\s*\/\s*↓|↑↓|arrow keys (?:to|for) (?:select|navigate))/i.test(joined);
    const submit = /(?:(?:press )?(?:enter|return)\s+to\s+(?:confirm|select|submit|accept)|(?:esc|escape)\s+to\s+cancel)/i.test(joined);
    const selected = context.some(line => /^[>❯›]\s*\S/.test(line));
    const endpoint = /^(?:[>❯›●○]\s*)?(?:\d{1,2}[.)]\s+|\[[ x✓]\]\s+)/.test(tail) ||
      /(?:enter|return|esc|escape|arrow keys|↑↓|↑\s*\/\s*↓)/i.test(tail) || (screen.type === 'alternate' && /^[>❯›]\s*\S/.test(lines[cursor]));
    // Multi-line CLI menus need two independent signals. A numbered list in
    // ordinary output, or the word "approval", does not constitute a prompt.
    if (endpoint && ((choices.length >= 2 && (menuQuestion || submit)) || (selected && navigation && (menuQuestion || submit)))) {
      const identity = menuQuestion || context.find(line => /(?:enter|return)\s+to\s+/i.test(line)) || tail;
      const options = choices.map(line => line.replace(/^[>❯›●○]\s*/, '').replace(/\[[ x✓]\]/, '[]')).join('|');
      return { kind: 'selection', label: LABELS.selection, fingerprint: `selection:${hash(identity + '|' + options)}` };
    }
    if (direct && cursor - locus <= 1) return { kind: direct, label: LABELS[direct], fingerprint: `${direct}:${hash(tail)}` };
    return null;
  }
  function terminalReply(data) {
    return /^(?:\x1b\[[?<>]?[\d;]*[cnR]|\x1b\[\??\d+;\d+\$y|\x1b\[[IO]|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\][^\x07]*\x07)$/.test(data);
  }
  function createDetector({ onChange = () => {}, onAlert = () => {}, stableMs = 900, releaseMs = 250,
    sourceId = root.crypto?.randomUUID?.() || `attention-${Date.now()}-${++sequence}` } = {}) {
    let candidate = null, missingSince = null, suppressed = '', lastEvidence = null, enabled = true;
    let inputEpoch = 0, screenStamp = '', suppressedStamp = '';
    let state = { sourceId, revision: 0, eventId: 0, waiting: false, acknowledged: false, kind: '', label: '' };
    function publish(values) { state = { ...state, ...values, revision: state.revision + 1 }; onChange({ ...state }); }
    function clear() { if (state.waiting) publish({ waiting: false, acknowledged: false, kind: '', label: '' }); }
    function tick(now) {
      if (!enabled) return { ...state };
      if (missingSince !== null && now - missingSince >= releaseMs) { clear(); candidate = null; missingSince = null; suppressed = ''; suppressedStamp = ''; }
      if (candidate && lastEvidence && !state.waiting && candidate.fingerprint !== suppressed && now - candidate.since >= stableMs) {
        publish({ waiting: true, acknowledged: false, eventId: state.eventId + 1, kind: candidate.kind, label: candidate.label }); onAlert({ ...state });
      }
      return { ...state };
    }
    return {
      observe(screen, now, shellPhase = '', restored = false) {
        if (!enabled) return { ...state };
        const evidence = classifyPrompt(screen, shellPhase);
        if ((evidence?.fingerprint || '') !== (lastEvidence?.fingerprint || '')) inputEpoch++;
        lastEvidence = evidence;
        screenStamp = hash((screen?.lines || []).slice(0, MAX_ROWS).map(undecorate).join('\n').slice(0, MAX_TEXT));
        // A retry can contain progress and the next identical prompt in one
        // parsed write. Changed live context proves the handled prompt moved
        // on even though no intermediate blank screen was sampled. A snapshot
        // merely rebuilds context, so rebase its stamp without re-alerting.
        if (evidence && evidence.fingerprint === suppressed) {
          if (restored) suppressedStamp = screenStamp;
          else if (suppressedStamp && suppressedStamp !== screenStamp) { suppressed = ''; suppressedStamp = ''; candidate = null; inputEpoch++; }
        }
        if (!evidence) {
          if (state.waiting) { if (missingSince === null) missingSince = now; }
          else { candidate = null; suppressed = ''; suppressedStamp = ''; }
        } else {
          missingSince = null;
          if (!candidate || candidate.fingerprint !== evidence.fingerprint) {
            clear(); candidate = { ...evidence, since: now }; if (suppressed !== evidence.fingerprint) suppressed = '';
          }
        }
        return tick(now);
      },
      tick,
      nextDelay(now) {
        if (!enabled) return null;
        if (missingSince !== null) return Math.max(1, releaseMs - (now - missingSince));
        if (candidate && !state.waiting && candidate.fingerprint !== suppressed) return Math.max(1, stableMs - (now - candidate.since));
        return null;
      },
      input(data) {
        if (typeof data !== 'string' || !data || terminalReply(data)) return;
        if (!state.waiting) { if (candidate) { suppressed = candidate.fingerprint; suppressedStamp = screenStamp; candidate = null; } return; }
        if (/[\r\n\x03\x04]/.test(data) || data === '\x1b' || (state.kind === 'confirmation' && /^[yYnN]$/.test(data))) {
          suppressed = candidate?.fingerprint || ''; suppressedStamp = screenStamp; clear(); missingSince = null;
        } else if (!state.acknowledged) publish({ acknowledged: true });
      },
      captureInput() { return { sourceId, epoch: inputEpoch }; },
      acceptInput(data, token) {
        if (!token || token.sourceId !== sourceId || token.epoch !== inputEpoch) return false;
        this.input(data); return true;
      },
      invalidateInput() { inputEpoch++; },
      acknowledge() { if (state.waiting && !state.acknowledged) publish({ acknowledged: true }); },
      refresh() { if (state.waiting) publish({}); },
      reset() { inputEpoch++; candidate = null; lastEvidence = null; missingSince = null; suppressed = ''; suppressedStamp = ''; screenStamp = ''; clear(); },
      setEnabled(value) { enabled = !!value; if (!enabled) this.reset(); },
      state: () => ({ ...state })
    };
  }
  function attach({ terminal, isReady = () => true, enabled = () => true, onChange, onAlert,
    now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, stableMs, releaseMs, sourceId } = {}) {
    const detector = createDetector({ onChange, onAlert, stableMs, releaseMs, sourceId });
    let timer = null, disposed = false, suspended = false, shellPhase = '';
    function cancel() { if (timer !== null) clearTimer(timer); timer = null; }
    function schedule() {
      cancel(); const delay = detector.nextDelay(now());
      if (delay !== null && !disposed) timer = setTimer(() => { timer = null; sample(); }, delay);
    }
    function sample(restored = false) {
      if (disposed) return;
      detector.setEnabled(enabled());
      if (suspended) { cancel(); return; }
      if (!isReady()) { detector.reset(); cancel(); return; }
      detector.observe(readScreen(terminal), now(), shellPhase, restored === true); schedule();
    }
    const parsed = terminal.onWriteParsed?.(sample);
    // Cooperating shells may supply OSC 133 semantic markers. Observe only:
    // never inject hooks, change a shell profile, or consume another handler.
    const semantic = terminal.parser?.registerOscHandler?.(133, data => {
      if (suspended || disposed) return false;
      const phase = String(data).split(';', 1)[0];
      if (phase === 'A' || phase === 'B') { shellPhase = 'prompt'; detector.reset(); cancel(); }
      else if (phase === 'C' || phase === 'D') shellPhase = phase === 'C' ? 'command' : '';
      return false;
    });
    return {
      sample,
      suspend() { if (disposed) return; suspended = true; shellPhase = ''; detector.invalidateInput(); cancel(); },
      resume() { if (disposed) return; suspended = false; sample(true); detector.refresh(); },
      input(data) { detector.input(data); schedule(); },
      captureInput: detector.captureInput,
      acceptInput(data, token) { if (disposed || suspended || !isReady()) return false; const accepted = detector.acceptInput(data, token); schedule(); return accepted; },
      acknowledge() { detector.acknowledge(); },
      reset() { cancel(); suspended = false; shellPhase = ''; detector.reset(); },
      dispose() { if (disposed) return; disposed = true; cancel(); parsed?.dispose(); semantic?.dispose(); detector.reset(); },
      state: detector.state
    };
  }
  let audioContext;
  async function playAlert() {
    try {
      const Audio = root.AudioContext || root.webkitAudioContext;
      if (!Audio) return false;
      audioContext ||= new Audio();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (audioContext.state !== 'running') return false;
      const start = audioContext.currentTime, gain = audioContext.createGain(), tone = audioContext.createOscillator();
      tone.type = 'sine'; tone.frequency.setValueAtTime(660, start); tone.frequency.setValueAtTime(880, start + 0.10);
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.09, start + 0.015);
      gain.gain.setValueAtTime(0.09, start + 0.16); gain.gain.linearRampToValueAtTime(0, start + 0.25);
      tone.connect(gain); gain.connect(audioContext.destination); tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      tone.start(start); tone.stop(start + 0.26); return true;
    } catch { return false; }
  }
  const api = { DEFAULTS, LABELS, readScreen, classifyPrompt, createDetector, attach, playAlert };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NerdSSHellAttention = Object.freeze(api);
})(typeof window === 'object' ? window : globalThis);
