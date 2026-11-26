import { expect, test, type Page } from '@playwright/test';
import { installBaseState, localImportFixture, mockNeteaseApi, openApp } from './helpers/appFixtures';
import { waitForAppMounted } from '../helpers/appState';

// test/ui/localPureMusicMark.spec.ts
// 本地歌曲的「标记为纯音乐」在真实应用里的三条入口与它的后果：
// - 播放页右侧面板 → 本地页签 → 在线匹配（LyricMatchModal）里的开关：关窗、不重新播放、当前歌词就地清空，
//   本地页签的歌词来源读作「纯音乐」，再打开窗口按钮变成「取消纯音乐标记」；在同一个窗口里选中并保存一个
//   网易判定为纯音乐（没有歌词行）的候选，也按纯音乐标记保存；
// - 资料库网格聚焦卡上的铅笔（LocalSongMetadataMatchDialog）：同一个开关，徽标「纯音乐」，取消后本地歌词就地回来；
// - 命令面板的 playback-toggle-pure-music：只在当前是本地歌曲时出现，执行一次标记、再执行一次取消。
// 标记要落进 IndexedDB 的歌曲记录（重载后仍在），并且被标记的歌重新播放时不再自动搜索歌词——用「在线歌词优先」
// 的设置做对照：没标记时播放会发出网易 cloudsearch，标记后同样的播放一个都没有，取消标记后又恢复。
// 数据是导入的本地曲库（一首「Test Artist - Midnight Train」，带一份本地 .lrc）。界面语言是 en。

test.use({ screenshot: 'only-on-failure' });

const SONG_FILE = 'Test Artist - Midnight Train.mp3';
const LOCAL_LYRIC_LINE = 'Leaves the station';
const MARKED_TOAST = 'Marked as instrumental; lyrics will no longer be matched automatically';
const UNMARKED_TOAST = 'Instrumental mark removed; lyrics will be matched automatically next time it plays';

type AppModuleWindow = Window & { __appModule: (path: string) => Promise<Record<string, any>> };

/**
 * 导入固件曲库并停在网格首页。onlineFirst 打开「在线歌词优先」（并关掉跨平台最佳歌词，让自动匹配只走网易
 * 的 mock）：只有这样，带本地 .lrc 的这首歌在播放时才会去自动匹配，「不再自动匹配」才有对照可看。
 */
const boot = async (page: Page, { onlineFirst = false } = {}) => {
    await installBaseState(page, { neteaseMode: 'guest', localImportFixture });
    // 排在 installBaseState 之后：它的种子脚本会先 localStorage.clear()。
    await page.addInitScript((online) => {
        localStorage.setItem('playback_entry_view', 'player');
        localStorage.setItem('playback_entry_view_chosen', 'true');
        if (online) {
            localStorage.setItem('local_lyrics_priority', 'online');
            localStorage.setItem('auto_use_best_lyric', 'false');
        }
        // 与其他 spec 一样按裸路径取应用模块（拿到的是应用正在用的同一份 store）。
        (window as unknown as AppModuleWindow).__appModule = (path: string) => import(/* @vite-ignore */ path);
    }, onlineFirst);
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
};

/** 记下歌词自动匹配发出的网易搜索（mock 的 cloudsearch）与对应的日志。 */
const trackLyricSearches = (page: Page) => {
    const searches: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('__mock_netease__/cloudsearch')) searches.push(request.url());
    });
    page.on('console', (message) => {
        if (message.text().startsWith('[LocalMusic] Searching lyrics for')) searches.push(message.text());
    });
    return searches;
};

