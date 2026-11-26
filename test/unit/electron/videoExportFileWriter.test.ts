import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// test/unit/electron/videoExportFileWriter.test.ts

const {
    PART_FILE_SUFFIX,
    createVideoExportFileWriter,
} = require('../../../electron/videoExportFileWriter.cjs') as {
    PART_FILE_SUFFIX: string;
    createVideoExportFileWriter: (options?: {
        finalizeFile?: (handle: fs.promises.FileHandle) => Promise<boolean>;
        logger?: { warn: (...args: unknown[]) => void };
    }) => {
        open: (filePath: string) => Promise<string>;
        append: (id: string, data: unknown) => Promise<number>;
        finish: (id: string) => Promise<{ filePath: string; bytesWritten: number; finalized: boolean }>;
        abort: (id: string) => Promise<boolean>;
        disposeSync: () => void;
    };
};

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe('videoExportFileWriter', () => {
    let dir: string;
    let target: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-video-export-'));
        target = path.join(dir, 'song.webm');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('appends chunks in call order and renames the part file on finish', async () => {
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);

        // Not awaited one by one: concurrent IPC calls must still land in order.
        await Promise.all([
            writer.append(id, bytes(1, 2)),
            writer.append(id, bytes(3)),
            writer.append(id, new Uint8Array([4, 5, 6]).subarray(1)),
        ]);
        expect(fs.existsSync(target)).toBe(false);

        const result = await writer.finish(id);
        expect(result).toEqual({ filePath: target, bytesWritten: 5, finalized: false });
        expect([...fs.readFileSync(target)]).toEqual([1, 2, 3, 5, 6]);
        expect(fs.existsSync(`${target}${PART_FILE_SUFFIX}`)).toBe(false);
    });

    it('replaces an existing file only once the export finished', async () => {
        fs.writeFileSync(target, 'previous');
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);
        await writer.append(id, bytes(9));
        expect(fs.readFileSync(target, 'utf8')).toBe('previous');

        await writer.finish(id);
        expect([...fs.readFileSync(target)]).toEqual([9]);
    });

    it('abort deletes the partial file and leaves the target untouched', async () => {
        fs.writeFileSync(target, 'previous');
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);
        await writer.append(id, bytes(1));

        expect(await writer.abort(id)).toBe(true);
        expect(fs.existsSync(`${target}${PART_FILE_SUFFIX}`)).toBe(false);
        expect(fs.readFileSync(target, 'utf8')).toBe('previous');
        await expect(writer.append(id, bytes(2))).rejects.toThrow(/not open/);
        expect(await writer.abort(id)).toBe(false);
    });

    it('opening a new session discards the stale one', async () => {
        const writer = createVideoExportFileWriter();
        const stale = await writer.open(path.join(dir, 'stale.webm'));
        await writer.append(stale, bytes(1));

        const fresh = await writer.open(target);
        expect(fs.existsSync(path.join(dir, `stale.webm${PART_FILE_SUFFIX}`))).toBe(false);
        await expect(writer.finish(stale)).rejects.toThrow(/not open/);

        await writer.append(fresh, bytes(7));
        await writer.finish(fresh);
        expect([...fs.readFileSync(target)]).toEqual([7]);
    });

    it('rejects non-binary chunks', async () => {
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);
        await expect(writer.append(id, 'text')).rejects.toThrow(/binary/);
        await writer.abort(id);
    });

    it('disposeSync removes the partial file on quit', async () => {
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);
        await writer.append(id, bytes(1));

        writer.disposeSync();
        expect(fs.existsSync(`${target}${PART_FILE_SUFFIX}`)).toBe(false);
        expect(await writer.abort(id)).toBe(false);
    });

    it('runs finalizeFile on a read/write handle before renaming', async () => {
        const writer = createVideoExportFileWriter({
            finalizeFile: async handle => {
                // Reads back what was streamed, then rewrites the first byte in place.
                const head = Buffer.alloc(2);
                await handle.read(head, 0, 2, 0);
                expect([...head]).toEqual([1, 2]);
                expect(fs.existsSync(target)).toBe(false);
                await handle.write(Buffer.from([9]), 0, 1, 0);
                return true;
            },
        });
        const id = await writer.open(target);
        await writer.append(id, bytes(1, 2, 3));

        expect(await writer.finish(id)).toEqual({ filePath: target, bytesWritten: 3, finalized: true });
        expect([...fs.readFileSync(target)]).toEqual([9, 2, 3]);
    });

    it('keeps the recording when finalizeFile fails', async () => {
        const warnings: unknown[][] = [];
        const writer = createVideoExportFileWriter({
            finalizeFile: async () => {
                throw new Error('Invalid recorded MP4: test');
            },
            logger: { warn: (...args) => warnings.push(args) },
        });
        const id = await writer.open(target);
        await writer.append(id, bytes(4, 5));

        expect(await writer.finish(id)).toEqual({ filePath: target, bytesWritten: 2, finalized: false });
        expect([...fs.readFileSync(target)]).toEqual([4, 5]);
        expect(warnings).toHaveLength(1);
    });
});
