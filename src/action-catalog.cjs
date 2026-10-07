'use strict';
const { randomUUID } = require('node:crypto');
const { shellQuote: q } = require('./core.cjs');
const MAX_SCRIPT = 32768;
function scriptText(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > MAX_SCRIPT) throw new Error('Enter a command of at most 32 KiB.');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)) throw new Error('Command contains terminal controls or invisible direction overrides.');
  return value.replace(/\r\n?/g, '\n');
}
function parameter(value, kind) {
  if (typeof value !== 'string' || value.length > 128) throw new Error('Enter a valid service or container name.');
  const pattern = kind === 'container' ? /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/ : /^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,127}$/;
  if (!pattern.test(value)) throw new Error('Use the exact name, without spaces, options or shell punctuation.');
  return q(value);
}
const PROBE_TOOLS = Object.freeze(['apt', 'dnf', 'pacman', 'checkupdates', 'systemctl', 'journalctl', 'docker', 'free', 'ip', 'ss', 'softwareupdate', 'sudo', 'shutdown', 'rpm-ostree', 'bootc']);
const PROBE = `/bin/sh -c ${q(`printf 'system:'; uname -s
if [ -r /etc/os-release ]; then cat /etc/os-release; fi
for tool in ${PROBE_TOOLS.join(' ')}; do
  if command -v "$tool" >/dev/null 2>&1; then printf '\\ncap:%s\\n' "$tool"; fi