const playbackSnapshot = (page: Page) => page.evaluate(async () => {
    const load = (window as unknown as AppModuleWindow).__appModule;
    const [{ usePlaybackStore }, { useAppViewStore }] = await Promise.all([
        load('/src/stores/usePlaybackStore.ts'),
        load('/src/stores/useAppViewStore.ts'),
    ]);
    const state = usePlaybackStore.getState();
    return {
        song: (state.currentSong?.name ?? null) as string | null,
        isPureMusic: Boolean(state.currentSong?.isPureMusic),
        lines: (state.lyrics?.lines.map((line: { fullText: string }) => line.fullText) ?? null) as string[] | null,
        lyricSource: (state.activeLocalLyricsSource ?? null) as string | null,
        // 重新播放会铸一个新的 blob URL 换进 <audio>：它不变就是没有重新播放。
        audioSrc: [...document.querySelectorAll('audio')].map(node => node.getAttribute('src')).filter(Boolean).join(' '),
        view: useAppViewStore.getState().view as string,
    };
});

/** IndexedDB 里这首歌的记录（经应用自己的 db 模块读）。 */
const storedSong = (page: Page) => page.evaluate(async (fileName) => {
    const { getLocalSongs } = await (window as unknown as AppModuleWindow).__appModule('/src/services/db.ts');
    const song = (await getLocalSongs()).find((item: { fileName: string }) => item.fileName === fileName);
    return song ? {
        markedPureMusic: Boolean(song.markedPureMusic),
        matchedIsPureMusic: Boolean(song.matchedIsPureMusic),
        lyricsSource: (song.lyricsSource ?? null) as string | null,
    } : null;
}, SONG_FILE);

/** 打开「全部歌曲」，用网格卡片上的播放键开始播放，进入播放页，当前歌词是本地 .lrc。 */
const playFromGrid = async (page: Page) => {
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    await page.locator('[data-library-renderer="grid"] [data-grid-card-play="play"]').first().dispatchEvent('click');
    await expect.poll(async () => (await playbackSnapshot(page)).song).toBe('Midnight Train');
    await expect.poll(async () => (await playbackSnapshot(page)).view).toBe('player');
    await expectLocalLyricsShown(page);
};

/**
 * 当前歌词以播放 store 为准：屏幕上的字幕层只在音频真的在走时才重算当前行，假音频放不出声，
 * 它画不画本地 .lrc 取决于时序（实测时有时无），就地换歌词后（setCurrentLineIndex(-1)）更是一直空着，
 * 拿它判断「歌词在 / 歌词回来了」不可靠。清空时仍顺带确认屏幕上没有那一行。
 */
const expectLocalLyricsShown = async (page: Page) => {
    await expect.poll(async () => {
        const state = await playbackSnapshot(page);
        return { lines: state.lines, lyricSource: state.lyricSource, isPureMusic: state.isPureMusic };
    }).toEqual({ lines: ['Midnight Train', LOCAL_LYRIC_LINE], lyricSource: 'local', isPureMusic: false });
};

const expectLyricsCleared = async (page: Page) => {
    await expect.poll(async () => {
        const state = await playbackSnapshot(page);
        return { lines: state.lines, lyricSource: state.lyricSource, isPureMusic: state.isPureMusic };
    }).toEqual({ lines: null, lyricSource: 'online', isPureMusic: true });
    await expect(page.getByText(LOCAL_LYRIC_LINE, { exact: true })).toHaveCount(0);
};

const panel = (page: Page) => page.getByTestId('unified-panel-surface');

/** 用面板开关打开播放页右侧面板，切到本地页签。 */
const openLocalTab = async (page: Page) => {
    if (await panel(page).count() === 0) await page.getByTestId('panel-toggle').click();
    await expect(panel(page)).toBeVisible();
    await panel(page).locator('[data-ponder-panel-tab-button="local"]').click();
    await expect(panel(page).getByRole('button', { name: 'Match Online' })).toBeVisible();
};

const lyricMatchModal = (page: Page) => page.locator('[data-folia-keyboard-window]')
    .filter({ has: page.getByRole('heading', { name: 'Match Data', exact: true }) });

const metadataDialog = (page: Page) => page.getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Manual Online Match', exact: true }) });

/** 网格「全部歌曲」里聚焦卡上的铅笔（歌名悬停时出现），打开 LocalSongMetadataMatchDialog。 */
const openMetadataDialog = async (page: Page) => {
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    await page.locator('[data-library-renderer="grid"] [data-ponder="local-metadata-match"]').click();
    await expect(metadataDialog(page)).toBeVisible();
};

