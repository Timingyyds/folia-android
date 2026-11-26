// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/shared/customSelect.test.ts
// CustomSelect 为 Folium 表单（#485）加的行为：捕获阶段的外部点击（命令面板根节点会拦 mousedown）、
// 焦点移走即收起、Escape 只关菜单不惊动外层、↑↓/Enter 选择、键盘高亮跟随滚动（普通与虚拟化两个分支）、
// compact 尺寸与调用方接管的触发按钮外观、ariaLabelledBy 让触发按钮的名字带上当前值、i18n 占位文字。
// 审查后补的：高亮按值记（onOpen 懒加载选项、菜单开着选项变了，Enter 不会选到换进来的别的项）、
// Enter 落在当前值上只收起不报告、键盘打开时把当前项滚进视野、select-only combobox 的
// aria-controls / aria-activedescendant（读屏能听到 ↑↓ 移到了哪一项）。

vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CustomSelect } from '@/components/shared/CustomSelect';
import type { CustomSelectOption } from '@/components/shared/CustomSelectMenu';
import { stepCustomSelectIndex } from '@/components/shared/useCustomSelectNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
    { value: 'h264', label: 'H.264' },
    { value: 'hevc', label: 'HEVC' },
    { value: 'av1', label: 'AV1' },
];

let root: Root | null = null;
const windowListeners: Array<(event: KeyboardEvent) => void> = [];

/** jsdom 不实现元素滚动；用例按需装上替身，结束后还原。 */
const scrollStubs: Array<() => void> = [];

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    windowListeners.splice(0).forEach(listener => window.removeEventListener('keydown', listener));
    scrollStubs.splice(0).forEach(restore => restore());
    document.body.replaceChildren();
});

const stubElementMethod = (name: 'scrollTo' | 'scrollIntoView', impl: (this: HTMLElement, ...args: unknown[]) => void) => {
    const spy = vi.fn(impl);
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, name);
    Object.defineProperty(Element.prototype, name, { configurable: true, writable: true, value: spy });
    scrollStubs.push(() => {
        if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
        else delete (Element.prototype as unknown as Record<string, unknown>)[name];
    });
    return spy;
};

type SelectProps = React.ComponentProps<typeof CustomSelect>;

/** 挂一个 CustomSelect；外层像命令面板那样在 mousedown 上 stopPropagation，旁边放一个可点的兄弟元素。 */
const renderSelect = (props: Partial<SelectProps> = {}) => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const render = (next: Partial<SelectProps> = {}) => act(() => root!.render(
        React.createElement(
            'div',
            { onMouseDown: (event: React.MouseEvent) => event.stopPropagation() },
            React.createElement('span', { 'data-testid': 'elsewhere' }, 'elsewhere'),
            React.createElement('span', { id: 'field-label' }, 'Video codec'),
            React.createElement('input', { 'data-testid': 'other-field', 'aria-label': 'Other field' }),
            React.createElement(CustomSelect, {
                value: 'hevc',
                options: OPTIONS,
                ariaLabel: 'Codec',
                onChange,
                ...props,
                ...next,
            }),
        ),
    ));
    render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    return { host, trigger, options, onChange, render };
};

/** 外层（命令面板、设置弹窗）在 window 冒泡阶段听按键，这里用一个间谍顶替。 */
const listenLikeOuterLayer = () => {
    const spy = vi.fn();
    const listener = (event: KeyboardEvent) => spy(event.key);
    window.addEventListener('keydown', listener);
    windowListeners.push(listener);
    return spy;
};

const press = (target: Element, key: string) => act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
});

/** 真实的指针点击：detail 至少为 1。jsdom 的 element.click() 的 detail 是 0，和空格激活按钮一样。 */
const mouseClick = (target: Element) => act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
});

/** 等一帧：虚拟化列表刚挂上时，滚动可能要等 react-window 把容器元素登记好。 */
const nextFrame = () => act(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
});

const activeRows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-active="true"]'));

/** 播放设置的音频输出：设备还没枚举时只有「默认」和补在末尾的已存设备；Chromium 枚举出来 default、communications 排在最前。 */
const SAVED_DEVICE_ONLY: CustomSelectOption[] = [
    { value: '', label: 'Default' },
    { value: 'abc', label: 'USB DAC' },
];
const ENUMERATED_DEVICES: CustomSelectOption[] = [
    { value: '', label: 'Default' },
    { value: 'default', label: 'Default - Speakers' },
    { value: 'communications', label: 'Communications - Speakers' },
    { value: 'speakers', label: 'Speakers' },
    { value: 'abc', label: 'USB DAC' },
];

