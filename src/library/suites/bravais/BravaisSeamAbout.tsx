import React, { type ReactNode } from 'react';
import BravaisSeamBlurb from './BravaisSeamBlurb';
import './bravaisAbout.css';

// src/library/suites/bravais/BravaisSeamAbout.tsx
// 完整信息条里「关于」这一节（设计稿 §10.2「描述」、§10.4）：像书勒口上的作者简介，没有小节标题，层次靠内容本身——
// 可选的署名（歌手页：头像 + 名字 + 别名）一组，一段舒展的正文（BravaisSeamBlurb：4 行截断，点开 / 收起），
// 最后一行不抢眼的附注（歌手页：「N 首歌 · M 张专辑」）。歌手页与集合页共用这一套，只是署名与附注不同。
// 没有正文也没有署名时由调用方不渲染这一节（不占位）。

export type BravaisSeamAboutProps = {
    /** 署名一行（歌手页的头像与名字）；集合页没有。 */
    byline?: ReactNode;
    /** 正文；没有就只剩署名与附注。 */
    text?: string;
    /** 正文那一块挂的 data-* 属性（用例按它找），值是 expanded / collapsed。 */
    textAttribute: `data-${string}`;
    /** 正文下面的附注（统计），一行。 */
    note?: string;
    noteAttribute?: `data-${string}`;
} & { [attribute: `data-${string}`]: string | boolean | undefined };

const BravaisSeamAbout: React.FC<BravaisSeamAboutProps> = ({ byline, text, textAttribute, note, noteAttribute, ...rest }) => (
    <section className="bravais-seam-about" {...rest}>
        {byline}
        {text && <BravaisSeamBlurb text={text} className="bravais-seam-about-text" dataAttribute={textAttribute} />}
        {note && <p className="bravais-seam-about-note" {...(noteAttribute ? { [noteAttribute]: true } : {})}>{note}</p>}
    </section>
);

export default BravaisSeamAbout;
