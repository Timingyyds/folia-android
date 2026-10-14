import type { AppView } from '../../../../state/useAppViewStore';
import type { StageTrackPillMode } from '../NowPlayingToast';

// src/ui/app/overlays/now-playing-toast/nowPlayingToastVisibility.ts
// Keeps the card and its next-track countdown on exactly the same set of app surfaces.
// The home page is opt-in (showOnHome), except when the library there is a wall like Lattice (bravais): the wall
// and Lattice are the same kind of surface, so the card is there as it is on Lattice (2026-10-10).

export const shouldShowNowPlayingToast = ({
    mode,
    view,
    showOnHome,
    homeIsWall = false,
}: {
    mode: StageTrackPillMode;
    view: AppView;
    showOnHome: boolean;
    /** The home page shows a wall library (bravais), which carries the card the way Lattice does. */
    homeIsWall?: boolean;
}) => mode !== 'never' && (
    view === 'player'
    || view === 'lattice'
    || (view === 'home' && (showOnHome || homeIsWall))
);
