import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconBulb } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
    const options = { onTrack: setTrack, qr: withQr ? (text: string) => Boolean(handlers.current.qr?.(text)) : undefined };
    const failed = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
    const start = () => {
      if (!video.current) return void setTimeout(start, 50);
      if (keepOpen) scanEach(video.current, abort.signal, (code) => handlers.current.onCode(code), options).catch(failed);
      else
        scan(video.current, abort.signal, setTrack, { qr: options.qr }).then(
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
          <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} />
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
