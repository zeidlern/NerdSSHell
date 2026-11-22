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
  let choosing = false;

  function captureConnection(key) {
    const { profile, remote } = forKey(key);
    const valid = () => getRemote(profile.id) === remote && remote.connected && !remote.closing;
    const validate = () => { if (!valid()) throw new Error('Server connection changed. Refresh and try again.'); };
    return { key, profile, profileId: profile.id, remote, valid, validate };
  }

  function capturePane(key) {
    const owner = captureConnection(key);
    if (owner.profile.local) throw new Error('Use Windows Explorer for local files.');
    const view = owner.remote.views.get(key);
    const valid = () => owner.valid() && owner.remote.views.get(key) === view && !!view?.active;
    const validate = () => { if (!valid()) throw new Error('File-browser session changed. Refresh and try again.'); };
    validate();
    return { ...owner, view, valid, validate };
  }

  async function runTransfer({ key, profileId }, name, operation) {
    if (transfers.size >= 4) throw new Error('Wait for a file transfer to finish (limit four at once).');
    const controller = new AbortController(), id = randomUUID();
    transfers.set(id, { profileId, controller });
    const identity = { id, profileId, key };
    try {
      emit('transfer', { ...identity, status: 'starting', name });
      return await operation({ signal: controller.signal,
        progress: data => emit('transfer', { ...identity, status: 'running', ...data }) });
    } finally {
      transfers.delete(id);
      emit('transfer', { ...identity, status: 'finished' });
    }
  }

  async function uploadSelection(owner, directory, selected, copy) {
    sftp.remotePath(directory);
    const { remote } = owner;
    const validate = () => { owner.validate(); copy?.local.validate(); copy?.remote.validate(); };
    const revalidate = async sources => {
      validate();
      if (copy) await copy.local.revalidate(sources);
      validate();
    };
    if (selected === null) {
      const picked = await dialog.showOpenDialog(getWindow(), { title: 'Upload files', properties: ['openFile', 'multiSelections'] });
      if (picked.canceled) return [];
      selected = picked.filePaths;
    }
    validate();
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > 50 || selected.some(file => typeof file !== 'string' || !path.isAbsolute(file) || file.length > 4096)) throw new Error('Invalid file selection.');
    const sources = await Promise.all(selected.map(captureUploadSource));
    validate();
    if (!await confirm('Upload files', `Upload ${selected.length} file(s) to ${remote.profile.name}?`, `${remote.profile.username}@${remote.profile.host}\nDestination: ${directory}\n\n${selected.join('\n')}\n\nFiles will not be executed.`)) return [];
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
      const owner = captureConnection(key);
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
    handle('localFilesList', (key, id, directory = '~') => files.list(key, id, directory));
    handle('localFilesChoose', async (key, id) => {
      const owner = capturePane(key);
      browserToken(id);
      if (choosing) throw new Error('Finish the folder picker first.');
      choosing = true;
      try {
        const selected = await dialog.showOpenDialog(getWindow(), { title: 'Choose Local folder for File SFTP', properties: ['openDirectory'] });
        if (selected.canceled) return null;
        owner.validate();
        return await files.list(key, id, '~', selected.filePaths[0]);
      } finally { choosing = false; }
    });
    handle('localFilesUpload', async (key, id, source, directory) => {
      sftp.remotePath(directory);
      const remote = files.captureRemote(key, id, directory, true), local = await files.capture(key, id, source);
      return uploadSelection(local.owner, directory, [local.selected.path], { local, remote });
    });
    handle('localFilesDownload', async (key, id, source) => {
      sftp.remotePath(source);
      const remote = files.captureRemote(key, id, source), local = await files.capture(key, id), { owner } = local;
      const target = path.join(local.directory, sftp.downloadName(source));
      if (!await confirm('Copy Remote → Local?', 'Download this file without replacing an existing local file?', `${owner.remote.profile.username}@${owner.remote.profile.host}\nRemote: ${source}\nLocal: ${target}`)) return null;
      remote.validate();
      await local.revalidate();
      local.validate();
      remote.validate();
      return downloadTo(owner, source, target);
    });
    handle('cancelTransfer', id => transfers.get(id)?.controller.abort());
  }

  return {
    register,
    cancelView: key => listings.cancelView(key),
    cancelProfile(id) {
      listings.cancelProfile(id);
      for (const entry of transfers.values()) if (entry.profileId === id) entry.controller.abort();
    },
    abortTransfers() { for (const entry of transfers.values()) entry.controller.abort(); }
  };
}

module.exports = { createFileOperations };
