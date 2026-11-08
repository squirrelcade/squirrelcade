# Friends

Compare your collection with a friend's, console by console, and find trades that come out even. Each of you keeps your own Squirrelcade: you swap files that say what you have.

## How it works

1. **Friends > Add a friend:** their name (and their email, if you like). Then **Your file for …** saves your file, a small .json.
2. Send it to them any way you like: by email, in a message, on a USB stick.
3. They drop it on their Friends page, which adds you as their friend, and send their file back.
4. Drop theirs on your Friends page (a zip with the .json in it works too), or use **Paste a friend's file** when it came as text. You see whose it is and what's in it before anything changes.

Send a new file whenever your collection has changed enough to matter: a new file from a friend replaces their last one. A friend's file older than 60 days (Settings > Friends > Keep a friend's file for) is left out of comparisons and trades until they send a new one.

Every file between the two of you carries the same code, made for your friendship, so Squirrelcade knows whose file it is. A file with another code asks you first. If you each added the other by hand, say it's theirs: your codes agree from then on.

## Live links

Instead of swapping files by hand, you can share live: your Squirrelcade keeps a file up to date for a friend, and theirs reads it by itself. Each of you can share live, or only one. The hand-sent files above keep working as they are (each friend's card says **By hand** and **Live link**).

### You share live

1. On the friend's card, turn on **Share live with …**. Squirrelcade writes an encrypted file for that friend in a folder. The card shows the file's name and folder, and **Write now** writes it again at once.
2. The folder is **Settings > Friends > Live links > Folder for live friend files**. Empty, it's `friends-live` in Squirrelcade's own folder (`/config/friends-live` in Docker). In Docker, mount a folder there, or point a syncing tool at the one you already have.
3. Carry that folder to the cloud with anything that syncs a folder:
   - **A PC:** Google Drive for desktop (add the folder to what it syncs), or Dropbox's desktop app.
   - **A Synology:** Cloud Sync, with the folder as the local path and Google Drive or Dropbox as the cloud.
   - **A server:** rclone, on a timer, for example `rclone copy /config/friends-live mydrive:squirrelcade-live` (cron or a systemd timer every 10 minutes).
4. Share the file from the cloud as **Anyone with the link**. In Google Drive: right-click the file > **Share** > **General access** > **Anyone with the link** > **Viewer**, then **Copy link**. In Dropbox: **Copy link**.
5. Paste that link in **The file's shared link** on the friend's card (it saves when you click away or press Enter).
6. Press **Copy the invite** and send it to your friend once, by email or chat. It's one line that starts with `squirrelcade-invite:`. It carries your file's link and your friendship's code, so send it only to them.

Squirrelcade rewrites the same file a minute after each change to your collection (several changes in a row write once). The file is the same one and its link stays the same, as long as the tool that carries it replaces the file in place: rclone copy, Google Drive for desktop and Cloud Sync do. If you ever delete the file or change the link, send a new invite.

### They share live

1. Your friend sends you their invite. On **Friends**, press **Add a friend from an invite** (or **Paste ...'s invite** on that friend's card) and paste it. Squirrelcade reads the link at once, and adds the friend if they're new.
2. From then on it reads the link by itself: **Settings > Friends > Read friends' live links every** (24 hours to start). **Read now** on the card reads it at once, and says whether it was read, there was nothing new, or the file was refused and why. **Remove the link** stops reading it.

A file that is refused never replaces the last good one: you keep what you had, and the card shows the reason in red until a file is read.

### Safe to share

The file is encrypted with your friendship's code, which is never in the file, so the link alone shows nothing. Squirrelcade only accepts a file that is a live file of that friendship, checks out, and is newer than the one it has. Anyone who gets the invite as well as the link can read what your file shares (**Settings > Friends > What you share** decides it), so send the invite only to your friend.

### If a file is refused

| What it says | What it means and what to do |
| --- | --- |
| A web page, not a Squirrelcade file | The link isn't giving the file itself: a sign-in page, or Google's "can't scan for viruses" page. Share it as **Anyone with the link** and paste the link again. |
| "Not found" | The file was moved or removed, or the link changed. Ask your friend for a new invite. |
| The live file of your friendship with someone else | That link belongs to another friend. Check which link is pasted on whose card. |
| Another friendship | The file isn't from your friendship with them. Ask them for their invite again. |
| Doesn't check out with your friendship's code | The file was changed or damaged on the way, or made with another code. Ask for a fresh invite. |
| A friend file sent by hand | The link goes to a hand-sent file. Bring that one in with **Bring in theirs**, or ask for the live file's link. |
| From a newer Squirrelcade | Update your Squirrelcade to read it. |
| Too many requests | Nothing to do: it's read again later. |

System > Status > Integrations shows a light for your live files and for each friend's live link (see [Integrations](integrations.md)).

## What your file shares

Settings > Friends > What you share decides it:

- **Your collection:** each game with its console, and each copy's condition.
- **What your copies are worth:** PriceCharting's value of each copy, so trades can be balanced.
- **Games from your wishlist:** the top 50, with their acorns. (For someone who doesn't have a Squirrelcade, **Acorns wishlist > Share as a file** makes a web page of it to send; see [The wishlist](wishlist.md).)
- **What you'd trade:** copies you marked for sale or trade (see [Your copies](your-copies.md)), with your asking price.
- **Your spare copies:** second copies of a game (all but the best one) count as for trade too.

Never in it: what you paid, your notes, where your copies are kept, loans, photos or what you played. It names you by your Squirrelcade's name, unless you give another (Settings > Friends > Your name in what you share).

## Compare

One console at a time: the games you both have, the ones only you have, and the ones only they have, each with its copies' conditions and value. Two copies are the same game when they're the same PriceCharting entry, or when their titles are the same game on the same console ("Cars 2" and "Cars 2: The Video Game"; see [How matching works](../MATCHING.md)). Badges show what they'd trade, and the games on your wishlist or on theirs.

## Trades

- **Even trades:** something of theirs you want (it's on your wishlist, or you don't have it) for something of yours worth about the same, within 20% (Settings > Friends > An even trade is within). What they want comes first, then the fewest games.
- **Pick one of their games:** any game in their collection, even one they didn't mark for trade. Squirrelcade finds what of yours evens it out: one game, or two or three together.
- **They'd trade, you want** and **You'd trade, they want:** each side's list, most wanted first. **Even it out** picks a game of theirs from the list.

Values come from PriceCharting on each side, so they're a guide: agree on the trade between you. When your currencies differ, the Trades tab says so.

Viewers don't see Friends: it's yours.
