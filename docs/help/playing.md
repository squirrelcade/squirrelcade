# What you played

Squirrelcade keeps what you've played of the games you own, beside the collection (PriceCharting doesn't know it): a status and your rating, from 1 to 10.

## Marking a game

Open a game you own (its title or cover anywhere), and under **Played** choose where you are with it:

- **Not played yet**: in your backlog.
- **Playing**: the day you choose it is kept as the day you started.
- **Beaten** (the story, the credits) or **Completed (everything)**: the day you choose it is kept as the day you finished.
- **Dropped**: you stopped and won't go back.
- **Just for the shelf**: you keep it to have it, not to play it. It isn't in your backlog.

Your rating is the choice beside it. Clear both to forget the game's play. A copy of an edition ("Greatest Hits", "Game of the Year") counts as its catalog game, so the game is marked once whichever copy you open.

## The Backlog page

**Stash > Backlog** lists your games by where you are with them: the **Backlog** first, then each status, the games you haven't marked, and the ones you rated, each with how many there are. You can mark them right in the list, search them, and narrow them to one console.

Games you haven't marked count as not played yet, so your backlog starts as your whole collection. To count only the games you mark "Not played yet", turn off **Games you haven't marked count as not played** (Settings > Collection > Playing).

**What to play next** picks one game from your backlog (on the console chosen, if any), at random but leaning toward the ones IGDB rates well. **Start playing** marks it Playing; **Just for the shelf** takes it out of the backlog and picks another.

## Elsewhere

- The Collection page shows each copy's status and rating, and **Played or not** narrows the list to one status (or your backlog). Its download has them too.
- The **Top 100** lists show what you played of each game, and how many you've finished.
- **Almanac > Statistics** counts your games by status, and the ones you finished each year.

## RetroAchievements

If you play classic games with achievements from [RetroAchievements](https://retroachievements.org) (in RetroArch, or on RomM's player), Squirrelcade can show your progress on each game. Turn on **Settings > Sources > RetroAchievements**, and right under it enter your RetroAchievements username and its **web API key** (on retroachievements.org: Settings, then the Keys section). **Save and test** checks them; your progress is read then, and every day after (**Read now** reads it again).

Each game's drawer then shows, under Played, your award and your achievements ("Mastered · 72 of 72 achievements"), linked to the game on RetroAchievements. Games are matched by console and title; hacks, homebrew and achievement subsets are left out, and consoles Squirrelcade doesn't track (arcade, home computers) are kept but not shown.

**Settings > Sources > RetroAchievements > In What you played** can also mark the games you've beaten as **Beaten**, and the ones you've mastered as **Completed**, when you haven't given them a status yourself. It's off to start with.

## Xbox achievements and PlayStation trophies

Squirrelcade can show how far you got in each game on Xbox (Xbox 360, Xbox One, Xbox Series X and S) and PlayStation (PS3, PS4, PS5, Vita). Under Played, each game's drawer then shows a line for each: "Xbox: 20 of 50 achievements · 400 of 1,000 gamerscore · 40% · last played 8/1/2026", or "PlayStation: Platinum · 48 of 48 trophies · last trophy 9/1/2026". A game you have on several consoles (Smart Delivery, cross-buy) goes on the one you own a copy on. Both are read every day; **Read now** reads them again.

- **Xbox:** Microsoft has no public API for your achievements, so Squirrelcade reads them through [OpenXBL](https://xbl.io), a free service. Sign in there with the Microsoft account you play with, copy the API key from your profile page, and paste it under **Settings > Sources > Xbox achievements**. **Save and test** says whose account it is. OpenXBL's free plan allows 150 requests an hour, and Squirrelcade makes one a day. An Xbox 360 game counts your achievements but not how many it has (Xbox Live doesn't say), so its line shows the gamerscore.
- **PlayStation:** Sony has no public API either. Squirrelcade uses the one the PlayStation App uses, through the open-source psn-api. It's unofficial, so it could stop working if Sony changes it. It signs in with a token from your browser: sign in at playstation.com, then open ca.account.sony.com/api/v1/ssocookie in the same browser. It shows {"npsso":"..."}: copy the 64 characters after npsso into **Settings > Sources > PlayStation trophies**, and **Save and test**. The token lasts about two months, and Settings says until when. When it runs out, the daily read fails with a message saying to copy a new one (a notification too, if you've set them up). Keep the token private: it signs in to your account.

**In What you played** (Settings > Sources > Xbox achievements, and PlayStation trophies) can mark a game you completed as **Completed** when you haven't given it a status yourself. On Xbox that's every achievement; on PlayStation, the platinum, or every trophy of a game without one. It's off to start with. Games you've completed show on Acorns > Sales' **Ready to sell?** (see [Selling your games](selling.md)).

## Viewers

People you invite as viewers see what you played unless you turn off **Viewers see what you played** (Settings > Security > Viewers). They never change it.
