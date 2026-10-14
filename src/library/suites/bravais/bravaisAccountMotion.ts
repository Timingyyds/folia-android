import type { Transition } from 'framer-motion';

// src/library/suites/bravais/bravaisAccountMotion.ts
// 首页窄缝底部账户入口的平台列表怎么弹出 / 收起（fb4，设计稿 §10.7）：列表从按钮往上长出来，盖在导航区上。
// 正常：从按钮那一侧（底边中点）放大 + 往上位移 + 渐显；收起反过来、稍快。降低动态效果（bravais 沿用的「队列拼贴」
// 或「界面微动效」任一降级）时只剩短渐变，不缩放、不位移。只是数据，交给 motion.div。

type BravaisPopFrame = { opacity: number; scale?: number; y?: number };

export type BravaisAccountPopMotion = {
    initial: BravaisPopFrame;
    animate: BravaisPopFrame;
    exit: BravaisPopFrame & { transition: Transition };
    transition: Transition;
    /** 缩放的原点：按钮在列表下面，所以是底边中点。 */
    transformOrigin: string;
};

const POP_EASE = [0.22, 1, 0.36, 1] as const;

/** 平台列表弹出 / 收起的动效参数；`reduced` 时只做短渐变。 */
export const resolveBravaisAccountPopMotion = (reduced: boolean): BravaisAccountPopMotion => (reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: { duration: 0.1, ease: 'linear' } },
        transition: { duration: 0.12, ease: 'linear' },
        transformOrigin: '50% 100%',
    }
    : {
        initial: { opacity: 0, scale: 0.88, y: 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.94, y: 8, transition: { duration: 0.12, ease: 'easeIn' } },
        transition: { duration: 0.2, ease: POP_EASE },
        transformOrigin: '50% 100%',
    });
