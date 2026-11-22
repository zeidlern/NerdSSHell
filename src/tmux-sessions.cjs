'use strict';
const { randomUUID } = require('node:crypto');
const { geometry, id, sessionName, shellQuote: q } = require('./core.cjs');
const { MAX_DISCOVERED_PANES, resourceLimitError } = require('./session-limits.cjs');

const SESSION_IDENTITY_OPTION = '@nerdsshell-id';
const LEGACY_SESSION_IDENTITY_OPTION = '@betterssh-id';
const SESSION_IDENTITY_FORMAT = `#{${SESSION_IDENTITY_OPTION}}|#{${LEGACY_SESSION_IDENTITY_OPTION}}`;
const SESSION_TOKEN = /^[a-f0-9-]{36}$/;
const IDENTITY_CHANGED = 'NERDSSHELL_IDENTITY_CHANGED';

function parseSessionIdentity(value) {
  const pair = value.split('|');
  if (pair.length > 2) throw new Error('Invalid session identity.');
  // Old 13-column records used only the legacy token in this column.
  const [current, legacy] = pair.length === 1 ? ['', pair[0]] : pair;
  for (const token of [current, legacy]) if (token && !SESSION_TOKEN.test(token)) throw new Error('Invalid session identity.');
  if (current && legacy && current !== legacy) throw new Error('Conflicting remote session identities. No session was changed.');
  return { sessionToken: current || legacy, sessionIdentityOption: current ? SESSION_IDENTITY_OPTION : legacy ? LEGACY_SESSION_IDENTITY_OPTION : null };
}

// tmux 3.6 replaces literal tabs in list formats with underscores. Its q:
// modifier escapes every pipe in a name, so quoted text cannot contain " | ".
const PANE_SEPARATOR = ' | ';
const PANE_FORMAT = [
  '#{session_id}', '#{q:session_name}', '#{window_id}', '#{window_index}', '#{q:window_name}',
  '#{pane_id}', '#{pane_index}', '#{pane_width}', '#{pane_height}', '#{pane_dead}',
  SESSION_IDENTITY_FORMAT, '#{window_panes}', '#{q:pane_current_command}'
].join(PANE_SEPARATOR);

function unescapeFormat(value) { return value.replace(/\\(.)/g, '$1'); }

function parsePanes(data) {
  const panes = [];
  for (const line of data.replace(/\n+$/, '').split('\n')) {
    if (!line) continue;
    if (panes.length >= MAX_DISCOVERED_PANES) throw resourceLimitError(`The server session list exceeds the ${MAX_DISCOVERED_PANES}-pane safety limit. No sessions were changed.`);
    const fields = line.split(PANE_SEPARATOR);
    if (fields.length !== 13) throw new Error('The server returned an unrecognized session list.');
    panes.push({ sessionId: id(fields[0], '$'), sessionName: unescapeFormat(fields[1]), windowId: id(fields[2], '@'),
      windowIndex: Number(fields[3]), windowName: unescapeFormat(fields[4]), paneId: id(fields[5], '%'), paneIndex: Number(fields[6]),
      ...geometry(Number(fields[7]), Number(fields[8])),
      dead: fields[9] === '1', ...parseSessionIdentity(fields[10]), windowPanes: Number(fields[11]), command: unescapeFormat(fields[12]) });
  }
  return panes;
}

function paneKey(profileId, token, paneId) {
  if (!SESSION_TOKEN.test(token)) throw new Error('Invalid session identity.');
  id(paneId, '%');
  return `${profileId}/${token}/${paneId}`;
}

function identityCondition(pane) {
  // Legacy-only pane records remain usable with their original stable token.
  const observed = pane.sessionIdentityOption || LEGACY_SESSION_IDENTITY_OPTION;
  if (![SESSION_IDENTITY_OPTION, LEGACY_SESSION_IDENTITY_OPTION].includes(observed)) throw new Error('Invalid session identity marker.');
  if (!SESSION_TOKEN.test(pane.sessionToken)) throw new Error('Invalid session identity.');
  const other = observed === SESSION_IDENTITY_OPTION ? LEGACY_SESSION_IDENTITY_OPTION : SESSION_IDENTITY_OPTION;
  return `#{&&:#{==:#{${observed}},${pane.sessionToken}},#{||:#{==:#{${other}},},#{==:#{${other}},${pane.sessionToken}}}}`;
}

function guardedBranch(condition, command) {
  return `${q(condition)} ${q(command)} ${q('display-message -p ' + IDENTITY_CHANGED)}`;
}

