import { Button, Group } from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { notifyError, notifySuccess } from '../hooks';

/** IsThereAnyDeal's key test, right under the key. With unsaved changes (the key, or the switch), it saves them first. */
export function ItadButtons({ unsaved, save }: { unsaved: boolean; save: () => Promise<boolean> }) {
  const test = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ ok: boolean; message: string }>('/pc/prices/test', { method: 'POST' });
    },
    onSuccess: (r) => {
      if (!r) return;
      if (r.ok) notifySuccess(r.message, 'IsThereAnyDeal');
      else notifyError(new Error(r.message), 'IsThereAnyDeal');
    },
    onError: (err) => notifyError(err, 'IsThereAnyDeal'),
  });
  return (
    <Group gap="sm">
      <Button variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending} onClick={() => test.mutate()}>
        {unsaved ? 'Save and test' : 'Test the key'}
      </Button>
    </Group>
  );
}
