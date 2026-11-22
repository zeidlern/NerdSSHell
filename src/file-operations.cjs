'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { FileListings, browserToken } = require('./file-listings.cjs');
const { LocalFiles } = require('./local-files.cjs');
const sftp = require('./sftp-browser.cjs');
const transfer = require('./transfer.cjs');

function createFileOperations({ forKey, getRemote, dialog, getWindow, confirm, emit }, {
  listDirectory = sftp.listDirectory, download = sftp.download,
  upload = transfer.upload, captureUploadSource = transfer.captureUploadSource
} = {}) {
  const listings = new FileListings();
  const files = new LocalFiles(capturePane);
  const transfers = new Map();
  const pendingUploadApprovals = new Set();
  let choosing = false;

  function capturePane(key) {
    const { profile, remote } = forKey(key);
    if (profile.local) throw new Error('Use Windows Explorer for local files.');
    const profileId = profile.id, view = remote.views.get(key);
    const valid = () => getRemote(profileId) === remote && remote.connected && !remote.closing && remote.views.get(key) === view && !!view?.active;
    const validate = () => { if (!valid()) throw new Error('File operation session changed. Refresh and try again.'); };
    validate();
    return { key, profile, profileId, remote, view, valid, validate };
  }

  async function runTransfer({ key, profileId }, name, operation) {
    if (transfers.size >= 4) throw new Error('Wait for a file transfer to finish (limit four at once).');
    const controller = new AbortController(), transferId = randomUUID();
    transfers.set(transferId, { profileId, controller });
    const identity = { id: transferId, profileId, key };
    try {
      emit('transfer', { ...identity, status: 'starting', name });
      return await operation({ signal: controller.signal,
        progress: data => emit('transfer', { ...identity, status: 'running', ...data }) });
    } finally {
      transfers.delete(transferId);
      emit('transfer', { ...identity, status: 'finished' });
    }
  }

  async function approveUpload(owner, directory, selected) {
    const { remote } = owner;
    const controller = new AbortController();
    const approval = { key: owner.key, profileId: owner.profileId, controller };
    pendingUploadApprovals.add(approval);
    try {
      const accepted = await confirm('Upload files', `Upload ${selected.length} file(s) to ${remote.profile.name}?`, `${remote.profile.username}@${remote.profile.host}\nDestination: ${directory}\n\n${selected.join('\n')}\n\nFiles will not be executed.`, { signal: controller.signal, valid: owner.valid });
      return accepted && !controller.signal.aborted && owner.valid();
    } finally {
      pendingUploadApprovals.delete(approval);
    }
  }

  function cancelUploadApprovals(matches) {
    for (const approval of pendingUploadApprovals) if (matches(approval)) approval.controller.abort();
  }

  async function uploadSelection(owner, directory, selected, copy) {
    sftp.remotePath(directory);
    const { remote } = owner;
    const validateSelection = () => { copy?.localSelection.validate(); copy?.remoteSelection.validate(); };
    const validate = () => { owner.validate(); validateSelection(); };
    const revalidate = async sources => {
      validate();
      if (copy) await copy.localSelection.revalidate(sources);
      validate();
    };
    if (selected === null) {
      const picked = await dialog.showOpenDialog(getWindow(), { title: 'Upload files', properties: ['openFile', 'multiSelections'] });
      if (picked.canceled || !owner.valid()) return [];
      selected = picked.filePaths;
    }
    validate();
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > 50 || selected.some(file => typeof file !== 'string' || !path.isAbsolute(file) || file.length > 4096)) throw new Error('Invalid file selection.');
    const sources = await Promise.all(selected.map(captureUploadSource));
    if (!owner.valid()) return [];
    validateSelection();
    if (!await approveUpload(owner, directory, selected) || !owner.valid()) return [];
    await revalidate(sources);
    validate();
    return runTransfer(owner, path.basename(selected[0]), options => upload(remote, sources, { ...options, directory,
      confirmOverwrite: async target => {
        const accepted = await confirm('Replace existing remote file?', target, `Server: ${remote.profile.name}. The previous file will be replaced only after this upload completes.`);
        validate();
        if (accepted) await revalidate(sources);
        validate();
        return accepted;
      } }));
  }

  function downloadTo(owner, source, target) {
    return runTransfer(owner, sftp.downloadName(source), options => download(owner.remote, source, target, options));
  }

  function register(handle) {
    handle('upload', (key, dropped) => {
      const owner = capturePane(key);
      return uploadSelection(owner, owner.profile.uploadDirectory, dropped);
    });
    handle('listFiles', async (key, browserId, directory) => {
      sftp.remotePath(directory);
      const owner = capturePane(key);
      files.clearRemote(key, browserId);
      const result = await listings.run({ ...owner, browserId }, signal => listDirectory(owner.remote, directory, { signal }));
      owner.validate();
      files.rememberRemote(key, browserId, result);
      return result;
    });
    handle('cancelFileList', (key, browserId) => listings.cancel(key, browserId));
    handle('browserUpload', (key, directory, dropped) => uploadSelection(capturePane(key), directory, dropped));
    handle('downloadFile', async (key, source) => {
      sftp.remotePath(source);
      const owner = capturePane(key);
      const result = await dialog.showSaveDialog(getWindow(), {
        title: `Download from ${owner.remote.profile.name} (choose a new filename)`, defaultPath: sftp.downloadName(source)
      });
      if (result.canceled || !result.filePath) return null;
      owner.validate();
      return downloadTo(owner, source, result.filePath);
    });
    handle('localFilesList', (key, browserId, directory = '~') => files.list(key, browserId, directory));
    handle('localFilesChoose', async (key, browserId) => {
      const owner = capturePane(key);
      browserToken(browserId);
      if (choosing) throw new Error('Finish the folder picker first.');
      choosing = true;
      try {
        const selected = await dialog.showOpenDialog(getWindow(), { title: 'Choose Local folder for File SFTP', properties: ['openDirectory'] });
        if (selected.canceled) return null;
        owner.validate();
        return await files.list(key, browserId, '~', selected.filePaths[0]);
      } finally { choosing = false; }
    });
    handle('localFilesUpload', async (key, browserId, source, directory) => {
      sftp.remotePath(directory);
      const remoteSelection = files.captureRemote(key, browserId, directory, true);
      const localSelection = await files.capture(key, browserId, source);
      return uploadSelection(localSelection.owner, directory, [localSelection.selected.path], { localSelection, remoteSelection });
    });
    handle('localFilesDownload', async (key, browserId, source) => {
      sftp.remotePath(source);
      const remoteSelection = files.captureRemote(key, browserId, source);
      const localSelection = await files.capture(key, browserId), { owner } = localSelection;
      const target = path.join(localSelection.directory, sftp.downloadName(source));
      if (!await confirm('Copy Remote → Local?', 'Download this file without replacing an existing local file?', `${owner.remote.profile.username}@${owner.remote.profile.host}\nRemote: ${source}\nLocal: ${target}`)) return null;
      remoteSelection.validate();
      await localSelection.revalidate();
      localSelection.validate();
      remoteSelection.validate();
      return downloadTo(owner, source, target);
    });
    handle('cancelTransfer', transferId => transfers.get(transferId)?.controller.abort());
  }

  return {
    register,
    cancelView(key) {
      listings.cancelView(key);
      cancelUploadApprovals(approval => approval.key === key);
    },
    cancelProfile(profileId) {
      listings.cancelProfile(profileId);
      cancelUploadApprovals(approval => approval.profileId === profileId);
      for (const entry of transfers.values()) if (entry.profileId === profileId) entry.controller.abort();
    },
    abortTransfers() { for (const entry of transfers.values()) entry.controller.abort(); }
  };
}

module.exports = { createFileOperations };
