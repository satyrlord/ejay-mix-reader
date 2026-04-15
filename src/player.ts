// Thin wrapper around HTMLAudioElement for sample playback.

export type PlayerState = "stopped" | "playing";

/**
 * Calculate the progress polling interval for a given sample duration.
 * Targets ~20 updates per playback, clamped between 50 ms and 250 ms.
 * Returns 250 ms when the duration is 0 or unknown.
 */
export function calcProgressInterval(durationSec: number): number {
  if (durationSec <= 0) return 250;
  return Math.round(Math.max(50, Math.min(250, (durationSec * 1000) / 20)));
}

type PlayerListener = (state: PlayerState) => void;

export class Player {
  private audio = new Audio();
  private currentPath: string | null = null;
  private listeners: PlayerListener[] = [];

  /* istanbul ignore next -- depends on real audio completing playback */
  private readonly onEnded = (): void => { this.emitState("stopped"); };
  /* istanbul ignore next -- race with stop(); guard prevents double-emit */
  private readonly onPause = (): void => {
    if (this.audio.ended || this.audio.currentTime === 0) return;
    this.emitState("stopped");
  };

  constructor() {
    this.audio.addEventListener("ended", this.onEnded);
    this.audio.addEventListener("pause", this.onPause);
  }

  get state(): PlayerState {
    return this.audio.paused ? "stopped" : "playing";
  }

  get activePath(): string | null {
    return this.audio.paused ? null : this.currentPath;
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }

  get duration(): number {
    return this.audio.duration || 0;
  }

  onStateChange(fn: PlayerListener): void {
    this.listeners.push(fn);
  }

  toggle(path: string): void {
    if (this.currentPath === path && !this.audio.paused) {
      this.stop();
      return;
    }
    this.play(path);
  }

  play(path: string): void {
    if (this.currentPath !== path) {
      this.audio.src = path;
      this.currentPath = path;
    }
    this.audio.currentTime = 0;
    void this.audio.play()
      .then(() => this.emitState("playing"))
      .catch((err: unknown) => {
        console.warn("Audio playback failed:", err);
        this.emitState("stopped");
      });
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.emitState("stopped");
  }

  /** Release event listeners. Call when the Player instance is no longer needed. */
  destroy(): void {
    this.audio.removeEventListener("ended", this.onEnded);
    this.audio.removeEventListener("pause", this.onPause);
    this.listeners = [];
  }

  private emitState(state: PlayerState): void {
    for (const fn of this.listeners) fn(state);
  }
}
