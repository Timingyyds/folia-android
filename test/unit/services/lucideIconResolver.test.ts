import { describe, expect, it } from 'vitest';
import * as LucideIcons from 'lucide-react';
import {
    getLucideIconStatus,
    hasLucideIcon,
    loadLucideIcons,
    resolveLucideIcon,
    resolveLucideIconNames,
    subscribeLucideIcons,
} from '@/services/lucideIconResolver';

// test/unit/services/lucideIconResolver.test.ts
// The resolver loads icons on demand through dynamicIconImports instead of importing the whole set,
// so it rebuilds lucide-react's export names from the loader keys. The parity test pins that
// against the real barrel (importing it here is fine - tests are not the startup bundle).

const isLucideIcon = (value: unknown) => (
    typeof value === 'object' && value !== null && '$$typeof' in value && 'render' in value
);

// Vitest resolves the barrel to lucide's CJS build and the per-icon loaders to its ESM files, so the
// components are different objects; createLucideIcon names each one after its canonical icon.
const iconId = (icon: unknown) => (icon as { displayName?: string } | null)?.displayName ?? null;

describe('lucideIconResolver', () => {
    it('resolves nothing until the icon has loaded, then the exact export name', async () => {
        expect(resolveLucideIcon('CloudLightning')).toBeNull();
        expect(getLucideIconStatus('CloudLightning')).toBe('loading');

        await loadLucideIcons(['CloudLightning', '  Star  ']);

        expect(iconId(resolveLucideIcon('CloudLightning'))).toBe(iconId(LucideIcons.CloudLightning));
        expect(iconId(resolveLucideIcon('  Star  '))).toBe('Star');
        expect(getLucideIconStatus('Star')).toBe('ready');
    });

    it('rejects unknown names, empty input and non-icon module exports', async () => {
        await loadLucideIcons(['NotAnIconAtAll', 'createLucideIcon', 'icons', 'Icon', '']);
        expect(resolveLucideIcon('NotAnIconAtAll')).toBeNull();
        expect(resolveLucideIcon('createLucideIcon')).toBeNull();
        expect(resolveLucideIcon('icons')).toBeNull();
        expect(resolveLucideIcon('')).toBeNull();
        expect(resolveLucideIcon(null)).toBeNull();
        expect(resolveLucideIcon(undefined)).toBeNull();
        expect(getLucideIconStatus('NotAnIconAtAll')).toBe('missing');
        expect(getLucideIconStatus('')).toBe('missing');
    });

    it('keeps the single-icon lookup case-sensitive, like indexing the module', async () => {
        await loadLucideIcons(['star']);
        expect(iconId(resolveLucideIcon('Star'))).toBe('Star');
        expect(resolveLucideIcon('star')).toBeNull();
        expect(getLucideIconStatus('star')).toBe('missing');
    });

    it('validates editor input against the name table without loading the icon', async () => {
        await expect(hasLucideIcon('Star')).resolves.toBe(true);
        await expect(hasLucideIcon('star')).resolves.toBe(false);
        await expect(hasLucideIcon('NotAnIconAtAll')).resolves.toBe(false);
        await expect(hasLucideIcon('  ')).resolves.toBe(false);
    });

    it('resolves theme icon lists case-insensitively without a fallback', async () => {
        await loadLucideIcons(['Moon', 'moon', 'heart', 'not-a-lucide-icon']);
        expect(resolveLucideIconNames(['Moon', 'moon', 'heart', 'not-a-lucide-icon'])).toEqual(['Moon', 'Heart']);
        expect(resolveLucideIconNames(undefined)).toEqual([]);
        expect(resolveLucideIconNames(['not-a-lucide-icon'])).toEqual([]);
    });

    it('leaves names whose icon has not loaded out of the theme list', async () => {
        expect(resolveLucideIconNames(['Anchor'])).toEqual([]);
        await loadLucideIcons(['anchor']);
        expect(resolveLucideIconNames(['Anchor'])).toEqual(['Anchor']);
    });

    it('notifies subscribers when an icon arrives', async () => {
        let calls = 0;
        const unsubscribe = subscribeLucideIcons(() => {
            calls += 1;
        });
        await loadLucideIcons(['Feather']);
        unsubscribe();
        expect(calls).toBeGreaterThan(0);
        expect(iconId(resolveLucideIcon('Feather'))).toBe('Feather');
    });

    it('knows every icon export of lucide-react, aliases and Icon/Lucide forms included', async () => {
        const exportNames = Object.keys(LucideIcons).filter(name => (
            /^[A-Z]/.test(name)
            && name !== 'Icon'
            && isLucideIcon(LucideIcons[name as keyof typeof LucideIcons])
        ));
        expect(exportNames.length).toBeGreaterThan(5000);

        const unknown: string[] = [];
        for (const name of exportNames) {
            if (!(await hasLucideIcon(name))) unknown.push(name);
        }
        expect(unknown).toEqual([]);
    });

    it('maps export names to the right icon, sampled across the whole set', async () => {
        const exportNames = Object.keys(LucideIcons).filter(name => (
            /^[A-Z]/.test(name)
            && name !== 'Icon'
            && isLucideIcon(LucideIcons[name as keyof typeof LucideIcons])
        ));
        // Every module import goes through Vitest's transform, so check a spread of ~250 instead of
        // all ~1900 modules, plus the shapes the name mapping has to get right.
        const sample = [
            ...exportNames.filter((_, index) => index % 25 === 0),
            'AlarmCheck', 'AlarmCheckIcon', 'LucideAlarmCheck', 'ArrowDown01', 'Grid2x2', 'Grid2X2',
            'AArrowDown', 'Heading1', 'Clock10', 'X', 'XIcon', 'LucideX',
        ].filter(name => name in LucideIcons);

        await loadLucideIcons(sample);
        const mismatched = sample.filter(name => (
            iconId(resolveLucideIcon(name)) !== iconId(LucideIcons[name as keyof typeof LucideIcons])
        ));
        expect(mismatched).toEqual([]);
    });
});
