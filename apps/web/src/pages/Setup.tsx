import { settingDefinitions } from '@squirrelcade/core';
import { Alert, Button, Center, Paper, PasswordInput, Select, Stack, Stepper, Text, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../api';
import { usePageTitle, useSession } from '../hooks';
import { timeZoneOptions } from '../timezones';

/** What a region usually uses, until the new owner picks otherwise: its currency and how it writes dates. */
const REGION_DEFAULTS: Record<string, { currency: string; dateFormat: string }> = {
  'north-america': { currency: 'USD', dateFormat: 'us' },
  europe: { currency: 'EUR', dateFormat: 'eu' },
  japan: { currency: 'JPY', dateFormat: 'iso' },
  asia: { currency: 'USD', dateFormat: 'iso' },
};

/** First-run wizard: the account, then the basics every other page builds on. */
export function SetupPage() {
  usePageTitle('Set up');
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Outside the home network, the code from Squirrelcade's log.
  const codeNeeded = useSession().data?.setupCodeNeeded ?? false;
  const [setupCode, setSetupCode] = useState('');
  const [homeRegion, setHomeRegion] = useState<string>('north-america');
  const [currency, setCurrency] = useState<string>('USD');
  const [dateFormat, setDateFormat] = useState<string>('us');
  // A currency or date format the owner picked stays when they change the region; otherwise it follows the region.
  const [picked, setPicked] = useState({ currency: false, dateFormat: false });
  const pickRegion = (region: string) => {
    setHomeRegion(region);
    const d = REGION_DEFAULTS[region];
    if (!d) return;
    if (!picked.currency) setCurrency(d.currency);
    if (!picked.dateFormat) setDateFormat(d.dateFormat);
  };
  const [timeZone, setTimeZone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountProblem =
    codeNeeded && setupCode.replace(/[^A-Za-z0-9]/g, '').length !== 8
      ? 'Enter the setup code.'
      : username.trim() === ''
        ? 'Choose a username.'
        : password.length < 8
          ? 'Use a password of at least 8 characters.'
          : password !== confirm
            ? "The passwords don't match."
            : null;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api('/setup', {
        method: 'POST',
        json: { username: username.trim(), password, ...(codeNeeded ? { setupCode } : {}), settings: { 'general.homeRegion': homeRegion, 'general.currency': currency, 'general.dateFormat': dateFormat, 'general.timeZone': timeZone } },
      });
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="md" p="xl" w="100%" maw={560}>
        <Stack>
          <Stack gap={4}>
            <Title order={2}>Welcome to Squirrelcade</Title>
            <Text c="dimmed" size="sm">
              A few questions to get started. You can change all of this later in Settings.
            </Text>
          </Stack>
          <Stepper active={step} size="sm">
            <Stepper.Step label="Account">
              <Stack mt="md">
                {codeNeeded && (
                  <>
                    <Alert color="yellow" variant="light" title="You're outside your home network">
                      <Text size="sm">
                        So that nobody else can claim a new Squirrelcade, setting it up from here takes the setup code in its log, on the line that starts "No account yet". On a Synology:
                        Container Manager › Container › squirrelcade › Log. With Docker: <code>docker logs squirrelcade</code>. From your home network, no code is needed.
                      </Text>
                    </Alert>
                    <TextInput label="Setup code" placeholder="ABCD-EFGH" value={setupCode} onChange={(e) => setSetupCode(e.currentTarget.value)} autoComplete="off" />
                  </>
                )}
                <TextInput label="Username" value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoFocus autoComplete="username" data-lpignore="false" />
                <PasswordInput label="Password" description="At least 8 characters." value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="new-password" data-lpignore="false" />
                <PasswordInput label="Password again" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} autoComplete="new-password" data-lpignore="false" />
                <Button onClick={() => setStep(1)} disabled={accountProblem !== null}>
                  Next
                </Button>
                {accountProblem && username !== '' && (
                  <Text size="xs" c="dimmed">
                    {accountProblem}
                  </Text>
                )}
              </Stack>
            </Stepper.Step>
            <Stepper.Step label="Basics">
              <Stack mt="md">
                <Select
                  label="Home region"
                  description={settingDefinitions['general.homeRegion'].description}
                  data={(settingDefinitions['general.homeRegion'].options ?? []).map((o) => ({ value: o.value, label: o.label }))}
                  value={homeRegion}
                  onChange={(v) => v && pickRegion(v)}
                  allowDeselect={false}
                />
                <Select
                  label="Currency"
                  data={(settingDefinitions['general.currency'].options ?? []).map((o) => ({ value: o.value, label: o.label }))}
                  value={currency}
                  onChange={(v) => {
                    if (!v) return;
                    setCurrency(v);
                    setPicked((x) => ({ ...x, currency: true }));
                  }}
                  allowDeselect={false}
                />
                <Select
                  label="Date format"
                  data={(settingDefinitions['general.dateFormat'].options ?? []).map((o) => ({ value: o.value, label: o.label }))}
                  value={dateFormat}
                  onChange={(v) => {
                    if (!v) return;
                    setDateFormat(v);
                    setPicked((x) => ({ ...x, dateFormat: true }));
                  }}
                  allowDeselect={false}
                />
                <Select label="Time zone" data={timeZoneOptions()} value={timeZone} onChange={(v) => setTimeZone(v ?? '')} searchable />
                {error && <Alert color="red">{error}</Alert>}
                <Button onClick={finish} loading={busy}>
                  Create account and start
                </Button>
                <Button variant="subtle" onClick={() => setStep(0)}>
                  Back
                </Button>
              </Stack>
            </Stepper.Step>
          </Stepper>
          <Text size="xs" c="dimmed">
            Next, a short guide brings your collection in (an export, or games added one at a time) and builds your catalogs.
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}
