import { Alert, Badge, Button, Card, Group, Loader, Modal, MultiSelect, NumberInput, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconPencil, IconPlugConnected, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CUSTOM_MAIL_GUIDE, MAIL_PROVIDERS } from '@squirrelcade/core';
import { useState } from 'react';
import { api } from '../api';
import { timeAgo } from '../format';
import { notifyError, notifySuccess } from '../hooks';
import { SetupGuide } from '../SetupGuide';

/** An email account as the server tells it: never the password, only whether one is set. */
export interface MailAccountView {
  id: number;
  name: string;
  address: string;
  username: string;
  hasPassword: boolean;
  imapHost: string;
  imapPort: number;
  imapSecurity: 'ssl' | 'starttls';
  smtpHost: string;
  smtpPort: number;
  reads: boolean;
  sends: boolean;
  problem: string | null;
  state?: { read?: { at: string; ok: boolean; message: string }; send?: { at: string; ok: boolean; message: string } };
}

interface Outcome {
  ok: boolean;
  message: string;
}

/** The accounts, for a feature's page to choose from. */
export function useMailAccounts() {
  return useQuery({ queryKey: ['mail', 'accounts'], queryFn: () => api<{ accounts: MailAccountView[] }>('/mail/accounts'), staleTime: 15_000 });
}

/**
 * What a feature reads, on the feature's own page: one account, several, or all (nothing chosen). Saved with the page's
 * other settings, as a list of account numbers.
 */
export function AccountPicker({ label, description, value, onChange, reads = true }: { label: string; description: string; value: string[]; onChange: (v: string[]) => void; reads?: boolean }) {
  const { data } = useMailAccounts();
  const options = (data?.accounts ?? []).filter((a) => (reads ? a.reads : a.sends)).map((a) => ({ value: String(a.id), label: `${a.name} (${a.address})` }));
  return (
    <MultiSelect
      label={label}
      description={description}
      placeholder={options.length === 0 ? 'No account yet (Settings › Email)' : value.length === 0 ? 'All accounts' : undefined}
      data={options}
      value={value.filter((v) => options.some((o) => o.value === v))}
      onChange={onChange}
      clearable
      searchable={false}
    />
  );
}

/** The one account that sends (Settings › Notifications): empty is the first that has an outgoing server. */
export function SenderPicker({ label, description, value, onChange }: { label: string; description: string; value: string; onChange: (v: string) => void }) {
  const { data } = useMailAccounts();
  const options = (data?.accounts ?? []).filter((a) => a.sends).map((a) => ({ value: String(a.id), label: `${a.name} (${a.address})` }));
  return <Select label={label} description={description} placeholder={options.length === 0 ? 'No account that sends yet (Settings › Email)' : 'The first that sends'} data={options} value={value || null} onChange={(v) => onChange(v ?? '')} clearable />;
}

const blank = { name: '', address: '', username: '', password: '', provider: 'custom', imapHost: '', imapPort: 993, imapSecurity: 'ssl' as 'ssl' | 'starttls', smtpHost: '', smtpPort: 587 };
type Form = typeof blank;

