import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconBulb } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { cameraProblem, scan } from './scanner';

/** The camera, reading a barcode: Store Mode's scan button and the sign-in page's check use it. */
export function ScannerModal({ opened, onClose, onCode }: { opened: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
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
    const start = () => {
      if (!video.current) return void setTimeout(start, 50);
      scan(video.current, abort.signal, setTrack).then(
        (code) => code && onCode(code),
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      );
    };
    start();
    return () => {
      abort.abort();
      setTrack(null);
      setLight(false);
    };
  }, [opened, onCode]);
  return (
    <Modal opened={opened} onClose={onClose} title="Point the camera at the barcode" size="lg" centered>
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
        </Stack>
      )}
    </Modal>
  );
}
