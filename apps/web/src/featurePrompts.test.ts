import { everythingNowSentence, FEATURE_LIST, featureTime } from '@squirrelcade/core';
import { describe, expect, it } from 'vitest';
import setupPrompt from '../../../docs/ai/setup-prompt.md?raw';
import { FEATURE_IDS, featurePrompt, PROMPT_IDS } from './featurePrompts';

describe("the features' own setup prompts", () => {
  it('has one prompt for each feature, and no prompt without a feature', () => {
    expect([...PROMPT_IDS].sort()).toEqual([...FEATURE_IDS].sort());
  });

  it('is a complete prompt: what, have ready, steps, the check, the padded time, and never a secret asked for', () => {
    for (const f of FEATURE_LIST) {
      const text = featurePrompt(f.id)!;
      expect(text, f.id).toMatch(/^# Set up /);
      for (const heading of ['## What it is', '## Have ready', '## Steps', '## Check that it works', '## How long it takes', '## If something goes wrong']) expect([f.id, text.includes(heading)]).toEqual([f.id, true]);
      expect(text, f.id).toContain(featureTime(f));
      expect(text, f.id).toContain('Never ask me for a password, API key, token, app password or webhook address');
      expect(text, f.id).toContain('I type it there myself');
      expect(text, f.id).toContain('Settings > Features');
      // Nothing of any one install: no home-network addresses (the documentation range 192.0.2.x and placeholders are fine).
      expect(text, f.id).not.toMatch(/\b(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)\b/);
      // "console", never "platform", in what people read.
      expect(text.replace(/`[^`]*`/g, "").toLowerCase(), f.id).not.toMatch(/\bplatforms?\b/);
    }
  });

  it("is what the whole-install prompt lists: the same times, the same total, the two choices", () => {
    expect(setupPrompt).toContain('**Quick start (recommended):**');
    expect(setupPrompt).toContain('**Everything now:**');
    expect(setupPrompt).toContain(everythingNowSentence().split(',')[0]!);
    for (const f of FEATURE_LIST) expect(setupPrompt, f.id).toContain(`. ${f.name} | ${f.needs} | ${featureTime(f)} |`);
    expect(setupPrompt).toContain(`${FEATURE_LIST.length} integrations in all`);
  });
});
