import { describe, expect, it } from 'vitest';
import { isCommandPaletteShortcut } from '../../../src/utils/keyboardTargets';
import { isMacPlatform } from '../../../src/utils/platform';

// test/unit/utils/commandPaletteShortcut.test.ts
// 命令面板的 Ctrl/Cmd+K 判定：面板自己的监听器与模组首页页面的放行共用它，两边对同一次按键的结论必须一致。
// 主修饰键随平台（macOS 是 Cmd，其他是 Ctrl），这里按当前平台造事件，两边都能跑。

type KeyInit = { key: string; code?: string; primary?: boolean; secondary?: boolean; altKey?: boolean; shiftKey?: boolean };

const press = ({ key, code = '', primary = false, secondary = false, altKey = false, shiftKey = false }: KeyInit) => ({
    key,
    code,
    ctrlKey: isMacPlatform ? secondary : primary,
    metaKey: isMacPlatform ? primary : secondary,
    altKey,
    shiftKey,
}) as KeyboardEvent;

describe('isCommandPaletteShortcut', () => {
    it('accepts the primary modifier with K from a physical key or from the key value alone', () => {
        expect(isCommandPaletteShortcut(press({ key: 'k', code: 'KeyK', primary: true }))).toBe(true);
        // 软件注入的按键没有 event.code。
        expect(isCommandPaletteShortcut(press({ key: 'k', primary: true }))).toBe(true);
        expect(isCommandPaletteShortcut(press({ key: 'K', primary: true }))).toBe(true);
        // 非拉丁布局：物理键仍是 KeyK。
        expect(isCommandPaletteShortcut(press({ key: 'л', code: 'KeyK', primary: true }))).toBe(true);
    });

    it('rejects K without the primary modifier or with any extra modifier', () => {
        expect(isCommandPaletteShortcut(press({ key: 'k', code: 'KeyK' }))).toBe(false);
        expect(isCommandPaletteShortcut(press({ key: 'k', code: 'KeyK', secondary: true }))).toBe(false);
        expect(isCommandPaletteShortcut(press({ key: 'k', code: 'KeyK', primary: true, secondary: true }))).toBe(false);
        expect(isCommandPaletteShortcut(press({ key: 'k', code: 'KeyK', primary: true, altKey: true }))).toBe(false);
        expect(isCommandPaletteShortcut(press({ key: 'K', code: 'KeyK', primary: true, shiftKey: true }))).toBe(false);
    });

    it('rejects other keys under the primary modifier', () => {
        expect(isCommandPaletteShortcut(press({ key: 'j', code: 'KeyJ', primary: true }))).toBe(false);
        expect(isCommandPaletteShortcut(press({ key: 'Enter', code: 'Enter', primary: true }))).toBe(false);
    });
});