/** Settings › Email: the accounts, and nothing else. Add, Test, Edit, Remove. */
export function MailAccounts() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useMailAccounts();
  const [editing, setEditing] = useState<{ id: number | null; form: Form } | null>(null);
  const [results, setResults] = useState<Record<number, { read: Outcome | null; send: Outcome | null }>>({});
  const accounts = data?.accounts ?? [];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['mail'] });
    void queryClient.invalidateQueries({ queryKey: ['integrations'] });
  };

  const save = useMutation({
    mutationFn: async (e: { id: number | null; form: Form }) => {
      const { provider: _provider, ...body } = e.form;
      void _provider;
      return api<MailAccountView>(e.id === null ? '/mail/accounts' : `/mail/accounts/${e.id}`, { method: e.id === null ? 'POST' : 'PUT', json: body });
    },
    onSuccess: () => {
      setEditing(null);
      refresh();
      notifySuccess('Saved.');
    },
    onError: (err) => notifyError(err, "Couldn't save"),
  });
  const test = useMutation({
    mutationFn: async (id: number) => ({ id, result: await api<{ read: Outcome | null; send: Outcome | null }>(`/mail/accounts/${id}/test`, { method: 'POST' }) }),
    onSuccess: ({ id, result }) => {
      setResults((r) => ({ ...r, [id]: result }));
      refresh();
    },
    onError: (err) => notifyError(err, 'Test'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/mail/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => notifyError(err, "Couldn't remove"),
  });

  const open = (a?: MailAccountView) =>
    setEditing(
      a
        ? { id: a.id, form: { name: a.name, address: a.address, username: a.username, password: '', provider: 'custom', imapHost: a.imapHost, imapPort: a.imapPort, imapSecurity: a.imapSecurity, smtpHost: a.smtpHost, smtpPort: a.smtpPort } }
        : { id: null, form: { ...blank } },
    );
  const set = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const provider = MAIL_PROVIDERS.find((m) => m.id === editing?.form.provider);

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Each feature picks its accounts on its own page.
        </Text>
        <Button leftSection={<IconPlus size={14} />} onClick={() => open()}>
          Add an account
        </Button>
      </Group>
      {isLoading && <Loader size="sm" />}
      {!isLoading && accounts.length === 0 && (
        <Alert color="gray" variant="light">
          No accounts yet.
        </Alert>
      )}
      {accounts.map((a) => {
        const r = results[a.id];
        return (
          <Card key={a.id} withBorder padding="sm">
            <Stack gap={6}>
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Group gap="xs">
                  <Text fw={600}>{a.name}</Text>
                  <Text size="sm" c="dimmed">
                    {a.address}
                  </Text>
                  {a.reads && (
                    <Badge size="xs" variant="light" style={{ textTransform: 'none' }}>
                      reads
                    </Badge>
                  )}
                  {a.sends && (
                    <Badge size="xs" variant="light" color="grape" style={{ textTransform: 'none' }}>
                      sends
                    </Badge>
                  )}
                </Group>
                <Group gap="xs">
                  <Button size="compact-sm" variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending && test.variables === a.id} onClick={() => test.mutate(a.id)}>
                    Test
                  </Button>
                  <Button size="compact-sm" variant="default" leftSection={<IconPencil size={14} />} onClick={() => open(a)}>
                    Edit
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="default"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    loading={remove.isPending && remove.variables === a.id}
                    onClick={() => {
                      if (window.confirm(`Remove ${a.name}?`)) remove.mutate(a.id);
                    }}
                  >
                    Remove
                  </Button>
                </Group>
              </Group>
              {a.problem && (
                <Text size="sm" c="red">
                  {a.problem}
                </Text>
              )}
              {r && (
                <Stack gap={2} role="status">
                  {(
                    [
                      ['Reading', r.read],
                      ['Sending', r.send],
                    ] as const
                  )
                    .filter(([, o]) => o !== null)
                    .map(([what, o]) => (
                      <Text key={what} size="sm" c={o!.ok ? 'green' : 'red'}>
                        {o!.ok ? '✓' : '✗'} {what}: {o!.message}
                      </Text>
                    ))}
                </Stack>
              )}
              {!r && (a.state?.read || a.state?.send) && (
                <Text size="xs" c="dimmed">
                  {a.state.read ? `${a.state.read.ok ? 'Read' : 'Read failed'} ${timeAgo(a.state.read.at)}` : ''}
                  {a.state.read && a.state.send ? '; ' : ''}
                  {a.state.send ? `${a.state.send.ok ? 'sent' : 'send failed'} ${timeAgo(a.state.send.at)}` : ''}
                </Text>
              )}
            </Stack>
          </Card>
        );
      })}
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.id === null ? 'Add an account' : 'Edit account'} size="lg">
        {editing && (
          <Stack gap="sm">
            {editing.id === null && (
              <Select
                label="Provider"
                data={[...MAIL_PROVIDERS.map((m) => ({ value: m.id, label: m.name })), { value: 'custom', label: 'Another provider' }]}
                value={editing.form.provider}
                onChange={(v) => {
                  const p = MAIL_PROVIDERS.find((m) => m.id === v);
                  set({ provider: v ?? 'custom', ...(p ? { imapHost: p.imapHost, imapPort: p.imapPort, imapSecurity: 'ssl' as const, smtpHost: p.host, smtpPort: p.port, name: editing.form.name || p.name } : {}) });
                }}
              />
            )}
            <SetupGuide guide={provider?.guide ?? CUSTOM_MAIL_GUIDE} title={provider ? `Setting up ${provider.name}` : 'App password'} folded />
            <TextInput label="Name" value={editing.form.name} onChange={(e) => set({ name: e.currentTarget.value })} />
            <TextInput label="Address" value={editing.form.address} onChange={(e) => set({ address: e.currentTarget.value })} />
            <PasswordInput
              label="App password"
              placeholder={editing.id !== null && accounts.find((a) => a.id === editing.id)?.hasPassword ? 'Saved' : undefined}
              value={editing.form.password}
              onChange={(e) => set({ password: e.currentTarget.value })}
              autoComplete="new-password"
            />
            <TextInput label="Sign-in name" description="Empty: the address." value={editing.form.username} onChange={(e) => set({ username: e.currentTarget.value })} />
            <Group grow align="flex-start">
              <TextInput label="Incoming server" description="IMAP. Empty: it doesn't read." value={editing.form.imapHost} onChange={(e) => set({ imapHost: e.currentTarget.value })} />
              <NumberInput label="Port" value={editing.form.imapPort} min={1} max={65535} onChange={(v) => set({ imapPort: Number(v) || 993 })} />
              <Select
                label="Security"
                data={[
                  { value: 'ssl', label: 'SSL' },
                  { value: 'starttls', label: 'STARTTLS' },
                ]}
                value={editing.form.imapSecurity}
                onChange={(v) => set({ imapSecurity: v === 'starttls' ? 'starttls' : 'ssl', imapPort: v === 'starttls' ? 143 : 993 })}
                allowDeselect={false}
              />
            </Group>
            <Group grow align="flex-start">
              <TextInput label="Outgoing server" description="SMTP. Empty: it doesn't send." value={editing.form.smtpHost} onChange={(e) => set({ smtpHost: e.currentTarget.value })} />
              <NumberInput label="Port" value={editing.form.smtpPort} min={1} max={65535} onChange={(v) => set({ smtpPort: Number(v) || 587 })} />
            </Group>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate(editing)}>
                Save
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
