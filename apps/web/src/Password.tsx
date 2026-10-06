import { Button, Group, Modal, PasswordInput, Stack } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api';
import { notifyError, notifySuccess } from './hooks';

/** Changing your own password, from the account menu (a viewer's way to it; the owner also has Settings > Security). */
export function PasswordModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const close = () => {
    setCurrent('');
    setNext('');
    onClose();
  };
  const change = useMutation({
    mutationFn: () => api('/auth/password', { method: 'POST', json: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      notifySuccess('Your other devices are signed out.', 'Password changed');
      close();
    },
    onError: (err) => notifyError(err, "Couldn't change the password"),
  });
  return (
    <Modal opened={opened} onClose={close} title="Change your password">
      <Stack>
        <PasswordInput label="Current password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} autoComplete="current-password" data-lpignore="false" data-autofocus />
        <PasswordInput label="New password" description="At least 8 characters." value={next} onChange={(e) => setNext(e.currentTarget.value)} autoComplete="new-password" data-lpignore="false" />
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button loading={change.isPending} disabled={!current || next.length < 8} onClick={() => change.mutate()}>
            Change password
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