function assignIdentity(sessionId) {
  const token = randomUUID();
  // Publish the legacy marker first. A set-option hook may yield between commands,
  // so recheck that the current marker is empty and the legacy marker still agrees.
  const bothEmpty = `#{&&:#{==:#{${SESSION_IDENTITY_OPTION}},},#{==:#{${LEGACY_SESSION_IDENTITY_OPTION}},}}`;
  const legacyAssigned = `#{&&:#{==:#{${SESSION_IDENTITY_OPTION}},},#{==:#{${LEGACY_SESSION_IDENTITY_OPTION}},${token}}}`;
  const setCurrent = `set-option -o -t ${sessionId} ${SESSION_IDENTITY_OPTION} ${token}`;
  const publishCurrent = `if-shell -F -t ${sessionId} ${guardedBranch(legacyAssigned, setCurrent)}`;
  const assign = `set-option -o -t ${sessionId} ${LEGACY_SESSION_IDENTITY_OPTION} ${token} ; ${publishCurrent}`;
  return `if-shell -F -t ${q(sessionId)} ${guardedBranch(bothEmpty, assign)}`;
}

class TmuxSessions {
  #prefix;
  #profileId;
  #exec;
  #checked;

  constructor({ prefix, profileId, exec, checked }) {
    this.#prefix = prefix;
    this.#profileId = profileId;
    this.#exec = exec;
    this.#checked = checked;
  }

  async discover(assertCurrent) {
    assertCurrent();
    const command = `${this.#prefix} list-panes -a -F ${q(PANE_FORMAT)}`;
    const listing = await this.#exec(command);
    assertCurrent();
    if (listing.code !== 0) {
      if (/no server running|No such file or directory|no sessions/i.test(listing.stderr)) return [];
      throw new Error(listing.stderr.trim() || 'Could not discover persistent sessions.');
    }
    let panes = parsePanes(listing.stdout);
    // Discovery only assigns missing metadata. Legacy-only sessions retain their
    // existing marker. A concurrent assignment is resolved by reading back once.
    const unmarked = new Set(panes.filter(pane => !pane.sessionToken).map(pane => pane.sessionId));
    for (const sessionId of unmarked) {
      assertCurrent();
      await this.#checked(`${this.#prefix} ${assignIdentity(sessionId)}`);
      assertCurrent();
    }
    if (unmarked.size) {
      panes = parsePanes(await this.#checked(command));
      assertCurrent();
    }
    return panes.map(pane => ({ ...pane, profileId: this.#profileId, key: paneKey(this.#profileId, pane.sessionToken, pane.paneId) }));
  }

  async #verify(pane, assertCurrent, changed) {
    const target = id(pane.sessionId, '$');
    const value = await this.#checked(`${this.#prefix} display-message -p -t ${q(target)} ${q(SESSION_IDENTITY_FORMAT)}`);
    assertCurrent();
    const observed = parseSessionIdentity(value.trim());
    if (observed.sessionToken !== pane.sessionToken ||
        (pane.sessionIdentityOption === SESSION_IDENTITY_OPTION && observed.sessionIdentityOption !== SESSION_IDENTITY_OPTION)) {
      throw new Error(changed);
    }
  }

  async #guardedChange(pane, command, changed, assertCurrent) {
    const target = id(pane.sessionId, '$');
    const branches = guardedBranch(identityCondition(pane), command);
    const result = await this.#checked(`${this.#prefix} if-shell -F -t ${q(target)} ${branches}`);
    assertCurrent?.();
    if (result.includes(IDENTITY_CHANGED)) throw new Error(changed);
  }

  async prepareAttachment(pane, assertCurrent) {
    const changed = 'The session identity changed. Refresh the session list before attaching.';
    await this.#verify(pane, assertCurrent, changed);
    assertCurrent();
    // Only adjust the identified session so detaching keeps remote work alive.
    await this.#guardedChange(pane, `set-option -t ${pane.sessionId} destroy-unattached off`, changed, assertCurrent);
  }

  verifyAttachment(pane, assertCurrent) {
    return this.#verify(pane, assertCurrent, 'The session identity changed during attachment. Refresh the session list before opening.');
  }

  rename(pane, name) {
    sessionName(name);
    return this.#guardedChange(pane, `rename-session -t ${pane.sessionId} ${q(name)}`, 'The remote session identity changed. It was not renamed.');
  }

  end(pane) {
    // Evaluate identity and termination in one server command to guard ID reuse.
    return this.#guardedChange(pane, `kill-session -t ${pane.sessionId}`, 'The remote session identity changed. It was not terminated.');
  }
}

module.exports = { TmuxSessions, parsePanes, paneKey };
