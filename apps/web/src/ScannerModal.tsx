import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconBulb, IconDeviceMobile } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSetting } from './hooks';
import { cameraProblem, scan, scanEach } from './scanner';

/**
 * The camera, reading a barcode: Store Mode's scan button and the sign-in page's check use it. With qr, it reads a
 * place's QR label too; with keepOpen (Pack a place), it stays open and gives each code as it's read, `children`
 * saying what became of the last one.
 */
export function ScannerModal({
  opened,
  onClose,
  onCode,
  qr,
  keepOpen = false,
  title = 'Point the camera at the barcode',
  children,
}: {
  opened: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
  qr?: (text: string) => boolean;
  keepOpen?: boolean;
  title?: string;
  children?: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // How long the camera stays ready for the next scan (D162), so a run of scans asks the browser for it once.
  const keepSeconds = useSetting('interface.cameraKeepSeconds', 90);
  // Scanning is upright only (the owner: "locked in one direction"): a phone turned sideways pauses it and says so. A
  // page can't lock an iPhone's screen, and iPhone Safari could leave the picture turned a quarter after a turn.
  const sideways = useMediaQuery('(orientation: landscape) and (max-height: 32em)') ?? false;
  const paused = useRef(false);
  paused.current = sideways;
  useEffect(() => {
    const v = video.current;
    if (!opened || sideways || !v?.srcObject) return;
    // Upright again: the picture is attached anew, the right way up.
    const stream = v.srcObject;
    v.srcObject = null;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
  }, [sideways, opened]);
  // The latest handlers, so a page that renders again doesn't restart the camera.
  const handlers = useRef({ onCode, qr });
  handlers.current = { onCode, qr };
  const withQr = Boolean(qr);
  // The camera's light, where the browser can switch it (Chrome on Android): for dim shops.
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [light, setLight] = useState(false);
  const canLight = !!track && !!(track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch;
  const toggleLight = () => {
    if (!track) return;
    const on = !light;
    void track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).then(() => setLight(on), () => undefined);
  };
  useEffect(() => {
    if (!opened) return;
    const problem = cameraProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const abort = new AbortController();
    const options = {
      onTrack: setTrack,
      qr: withQr ? (text: string) => Boolean(handlers.current.qr?.(text)) : undefined,
      keepMs: Math.max(0, keepSeconds) * 1000,
      paused: () => paused.current,
    };
    const failed = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
    const start = () => {
      if (!video.current) return void setTimeout(start, 50);
      if (keepOpen) scanEach(video.current, abort.signal, (code) => handlers.current.onCode(code), options).catch(failed);
      else
        scan(video.current, abort.signal, setTrack, { qr: options.qr, keepMs: options.keepMs, paused: options.paused }).then(
          (code) => code && handlers.current.onCode(code),
          failed,
        );
    };
    start();
    return () => {
      abort.abort();
      setTrack(null);
      setLight(false);
    };
  }, [opened, keepOpen, withQr]);
  return (
    <Modal opened={opened} onClose={onClose} title={title} size="lg" centered>
      {error ? (
        <Alert color="yellow">{error}</Alert>
      ) : (
        <Stack gap="xs">
          <div style={{ position: 'relative' }}>
            <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 8, background: '#000', display: 'block' }} />
            {sideways && (
              <div className="sc-scan-upright" role="status">
                <IconDeviceMobile size={28} aria-hidden />
                Turn your phone upright to scan
              </div>
            )}
          </div>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Text size="xs" c="dimmed">
              Hold the barcode flat, about a hand's width away, filling half the picture. Shiny case? Tilt it a little so the light doesn't shine on the barcode.
            </Text>
            {canLight && (
              <Button size="compact-sm" variant={light ? 'filled' : 'default'} leftSection={<IconBulb size={14} />} onClick={toggleLight}>
                Light
              </Button>
            )}
          </Group>
          {children}
          {keepOpen && (
            <Button variant="default" onClick={onClose}>
              Done
            </Button>
          )}
        </Stack>
      )}
    </Modal>
  );
}
