import { useCanEdit } from './hooks';
import { Alert, Anchor, Button, Code, Group, Stack, Text } from '@mantine/core';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Tells the server a page failed to draw, so it's in the log and the support file (System > Status). Best
 * effort: a failure to report is ignored.
 */
export function reportClientError(error: unknown, componentStack?: string | null): void {
  const err = error instanceof Error ? error : new Error(String(error));
  try {
    void fetch('/api/v1/system/client-error', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: err.message, stack: [err.stack, componentStack].filter(Boolean).join('\n'), path: location.pathname + location.search }),
    }).catch(() => {});
  } catch {
    // Nothing more to do: the page already shows the problem.
  }
}

/**
 * Catches a page (or the game drawer) that fails to draw: the menu stays usable and the problem shows in its
 * place, instead of a blank screen. Opening another page (a new resetKey) tries again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; compact?: boolean }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error);
    reportClientError(error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.compact) {
      return (
        <Text size="sm" c="red">
          This couldn't be shown ({error.message}).
        </Text>
      );
    }
    return (
      <Alert color="red" title="This page couldn't be shown" maw={720}>
        <FailedPage message={error.message} />
      </Alert>
    );
  }
}

/**
 * What a page that failed says: reload, and for the owner, the support file (the problem is in its log); a viewer,
 * who can't open the system pages, is asked to tell the owner.
 */
function FailedPage({ message }: { message: string }) {
  const canEdit = useCanEdit();
  return (
    <Stack gap="xs">
      <Text size="sm">
        {canEdit ? (
          <>
            Something in it went wrong. Reloading usually helps; if it keeps happening, the support file on{' '}
            <Anchor href="/system/status" size="sm">
              System &gt; Status
            </Anchor>{' '}
            has the details (the problem is in its log).
          </>
        ) : (
          "Something in it went wrong. Reloading usually helps; if it keeps happening, tell the collection's owner."
        )}
      </Text>
      <Code block>{message}</Code>
      <Group>
        <Button size="xs" onClick={() => window.location.reload()}>
          Reload
        </Button>
        {/* For reporting it: the support file, with this problem in its log. */}
        {canEdit && (
          <Button size="xs" variant="default" component="a" href="/api/v1/system/support">
            Download a support file
          </Button>
        )}
      </Group>
    </Stack>
  );
}
