import type { LocalSong } from '../types';

// src/lib/localSongRecordEquality.ts
// Compares local-song records by persisted content so a state patch can skip records that did not change.

const isPlainObject = (value: object): boolean => {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

// 结构化比较纯对象与数组；值为 undefined 的键视同不存在（内存对象常被赋 undefined，库里读回的则没有这个键）。
// 非纯对象（Blob、Date、Map 等）只按引用比较，宁可判成不同多回写一次，也不漏掉变化。
const isDeepEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((item, index) => isDeepEqual(item, right[index]));
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return false;

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).filter(key => leftRecord[key] !== undefined);
    const rightKeys = Object.keys(rightRecord).filter(key => rightRecord[key] !== undefined);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(key => isDeepEqual(leftRecord[key], rightRecord[key]));
};

/** 两条本地歌曲记录的持久化内容是否相同；fileHandle 只存在内存里，不参与比较。 */
export const isSameLocalSongRecord = (left: LocalSong, right: LocalSong): boolean => {
    if (left === right) return true;
    const { fileHandle: _leftHandle, ...leftPersisted } = left;
    const { fileHandle: _rightHandle, ...rightPersisted } = right;
    return isDeepEqual(leftPersisted, rightPersisted);
};