const palette = (page: Page) => page.getByTestId('command-palette-panel');
const paletteRow = (page: Page) => palette(page).getByText('Mark or unmark as instrumental', { exact: true });

const searchPalette = async (page: Page, query: string) => {
    await expect.poll(async () => {
        await page.keyboard.press('ControlOrMeta+k');
        return palette(page).count();
    }).toBeGreaterThan(0);
    await palette(page).getByRole('combobox').fill(query);
};

const runPaletteToggle = async (page: Page) => {
    await searchPalette(page, '纯音乐');
    await expect(paletteRow(page).first()).toBeVisible();
    await paletteRow(page).first().click();
    await expect(palette(page)).toHaveCount(0);
};

/**
 * 回到网格，用筛选框的 --play 重新播放这首（它已是当前歌曲，卡片上的播放键只会暂停 / 继续）。
 * 返回时自动匹配那一段已经跑完：播放先换一次 currentSong，匹配流程收尾时再换一次。
 */
const replayFromGrid = async (page: Page) => {
    const before = (await playbackSnapshot(page)).audioSrc;
    await page.goBack();
    await expect(page.locator('[data-library-renderer="grid"]')).toHaveCount(1);
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    const filterBox = page.getByTestId('command-palette-filter');
    await expect.poll(async () => {
        await page.keyboard.press('m');
        return filterBox.count();
    }).toBeGreaterThan(0);
    await page.evaluate(async () => {
        const { usePlaybackStore } = await (window as unknown as AppModuleWindow).__appModule('/src/stores/usePlaybackStore.ts');
        const w = window as unknown as { __songUpdates: number; __stopSongUpdates?: () => void };
        w.__stopSongUpdates?.();
        w.__songUpdates = 0;
        w.__stopSongUpdates = usePlaybackStore.subscribe((state: { currentSong: unknown }, previous: { currentSong: unknown }) => {
            if (state.currentSong !== previous.currentSong) w.__songUpdates += 1;
        });
    });
    await filterBox.getByRole('combobox').fill('midnight --play');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await playbackSnapshot(page)).audioSrc).not.toBe(before);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __songUpdates: number }).__songUpdates)).toBeGreaterThanOrEqual(2);
    expect((await playbackSnapshot(page)).song).toBe('Midnight Train');
};

