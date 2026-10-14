import { useEffect } from 'react';

type NativeMediaActions = {
  play: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  toggle: () => void | Promise<void>;
  next: () => void | Promise<void>;
  previous: () => void | Promise<void>;
  seek?: (seconds: number) => void | Promise<void>;
};

export const useNativeMediaActions = (actions: NativeMediaActions) => {
  useEffect(() => {
    const listener = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === 'play') void actions.play();
      else if (action === 'pause') void actions.pause();
      else if (action === 'toggle') void actions.toggle();
      else if (action === 'next') void actions.next();
      else if (action === 'previous') void actions.previous();
      else if (action.startsWith('seek:')) {
        const seconds = Number(action.slice(5)) / 1000;
        if (Number.isFinite(seconds)) void actions.seek?.(seconds);
      }
    };
    window.addEventListener('folia-native-media-action', listener);
    return () => window.removeEventListener('folia-native-media-action', listener);
  }, [actions.next, actions.pause, actions.play, actions.previous, actions.toggle]);
};
