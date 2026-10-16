import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraKeeper } from './camera';

/** A stand-in camera: one video track that's live until stopped. */
function fakeStream() {
  const track = { readyState: 'live' as 'live' | 'ended', stop: vi.fn(() => void (track.readyState = 'ended')), applyConstraints: vi.fn(async () => undefined) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the camera kept ready between scans (D162)', () => {
  it('hands the same camera to the next scan within the time, so the browser asks once; then turns it off', async () => {
    vi.useFakeTimers();
    const made: ReturnType<typeof fakeStream>[] = [];
    const getStream = vi.fn(async () => {
      const s = fakeStream();
      made.push(s);
      return s.stream;
    });
    const camera = cameraKeeper(getStream);
    const first = await camera.open();
    camera.release(first, 90_000);
    expect(made[0]!.track.stop).not.toHaveBeenCalled();
    // Its light is turned off while it waits.
    expect(made[0]!.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: false }] });
    vi.advanceTimersByTime(60_000);
    expect(await camera.open()).toBe(first);
    expect(getStream).toHaveBeenCalledTimes(1);
    camera.release(first, 90_000);
    vi.advanceTimersByTime(90_000);
    expect(made[0]!.track.stop).toHaveBeenCalled();
    // Once off, the next scan opens a new one.
    const second = await camera.open();
    expect(second).not.toBe(first);
    expect(getStream).toHaveBeenCalledTimes(2);
  });

  it('turns off at once with no time to keep it, or when asked, and never hands back an ended camera', async () => {
    const made: ReturnType<typeof fakeStream>[] = [];
    const camera = cameraKeeper(async () => {
      const s = fakeStream();
      made.push(s);
      return s.stream;
    });
    const a = await camera.open();
    camera.release(a, 0);
    expect(made[0]!.track.stop).toHaveBeenCalled();
    const b = await camera.open();
    camera.release(b, 90_000);
    camera.stop();
    expect(made[1]!.track.stop).toHaveBeenCalled();
    // Ended on its own while kept (a phone call, say): a new one is opened.
    const c = await camera.open();
    camera.release(c, 90_000);
    made[2]!.track.readyState = 'ended';
    expect(await camera.open()).not.toBe(c);
    expect(made).toHaveLength(4);
  });
});
