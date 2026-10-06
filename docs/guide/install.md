# 1. Install it

Squirrelcade is one Docker container with two folders: **config** (its database, settings, logs and backups) and **imports** (a folder it watches for collection exports). Pick the way your server runs Docker below; they all end at the same place.

## The compose file

Every way below uses this file. Change the three marked lines:

```yaml
services:
  squirrelcade:
    image: ghcr.io/squirrelcade/squirrelcade:latest
    container_name: squirrelcade
    restart: unless-stopped
    user: "1000:1000"            # 1. your user and group ids (see "Which user" below)
    environment:
      - TZ=America/New_York      # 2. your time zone
    volumes:
      - ./config:/config         # 3. where the two folders go on your server
      - ./imports:/imports
    ports:
      - "7575:7575"
```

- **Which user:** Squirrelcade needs permission to save files in the two folders. The `user:` line says which user it saves them as.
  - **Linux server:** run `id`. If it shows `uid=1000(you) gid=1000(you)`, keep `"1000:1000"`; if your numbers differ, use yours, as `"uid:gid"`.
  - **Synology, Unraid, TrueNAS:** use the numbers in that NAS's steps below.
  - **Windows or Mac:** delete the `user:` line.
- **Time zone:** your time zone's name, such as `America/Phoenix` or `Europe/London`. Find yours in the [list of time zones](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) (the "TZ identifier" column). Squirrelcade also asks on the first visit.
- **The folders:** `./config` means a folder named config next to the compose file. Use full paths when your app asks for them (`/volume1/docker/squirrelcade/config`).

The PC library (Playnite) and a second backup folder add lines of their own: see [Connect what you use](connect.md).

## On a Linux server with Docker

```bash
mkdir -p ~/squirrelcade/config ~/squirrelcade/imports
cd ~/squirrelcade
nano docker-compose.yml        # paste the file above and save
docker compose up -d
```

## On a Synology NAS (DSM 7.2, Container Manager)

