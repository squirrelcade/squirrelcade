# AI-assisted setup

Squirrelcade works with many other services, and setting each one up takes a few steps of its own. An AI assistant can take you through all of it, one step at a time, if it knows Squirrelcade: this page gives you a prompt that tells it everything it needs.

## How it works

1. **Copy the prompt** (or download it) with the buttons above. It's made for your Squirrelcade: what's set up already, and a link to each of its settings.
2. Paste it into a new chat with the AI you use (Claude, ChatGPT, Gemini, Grok, Copilot...), or attach the downloaded file.
3. The AI asks what you have and what you'd like, a few questions at a time: your server, your collection, reaching Squirrelcade from your phone, the services you use, and the ones you'd be willing to install.
4. It writes a plan, checks it with you, then takes you through it one step at a time: what to click, what to type, what to run, and how to check that each part works.

## Keys and passwords stay with you

The prompt tells the AI never to ask for a password, key or token. It tells you where to get each one and where it goes in Squirrelcade; you type it there yourself and press the part's **Test** button. If you paste one into a chat by mistake, make a new one: the old one has left your hands.

It also tells the AI to ask before anything that installs or changes something on your server, and never to suggest opening Squirrelcade to the internet without a gate in front (a VPN, Cloudflare Access, or a proxy's own sign-in).

## What's in the prompt

- How the AI should work with you: interview first, then a plan, then one step at a time.
- What Squirrelcade is, and how each part is set up, with the official pages to get keys from.
- **My Squirrelcade now:** the version, your collection's size, backups, which optional parts are on and whether they work, messages, sign-in and sharing, and anything that needs attention. Never passwords, keys or tokens (only whether each is set), and email addresses are left out.
- **Where things are:** a link to each setting and page on your Squirrelcade, from its address as your browser reaches it.

It's plain text: **See the prompt** shows it before you copy it.

## Settings the AI writes for you

Rather than type each setting, you can let the AI write the ones you chose into a settings file (never with a password, key or token in it: those you still type yourself). Save what it gives you as a file, then load it with **Settings > Import** (on any settings page). The import window lists each change, before and after, and anything in the file that isn't a setting, so nothing changes until you've seen it; **Apply the file, keep these** changes only what's in the file. The prompt with every guide ends with every setting, so the AI knows each one's name and what it takes.

## Which AI

Any capable AI chat works. The prompt is written with Claude in mind, but asks for nothing only Claude can do.

- **Download it with every guide** puts the prompt and all of Squirrelcade's guides in one file. Attach it to the chat as a file: it's too long for some chats to take as a message.
- An AI that can run commands on your server (an agent in a terminal, such as Claude Code) can check things itself. The prompt tells it to ask before it changes anything, and never to read or print a key or password. Save the file in a folder on the server, start the agent there, and tell it: "Read squirrelcade-setup-prompt.md and follow it."

## Before Squirrelcade is installed

The same prompt, without an install's details, is in Squirrelcade's repository: [docs/ai/setup-prompt.md](https://github.com/squirrelcade/squirrelcade/blob/main/docs/ai/setup-prompt.md). Paste it the same way, and the AI starts with installing Squirrelcade.

## Tips

- Answer in your own words, and say "later" to anything you don't want today.
- If what you see doesn't match what the AI says, tell it what you see: menus change.
- Squirrelcade's guides are the reference. If the AI and a guide disagree, trust the guide, and tell the AI.
- When you're done, **System > Status** has the setup checklist, and each optional part's test says whether it works.
