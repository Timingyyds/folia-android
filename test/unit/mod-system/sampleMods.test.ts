import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

// test/unit/mod-system/sampleMods.test.ts
// Every mod shipped in the repository's mods/ directory is Folium 1: its
// manifest validates and the entry files it declares exist. Samples are the
// first thing mod authors copy, so they must never drift from the contract.
// They are also officially signed: editing a sample means re-signing it
// (folium-compound: tools/sign.mjs), or this suite fails. The samples listed in
// BETA_SAMPLES are signed with the beta-channel key instead and must verify as
// beta; every other sample must verify as officially verified.

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');
const { verifyModSignature } = require('../../../electron/modSystem/modSignature.cjs');

const MODS_DIR = path.resolve(__dirname, '../../../mods');
const BETA_SAMPLES = new Set(['sample-beta-hello']);
const modDirectories = fs.readdirSync(MODS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(MODS_DIR, entry.name));

describe('repository sample mods', () => {
    it('has samples to check', () => {
        expect(modDirectories.length).toBeGreaterThan(0);
    });

    it.each(modDirectories.map((directory) => [path.basename(directory), directory]))('%s is a valid Folium 1 mod', (_name, directory) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
        const result = validateManifest(manifest);
        expect(result.ok ? [] : result.errors).toEqual([]);
        if (!result.ok) return;
        if (result.value.main) expect(fs.existsSync(path.join(directory, result.value.main))).toBe(true);
        if (result.value.client) {
            const clientPath = path.join(directory, result.value.client);
            expect(fs.existsSync(clientPath)).toBe(true);
            expect(fs.readFileSync(clientPath, 'utf8')).toMatch(/export default function activate\(folium\)/);
        }
    });

    it.each(modDirectories.map((directory) => [path.basename(directory), directory]))('%s carries a valid signature of its channel', (name, directory) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
        expect(verifyModSignature(directory, manifest)).toMatchObject({ status: BETA_SAMPLES.has(name) ? 'beta' : 'verified' });
    });

    it('has a beta-channel sample for every name in BETA_SAMPLES', () => {
        const names = modDirectories.map((directory) => path.basename(directory));
        BETA_SAMPLES.forEach((name) => expect(names).toContain(name));
    });
});
