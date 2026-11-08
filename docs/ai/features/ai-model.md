# Set up an AI model for Check a shelf and Talk in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: an AI model for Check a shelf and Talk. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 25"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

**Check a shelf** (in Store Mode) reads a photo of a shelf on the phone with no service at all. With a **vision model** set up, pieces of the photo also go to a model I choose, which reads more spines; its reads are matched like the phone's, and the model never decides what I have. With the model set up, **Talk to Squirrelcade** (a Talk button on every page, for asking about my collection in plain words and telling it what happened) uses the same model. Each piece of a photo is one request to the service: **Pieces a day** caps it. Nothing in Squirrelcade needs this.

## Have ready

- A choice of model: **OpenAI**, **Google Gemini**, **Anthropic's Claude**, **OpenRouter**, a model at home (**Ollama** or **LM Studio**, no key), or a helper of my own (Claude Code on my own plan answering Squirrelcade's requests). Ask me which; at-home models cost nothing but need a capable machine, and the others cost per request (small, and capped).
- For a service: an account and an **API key** from that service (I type it into Squirrelcade myself).

## Steps

1. In Squirrelcade: **Settings > Features:** turn on **A vision model for Check a shelf** (and **Talk to Squirrelcade** if I want the Talk button).
2. On its card in **Settings > Sources**, pick the preset (OpenAI, Google Gemini, Anthropic's Claude, OpenRouter, Ollama, LM Studio, or a helper of my own). The address and model fill in.
3. For a service with a key: I make the key at the service's own site (its API keys page; a billing account may be needed) and paste it into the key field myself. For Ollama or LM Studio, the address is where it runs, as the Squirrelcade server reaches it.
4. **Pieces a day:** the cap on paid requests a day. Set it low at first.
5. **Save and test.**

## Check that it works

- **System > Status > Integrations:** the AI model light is green.
- In Store Mode, **Check a shelf** on a photo of games; with Talk on, ask it "What do I have for the Dreamcast?".

## How long it takes

about 10 minutes; give it 25. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- Refused test: the key, the address or the model's name is wrong; the message says which.
- A helper of my own: red means nothing is answering; is it running? (Help > Store Mode)
- Photos of my copies never leave my server; only the pieces of a shelf photo I check do.
