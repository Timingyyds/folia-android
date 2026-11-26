const crypto = require('crypto');
const fs = require('fs');

// electron/videoExportFileWriter.cjs
// Streams MediaRecorder chunks from the renderer straight to disk so a long or high-resolution
// export never has to exist as one in-memory buffer (renderer Blob -> ArrayBuffer -> single IPC
// message -> main-process Buffer copy), which is what broke large exports. Chunks land in a
// sibling `.part` file that is renamed onto the chosen path only once the recording finished,
// so a cancelled or failed export never clobbers an existing file at that path.

const PART_FILE_SUFFIX = '.part';

const toBuffer = (data) => {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return null;
};

/**
 * Owns at most one export file at a time. `finalizeFile(handle)` runs on the finished partial
 * file before it is renamed (e.g. to rewrite container metadata that is only known once
 * recording ended); it gets a read/write handle and its failure is logged, not fatal — the
 * recording itself is intact and still worth keeping. Each `open` returns an opaque session id that the
 * renderer passes back with every chunk; opening a new session aborts any stale one (e.g. a
 * renderer reload mid-export) so its handle and `.part` file do not leak.
 */
function createVideoExportFileWriter({
  fsp = fs.promises,
  fsSync = fs,
  finalizeFile = null,
  logger = console,
} = {}) {
  let session = null;

  const requireSession = (id) => {
    if (!session || session.id !== id) {
      throw new Error('Video export file session is not open.');
    }
    return session;
  };

  // Closes the handle and deletes the partial file; never throws.
  const discard = async (target) => {
    await target.queue.catch(() => {});
    await target.handle.close().catch(() => {});
    await fsp.unlink(target.partPath).catch(() => {});
  };

  const open = async (filePath) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Missing video export path.');
    }

    if (session) {
      const stale = session;
      session = null;
      await discard(stale);
    }

    const partPath = `${filePath}${PART_FILE_SUFFIX}`;
    const handle = await fsp.open(partPath, 'w+');
    session = {
      id: crypto.randomUUID(),
      filePath,
      partPath,
      handle,
      bytesWritten: 0,
      // Writes are chained so chunks hit the file in arrival order even though each IPC
      // handler is async; the first failure poisons the chain and surfaces on every later call.
      queue: Promise.resolve(),
    };
    return session.id;
  };

  // Async so validation errors reject like write errors; the chain link itself is attached
  // synchronously, before the first await, which is what preserves arrival order.
  const append = async (id, data) => {
    const target = requireSession(id);
    const buffer = toBuffer(data);
    if (!buffer) {
      throw new Error('Video export chunk must be binary data.');
    }

    let totalAfterChunk = 0;
    target.queue = target.queue.then(async () => {
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await target.handle.write(buffer, offset, buffer.length - offset);
        offset += bytesWritten;
      }
      target.bytesWritten += buffer.length;
      totalAfterChunk = target.bytesWritten;
    });
    await target.queue;
    return totalAfterChunk;
  };

  const finish = async (id) => {
    const target = requireSession(id);
    session = null;
    let finalized = false;
    try {
      await target.queue;
      if (finalizeFile) {
        try {
          finalized = Boolean(await finalizeFile(target.handle));
        } catch (error) {
          logger.warn('[VideoExport] Could not finalize the recorded file; keeping it as recorded', error);
        }
      }
      await target.handle.close();
    } catch (error) {
      await discard(target);
      throw error;
    }
    await fsp.rename(target.partPath, target.filePath);
    return { filePath: target.filePath, bytesWritten: target.bytesWritten, finalized };
  };

  const abort = async (id) => {
    if (!session || session.id !== id) {
      return false;
    }
    const target = session;
    session = null;
    await discard(target);
    return true;
  };

  // Synchronous best-effort cleanup for app quit, where async work may never complete.
  const disposeSync = () => {
    if (!session) return;
    const target = session;
    session = null;
    try {
      fsSync.closeSync(target.handle.fd);
    } catch {
      // The handle may already be closing; the unlink below is what matters.
    }
    try {
      fsSync.unlinkSync(target.partPath);
    } catch {
      // Nothing to clean up.
    }
  };

  return {
    open,
    append,
    finish,
    abort,
    disposeSync,
  };
}

module.exports = {
  PART_FILE_SUFFIX,
  createVideoExportFileWriter,
};
