'use strict';
// Native attention lives in main; the renderer supplies bounded semantic state,
// never notification text, URLs, commands, executable paths, or terminal output.
const { LABELS } = require('../ui/session-attention.js');
const MAX_SESSIONS = 128, COALESCE_MS = 200, GLOBAL_INTERVAL_MS = 2000, SESSION_INTERVAL_MS = 5000;
function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['sourceId', 'revision', 'eventId', 'waiting', 'acknowledged', 'kind', 'label'].includes(key)) ||
      typeof value.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.sourceId) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !Number.isSafeInteger(value.eventId) || value.eventId < 0 ||
      typeof value.waiting !== 'boolean' || typeof value.acknowledged !== 'boolean' ||
      typeof value.kind !== 'string' || typeof value.label !== 'string' ||
      (value.waiting ? value.eventId < 1 || !Object.hasOwn(LABELS, value.kind) || value.label !== LABELS[value.kind] : value.kind !== '' || value.label !== '' || value.acknowledged)) {
    throw new Error('Invalid session attention state.');
  }
  return { ...value };
}
function cleanLabel(value) { return String(value || 'Terminal session').replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 120); }
function createSessionNotifications({ getWindow, Notification, getPreferences = () => ({}), resolveSession,
  onActivate = () => {}, onAudio = () => {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const sessions = new Map(), pending = new Map(), notices = new Map();
  let active = '', timer = null, timerAt = Infinity, lastAlert = -Infinity, watchedWindow = null, disposed = false;
  function prefs() { const value = getPreferences() || {}; return { enabled: value.enabled !== false, audio: value.audio !== false, desktop: value.desktop !== false }; }
  function owner(key) { try { return resolveSession(key) || null; } catch { return null; } }
  function current(key, item) { const value = owner(key); return value && value.identity === item.identity ? value : null; }
  function foreground(key) { const win = getWindow(); return !!win && !win.isDestroyed() && win.isFocused() && !win.isMinimized() && key === active; }
  function actionable(key, item) { return item.waiting && !item.acknowledged && item.eventId > item.seenEventId && !!current(key, item) && !foreground(key); }
  function closeNotice(notice) { notices.delete(notice); try { notice.close(); } catch {} }
  function pruneNotices() {
    for (const [notice, members] of notices) if (!members.some(({ key, item, eventId }) => sessions.get(key) === item && item.eventId === eventId && item.waiting && !item.acknowledged && current(key, item) && !foreground(key))) closeNotice(notice);
  }
  function syncFlash() {
    const win = getWindow(); if (!win || win.isDestroyed()) return;
    const p = prefs(), waiting = p.enabled && p.desktop && !win.isFocused() && [...sessions].some(([key, item]) => item.waiting && !item.acknowledged && current(key, item));
    win.flashFrame(!!waiting);
  }
  function viewed() {
    const item = sessions.get(active);
    if (item && foreground(active)) { item.seenEventId = item.eventId; pending.delete(active); }
    pruneNotices(); syncFlash();
  }
  function bindWindow() {
    const win = getWindow(); if (win === watchedWindow) return;
    watchedWindow?.removeListener('focus', viewed); watchedWindow?.removeListener('blur', syncFlash);
    watchedWindow = win;
    if (win && !win.isDestroyed()) { win.on('focus', viewed); win.on('blur', syncFlash); }
  }
  function schedule() {
    if (disposed || !pending.size) { if (timer !== null) clearTimer(timer); timer = null; timerAt = Infinity; return; }
    const at = now(), delay = Math.max(COALESCE_MS, lastAlert + GLOBAL_INTERVAL_MS - at);
    let soonest = Infinity;
    for (const [key, item] of pending) {
      if (!actionable(key, item)) { pending.delete(key); continue; }
      soonest = Math.min(soonest, Math.max(delay, item.lastAlert + SESSION_INTERVAL_MS - at));
    }
    if (!Number.isFinite(soonest)) { if (timer !== null) clearTimer(timer); timer = null; timerAt = Infinity; }
    else if (timer === null || timerAt > at + soonest) {
      if (timer !== null) clearTimer(timer); timerAt = at + soonest; timer = setTimer(flush, soonest);
    }
  }
  function flush() {
    timer = null; timerAt = Infinity; if (disposed) return;
    const p = prefs(); if (!p.enabled) { pending.clear(); syncFlash(); return; }
    const at = now(), batch = [];
    for (const [key, item] of pending) {
      if (!actionable(key, item)) { pending.delete(key); continue; }
      if (at - lastAlert < GLOBAL_INTERVAL_MS || at - item.lastAlert < SESSION_INTERVAL_MS) continue;
      pending.delete(key); item.seenEventId = item.eventId; item.lastAlert = at;
      batch.push({ key, item, eventId: item.eventId });
    }
    if (!batch.length) { schedule(); return; }
    lastAlert = at;
    if (p.audio) { try { onAudio({ keys: batch.map(x => x.key) }); } catch {} }
    let supported = false;
    if (p.desktop) { try { supported = !!Notification?.isSupported(); } catch {} }
    if (supported) {
      let notice;
      try {
        const label = cleanLabel(current(batch[0].key, batch[0].item)?.label);
        notice = new Notification({ title: 'NerdSSHell · Input needed', silent: true,
          body: batch.length === 1 ? `${label} is waiting for input. Select to open the session.` : 'Several terminal sessions need input. Select to open a waiting session.' });
        notices.set(notice, batch);
        notice.on('failed', () => { notices.delete(notice); });
        notice.on('click', () => {
          const target = batch.find(({ key, item, eventId }) => sessions.get(key) === item && item.eventId === eventId && item.waiting && current(key, item));
          if (!target) { closeNotice(notice); return; }
          const win = getWindow(); if (!win || win.isDestroyed()) return;
          if (win.isMinimized()) win.restore(); win.show(); win.focus(); onActivate(target.key); closeNotice(notice);
        });
        // Retain the object while its prompt is pending. Timed-out Windows
        // toasts may still be in Action Center and must remain clearable.
        notice.show();
      } catch { if (notice) closeNotice(notice); /* Independent taskbar/audio attention still works. */ }
    }
    syncFlash(); schedule();
  }
  function forget(key) { pending.delete(key); sessions.delete(key); pruneNotices(); syncFlash(); }
  return {
    update(key, value) {
      if (disposed) return false;
      if (typeof key !== 'string' || !key || key.length > 240 || /[\x00-\x1f\x7f]/.test(key)) throw new Error('Invalid session.');
      const state = validateState(value), resolved = owner(key);
      // Snapshot capture temporarily makes the same backend view unready.
      // Reject its in-flight transition and remove current attention routes,
      // but retain event deduplication until an explicit lifecycle forget.
      if (!resolved?.identity) { pending.delete(key); pruneNotices(); syncFlash(); schedule(); return false; }
      bindWindow(); let prior = sessions.get(key);
      if (prior && prior.identity !== resolved.identity) { forget(key); prior = null; }
      if (prior && (state.sourceId !== prior.sourceId || state.revision <= prior.revision || state.eventId < prior.eventId ||
          (state.eventId === prior.eventId && ((!prior.waiting && state.waiting) || (prior.acknowledged && state.waiting && !state.acknowledged))))) return false;
      if (!prior && sessions.size >= MAX_SESSIONS) {
        for (const [otherKey, item] of sessions) if (!current(otherKey, item)) forget(otherKey);
        if (sessions.size >= MAX_SESSIONS) return false;
      }
      const item = prior || { identity: resolved.identity, seenEventId: 0, lastAlert: -Infinity };
      Object.assign(item, state); sessions.set(key, item);
      if (state.waiting && !state.acknowledged && state.eventId > item.seenEventId) {
        if (foreground(key)) item.seenEventId = state.eventId;
        else pending.set(key, item);
      } else pending.delete(key);
      pruneNotices(); syncFlash(); schedule(); return true;
    },
    setActive(key) {
      if (typeof key !== 'string' || key.length > 240 || /[\x00-\x1f\x7f]/.test(key)) throw new Error('Invalid active session.');
      if (key && !owner(key)) return false;
      active = key; bindWindow(); viewed(); schedule(); return true;
    },
    forget,
    clearProfile(id) { for (const key of sessions.keys()) if (key.startsWith(`${id}/`)) forget(key); schedule(); },
    refreshPreferences() {
      const p = prefs();
      if (!p.enabled) { for (const key of [...sessions.keys()]) forget(key); }
      else if (!p.desktop) { for (const notice of [...notices.keys()]) closeNotice(notice); }
      syncFlash(); schedule();
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (timer !== null) clearTimer(timer); timer = null;
      for (const notice of [...notices.keys()]) closeNotice(notice);
      sessions.clear(); pending.clear();
      watchedWindow?.removeListener('focus', viewed); watchedWindow?.removeListener('blur', syncFlash); watchedWindow = null;
      const win = getWindow(); if (win && !win.isDestroyed()) win.flashFrame(false);
    }
  };
}
module.exports = { createSessionNotifications, validateState };
