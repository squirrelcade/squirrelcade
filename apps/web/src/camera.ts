/**
 * The camera kept ready between scans for a while (D162, Settings > Interface > "Keep the camera ready between scans"):
 * a scan that ends hands its camera back instead of turning it off, and the next scan within that time takes it again,
 * so a run of scans starts at once and the browser asks for the camera once (iPhone Safari asked for every scan, the
 * owner found). It turns off when the time is up, or at once when asked (the page hidden, say).
 */
export interface CameraKeeper {
  /** The camera kept ready, or a new one. */
  open(): Promise<MediaStream>;
  /** A scan is done with it: kept ready `keepMs` (its light off meanwhile), or turned off at once for 0. */
  release(stream: MediaStream, keepMs: number): void;
  /** Turns the kept camera off now. */
  stop(): void;
}

const stopTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};
const live = (stream: MediaStream) => stream.getVideoTracks().some((track) => track.readyState === 'live');

export function cameraKeeper(getStream: () => Promise<MediaStream>): CameraKeeper {
  let held: { stream: MediaStream; timer: ReturnType<typeof setTimeout> } | null = null;
  const keeper: CameraKeeper = {
    async open() {
      const kept = held;
      held = null;
      if (kept) {
        clearTimeout(kept.timer);
        // Still on (iOS can end it on its own, a call coming in): taken as it is; else a new one.
        if (live(kept.stream)) return kept.stream;
        stopTracks(kept.stream);
      }
      return getStream();
    },
    release(stream, keepMs) {
      // A light left on (Android's torch) isn't kept on while nobody scans.
      for (const track of stream.getVideoTracks()) {
        track.applyConstraints?.({ advanced: [{ torch: false } as MediaTrackConstraintSet] })?.catch(() => undefined);
      }
      if (held?.stream !== stream) keeper.stop();
      else clearTimeout(held.timer);
      if (keepMs <= 0) {
        held = null;
        stopTracks(stream);
        return;
      }
      held = { stream, timer: setTimeout(() => keeper.stop(), keepMs) };
    },
    stop() {
      const kept = held;
      held = null;
      if (!kept) return;
      clearTimeout(kept.timer);
      stopTracks(kept.stream);
    },
  };
  return keeper;
}
