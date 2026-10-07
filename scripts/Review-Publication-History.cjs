'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
}
function review() {
  if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Error('Full history is required, not a shallow checkout.');
  const emails = new Set(git(['log', '--all', '--format=%ae%n%ce']).split(/\r?\n/).filter(Boolean));
  const personal = [...emails].filter(value => !/(?:@users\.noreply\.github\.com$|^noreply@github\.com$)/i.test(value));
  const ids = git(['rev-list', '--objects', '--all', '--no-object-names']).trim().split(/\r?\n/).filter(Boolean);
  const objects = git(['cat-file', '--batch-check'], {input: ids.join('\n') + '\n'}).trim().split(/\r?\n/).map(line => line.split(' '));
  const patterns = {
    email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig,
    private_ipv4: /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])/g,
    windows_home: /[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/ig
  };
  const summary = { commits: Number(git(['rev-list', '--all', '--count']).trim()), nonNoreplyEmailIdentities: personal.length, textBlobs: 0, binaryBlobsSkipped: 0, largeBlobsSkipped: 0, matches: {} };
  const findings = [];
  for (const [sha, type, size] of objects) {
    if (type !== 'blob') continue;
    if (Number(size) > 2 * 1024 * 1024) { summary.largeBlobsSkipped++; continue; }
    const bytes = git(['cat-file', 'blob', sha], {encoding: 'buffer', maxBuffer: 3 * 1024 * 1024});
    if (bytes.includes(0)) { summary.binaryBlobsSkipped++; continue; }
    const text = bytes.toString('utf8'); summary.textBlobs++;
    for (const [category, pattern] of Object.entries(patterns)) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        summary.matches[category] = (summary.matches[category] || 0) + 1;
        findings.push({blob: sha, category, line: text.slice(0, match.index).split('\n').length});
      }
    }
  }
  return { summary, findings, limitations: 'Redacted triage, not clearance. No email/IP/path values are emitted. Review upstream notices, synthetic fixtures and actual personal data separately. Large/binary blobs, images, PR text, logs, artifacts and other refs not fetched need independent review. Gitleaks is a separate secret-pattern check.' };
}
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Supply a NEW report filename outside tracked source.');
    const result = review();
    fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify(result.summary));
    console.log('Privacy triage complete; matches need human review. This is NOT public-release clearance.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { review };