1. Check the processor: **Control Panel > Info Center** names it. Intel or AMD is fine; an ARM processor (Realtek, for example) isn't supported yet. Then install **Container Manager** from the Package Center, if it isn't already.
2. In **File Station**, make a folder `docker/squirrelcade`, with `config` and `imports` folders inside it.
3. Let Squirrelcade save files there. The easy way: in **File Station**, right-click the `squirrelcade` folder, choose **Properties**, and on **Permission** click **Create**: pick **Everyone**, tick read and write, and apply it to the folders and files inside too. Then keep `"1000:1000"` in the compose file. (Or use your own account's numbers: turn on SSH in **Control Panel > Terminal & SNMP**, sign in with `ssh you@your-nas` and run `id`. Synology accounts start at 1026 and the group is usually `100`, so `"1026:100"`.)
4. **Container Manager > Project > Create:** name `squirrelcade`, path `docker/squirrelcade`, source **Create docker-compose.yml**; paste the file, then **Next** (the web portal page needs nothing: **Next** again) and **Done**. It downloads the image and starts it.

## On Unraid

The quickest way is the template:

1. Download [docs/unraid/squirrelcade.xml](../unraid/squirrelcade.xml) from the repository.
2. Save it on the Unraid flash drive (the **flash** share) as `config/plugins/dockerMan/templates-user/my-squirrelcade.xml`.
3. Open **Docker > Add Container** and pick **my-squirrelcade** under **Template**.
4. Check the paths, then click **Apply**.

Or fill in the form yourself:

1. **Docker > Add Container** (Squirrelcade isn't in Community Applications yet):
   - **Repository:** `ghcr.io/squirrelcade/squirrelcade:latest`
   - **Network type:** bridge; add a **Port** 7575 to 7575.
   - Add a **Path**: container `/config`, host `/mnt/user/appdata/squirrelcade/config`; and another: `/imports`, host `/mnt/user/appdata/squirrelcade/imports`.
   - Add a **Variable** `TZ` with your time zone.
   - **Extra Parameters** (Advanced view): `--user 99:100` (Unraid's nobody:users, which own appdata).
2. **Apply.**

## With Portainer

**Stacks > Add stack**, name it `squirrelcade`, paste the compose file into the **Web editor** with full paths for the two folders (they must exist, owned by the user in `user:`), and **Deploy the stack**.

## On TrueNAS SCALE (24.10 or later)

**Apps > Discover Apps > Install via YAML** (the ⋮ menu), name it `squirrelcade`, and paste the compose file with full paths to a dataset of yours (`/mnt/tank/apps/squirrelcade/config`, say). TrueNAS runs apps as its `apps` user: use `user: "568:568"` and give that user write access to the dataset.

## On Windows or a Mac (to try it)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. Make a new folder for Squirrelcade, with two empty folders inside it: `config` and `imports`.
3. In the new folder, save the compose file above as `docker-compose.yml`, without the `user:` line (Docker Desktop takes care of it). In Notepad, set **Save as type** to **All files**, or it saves `docker-compose.yml.txt`. In TextEdit on a Mac, choose **Format > Make Plain Text** first.
4. Open a terminal in that folder. On Windows 11, right-click an empty spot in the folder and choose **Open in Terminal**. On a Mac, type `cd ` (with the space) in Terminal, drag the folder onto the window, and press Return.
5. Run `docker compose up -d`, then open `http://localhost:7575`.

A computer that sleeps isn't a good home for Squirrelcade for good, but it's a fine way to try it.

## Check that it worked

- Open Squirrelcade in a browser on a computer at home. Its address is `http://`, your server's address, then `:7575`:
  - **On a NAS:** use the address you open its own page with, and change the number after the colon. If your Synology's page is `http://192.168.1.20:5000`, Squirrelcade is at `http://192.168.1.20:7575`.
  - **On a Linux server:** `hostname -I` prints its address (the first one), such as `192.168.1.20`.
  - **On the Windows PC or Mac you're using:** `http://localhost:7575`.

  The first page asks you to create the owner's account: that's step 2, [the first visit](first-run.md).
- Opening it from outside your home network (through a tunnel, say)? The first page then also asks for a **setup code**, so nobody else can claim a new install. Squirrelcade writes it in its log when it starts, on the line that begins "No account yet": `docker logs squirrelcade`, or Synology's **Container Manager > Container > squirrelcade > Log**.
- Nothing there? The container's log says why: `docker logs squirrelcade`, or the log in your NAS app. The usual causes:
  - **"permission denied" on /config:** the user in `user:` can't write to the config folder. Change the numbers, or the folder's owner (`sudo chown -R 1000:1000 config imports`).
  - **Port 7575 taken** by something else: change the left number (`"7580:7575"`) and open that port instead.
  - **"no matching manifest for linux/arm64"** when it downloads the image: the processor is ARM, which isn't supported yet (`uname -m` says `aarch64`).
  - **"manifest unknown"** or **"not found":** the image name is mistyped. It's `ghcr.io/squirrelcade/squirrelcade:latest`.

## Updating later

In the compose file's folder, run `docker compose pull`, then `docker compose up -d` (with `sudo` in front of each `docker` on a NAS over SSH). Or in your NAS app:

- **Synology's Container Manager:** in **Project**, select squirrelcade, then **Action > Stop** and **Action > Clean** (your files stay in the config folder). In **Image**, delete `ghcr.io/squirrelcade/squirrelcade`. Back in **Project**, **Action > Build** downloads the new version and starts it.
- **Unraid:** **Check for Updates** at the bottom of the Docker tab, then **apply update** on Squirrelcade.
- **Portainer:** the stack's **Editor**, then **Update the stack** with **Re-pull image and redeploy** on.

Squirrelcade copies its database before it changes it, and the first visit after an update shows what's new. More in [Keep it running](maintain.md).