test('the player lyric match window marks the playing song as instrumental in place and unmarks it again', async ({ page }) => {
    await boot(page);
    await playFromGrid(page);
    await openLocalTab(page);
    await expect(panel(page).getByTitle('Local', { exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Instrumental', exact: true })).toHaveCount(0);
    const playing = await playbackSnapshot(page);

    await panel(page).getByRole('button', { name: 'Match Online' }).click();
    await expect(lyricMatchModal(page)).toBeVisible();
    const markButton = lyricMatchModal(page).getByRole('button', { name: 'Mark as instrumental', exact: true });
    await expect(markButton).toHaveAttribute('aria-pressed', 'false');
    await markButton.click();

    // 关窗，不重新播放（同一首、同一个音频 URL、还在播放页），当前歌词就地清空。
    await expect(lyricMatchModal(page)).toHaveCount(0);
    await expect(page.getByText(MARKED_TOAST)).toBeVisible();
    await expectLyricsCleared(page);
    const marked = await playbackSnapshot(page);
    expect({ song: marked.song, audioSrc: marked.audioSrc, view: marked.view })
        .toEqual({ song: playing.song, audioSrc: playing.audioSrc, view: 'player' });
    expect(await storedSong(page)).toEqual({ markedPureMusic: true, matchedIsPureMusic: true, lyricsSource: 'online' });

    // 本地页签：歌词状态与来源都读作「纯音乐」，选中的是它。
    await openLocalTab(page);
    await expect(panel(page).getByTitle('Local / Instrumental', { exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Instrumental', exact: true })).toBeVisible();

    // 再打开窗口：按钮变成取消，歌词来源标签读作「纯音乐」。
    await panel(page).getByRole('button', { name: 'Match Online' }).click();
    await expect(lyricMatchModal(page)).toBeVisible();
    const unmarkButton = lyricMatchModal(page).getByRole('button', { name: 'Unmark instrumental', exact: true });
    await expect(unmarkButton).toHaveAttribute('aria-pressed', 'true');
    await expect(lyricMatchModal(page).getByText('Instrumental', { exact: true })).toBeVisible();
    await unmarkButton.click();

    await expect(lyricMatchModal(page)).toHaveCount(0);
    await expect(page.getByText(UNMARKED_TOAST)).toBeVisible();
    await expectLocalLyricsShown(page);
    expect((await playbackSnapshot(page)).audioSrc).toBe(playing.audioSrc);
    expect(await storedSong(page)).toEqual({ markedPureMusic: false, matchedIsPureMusic: false, lyricsSource: null });
    await openLocalTab(page);
    await expect(panel(page).getByTitle('Local', { exact: true })).toBeVisible();
});

test('a marked song is not auto-matched when replayed, and the mark survives a reload', async ({ page }) => {
    await boot(page, { onlineFirst: true });
    const searches = trackLyricSearches(page);

    // 对照：没标记时，在线优先下播放会自动搜索歌词（mock 没有结果，本地 .lrc 照常显示）。
    await playFromGrid(page);
    await expect.poll(() => searches.length).toBeGreaterThan(0);

    // 用命令面板标记：匹配窗口一打开就会自己搜一次，那次搜索会和下面要数的混在一起。
    await runPaletteToggle(page);
    await expectLyricsCleared(page);

    // 重新播放：匹配流程跑完了，一次搜索都没有，歌词仍是空的，本地页签仍读作「纯音乐」。
    searches.length = 0;
    await replayFromGrid(page);
    await page.waitForTimeout(1000);
    expect(searches).toEqual([]);
    await expectLyricsCleared(page);
    await openLocalTab(page);
    await expect(panel(page).getByTitle('Local / Instrumental', { exact: true })).toBeVisible();

    // 重载：记录还在 IndexedDB 里，资料库里的匹配窗口照样认出它。
    await page.reload();
    await waitForAppMounted(page);
    expect(await storedSong(page)).toEqual({ markedPureMusic: true, matchedIsPureMusic: true, lyricsSource: 'online' });
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await openMetadataDialog(page);
    await expect(metadataDialog(page).getByText('Instrumental', { exact: true })).toBeVisible();
    await expect(metadataDialog(page).getByRole('button', { name: 'Unmark instrumental', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('the library match dialog toggles the mark and the playing song follows in place', async ({ page }) => {
    await boot(page);
    await playFromGrid(page);
    const playing = await playbackSnapshot(page);
    await page.goBack();
    await expect(page.locator('[data-library-renderer="grid"]')).toHaveCount(1);

    await openMetadataDialog(page);
    await expect(metadataDialog(page).getByText('Instrumental', { exact: true })).toHaveCount(0);
    const markButton = metadataDialog(page).getByRole('button', { name: 'Mark as instrumental', exact: true });
    await expect(markButton).toHaveAttribute('aria-pressed', 'false');
    await markButton.click();
    await expect(metadataDialog(page)).toHaveCount(0);
    await expect.poll(() => storedSong(page)).toEqual({ markedPureMusic: true, matchedIsPureMusic: true, lyricsSource: 'online' });
    await expect.poll(async () => {
        const state = await playbackSnapshot(page);
        return { song: state.song, lines: state.lines, lyricSource: state.lyricSource, audioSrc: state.audioSrc };
    }).toEqual({ song: 'Midnight Train', lines: null, lyricSource: 'online', audioSrc: playing.audioSrc });

    await openMetadataDialog(page);
    await expect(metadataDialog(page).getByText('Instrumental', { exact: true })).toBeVisible();
    const unmarkButton = metadataDialog(page).getByRole('button', { name: 'Unmark instrumental', exact: true });
    await expect(unmarkButton).toHaveAttribute('aria-pressed', 'true');
    await unmarkButton.click();
    await expect(metadataDialog(page)).toHaveCount(0);
    await expect.poll(() => storedSong(page)).toEqual({ markedPureMusic: false, matchedIsPureMusic: false, lyricsSource: null });

    // 本地歌词就地回来：同一首、没有重新播放；回到播放页，本地页签不再读作「纯音乐」。
    await expect.poll(async () => {
        const state = await playbackSnapshot(page);
        return { song: state.song, lines: state.lines, lyricSource: state.lyricSource, audioSrc: state.audioSrc };
    }).toEqual({ song: 'Midnight Train', lines: ['Midnight Train', LOCAL_LYRIC_LINE], lyricSource: 'local', audioSrc: playing.audioSrc });
    await page.goForward();
    await expect.poll(async () => (await playbackSnapshot(page)).view).toBe('player');
    await openLocalTab(page);
    await expect(panel(page).getByTitle('Local', { exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Instrumental', exact: true })).toHaveCount(0);
});

test('the command palette toggles the mark for the current local song only', async ({ page }) => {
    await boot(page, { onlineFirst: true });
    const searches = trackLyricSearches(page);

    // 没有本地歌曲在放时，命令不出现。
    await searchPalette(page, '纯音乐');
    await page.waitForTimeout(400);
    await expect(paletteRow(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);

    await playFromGrid(page);
    await expect.poll(() => searches.length).toBeGreaterThan(0);
    const playing = await playbackSnapshot(page);

    await runPaletteToggle(page);
    await expect(page.getByText(MARKED_TOAST)).toBeVisible();
    await expectLyricsCleared(page);
    expect((await playbackSnapshot(page)).audioSrc).toBe(playing.audioSrc);
    expect(await storedSong(page)).toEqual({ markedPureMusic: true, matchedIsPureMusic: true, lyricsSource: 'online' });

    await runPaletteToggle(page);
    await expect(page.getByText(UNMARKED_TOAST)).toBeVisible();
    await expectLocalLyricsShown(page);
    expect((await playbackSnapshot(page)).audioSrc).toBe(playing.audioSrc);
    expect(await storedSong(page)).toEqual({ markedPureMusic: false, matchedIsPureMusic: false, lyricsSource: null });

    // 取消标记后自动匹配恢复：再播一次又会去搜索。
    searches.length = 0;
    await replayFromGrid(page);
    await expect.poll(() => searches.length).toBeGreaterThan(0);
});

test('saving a provider result that is pure music in the player window marks the song too', async ({ page }) => {
    await boot(page);
    // 搜索给出一首网易标成纯音乐的候选（歌词只有提示语）；以前选它保存，歌词上什么都不记。
    await page.route('**/__mock_netease__/cloudsearch?*', route => route.fulfill({
        json: {
            result: {
                songCount: 1,
                songs: [{
                    id: 424242,
                    name: 'Midnight Train',
                    ar: [{ id: 1, name: 'Test Artist' }],
                    al: { id: 2, name: 'Night Instrumentals' },
                    dt: 126000,
                }],
            },
        },
    }));
    await page.route('**/__mock_netease__/lyric/new?*', route => route.fulfill({
        json: { pureMusic: true, lrc: { lyric: '[00:00.00]纯音乐，请欣赏' } },
    }));
    await playFromGrid(page);

    await openLocalTab(page);
    await panel(page).getByRole('button', { name: 'Match Online' }).click();
    await expect(lyricMatchModal(page)).toBeVisible();
    await lyricMatchModal(page).getByText('Test Artist · Night Instrumentals', { exact: true }).click();
    await lyricMatchModal(page).getByRole('button', { name: 'Save', exact: true }).click();

    await expect(lyricMatchModal(page)).toHaveCount(0);
    await expect.poll(() => storedSong(page)).toEqual({ markedPureMusic: true, matchedIsPureMusic: true, lyricsSource: 'online' });
    await expectLyricsCleared(page);
    expect((await playbackSnapshot(page)).song).toBe('Midnight Train');
    await openLocalTab(page);
    await expect(panel(page).getByTitle('Local / Instrumental', { exact: true })).toBeVisible();
});