describe('CustomSelect', () => {
    it('shows the selected label, and the translated placeholder when the value is not an option', () => {
        const { trigger, render } = renderSelect();
        expect(trigger.textContent).toBe('HEVC');
        render({ value: 'vp9' });
        expect(trigger.textContent).toBe('ui.selectPlaceholder');
        render({ value: 'vp9', placeholder: 'Pick one' });
        expect(trigger.textContent).toBe('Pick one');
    });

    it('opens on click, reports the picked option and closes', () => {
        const { trigger, options, onChange } = renderSelect();
        act(() => trigger.click());
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Codec');
        expect(options().map(option => option.textContent)).toEqual(['H.264', 'HEVC', 'AV1']);
        expect(options()[1].getAttribute('aria-selected')).toBe('true');

        act(() => options()[2].click());
        expect(onChange).toHaveBeenCalledWith('av1');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('stays shut while disabled, by pointer and by keyboard', () => {
        const { trigger, onChange } = renderSelect({ disabled: true });
        expect(trigger.disabled).toBe(true);
        act(() => trigger.click());
        press(trigger, 'ArrowDown');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('closes on a press elsewhere even inside a container that stops mousedown from bubbling', () => {
        const { host, trigger } = renderSelect();
        act(() => trigger.click());
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        // 菜单自己身上的按下不算外部。
        act(() => {
            document.querySelector('[role="listbox"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        act(() => {
            host.querySelector('[data-testid="elsewhere"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes when focus moves outside, so a later Enter belongs to the new focus', () => {
        const outer = listenLikeOuterLayer();
        const { host, trigger, onChange } = renderSelect();
        act(() => trigger.click());
        const other = host.querySelector<HTMLInputElement>('[data-testid="other-field"]')!;
        act(() => other.focus());
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        press(other, 'Enter');
        expect(onChange).not.toHaveBeenCalled();
        expect(outer).toHaveBeenCalledWith('Enter');
    });

    it('lets Escape close only the menu, then hands Escape back to the outer layer', () => {
        const outer = listenLikeOuterLayer();
        const { trigger } = renderSelect();
        act(() => trigger.click());

        press(trigger, 'Escape');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(outer).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);

        press(trigger, 'Escape');
        expect(outer).toHaveBeenCalledWith('Escape');
    });

    it('opens with the arrow keys, walks the options and picks with Enter without the outer layer seeing it', () => {
        const outer = listenLikeOuterLayer();
        const { trigger, options, onChange } = renderSelect();
        trigger.focus();

        press(trigger, 'ArrowDown');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        // 打开时高亮当前选中项。
        expect(options()[1].getAttribute('data-active')).toBe('true');

        press(trigger, 'ArrowDown');
        expect(options()[2].getAttribute('data-active')).toBe('true');
        press(trigger, 'ArrowDown');
        expect(options()[2].getAttribute('data-active')).toBe('true');
        press(trigger, 'Home');
        expect(options()[0].getAttribute('data-active')).toBe('true');

        press(trigger, 'Enter');
        expect(onChange).toHaveBeenCalledWith('h264');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(outer).not.toHaveBeenCalled();
    });

    it('follows the pointer and drops a pointer highlight when it leaves the menu', () => {
        const { trigger, options } = renderSelect();
        mouseClick(trigger);
        act(() => { options()[0].dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
        expect(options()[0].getAttribute('data-active')).toBe('true');

        act(() => {
            document.querySelector('[role="listbox"]')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
        });
        expect(options()[0].getAttribute('data-active')).toBeNull();
        expect(options()[1].getAttribute('data-active')).toBe('true');
    });

    it('scrolls the keyboard highlight into view in a short list, opening by keyboard included, but not a pointer highlight', () => {
        const scrollIntoView = stubElementMethod('scrollIntoView', () => {});
        const { trigger, options } = renderSelect();
        trigger.focus();
        // 用键盘打开：当前项（第 2 项）滚进视野。
        press(trigger, 'ArrowDown');
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.contexts[0]).toBe(options()[1]);

        press(trigger, 'ArrowDown');
        expect(scrollIntoView).toHaveBeenCalledTimes(2);
        expect(scrollIntoView.mock.contexts[1]).toBe(options()[2]);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });

        act(() => { options()[0].dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
        expect(options()[0].getAttribute('data-active')).toBe('true');
        expect(scrollIntoView).toHaveBeenCalledTimes(2);

        // 鼠标打开不滚（同改动前）；空格激活按钮补发的 click（detail 0）算键盘打开。
        press(trigger, 'Escape');
        mouseClick(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(scrollIntoView).toHaveBeenCalledTimes(2);
        press(trigger, 'Escape');
        act(() => trigger.click());
        expect(scrollIntoView).toHaveBeenCalledTimes(3);
        expect(scrollIntoView.mock.contexts[2]).toBe(options()[1]);
    });

    it('opens a long (virtualized) list by keyboard scrolled to the current option, and by mouse where it was', async () => {
        const scrollTo = stubElementMethod('scrollTo', function (options) {
            this.scrollTop = (options as ScrollToOptions).top ?? this.scrollTop;
            this.dispatchEvent(new Event('scroll'));
        });
        const commands = Array.from({ length: 125 }, (_, index) => ({ value: `c-${index}`, label: `Command ${index}` }));
        const { trigger, onChange } = renderSelect({ value: 'c-60', options: commands });
        const row = (index: number) => document.querySelector<HTMLElement>(`[data-option-index="${index}"]`);
        trigger.focus();

        press(trigger, 'ArrowDown');
        await nextFrame();
        // 第 60 行底边贴到视口底边（行高 40 + 间距 2，列表高 228），渲染出来并且高亮。
        expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 61 * 42 - 228 }));
        expect(row(60)?.getAttribute('data-active')).toBe('true');
        expect(activeRows()).toHaveLength(1);
        expect(trigger.getAttribute('aria-activedescendant')).toBe(row(60)!.id);

        // 下一格是 61，而不是从看不见的 60 跳过去。
        press(trigger, 'ArrowDown');
        expect(row(61)?.getAttribute('data-active')).toBe('true');
        press(trigger, 'ArrowUp');
        press(trigger, 'Enter');
        expect(onChange).not.toHaveBeenCalled();

        scrollTo.mockClear();
        mouseClick(trigger);
        await nextFrame();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('walks a long (virtualized) list by keyboard: the highlight row is scrolled in and rendered active', () => {
        // react-window 的 scrollToRow 落到容器的 scrollTo；替身照真浏览器那样改 scrollTop 并发 scroll。
        const scrollTo = stubElementMethod('scrollTo', function (options) {
            this.scrollTop = (options as ScrollToOptions).top ?? this.scrollTop;
            this.dispatchEvent(new Event('scroll'));
        });
        const longOptions = Array.from({ length: 30 }, (_, index) => ({ value: `opt-${index}`, label: `Option ${index}` }));
        const outer = listenLikeOuterLayer();
        const { trigger, onChange } = renderSelect({ value: 'opt-0', options: longOptions });
        const row = (index: number) => document.querySelector<HTMLElement>(`[data-option-index="${index}"]`);
        trigger.focus();

        press(trigger, 'ArrowDown');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        // 虚拟化分支：起初只渲染视口加 overscan 的几行，第 12 行还不在 DOM 里。
        expect(row(0)?.getAttribute('data-active')).toBe('true');
        expect(row(12)).toBeNull();

        for (let step = 0; step < 12; step += 1) press(trigger, 'ArrowDown');
        // 菜单 maxHeight 240 减内边距 12 = 列表高 228；行高 40 + 间距 2。第 12 行底边贴到视口底边。
        expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 13 * 42 - 228 }));
        expect(row(12)?.getAttribute('data-active')).toBe('true');
        expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(1);

        // 指针高亮不滚动。
        const scrollCalls = scrollTo.mock.calls.length;
        act(() => { row(10)!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
        expect(row(10)?.getAttribute('data-active')).toBe('true');
        expect(row(12)?.getAttribute('data-active')).toBeNull();
        expect(scrollTo.mock.calls.length).toBe(scrollCalls);

        press(trigger, 'End');
        expect(row(29)?.getAttribute('data-active')).toBe('true');
        press(trigger, 'Enter');
        expect(onChange).toHaveBeenCalledWith('opt-29');
        expect(outer).not.toHaveBeenCalled();
    });

    it('keeps the highlight on the same option when the options change under the open menu', () => {
        const { trigger, options, onChange, render } = renderSelect({ value: 'abc', options: SAVED_DEVICE_ONLY });
        trigger.focus();
        press(trigger, 'Enter');
        expect(options()[1].getAttribute('data-active')).toBe('true');

        render({ options: ENUMERATED_DEVICES });
        expect(activeRows().map(row => row.textContent)).toEqual(['USB DAC']);
        expect(trigger.getAttribute('aria-activedescendant')).toBe(options()[4].id);

        // 高亮没动过：这是「Enter 打开、Enter 关闭」，不会把输出切到第二行换进来的 default。
        press(trigger, 'Enter');
        expect(onChange).not.toHaveBeenCalled();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        // ↑ 从当前设备往上走。
        press(trigger, 'ArrowDown');
        press(trigger, 'ArrowUp');
        expect(activeRows().map(row => row.textContent)).toEqual(['Speakers']);
        press(trigger, 'Enter');
        expect(onChange).toHaveBeenCalledWith('speakers');
    });

    it('keeps the highlight on the current value when onOpen fills the options in later', async () => {
        let finishEnumeration!: () => void;
        const enumerated = new Promise<void>(resolve => { finishEnumeration = resolve; });
        const onChange = vi.fn();
        const LazyOutput: React.FC = () => {
            const [devices, setDevices] = React.useState<CustomSelectOption[] | null>(null);
            return React.createElement(CustomSelect, {
                value: 'abc',
                options: devices ?? SAVED_DEVICE_ONLY,
                ariaLabel: 'Output',
                // 同 PlaybackSettingsSubview 的 ensureAudioOutputDevicesLoaded：打开时才去枚举。
                onOpen: () => { void enumerated.then(() => setDevices(ENUMERATED_DEVICES)); },
                onChange,
            });
        };
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root!.render(React.createElement(LazyOutput)));
        const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
        trigger.focus();

        press(trigger, 'ArrowDown');
        await act(async () => {
            finishEnumeration();
            await enumerated;
        });
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(5);
        expect(activeRows().map(row => row.textContent)).toEqual(['USB DAC']);

        press(trigger, 'ArrowUp');
        expect(activeRows().map(row => row.textContent)).toEqual(['Speakers']);
        press(trigger, 'ArrowDown');
        press(trigger, 'Enter');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('closes without reporting when Enter lands on the current value, while a click on it still reports', () => {
        const outer = listenLikeOuterLayer();
        const { trigger, options, onChange } = renderSelect();
        trigger.focus();

        // 改动前的「Enter 打开、Enter 关闭」：不调用 onChange，外层也收不到。
        press(trigger, 'Enter');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        press(trigger, 'Enter');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger);

        // 走开再走回当前项也一样。
        press(trigger, 'ArrowDown');
        press(trigger, 'ArrowDown');
        press(trigger, 'ArrowUp');
        press(trigger, 'Enter');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(onChange).not.toHaveBeenCalled();
        expect(outer).not.toHaveBeenCalled();

        // 鼠标点当前项照旧报告（改动前就是这样；FoliumSelectField 靠它把陈旧的存储值写成显示值）。
        mouseClick(trigger);
        act(() => options()[1].click());
        expect(onChange).toHaveBeenCalledWith('hevc');
    });

    it('is a select-only combobox whose active descendant follows the highlight into the listbox it controls', () => {
        const { trigger, options } = renderSelect();
        expect(trigger.getAttribute('role')).toBe('combobox');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.hasAttribute('aria-controls')).toBe(false);
        expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);

        trigger.focus();
        press(trigger, 'ArrowDown');
        const listbox = document.querySelector('[role="listbox"]')!;
        expect(listbox.id).not.toBe('');
        expect(trigger.getAttribute('aria-controls')).toBe(listbox.id);
        const ids = options().map(option => option.id);
        expect(ids.every(id => id !== '')).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
        expect(trigger.getAttribute('aria-activedescendant')).toBe(ids[1]);

        // 焦点不离开触发按钮，靠 aria-activedescendant 告诉读屏移到了哪一项；指针高亮也一样。
        press(trigger, 'ArrowDown');
        expect(document.activeElement).toBe(trigger);
        expect(trigger.getAttribute('aria-activedescendant')).toBe(ids[2]);
        act(() => { options()[0].dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
        expect(trigger.getAttribute('aria-activedescendant')).toBe(ids[0]);

        press(trigger, 'Escape');
        expect(trigger.hasAttribute('aria-controls')).toBe(false);
        expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('keeps options owned by the listbox in the virtualized branch and tells their position', async () => {
        stubElementMethod('scrollTo', function (options) {
            this.scrollTop = (options as ScrollToOptions).top ?? this.scrollTop;
            this.dispatchEvent(new Event('scroll'));
        });
        const longOptions = Array.from({ length: 30 }, (_, index) => ({ value: `opt-${index}`, label: `Option ${index}` }));
        const { trigger } = renderSelect({ value: 'opt-0', options: longOptions });
        trigger.focus();
        press(trigger, 'ArrowDown');
        await nextFrame();

        const listbox = document.querySelector('[role="listbox"]')!;
        // react-window 的容器默认 role=list，夹在中间会让 option 脱离 listbox。
        expect(listbox.querySelector('[role="list"]')).toBeNull();
        const first = listbox.querySelector<HTMLElement>('[data-option-index="0"]')!;
        expect(first.getAttribute('role')).toBe('option');
        expect(first.getAttribute('aria-setsize')).toBe('30');
        expect(first.getAttribute('aria-posinset')).toBe('1');
        expect(trigger.getAttribute('aria-activedescendant')).toBe(first.id);
    });

    it('names an otherwise unnamed combobox by its shown value, as the old button was', () => {
        const { trigger } = renderSelect({ ariaLabel: undefined });
        expect(trigger.hasAttribute('aria-label')).toBe(false);
        const valueId = trigger.getAttribute('aria-labelledby')!;
        expect(document.getElementById(valueId)?.textContent).toBe('HEVC');
        expect(trigger.contains(document.getElementById(valueId))).toBe(true);
    });

    it('names the trigger by ariaLabelledBy plus its shown value, and the menu by ariaLabel', () => {
        const labelled = renderSelect({ ariaLabelledBy: 'field-label' });
        const ids = labelled.trigger.getAttribute('aria-labelledby')!.split(/\s+/);
        const name = () => ids.map(id => document.getElementById(id)?.textContent).join(' ');
        expect(ids[0]).toBe('field-label');
        expect(name()).toBe('Video codec HEVC');
        expect(labelled.trigger.hasAttribute('aria-label')).toBe(false);
        act(() => labelled.trigger.click());
        expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Codec');
        act(() => labelled.options()[0].click());
        expect(labelled.onChange).toHaveBeenCalledWith('h264');
        labelled.render({ value: 'h264' });
        expect(name()).toBe('Video codec H.264');
        act(() => root!.unmount());
        root = null;
        document.body.replaceChildren();

        // 没有 ariaLabel 时列表也由同一组 id 命名。
        const unnamedMenu = renderSelect({ ariaLabel: undefined, ariaLabelledBy: 'field-label' });
        act(() => unnamedMenu.trigger.click());
        const listbox = document.querySelector('[role="listbox"]')!;
        expect(listbox.hasAttribute('aria-label')).toBe(false);
        expect(listbox.getAttribute('aria-labelledby')).toBe('field-label');
        act(() => root!.unmount());
        root = null;
        document.body.replaceChildren();

        // 不传 ariaLabelledBy：标记与原来一致，按钮只有 aria-label，显示值的 span 不带 id。
        const plain = renderSelect();
        expect(plain.trigger.getAttribute('aria-label')).toBe('Codec');
        expect(plain.trigger.hasAttribute('aria-labelledby')).toBe(false);
        expect(plain.trigger.querySelector('span')?.hasAttribute('id')).toBe(false);
    });

    it('keeps the settings-page trigger by default and hands the surface to the caller when asked', () => {
        const plain = renderSelect();
        expect(plain.trigger.className).toContain('px-4 py-3 text-sm');
        expect(plain.trigger.style.backgroundColor).toBe('var(--overlay-medium)');
        act(() => root!.unmount());
        root = null;
        document.body.replaceChildren();

        const compact = renderSelect({
            size: 'compact',
            triggerClassName: 'field-class',
            triggerStyle: { border: '1px solid red' },
        });
        expect(compact.trigger.className).toContain('px-2.5 py-1.5 text-xs');
        expect(compact.trigger.className).toContain('field-class');
        expect(compact.trigger.style.backgroundColor).toBe('');
        expect(compact.trigger.style.border).toBe('1px solid red');
        act(() => compact.trigger.click());
        expect(compact.trigger.style.boxShadow).toContain('0 0 0 1px');
    });
});

describe('stepCustomSelectIndex', () => {
    it('starts from the ends without a highlight and clamps instead of wrapping', () => {
        expect(stepCustomSelectIndex(-1, 1, 3)).toBe(0);
        expect(stepCustomSelectIndex(-1, -1, 3)).toBe(2);
        expect(stepCustomSelectIndex(2, 1, 3)).toBe(2);
        expect(stepCustomSelectIndex(0, -1, 3)).toBe(0);
        expect(stepCustomSelectIndex(1, 1, 3)).toBe(2);
        expect(stepCustomSelectIndex(5, 1, 3)).toBe(0);
        expect(stepCustomSelectIndex(0, 1, 0)).toBe(-1);
    });
});
