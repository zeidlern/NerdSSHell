'use strict';

const SSH_CLOSE_GRACE_MS = 2000;

function closeSshTransport(client, { graceMs = SSH_CLOSE_GRACE_MS } = {}) {
  if (!client) return;
  // ssh2 1.17.0's Client.destroy() checks isWritable and is a no-op after
  // Client.end(). Pin only this Client's owned socket before ending writes.
  const socket = client._sock;
  if (socket?.destroyed) return;
  if (typeof socket?.destroy !== 'function' && typeof client.destroy !== 'function') { client.end(); return; }
  let closed = false, timer;
  const cleanup = () => { clearTimeout(timer); client.off?.('close', done); socket?.off?.('close', done); };
  const done = () => { closed = true; cleanup(); };
  const force = () => {
    if (closed) return;
    done();
    // The captured socket remains ours even if a caller starts a new Client.
    if (socket) socket.destroy(); else client.destroy();
  };
  client.once?.('close', done); socket?.once?.('close', done);
  timer = setTimeout(force, graceMs); timer.unref?.();
  try { client.end(); } catch { force(); }
}

module.exports = { closeSshTransport, SSH_CLOSE_GRACE_MS };
