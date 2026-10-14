import React, { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ListFilter, X } from 'lucide-react';
import type { BravaisSeamFilter } from './bravaisSeamModels';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { bravaisRevealMotion } from './bravaisSeamMotion';
import { registerBravaisFilterInput, setBravaisFilterComposing, setBravaisFilterEditing, useBravaisUiStore } from './bravaisUiStore';
import { focusBravaisFilterInput } from './useBravaisSeamFilter';

// src/library/suites/bravais/BravaisSeamFilterField.tsx
// 缝里的「过滤当前页」输入位（设计稿 §7.6）：缝自己的样式（缝的字体与墨色、一道下划线，聚焦时下划线换强调色），不是
// 命令面板的内联框。与「搜索在线平台」明确区分：过滤是漏斗图标 + 下划线 + 「过滤当前页」，就在这面墙的信息条 / 面板 /
// 首页窄缝里，只收窄当前墙、不发请求；搜索是放大镜 + 带框的输入框 + 「搜索」按钮，占整条缝（书库 › 搜索）。
// - 值：打过字之后是本地草稿（每一下按键先进草稿再写 query，不等层描述绕一圈回来，光标与输入法组词不被打断），失焦后
//   跟着 query（清除按钮、墙上 Esc 阶梯清掉的、命令面板浮层里改的）。
// - 键：Esc 有词先清空、没词结束输入（焦点离开输入框）；↓ / Enter 把键盘焦点交给墙上的 rank 0（过滤词保留）；
//   输入法组词期间都不处理。
// - 「正在输入」（bravaisUiStore.filterEditing）：聚焦即开始；失焦结束——但输入位随缝翻走（卸载、翻走的那一半 inert）
//   时不算，换上来的那份接着拿焦点。
// - 有词时右边是匹配数（变了新字翻进来）与清除。`variant`：完整信息条 / 面板是一行；首页窄缝（120px）里匹配数另起一行。

const BravaisSeamFilterField: React.FC<{ filter: BravaisSeamFilter; variant?: 'strip' | 'panel' | 'home' }> = ({ filter, variant = 'strip' }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState<string | null>(null);
    const value = draft ?? filter.query;
    const editing = useBravaisUiStore(state => state.filterEditing);
    const reveal = bravaisRevealMotion(useBravaisReducedTransitions());

    useLayoutEffect(() => {
        const input = inputRef.current;
        return input ? registerBravaisFilterInput(input) : undefined;
    }, []);
    // 「正在输入」时挂上（缝从书脊 / 折叠临时展开、面板与信息条之间换形态）或被要求打开：拿焦点，光标在末尾。
    useEffect(() => {
        if (editing) focusBravaisFilterInput();
    }, [editing]);

    const write = (next: string, typed = false) => {
        if (typed || inputRef.current === document.activeElement) setDraft(next);
        filter.setQuery(next);
    };

    const onBlur = () => {
        setDraft(null);
        setBravaisFilterComposing(false);
        const input = inputRef.current;
        // 翻牌把输入位换走（卸载、翻走的那一半变 inert）不是「结束输入」：换上来的那份会接着拿焦点。
        window.setTimeout(() => {
            if (!input || !input.isConnected || input.closest('[inert]')) return;
            if (document.activeElement === input || useBravaisUiStore.getState().filterInput !== input) return;
            setBravaisFilterEditing(false);
        }, 0);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (value) {
                write('');
                return;
            }
            setBravaisFilterEditing(false);
            inputRef.current?.blur();
            return;
        }
        if ((event.key === 'ArrowDown' && !event.shiftKey) || (event.key === 'Enter' && !event.shiftKey)) {
            // 交给墙之后同一下按键不能再冒泡到墙的方向键处理（焦点会多走一格）。
            const handed = useBravaisUiStore.getState().focusFirst?.() ?? false;
            if (!handed && event.key === 'ArrowDown') return;
            event.preventDefault();
            event.stopPropagation();
            setBravaisFilterEditing(false);
            if (!handed) inputRef.current?.blur();
        }
    };

    return (
        <div
            className={`bravais-seam-filter-field is-${variant}${value ? ' has-query' : ''}${editing ? ' is-editing' : ''}`}
            data-bravais-seam-filter={value ? 'active' : 'idle'}
            data-bravais-seam-filter-variant={variant}
            data-bravais-input-kind="filter"
        >
            <label className="bravais-seam-filter-line">
                <ListFilter aria-hidden className="bravais-seam-filter-icon" />
                <input
                    ref={inputRef}
                    type="text"
                    data-bravais-filter-input
                    value={value}
                    placeholder={filter.placeholder}
                    aria-label={filter.placeholder}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="done"
                    // 聚焦时不拍快照：打字触发、输入位刚挂上时，第一下按键追加进 query 的值可能还在路上（层描述晚一拍），
                    // 第一次 onChange 才开始用草稿。
                    onFocus={() => setBravaisFilterEditing(true)}
                    onBlur={onBlur}
                    onChange={event => write(event.target.value, true)}
                    onCompositionStart={() => setBravaisFilterComposing(true)}
                    onCompositionEnd={event => {
                        setBravaisFilterComposing(false);
                        write(event.currentTarget.value);
                    }}
                    onKeyDown={onKeyDown}
                />
                {variant !== 'home' && value && (
                    <BravaisSeamFlipText as="span" flipKey={filter.matchLabel} className="bravais-seam-filter-count" data-bravais-filter-count>
                        {filter.matchLabel}
                    </BravaisSeamFlipText>
                )}
                {value && (
                    <button
                        type="button"
                        className="bravais-seam-filter-clear"
                        data-bravais-seam-action="clear-filter"
                        aria-label={filter.clearLabel}
                        title={filter.clearLabel}
                        // 按下时不抢走输入框的焦点：清空后接着打字。
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => write('')}
                    >
                        <X aria-hidden />
                    </button>
                )}
            </label>
            <AnimatePresence initial={false}>
                {variant === 'home' && value && (
                    <motion.div key="count" className="bravais-seam-filter-count-line" {...reveal}>
                        <BravaisSeamFlipText as="span" flipKey={filter.matchLabel} className="bravais-seam-filter-count" data-bravais-filter-count>
                            {filter.matchLabel}
                        </BravaisSeamFlipText>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default BravaisSeamFilterField;
