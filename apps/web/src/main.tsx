import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dropzone/styles.css';
// Fredoka (SIL Open Font License), the wordmark's and the headings' typeface, and Silkscreen (the same license), the pixel
// type for labels, scores and big numbers: both served by Squirrelcade itself.
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/silkscreen/400.css';
import './brand.css';
import { Anchor, Autocomplete, Code, Drawer, MantineProvider, Modal, MultiSelect, Notification, NumberInput, Pagination, PasswordInput, Select, TagsInput, TextInput, Textarea, createTheme, darken, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';

// The brand kit's colors (docs/design/redesign.md, 0.47.0). Forest is its cade green: shade 5 (#3dbe74) fills buttons
// in both color schemes, with dark text; 2 is its mint, 3 dark mode's link green, 7 light mode's (5.6:1 on white), 8 the
// "have it" green and 9 its deep green.
const forest: MantineColorsTuple = ['#e8f8ef', '#cdefdb', '#a3edc2', '#7fdda6', '#5bd08e', '#3dbe74', '#2fa866', '#1e7546', '#1f4d34', '#16392a'];
// The squirrel's brown (shade 5 is its body, 3 its tail's light): the prized things, such as sealed copies and a Top 100 rank.
const squirrel: MantineColorsTuple = ['#fbf1e7', '#f4dfc9', '#e9cfa6', '#e3a866', '#d08a4e', '#c0763a', '#a8632d', '#8e5428', '#6e3f1e', '#3a2a1c'];
// Acorn gold in place of Mantine's yellow: wanted, missing and needs a check (shade 4 is the kit's gold).
const yellow: MantineColorsTuple = ['#fdf6e3', '#f8e8bd', '#f2d58e', '#edc56a', '#e9b44c', '#d9a033', '#b9861f', '#8f6716', '#5a4a26', '#2a2312'];
// The kit's charcoal: text, soft text, muted, faint, the strong and the light line, the surface (inputs), the ground
// (the page, Mantine's body), the chrome (header and menu).
const dark: MantineColorsTuple = ['#f2efea', '#cbc6be', '#9e988f', '#6f6a63', '#383838', '#2c2c2c', '#1d1d1d', '#161616', '#111111', '#0b0b0b'];

// Password managers (LastPass above all) take any box on a page with a password field for a sign-in: they filled the
// owner's name into the game search and a password into a key box. Every box is off-limits to them unless it says
// otherwise: the sign-in, first-account and password boxes do (data-lpignore="false", with their own autocomplete).
const notForPasswordManagers = { autoComplete: 'off', 'data-lpignore': 'true' } as never;

const theme = createTheme({
  colors: { forest, squirrel, yellow, dark },
  primaryColor: 'forest',
  primaryShade: { light: 5, dark: 5 },
  // Headings in the logo's rounded typeface; body text stays in the system's.
  headings: { fontFamily: 'Fredoka, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontWeight: '600' },
  defaultRadius: 'md',
  // Filled badges and buttons in light colors (yellow, orange) get dark text, so they stay readable.
  autoContrast: true,
  components: {
    // Links read as links without their color.
    // A link that is a button keeps its words at the start: stretched in a column, a button centers them, and they
    // wandered from row to row ("Write why it matters").
    Anchor: Anchor.extend({ defaultProps: { underline: 'always' }, styles: { root: { textAlign: 'start' } } }),
    Autocomplete: Autocomplete.extend({ defaultProps: notForPasswordManagers }),
    MultiSelect: MultiSelect.extend({ defaultProps: notForPasswordManagers }),
    NumberInput: NumberInput.extend({ defaultProps: notForPasswordManagers }),
    PasswordInput: PasswordInput.extend({ defaultProps: notForPasswordManagers }),
    Select: Select.extend({ defaultProps: notForPasswordManagers }),
    TagsInput: TagsInput.extend({ defaultProps: notForPasswordManagers }),
    TextInput: TextInput.extend({ defaultProps: notForPasswordManagers }),
    Textarea: Textarea.extend({ defaultProps: notForPasswordManagers }),
    // Folder paths and other code break where they must, so a long one never pushes a phone's page sideways.
    Code: Code.extend({ styles: { root: { overflowWrap: 'anywhere' } } }),
    Drawer: Drawer.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } }),
    Modal: Modal.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } }),
    // A message's words in the readable dimmed color: Mantine's own gray is too faint on its card (3.5:1 in dark mode).
    Notification: Notification.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } }, styles: { description: { color: 'var(--mantine-color-dimmed)' } } }),
    Pagination: Pagination.extend({
      defaultProps: {
        getControlProps: (control) => ({ 'aria-label': { first: 'First page', previous: 'Previous page', next: 'Next page', last: 'Last page' }[control] }),
      },
    }),
  },
});

/** A color's contrast with white (WCAG's formula). */
function contrastOnWhite(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * r! + 0.7152 * g! + 0.0722 * b! + 0.05);
}

/** The lightest shade from 6 on that reads on white at 4.6:1: colored words in light mode (filled buttons use shade 5 since 0.47.0). */
const readableOnWhite = (shades: readonly string[]) => shades.slice(6).find((c) => contrastOnWhite(c) >= 4.6) ?? shades[9]!;

// Dimmed text and links with enough contrast to read (4.5:1 on cards as well as the page): Mantine's own
// are a little too faint (3.5:1 for dimmed text on a dark card).
const readableColors: CSSVariablesResolver = (t) => ({
  variables: {},
  // --sc-accent-text: green text that isn't a link (notes such as what the wishlist learned). --sc-wordmark-*: the
  // wordmark's two colors, as the logo's for light backgrounds and for dark (docs/brand).
  light: {
    '--mantine-color-body': '#f4f2ee',
    '--mantine-color-dimmed': '#6b655d',
    '--mantine-color-anchor': 'var(--mantine-color-forest-7)',
    '--sc-accent-text': 'var(--mantine-color-forest-7)',
    '--sc-wordmark-squirrel': '#a8632d',
    '--sc-wordmark-cade': '#1e7546',
    // In light mode, tinted and outlined badges' text (green on light green, say) is too faint in Mantine's own colors:
    // each color's text is darkened. (Filled gray needs nothing since 0.47.0: shade 5 takes dark text.)
    ...Object.fromEntries(
      Object.entries(t.colors).flatMap(([name, shades]) => [
        [`--mantine-color-${name}-light-color`, darken(shades[9], 0.35)],
        [`--mantine-color-${name}-outline`, darken(shades[9], 0.2)],
        [`--mantine-color-${name}-text`, readableOnWhite(shades)],
      ]),
    ),
  },
  dark: {
    '--mantine-color-dimmed': '#9e988f',
    '--mantine-color-anchor': 'var(--mantine-color-forest-3)',
    '--sc-accent-text': 'var(--mantine-color-forest-3)',
    '--sc-wordmark-squirrel': '#c0763a',
    '--sc-wordmark-cade': '#3dbe74',
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark" cssVariablesResolver={readableColors}>
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
