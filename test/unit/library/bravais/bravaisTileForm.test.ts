import { describe, expect, it } from 'vitest';
import { averagePixelColor, resolveArtistToneLight } from '@/library/suites/bravais/bravaisArtistTone';
import { formatCollectionBadge, resolveBravaisTileForm, resolveCollectionTrackCount } from '@/library/suites/bravais/bravaisTileForm';

// test/unit/library/bravais/bravaisTileForm.test.ts
// 磁贴的种类区分（设计稿 §7.7）：哪种条目是集合（叠页边）/ 双色调 / 保持海报，集合的曲目数与带曲目数的类型标签，
// 以及双色调亮端的取色换算。

describe('resolveBravaisTileForm', () => {
    it('makes collections a stack, artists a portrait and keeps tracks and the FM stream as posters', () => {
        expect(resolveBravaisTileForm({ kind: 'album' })).toBe('stack');
        expect(resolveBravaisTileForm({ kind: 'playlist' })).toBe('stack');
        expect(resolveBravaisTileForm({ kind: 'folder' })).toBe('stack');
        expect(resolveBravaisTileForm({ kind: 'feed' })).toBe('stack');
        expect(resolveBravaisTileForm({ kind: 'feed', direct: true })).toBe('poster');
        expect(resolveBravaisTileForm({ kind: 'artist' })).toBe('portrait');
        expect(resolveBravaisTileForm({ kind: 'track' })).toBe('poster');
    });

    it('gives the track count only to a collection and only when it is known', () => {
        expect(resolveCollectionTrackCount('stack', 12)).toBe(12);
        expect(resolveCollectionTrackCount('stack', 12.7)).toBe(12);
        expect(resolveCollectionTrackCount('stack', 0)).toBeUndefined();
        expect(resolveCollectionTrackCount('stack', undefined)).toBeUndefined();
        expect(resolveCollectionTrackCount('stack', Number.NaN)).toBeUndefined();
        expect(resolveCollectionTrackCount('portrait', 12)).toBeUndefined();
        expect(resolveCollectionTrackCount('poster', 12)).toBeUndefined();
    });

    it('folds the track count into the kind label', () => {
        expect(formatCollectionBadge('歌单', 124)).toBe('歌单 · 124');
        expect(formatCollectionBadge('Album', 12)).toBe('Album · 12');
        expect(formatCollectionBadge('Playlist', undefined)).toBe('Playlist');
    });
});

describe('artist tone', () => {
    it('averages the opaque pixels', () => {
        const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0]);
        expect(averagePixelColor(pixels)).toEqual({ r: 127.5, g: 0, b: 127.5 });
        expect(averagePixelColor(new Uint8ClampedArray([1, 2, 3, 0]))).toBeNull();
    });

    it('keeps the hue, lifts saturation and lightness, and gives up on colourless photos', () => {
        expect(resolveArtistToneLight({ r: 120, g: 40, b: 40 })).toBe('hsl(0 62% 66%)');
        expect(resolveArtistToneLight({ r: 30, g: 60, b: 110 })).toBe('hsl(218 62% 66%)');
        expect(resolveArtistToneLight({ r: 128, g: 128, b: 130 })).toBeNull();
    });
});
