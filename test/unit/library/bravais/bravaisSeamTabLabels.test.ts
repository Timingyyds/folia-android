import { describe, expect, it } from 'vitest';
import { abbreviateSeamTabLabel, abbreviateSeamTabLabels } from '@/library/suites/bravais/bravaisSeamTabLabels';

// test/unit/library/bravais/bravaisSeamTabLabels.test.ts
// fb2：首页窄缝页签放不下全名时的「一个字」短形——从已翻译的全名推，三份 locale 的页签都分得开。

describe('abbreviateSeamTabLabels', () => {
    it('takes the first character of each Chinese tab', () => {
        expect(abbreviateSeamTabLabels(['歌单', '电台', '专辑', '本地', 'Navi'])).toEqual(['歌', '电', '专', '本', 'N']);
    });

    it('takes an upper-case initial for English and Indonesian tabs', () => {
        expect(abbreviateSeamTabLabels(['Playlists', 'Radio', 'Albums', 'Folder', 'Navi'])).toEqual(['P', 'R', 'A', 'F', 'N']);
        expect(abbreviateSeamTabLabels(['Playlist', 'Radio', 'Album', 'Folder', 'Navi'])).toEqual(['P', 'R', 'A', 'F', 'N']);
        expect(abbreviateSeamTabLabel('  navidrome ')).toBe('N');
    });

    it('keeps graphemes whole and falls back to two of them when initials collide', () => {
        expect(abbreviateSeamTabLabel('👩‍🎤 Stage')).toBe('👩‍🎤');
        expect(abbreviateSeamTabLabels(['Albums', 'Artists', 'Radio'])).toEqual(['Al', 'Ar', 'R']);
        expect(abbreviateSeamTabLabels(['专辑', '专栏'])).toEqual(['专辑', '专栏']);
    });
});
