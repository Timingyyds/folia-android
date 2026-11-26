import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modFiles.test.ts
// The directory layout behind Folium 1.5 `api.storage.paths` and the mods panel's view of it:
// only a validated id becomes a path, usage counts regular files without following links, a root
// that is a stray file or a dead link is told apart as broken, and clearing empties a directory
// (links removed as links) while keeping it.

const require = createRequire(import.meta.url);
const {
    clearDirectoryContents,
    isBrokenDirectory,
    measureDirectoryBytes,
    resolveModStorageDirs,
} = require('../../../electron/modSystem/modFiles.cjs');

const temporaryDirectories: string[] = [];

const tempDir = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-files-'));
    temporaryDirectories.push(directory);
    return directory;
};

const writeFile = (filePath: string, bytes: number) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(bytes));
};

// A directory link that needs no privileges on Windows (a junction); a plain symlink elsewhere.
const linkDirectory = (target: string, linkPath: string) => fs.symlinkSync(target, linkPath, 'junction');

afterEach(() => {
    vi.restoreAllMocks();
    while (temporaryDirectories.length > 0) {
        fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
    }
});

describe('mod storage directories', () => {
    it('puts files/ beside the storage data file and the cache in its own root', () => {
        const userData = path.join(os.tmpdir(), 'user-data');
        expect(resolveModStorageDirs(userData, 'mod-a')).toEqual({
            dataDir: path.join(userData, 'mods-data', 'mod-a'),
            filesDir: path.join(userData, 'mods-data', 'mod-a', 'files'),
            cacheDir: path.join(userData, 'mods-cache', 'mod-a'),
        });
    });

    it.each(['', '../mod-a', 'mod-a/../../x', 'Mod-A', '-mod', 'a\\b', '.', null, 42])(
        'refuses %j as a path segment',
        (modId) => {
            expect(() => resolveModStorageDirs(os.tmpdir(), modId)).toThrow('invalid-mod-id');
        },
    );
});

describe('measuring a directory', () => {
    it('counts 0 for a directory that does not exist', async () => {
        expect(await measureDirectoryBytes(path.join(tempDir(), 'missing'))).toBe(0);
    });

    it('adds up regular files at every depth', async () => {
        const root = tempDir();
        writeFile(path.join(root, 'a.bin'), 10);
        writeFile(path.join(root, 'nested', 'b.bin'), 20);
        writeFile(path.join(root, 'nested', 'deeper', 'c.bin'), 30);
        fs.mkdirSync(path.join(root, 'empty'));
        expect(await measureDirectoryBytes(root)).toBe(60);
    });

    it('does not follow a link inside the directory', async () => {
        const base = tempDir();
        const outside = path.join(base, 'outside');
        writeFile(path.join(outside, 'big.bin'), 5000);
        const root = path.join(base, 'cache');
        writeFile(path.join(root, 'own.bin'), 7);
        linkDirectory(outside, path.join(root, 'linked'));
        try {
            fs.symlinkSync(path.join(outside, 'big.bin'), path.join(root, 'file-link'), 'file');
        } catch {
            // File symlinks need a privilege on Windows; the junction above covers the rule.
        }
        expect(await measureDirectoryBytes(root)).toBe(7);
    });

    it('counts 0 when the directory itself is a link', async () => {
        const base = tempDir();
        const outside = path.join(base, 'outside');
        writeFile(path.join(outside, 'big.bin'), 5000);
        const root = path.join(base, 'cache');
        linkDirectory(outside, root);
        expect(await measureDirectoryBytes(root)).toBe(0);
    });

    // A running mod creates and deletes files under its own directories while the panel counts them.
    describe('while a mod changes the directory', () => {
        // Fails readdir or lstat of the paths ending in `suffix` with `code`, as if the entry went away.
        const failFor = (method: 'readdir' | 'lstat', suffix: string, code: string) => {
            const real = fs.promises[method] as (...args: unknown[]) => Promise<unknown>;
            vi.spyOn(fs.promises, method).mockImplementation((async (target: fs.PathLike, ...rest: unknown[]) => {
                if (String(target).endsWith(suffix)) {
                    throw Object.assign(new Error(`${code}: ${String(target)}`), { code });
                }
                return real(target, ...rest);
            }) as never);
        };

        const busyTree = () => {
            const root = tempDir();
            writeFile(path.join(root, 'keep.bin'), 1000);
            writeFile(path.join(root, 'gone', 'temp.bin'), 50);
            writeFile(path.join(root, 'other', 'deeper', 'kept.bin'), 20);
            return root;
        };

        // ENOENT: deleted; ENOTDIR: replaced by a file; EPERM: deleted on Windows while still open.
        it.each(['ENOENT', 'ENOTDIR', 'EPERM'])(
            'leaves out a subdirectory that fails with %s and counts the rest',
            async (code) => {
                const root = busyTree();
                failFor('readdir', `${path.sep}gone`, code);
                expect(await measureDirectoryBytes(root)).toBe(1020);
            },
        );

        it.each(['ENOENT', 'EPERM'])('leaves out a file that fails with %s before it is sized', async (code) => {
            const root = busyTree();
            failFor('lstat', 'temp.bin', code);
            expect(await measureDirectoryBytes(root)).toBe(1020);
        });

        it('counts 0 when the directory itself goes away before it is read', async () => {
            const root = busyTree();
            failFor('readdir', root, 'ENOENT');
            expect(await measureDirectoryBytes(root)).toBe(0);
        });

        it('still fails on an error that is not an entry going away', async () => {
            const root = busyTree();
            failFor('readdir', `${path.sep}gone`, 'EACCES');
            await expect(measureDirectoryBytes(root)).rejects.toMatchObject({ code: 'EACCES' });
        });

        it('still fails when the directory itself cannot be read', async () => {
            const root = busyTree();
            failFor('readdir', root, 'EPERM');
            await expect(measureDirectoryBytes(root)).rejects.toMatchObject({ code: 'EPERM' });
        });
    });
});

