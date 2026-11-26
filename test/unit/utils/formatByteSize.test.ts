import { describe, expect, it } from 'vitest';
import { formatByteSize } from '../../../src/utils/formatByteSize';

// test/unit/utils/formatByteSize.test.ts
// The shared byte-size label: binary steps, at most two decimals, never "1024 KB", and an
// invalid measurement shown as a dash rather than as an empty "0 B".

describe('formatByteSize', () => {
    it.each([
        [0, '0 B'],
        [1, '1 B'],
        [1023, '1023 B'],
        [1024, '1 KB'],
        [1536, '1.5 KB'],
        [1024 * 1024 * 12.346, '12.35 MB'],
        [3 * 1024 ** 3, '3 GB'],
        [2 * 1024 ** 4, '2 TB'],
        [5000 * 1024 ** 4, '5000 TB'],
    ])('formats %d bytes as %s', (bytes, expected) => {
        expect(formatByteSize(bytes)).toBe(expected);
    });

    it('moves a value that rounds up to 1024 into the next unit', () => {
        expect(formatByteSize(1024 * 1024 - 1)).toBe('1 MB');
        expect(formatByteSize(1024 * 1023.999)).toBe('1 MB');
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('shows %s as a dash', (bytes) => {
        expect(formatByteSize(bytes)).toBe('—');
    });
});
