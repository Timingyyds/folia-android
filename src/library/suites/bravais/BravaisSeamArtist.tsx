import React from 'react';
import { Disc } from 'lucide-react';
import { getSizedCoverUrl } from '../../../lib/coverUrl';
import type { BravaisSeamArtist as BravaisSeamArtistModel } from './bravaisSeamModels';
import BravaisSeamAbout from './BravaisSeamAbout';
import './bravaisArtist.css';

// src/library/suites/bravais/BravaisSeamArtist.tsx
// 完整信息条里歌手页的「关于艺术家」（设计稿 §10.4「缝承载 ArtistGridView 的信息」）：像书勒口上的作者简介——
// 不加小节标题，头像与名字（下面一行别名）作为署名，简介是正文（截断 + 展开 / 收起，与集合页的描述共用 BravaisSeamAbout），
// 统计（「N 首歌 · M 张专辑」）是最后一行附注；元数据行与它相同时缝不再重复显示（BravaisSeamContent）。文案都由 surface 翻译好。

const AVATAR_PX = 40;

const BravaisSeamArtist: React.FC<{ artist: BravaisSeamArtistModel }> = ({ artist }) => {
    const byline = (
        <div className="bravais-seam-artist-head">
            <span className="bravais-seam-artist-avatar" style={{ width: AVATAR_PX, height: AVATAR_PX }}>
                {artist.coverUrl ? (
                    <img src={getSizedCoverUrl(artist.coverUrl, 128)} alt={artist.name} draggable={false} decoding="async" />
                ) : (
                    <Disc aria-hidden />
                )}
            </span>
            <span className="bravais-seam-artist-facts">
                <span className="bravais-seam-artist-name" data-bravais-artist-name>{artist.name}</span>
                {artist.aliases && <span className="bravais-seam-artist-aliases" data-bravais-artist-aliases>{artist.aliases}</span>}
            </span>
        </div>
    );
    return (
        <BravaisSeamAbout
            data-bravais-seam-artist
            byline={byline}
            text={artist.description}
            textAttribute="data-bravais-artist-bio"
            note={artist.stats}
            noteAttribute="data-bravais-artist-stats"
        />
    );
};

export default BravaisSeamArtist;
