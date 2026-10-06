import { SETTINGS_EXPORT_FORMAT, SETTINGS_EXPORT_VERSION, SETTINGS_PAGES, settingDefinitions, settingKeys, type SettingDefinition } from '@squirrelcade/core';
import template from '../../../docs/ai/setup-prompt.md?raw';
import { HELP_ORDER, HELP_TEXTS, helpTitle } from './helpTopics';

/** The install guide's steps (docs/guide), for the brief with every guide. */
const guideFiles = import.meta.glob('../../../docs/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const GUIDE_ORDER = ['README', 'install', 'first-run', 'phone', 'connect', 'maintain'];

/** The setup brief as the repository has it (docs/ai/setup-prompt.md), before an install fills in its own parts. */
export const BRIEF_TEMPLATE = template;

/** What only an install knows (GET /api/v1/system/ai-setup): its summary, and the links to each place on it. */
export interface BriefParts {
  state: string;
  links: string;
}

/**
 * Help > AI-assisted setup (0.29.0, D93): the brief with this install's parts put in their places ("My Squirrelcade
 * now" and "Where things are"), in place of the repository's words for an install that isn't there yet.
 */
export function fillBrief(text: string, parts: BriefParts): string {
  return text.replace(/<!-- squirrelcade:state -->[\s\S]*?<!-- \/squirrelcade:state -->/, () => parts.state.trim()).replace(/<!-- squirrelcade:links -->[\s\S]*?<!-- \/squirrelcade:links -->/, () => parts.links.trim());
}

/** A guide as a part of the brief: its headings a level down, and its pictures as words (an AI can't open them). */
function asAppendix(text: string): string {
  let code = false;
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('```')) code = !code;
      if (code) return line;
      return line
        .replace(/^(#{1,5}) /, '#$1 ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '(Picture: $1)')
        .replace(/<img [^>]*alt="([^"]*)"[^>]*>/g, '(Picture: $1)')
        .replace(/<\/?p>/g, '');
    })
    .join('\n');
}

/** Every guide, in reading order: the install guide's steps, then the help's guides as its index lists them. */
export function allGuides(): { name: string; title: string; text: string }[] {
  const guides = new Map(Object.entries(guideFiles).map(([path, text]) => [path.split('/').pop()!.replace(/\.md$/, ''), text]));
  return [
    ...GUIDE_ORDER.filter((k) => guides.has(k)).map((k) => ({ name: `docs/guide/${k}.md`, title: helpTitle(guides.get(k)!, k), text: guides.get(k)! })),
    ...HELP_ORDER.filter((k) => HELP_TEXTS.has(k) && k !== 'ai-setup').map((k) => ({ name: k === 'matching' ? 'docs/MATCHING.md' : `docs/help/${k}.md`, title: helpTitle(HELP_TEXTS.get(k)!, k), text: HELP_TEXTS.get(k)! })),
  ];
}

/** What a setting takes, in words an AI can write a settings file from. */
function takes(d: SettingDefinition): string {
  switch (d.kind) {
    case 'boolean':
      return 'true or false';
    case 'number':
      return `a number from ${d.min} to ${d.max}${d.unit ? ` (${d.unit})` : ''}${d.decimals ? `, up to ${d.decimals} decimals` : ''}`;
    case 'select':
      return `one of ${(d.options ?? []).map((o) => `${JSON.stringify(o.value)} (${o.label})`).join(', ')}`;
    case 'list':
      return d.platforms ? 'a list of console keys (such as "playstation-3")' : 'a list of texts';
    case 'path':
      return 'a folder as the container sees it (such as "/playnite")';
    case 'secret':
      return 'a secret: never in a file (typed into Settings by its owner)';
    case 'points':
      return 'a number for each name, {"name": number} (acorns, in the lists of the Acorns page)';
    case 'tiers':
    case 'percentTiers':
      return 'a list of tiers, as the Acorns page makes them';
    case 'sources':
      return 'the catalog sources, most trusted first';
    default:
      return 'text';
  }
}

/** A description's first sentence, for the reference (the rest is on the settings page). */
const firstSentence = (text: string) => {
  const end = text.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? text.slice(0, end + 1) : text;
  return sentence.length > 220 ? `${sentence.slice(0, sentence.lastIndexOf(' ', 220))}…` : sentence;
};

/**
 * Every setting a settings file can hold, page by page (0.31.0): its key, where it is, what it takes and its default,
 * for an AI writing a file for Settings > Import (the brief's "A settings file"). Secrets are named, never valued.
 */
export function settingsReference(): string {
  const lines = [
    '# Appendix: every setting',
    '',
    `For a settings file (the brief's "A settings file"): {"format": "${SETTINGS_EXPORT_FORMAT}", "version": ${SETTINGS_EXPORT_VERSION}, "settings": {"key": value, ...}}, only the settings to change. Each line: the key, where it is (page > section > name), what it takes, its default.`,
  ];
  for (const page of SETTINGS_PAGES) {
    const keys = settingKeys.filter((k) => settingDefinitions[k].page === page.id && settingDefinitions[k].kind !== 'shapes');
    if (keys.length === 0) continue;
    lines.push('', `## ${page.title}`, '');
    for (const k of keys) {
      const d = settingDefinitions[k] as SettingDefinition;
      const shown = d.kind === 'secret' ? '' : `; default ${JSON.stringify(d.default)}`;
      lines.push(`- \`${k}\` (${page.title} > ${d.section} > ${d.label}${d.advanced ? ', advanced' : ''}): ${takes(d)}${shown}. ${firstSentence(d.description)}`);
    }
  }
  return lines.join('\n');
}

/** The brief with every guide after it, in one file (for an AI that takes a file: Claude, ChatGPT, Gemini...). */
export function briefWithGuides(brief: string): string {
  const guides = allGuides();
  return [
    brief.trimEnd(),
    '',
    '---',
    '',
    "# Appendix: Squirrelcade's guides",
    '',
    `The same guides as in Squirrelcade's Help, for the details the brief leaves out: ${guides.map((g) => g.title).join(', ')}. Links between them name the files they came from.`,
    ...guides.map((g) => `\n---\n\n<!-- ${g.name} -->\n\n${asAppendix(g.text).trim()}`),
    '',
    '---',
    '',
    settingsReference(),
    '',
  ].join('\n');
}

/** Saves text as a file the browser downloads (the brief, from the page itself: nothing more to ask the server). */
export function saveText(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
