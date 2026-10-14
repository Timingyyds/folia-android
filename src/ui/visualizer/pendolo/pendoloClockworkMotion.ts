import type { PendoloMotionProfile } from './pendoloMotionProfile';

// src/ui/visualizer/pendolo/pendoloClockworkMotion.ts
// Balance-wheel phase + seconds-gear spring simulation for Pendolo clockwork.

export interface PendoloClockworkMotionState {
    phase: number;
    smoothedBass: number;
    secondGearElapsed: number;
    secondGearStep: number;
    secondGearAngle: number;
    secondGearVelocity: number;
}

export interface PendoloClockworkMotionStepResult {
    bass: number;
    bassOscillation: number;
    secondGearAngle: number;
    phase: number;
}

/** Creates the mutable simulation state carried across RAF frames. */
export const createPendoloClockworkMotionState = (): PendoloClockworkMotionState => ({
    phase: 0,
    smoothedBass: 0.15,
    secondGearElapsed: 0,
    secondGearStep: 0,
    secondGearAngle: 0,
    secondGearVelocity: 0,
});

/** Normalizes analyser bass values that may arrive as 0..1 or 0..255. */
export const normalizePendoloBass = (value: number): number => {
    const norm = value > 1 ? value / 255 : value;
    return Math.max(0, Math.min(1, norm));
};

/**
 * Advances balance-wheel phase and seconds-gear spring toward the next tooth.
 * When paused, only returns derived oscillation from the frozen phase.
 */
export const stepPendoloClockworkMotion = (
    state: PendoloClockworkMotionState,
    dt: number,
    rawBass: number,
    paused: boolean,
    profile: PendoloMotionProfile,
): PendoloClockworkMotionStepResult => {
    // Fetch real-time audio bass value directly from MotionValue (handling 0..255 byte scale)
    const clampedBass = normalizePendoloBass(rawBass);
    state.smoothedBass += (clampedBass - state.smoothedBass)
        * Math.min(0.24, 0.12 * profile.bassResponseMultiplier);
    const bass = state.smoothedBass;

    // 1. Balance wheel phase accumulation & harmonic swing (Audio Bass regulator)
    if (!paused) {
        state.phase += dt
            * (2.8 + bass * 3.5 * profile.bassResponseMultiplier)
            * profile.balanceSpeedMultiplier;
        state.secondGearElapsed += dt;
        const completedSteps = Math.floor(state.secondGearElapsed);
        if (completedSteps > 0) {
            state.secondGearStep += completedSteps;
            state.secondGearElapsed -= completedSteps;
        }
        const secondGearTarget = state.secondGearStep * (Math.PI * 2 / 15);
        const displacement = secondGearTarget - state.secondGearAngle;
        state.secondGearVelocity += displacement * 92 * profile.escapementSpringMultiplier * dt;
        state.secondGearVelocity *= Math.exp(-13 * profile.escapementDampingMultiplier * dt);
        state.secondGearAngle += state.secondGearVelocity * dt;
    }

    const bassOscillation = Math.sin(state.phase)
        * (0.15 + bass * 0.70 * profile.bassResponseMultiplier)
        * profile.balanceAmplitudeMultiplier;

    return {
        bass,
        bassOscillation,
        secondGearAngle: state.secondGearAngle,
        phase: state.phase,
    };
};