// A broken root counts 0 and blocks api.storage.paths, so the panel must still be able to clear it.
describe('telling a broken directory root', () => {
    it('is not broken when missing, a plain directory, or a link to a live directory', async () => {
        const base = tempDir();
        const outside = path.join(base, 'outside');
        fs.mkdirSync(outside);
        const linked = path.join(base, 'linked');
        linkDirectory(outside, linked);
        expect(await isBrokenDirectory(path.join(base, 'missing'))).toBe(false);
        expect(await isBrokenDirectory(outside)).toBe(false);
        expect(await isBrokenDirectory(linked)).toBe(false);
    });

    it('is broken when a file stands where the directory should be', async () => {
        const root = path.join(tempDir(), 'cache');
        writeFile(root, 4);
        expect(await isBrokenDirectory(root)).toBe(true);
    });

    it('is broken when the root is a link whose target is gone', async () => {
        const base = tempDir();
        const outside = path.join(base, 'outside');
        fs.mkdirSync(outside);
        const root = path.join(base, 'cache');
        linkDirectory(outside, root);
        fs.rmSync(outside, { recursive: true });
        expect(await isBrokenDirectory(root)).toBe(true);
    });
});

describe('clearing a directory', () => {
    it('removes every child, nested ones included, and keeps the directory', async () => {
        const root = tempDir();
        writeFile(path.join(root, 'a.bin'), 10);
        writeFile(path.join(root, 'nested', 'deeper', 'b.bin'), 10);
        expect(await clearDirectoryContents(root)).toEqual({ cleared: 2, failed: 0 });
        expect(fs.statSync(root).isDirectory()).toBe(true);
        expect(fs.readdirSync(root)).toEqual([]);
    });

    it('has nothing to do for a directory that does not exist', async () => {
        const root = path.join(tempDir(), 'missing');
        expect(await clearDirectoryContents(root)).toEqual({ cleared: 0, failed: 0 });
        expect(fs.existsSync(root)).toBe(false);
    });

    it('removes a link inside as a link, leaving what it points to', async () => {
        const base = tempDir();
        const outside = path.join(base, 'outside');
        writeFile(path.join(outside, 'keep.bin'), 5);
        const root = path.join(base, 'cache');
        writeFile(path.join(root, 'own.bin'), 5);
        linkDirectory(outside, path.join(root, 'linked'));
        expect(await clearDirectoryContents(root)).toEqual({ cleared: 2, failed: 0 });
        expect(fs.readdirSync(root)).toEqual([]);
        expect(fs.readFileSync(path.join(outside, 'keep.bin')).length).toBe(5);
    });

    it('removes a root that is a link instead of emptying its target', async () => {
        const base = tempDir();
        const outside = path.join(base, 'outside');
        writeFile(path.join(outside, 'keep.bin'), 5);
        const root = path.join(base, 'cache');
        linkDirectory(outside, root);
        expect(await clearDirectoryContents(root)).toEqual({ cleared: 1, failed: 0 });
        expect(fs.existsSync(root)).toBe(false);
        expect(fs.readFileSync(path.join(outside, 'keep.bin')).length).toBe(5);
    });

    it('removes a root that is a dead link or a stray file, so the directory can be made again', async () => {
        const base = tempDir();
        const outside = path.join(base, 'outside');
        fs.mkdirSync(outside);
        const deadLink = path.join(base, 'dead');
        linkDirectory(outside, deadLink);
        fs.rmSync(outside, { recursive: true });
        const stray = path.join(base, 'stray');
        writeFile(stray, 4);
        for (const root of [deadLink, stray]) {
            expect(() => fs.mkdirSync(root, { recursive: true })).toThrow();
            expect(await clearDirectoryContents(root)).toEqual({ cleared: 1, failed: 0 });
            fs.mkdirSync(root, { recursive: true });
            expect(await isBrokenDirectory(root)).toBe(false);
        }
    });

    it('goes on past a child it cannot remove and reports it', async () => {
        const root = tempDir();
        writeFile(path.join(root, 'busy.bin'), 1);
        writeFile(path.join(root, 'free.bin'), 1);
        const realRm = fs.promises.rm;
        vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, options) => {
            if (String(target).endsWith('busy.bin')) {
                throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
            }
            return realRm(target, options);
        });
        expect(await clearDirectoryContents(root)).toEqual({ cleared: 1, failed: 1 });
        expect(fs.readdirSync(root)).toEqual(['busy.bin']);
    });
});