done
if [ -d /run/systemd/system ]; then printf '\\ncap:systemd\\n'; fi`)}`;
function parsePlatform(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16384) throw new Error('Platform response exceeded its limit.');
  const systems = [...new Set([...text.matchAll(/^system:([^\r\n]+)[ \t]*$/gm)].map(m => m[1].trim()))];
  const ids = [...new Set([...text.matchAll(/^ID=["']?([a-z0-9_-]+)["']?[ \t]*\r?$/gm)].map(m => m[1]))];
  // Conflicting login banners or identity data must not select the first match.
  if (systems.length !== 1 || !['Linux', 'Darwin'].includes(systems[0]) || ids.length > 1) return { system: 'unknown', id: '', caps: [] };
  const caps = [...new Set([...text.matchAll(/^cap:([a-z0-9-]+)[ \t]*\r?$/gm)].map(m => m[1]).filter(c => PROBE_TOOLS.includes(c) || c === 'systemd'))];
  return { system: systems[0], id: ids[0] || '', caps };
}
const SEARCH_TERMS = Object.freeze({
  'system.info': 'about computer version uptime operating system', 'system.disk': 'drive properties storage free space explorer',
  'system.memory': 'task manager ram memory', 'system.processes': 'task manager cpu programs processes',
  'network.addresses': 'ipconfig network adapters ip addresses', 'network.ports': 'netstat tcp udp listening ports',
  'updates.check': 'windows update patches available upgrades', 'updates.install': 'windows update patches install upgrades',
  'admin.authenticate': 'administrator sudo elevation credentials authenticate', 'services.list': 'services msc service manager',
  'services.status': 'service status inspect', 'services.logs': 'event viewer journal logs',
  'services.restart': 'restart service', 'docker.list': 'docker containers', 'docker.logs': 'container logs event viewer',
  'docker.restart': 'restart container', 'system.reboot': 'reboot restart computer', 'system.shutdown': 'shutdown power off computer'
});
const actions = [
  ['system.info', 'System information', 'System', 'See operating system, kernel and uptime.', 'info'],
  ['system.disk', 'Disk space', 'System', 'See free and used space. Like drive properties in Explorer.', 'info'],
  ['system.memory', 'Memory usage', 'System', 'Inspect memory pressure without stopping anything.', 'info'],
  ['system.processes', 'Running processes', 'System', 'A read-only view similar to Task Manager.', 'info'],
  ['network.addresses', 'Network addresses', 'Network', 'Show interface addresses, similar to ipconfig.', 'info'],
  ['network.ports', 'Listening ports', 'Network', 'Show listening sockets; not a firewall change.', 'info'],
  ['updates.check', 'Check available updates', 'Updates', 'List updates. Some systems use cached package metadata.', 'info'],
  ['updates.install', 'Install system updates', 'Updates', 'Upgrade packages after review. Updates may restart services or interrupt sessions; keep backups and recovery access.', 'disruptive'],
  ['admin.authenticate', 'Authenticate administrator access', 'Administrator', 'Run sudo -v in this console. Its cache is not a Windows-style global elevation token.', 'change'],
  ['services.list', 'List services', 'Services', 'List loaded systemd services, or Windows services on this PC.', 'info'],
  ['services.status', 'Inspect a service', 'Services', 'Show the state of one systemd service.', 'info', 'service'],
  ['services.logs', 'Recent service logs', 'Services', 'Show the last 200 journal entries; no endless stream.', 'info', 'service'],
  ['services.restart', 'Restart a service', 'Services', 'Restart one service. Connections or jobs using it may stop.', 'disruptive', 'service'],
  ['docker.list', 'List containers', 'Containers', 'Show containers using your existing Docker permissions.', 'info'],
  ['docker.logs', 'Recent container logs', 'Containers', 'Show the last 200 lines of a container log.', 'info', 'container'],
  ['docker.restart', 'Restart a container', 'Containers', 'Restart one container. Work in it may stop.', 'disruptive', 'container'],
  ['system.reboot', 'Restart this computer', 'System', 'Reboot the selected remote computer. All sessions and jobs may stop.', 'disruptive'],
  ['system.shutdown', 'Shut down this computer', 'System', 'Power off the selected remote computer. Remote access may require someone to turn it on.', 'disruptive']
].map(([id, title, group, description, risk, argument]) => Object.freeze({ id, title, group, description, risk, argument: argument || null, keywords: SEARCH_TERMS[id] || '' }));
function updateManager(facts) {
  const caps = facts.caps || [];
  if (caps.some(c => ['rpm-ostree', 'bootc'].includes(c))) throw new Error('Image-based update tooling detected. Guided package upgrades are not supported; use this OS vendor’s procedure.');
  const families = { apt: ['ubuntu', 'debian', 'linuxmint', 'pop', 'kali', 'raspbian'],
    dnf: ['fedora', 'rhel', 'centos', 'rocky', 'almalinux', 'ol', 'amzn'],
    pacman: ['arch', 'manjaro', 'endeavouros', 'cachyos'] };
  const expected = Object.keys(families).find(manager => families[manager].includes(facts.id));
  if (expected) {
    if (!caps.includes(expected)) throw new Error('The expected package manager was not found. No alternative is guessed.');
    return expected;
  }
  const detected = ['apt', 'dnf', 'pacman'].filter(c => caps.includes(c));
  if (detected.length !== 1) throw new Error('No unambiguous supported package manager. Review the distribution’s update procedure.');
  return detected[0];
}
function compileAction(id, facts, argument = '') {
  const action = actions.find(a => a.id === id); if (!action) throw new Error('Unknown action.');
  const local = facts.system === 'Windows', cmd = local && facts.shell === 'cmd', linux = facts.system === 'Linux', mac = facts.system === 'Darwin';
  if (local && facts.shell !== undefined && !['cmd', 'powershell'].includes(facts.shell)) throw new Error('This Windows shell is not supported by Actions.');
  const has = tool => (facts.caps || []).includes(tool);
  let code, note = '';
  if (local) {
    const localCommands = cmd ? {
      'system.info': 'ver & systeminfo',
      'system.disk': 'dir',
      'system.memory': 'systeminfo',
      'system.processes': 'tasklist',
      'network.addresses': 'ipconfig',
      'network.ports': 'netstat -ano | findstr /C:"LISTENING" /C:"UDP"',
      'updates.check': 'start "" ms-settings:windowsupdate',
      'services.list': 'sc query type= service state= all'
    } : {
      'system.info': '$PSVersionTable; Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, LastBootUpTime',
      'system.disk': 'Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name="UsedGiB";Expression={[math]::Round($_.Used/1GB,2)}}, @{Name="FreeGiB";Expression={[math]::Round($_.Free/1GB,2)}}, Root',
      'system.memory': 'Get-CimInstance Win32_OperatingSystem | Select-Object @{Name="TotalMiB";Expression={[math]::Round($_.TotalVisibleMemorySize/1KB,1)}}, @{Name="FreeMiB";Expression={[math]::Round($_.FreePhysicalMemory/1KB,1)}}',
      'system.processes': 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 Name, Id, @{Name="CPUSeconds";Expression={$_.CPU}}, @{Name="WorkingSetMiB";Expression={[math]::Round($_.WorkingSet64/1MB,1)}}',
      'network.addresses': 'Get-NetIPConfiguration',
      'network.ports': 'Get-NetTCPConnection -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess',
      'updates.check': "Start-Process 'ms-settings:windowsupdate'",
      'services.list': 'Get-Service | Sort-Object Status, DisplayName'
    };
    code = localCommands[id];
    if (cmd && id === 'system.disk') note = 'Shows the current directory and free bytes on its drive. Change drive or directory in this session to inspect another location.';
    if (cmd && id === 'system.memory') note = 'System Information includes physical and virtual memory along with other operating-system details.';
    if (cmd && id === 'system.processes') note = 'Lists process IDs and memory use. It does not rank processes by current CPU usage.';
    if (!cmd && id === 'system.processes') note = 'CPUSeconds is cumulative CPU time, not current percent utilization. Protected processes may expose fewer details.';
    if (id === 'updates.check') note = 'Opens Windows Update settings. It does not install updates automatically.';
  } else if (linux || mac) {
    const common = { 'system.info': 'uname -a; uptime', 'system.disk': 'df -h',
      'system.processes': mac ? 'ps -axo pid,user,pcpu,pmem,etime,comm | head -n 41' : 'ps -eo pid,user,pcpu,pmem,etime,comm --sort=-pcpu | head -n 41',
      'admin.authenticate': 'sudo -v', 'system.reboot': 'sudo shutdown -r now', 'system.shutdown': 'sudo shutdown -h now' };
    code = common[id];
    if (id === 'system.memory') code = mac ? 'vm_stat' : has('free') ? 'free -h' : 'cat /proc/meminfo';
    if (id === 'network.addresses') code = mac ? 'ifconfig' : has('ip') ? 'ip -brief address' : undefined;
    if (id === 'network.ports') code = mac ? 'lsof -nP -iTCP -sTCP:LISTEN' : has('ss') ? 'ss -lntu' : undefined;
    if (id.startsWith('services.') && linux && (id === 'services.logs' ? has('journalctl') : has('systemctl') && has('systemd'))) {
      const service = action.argument ? parameter(argument, 'service') : '';
      code = { 'services.list': 'systemctl list-units --type=service --all --no-pager',
        'services.status': `systemctl status --no-pager -- ${service}`,
        'services.logs': `journalctl --no-pager -n 200 -u ${service}`,
        'services.restart': `sudo systemctl restart -- ${service}` }[id];
      if (id === 'services.list') note = 'Lists loaded units, including inactive loaded services; this is not an inventory of every installed unit file.';
      if (id === 'services.status') note = 'A nonzero status may mean the service is inactive, failed or missing. Read its state, not just the exit code.';
      if (id === 'services.logs') note = 'Only logs readable by your current account are shown. Elevation is not added silently.';
    }
    if (id.startsWith('docker.') && has('docker')) {
      const container = action.argument ? parameter(argument, 'container') : '';
      code = { 'docker.list': 'docker ps -a', 'docker.logs': `docker logs --tail 200 -- ${container}`, 'docker.restart': `docker restart -- ${container}` }[id];
      note = 'Uses existing Docker permissions and the account’s configured Docker context, which may point to another computer. Verify that context before restarting anything. The SSH destination label is not proof of the Docker daemon location; no privileges are granted.';
    }
    if (id.startsWith('updates.')) {
      const install = id === 'updates.install';
      if (mac && has('softwareupdate')) code = install ? 'sudo softwareupdate --install --all' : 'softwareupdate --list';
      else if (linux && updateManager(facts) === 'apt') { code = install ? 'sudo apt update && sudo apt upgrade' : 'apt list --upgradable'; if (!install) note = 'Lists upgrades using existing metadata. Install updates refreshes that metadata first.'; }
      else if (linux && updateManager(facts) === 'dnf') { code = install ? 'sudo dnf upgrade --refresh' : 'dnf check-update'; if (!install) note = 'dnf exit code 100 means updates are available, not a failed query. Metadata may be refreshed; no packages are installed.'; }
      else if (linux && updateManager(facts) === 'pacman') {
        code = install ? 'sudo pacman -Syu' : has('checkupdates') ? 'checkupdates' : undefined;
        note = install ? 'Performs a full system upgrade. Never refreshes the live database without upgrading.' : 'Requires the separately installed checkupdates utility; the app does not install it silently. Exit 2 means no updates. The utility uses a separate temporary package database.';
      }
    }
    if (code?.startsWith('sudo ') && !has('sudo')) throw new Error('sudo was not found. Administrator actions are unavailable; the app will not substitute another elevation method.');
    if (['system.reboot', 'system.shutdown'].includes(id) && !has('shutdown')) throw new Error('The shutdown tool was not found. No power command is guessed.');
    if (id === 'updates.install') note += (note ? ' ' : '') + 'Package prompts remain interactive. Updates can restart services or interrupt SSH. NerdSSHell does not request a reboot, but package scripts and system policy still apply.';
    if (['system.reboot', 'system.shutdown'].includes(id)) note = 'This affects the whole remote computer, including other users and all persistent jobs. Persistence does not survive a server reboot. Ensure another way to recover access.';
    if (id === 'admin.authenticate') note = 'Authentication is scoped to the executing console under common sudo policies. Other consoles may ask again; expiry depends on server policy. Continue administrative commands in this console. No password is stored and no expiry timer is guessed.';
  }
  if (!code) throw new Error(facts.system === 'unknown' ? 'Detect a supported operating system first, or review your own command.' : 'This action is unavailable on this platform or a required tool is missing.');
  return { ...action, code: scriptText(code), shell: local ? (cmd ? 'cmd' : 'powershell') : 'posix', note };
}
function availableActions(facts) {
  return actions.map(a => { try { compileAction(a.id, facts, a.argument ? 'example' : ''); return { ...a, enabled: true }; }
    catch (e) { return { ...a, enabled: false, reason: e.message }; } });
}
function commandWarnings(code, shell) {
  scriptText(code); const warnings = [];
  if (shell === 'powershell' && /(^|\n)\s*(sudo\s|apt\s|systemctl\s|journalctl\s|export\s)/m.test(code)) warnings.push('Looks like a Unix command, but the selected destination is local PowerShell. Check the target.');
  if (shell === 'posix' && /\b(Get-Process|Get-Service|Get-CimInstance|Set-ExecutionPolicy|Write-Host)\b/i.test(code)) warnings.push('Looks like PowerShell, but this remote task uses /bin/sh. Check the target and syntax.');
  if (shell === 'cmd' && /(?:\b(?:Get-Process|Get-Service|Get-CimInstance|Set-ExecutionPolicy|Write-Host)\b|\$PSVersionTable\b)/i.test(code)) warnings.push('Looks like PowerShell, but the selected destination is Command Prompt. Check the shell and syntax.');
  if (/(?:curl|wget|Invoke-WebRequest|irm|iwr)\b[\s\S]*\|\s*(?:sudo\s+)?(?:sh|bash|iex|Invoke-Expression)\b/i.test(code)) warnings.push('Downloads code and executes it. Review the source first.');
  if (/\b(?:sudo|Remove-Item|rm\s|shutdown|reboot|mkfs|dd\s|chmod|chown|Set-ExecutionPolicy)\b/i.test(code)) warnings.push('May change permissions, delete data, elevate privileges or interrupt this computer.');
  if (/^\s*(?:PS\s+[^>]+>|\$\s|[^\s]+@[^\s]+:[^\n]*[#$]\s)/m.test(code)) warnings.push('May include a copied prompt. Prompts are not removed automatically.');
  warnings.push('Pattern checks cannot prove a command safe. It runs with the selected account’s permissions.');
  return warnings;
}
function taskCommand(code) {
  code = scriptText(code);
  // Run in a fresh task, never send script bytes to a pre-existing interactive pane.
  return `/bin/sh -c ${q(`(\n${code}\n)\nnerdsshell_task_status=$?\nprintf '\\n[NerdSSHell] Command exited with status %s. This console remains open.\\n' "$nerdsshell_task_status"\nexec /bin/sh -i`)}`;
}
class ReviewTickets {
  constructor({ now = Date.now } = {}) { this.items = new Map(); this.now = now; }
  issue(plan, owner) {
    for (const [k, v] of this.items) if (!v.taken && v.expires <= this.now()) this.items.delete(k);
    if (this.items.size >= 16) throw new Error('Too many pending reviews. Close or complete one first.');
    const token = randomUUID(); this.items.set(token, { plan: Object.freeze({ ...plan }), owner, expires: this.now() + 300000 }); return token;
  }
  take(token) {
    const item = this.items.get(token);
    if (!item || item.taken) throw new Error('Command review expired or was already used. Review again.');
    // Keep reserved reviews tracked while native confirmation is open. They
    // remain cancellable and count toward the bounded review budget.
    item.taken = true;
    try { this.validate(token, item); } catch (error) { this.cancel(token); throw error; }
    return item;
  }
  validate(token, item) {
    if (!item || this.items.get(token) !== item || item.expires <= this.now()) throw new Error('Command review expired or was cancelled. Review again.');
    item.owner.validate();
  }
  cancel(token) { this.items.delete(token); }
}
module.exports = { MAX_SCRIPT, actions, PROBE, parsePlatform, availableActions, compileAction, scriptText, taskCommand, commandWarnings, ReviewTickets };
