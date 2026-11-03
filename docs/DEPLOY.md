# Deploying Hexhaven at home

This guide is for the person who hosts the game. You run Hexhaven on a computer at home. Friends reach
it at an `https://` address through a **Cloudflare Tunnel**, so you don't need to open any ports on your
router.

```
friends' browsers ──https/websocket──► Cloudflare ──tunnel──► cloudflared ──► app (port 3000, SQLite)
friends' browsers ◄──── voice audio (WebRTC, UDP) ────► each other, or via a TURN relay
```

Voice audio does **not** go through the tunnel. Cloudflare Tunnel carries HTTP and WebSockets only, and
WebRTC audio uses UDP. Browsers send audio straight to each other when they can. When they can't (strict
home routers, mobile networks, company Wi-Fi), the audio goes through a **TURN relay**. That is why
setup includes a TURN step (step 4).

## What you need

- A computer that stays on during game nights, running Linux, macOS or Windows with
  [Docker Desktop](https://docs.docker.com/get-docker/) or Docker Engine plus the Compose plugin.
  Check that it works by running `docker compose version`.
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up) and a **domain** that uses
  Cloudflare's nameservers. You can buy one through Cloudflare Registrar for a few dollars a year, or
  move an existing domain to Cloudflare.
- Optional: a Google account, if you want friends to sign in with Google.
- This repository on that computer: `git clone https://github.com/huyen89/catan.git hexhaven && cd hexhaven`.

Run all commands below from the repository folder.

## 1. Create your settings file

```bash
cp .env.example .env
openssl rand -hex 32     # copy the output into SESSION_SECRET
```

Open `.env` in a text editor. Every setting has a comment above it. For now, set these:

- `PUBLIC_ORIGIN`: the address friends will open, for example `https://hexhaven.yourdomain.com`.
  Use exactly what appears in the browser bar, without a trailing `/`.
- `SESSION_SECRET`: the random string you generated above.
- `GUEST_INVITE_CODE`: a code that only your friends know.

Never share or commit `.env`. It holds your secrets, and git already ignores it.

## 2. Create the Cloudflare Tunnel

1. In the Cloudflare dashboard, open **Zero Trust**. The first visit asks you to pick a team name and the
   free plan.
2. Go to **Networks → Tunnels → Create a tunnel**, choose **Cloudflared**, and name it `hexhaven`.
3. On the "Install and run a connector" page, choose **Docker**. Copy the long token that follows
   `--token` in the command it shows. Paste it into `.env` as `TUNNEL_TOKEN=...`. You don't need to run
   the command yourself, because our compose file starts cloudflared for you.
4. Go to the **Public Hostname** tab and click **Add a public hostname**:
   - Subdomain: `hexhaven`. Domain: your domain. The result must match `PUBLIC_ORIGIN`.
   - Service: type **HTTP**, URL **`app:3000`**. `app` is the name of the game container inside Docker's
     network.
5. Save. Cloudflare creates the DNS record and the HTTPS certificate automatically.

## 3. Choose how friends sign in

You can use one or both of these methods:

- **Guest + invite code** (simplest). Friends enter a name and the `GUEST_INVITE_CODE`.
- **Google sign-in**:
  1. Go to the [Google Cloud console](https://console.cloud.google.com/) and create or select a project.
  2. Under **APIs & Services → OAuth consent screen**, set up an External app. While it is in
     "Testing", add your friends' Gmail addresses as test users.
  3. Under **APIs & Services → Credentials → Create credentials → OAuth client ID**, choose type
     **Web application**. Under **Authorized JavaScript origins**, add your `PUBLIC_ORIGIN`, for example
     `https://hexhaven.yourdomain.com`. For local development, also add `http://localhost:5173`.
     You don't need any redirect URIs.
  4. Copy the client ID, which ends in `.apps.googleusercontent.com`, into `GOOGLE_CLIENT_ID`.
  5. List the allowed accounts in `ALLOWED_EMAILS`, comma-separated:
     `alice@gmail.com,bob@gmail.com`.

**Optional extra lock: Cloudflare Access.** In Zero Trust, go to **Access → Applications → Add an
application → Self-hosted**. Use your hostname and add a policy "Allow, Emails: your friends' emails".
Cloudflare then asks visitors for a one-time email code before they ever reach the game. WebSockets and
voice keep working. Friends sign in twice (once to Access, once to the game), which is the trade-off
for the extra protection.

## 4. Set up voice relay (TURN)

**Recommended: Cloudflare Realtime TURN.**

1. In the Cloudflare dashboard, go to **Realtime → TURN Server → Create**. Give it a name.
2. Copy the **Turn Token ID** into `CF_TURN_KEY_ID` and the **API Token** into `CF_TURN_API_TOKEN`.
   Cloudflare shows the API token only once.
3. Keep `TURN_PROVIDER=cloudflare`.

Cloudflare charges for TURN by relayed traffic and includes a free allowance. Voice-only use by a group
of friends is tiny, but check the current pricing on their site. The game server hands each signed-in
player short-lived credentials (`TURN_TTL_SEC`: 60..172800 seconds, default 3600 (1h)). The API token itself never leaves
your server.

**Alternative: your own coturn server.** Use this only if you can forward ports on your router.

1. On your router, forward **UDP 3478** and **UDP 49160–49200** (and optionally TCP 3478) to this
   computer.
2. In `.env`, set:
   - `TURN_PROVIDER=coturn`
   - `COTURN_SECRET`: generate one with `openssl rand -hex 32`.
   - `COTURN_URLS=turn:<your-public-ip-or-name>:3478?transport=udp,turn:<same>:3478?transport=tcp`
   - `COTURN_REALM`: your domain.
   - `COTURN_EXTERNAL_IP`: `<public-ip>/<this-computer's-LAN-ip>`, for example `203.0.113.7/192.168.1.20`.
3. Start the stack with `--profile coturn` added (see the next step). The relay refuses to forward
   traffic to private network addresses, so it cannot be used to reach your home network.
   Don't use a Cloudflare-proxied (orange-cloud) hostname in `COTURN_URLS`, because TURN needs your real
   IP. A home IP that changes needs a dynamic-DNS name.

**`TURN_PROVIDER=none`** uses only a public STUN server. This works for many home networks but not all
of them.

## 5. Start it

```bash
docker compose -f deploy/docker-compose.yml up -d --build
# with your own TURN server:
docker compose -f deploy/docker-compose.yml --profile coturn up -d --build
```

The first build takes a few minutes. Then:

```bash
docker compose -f deploy/docker-compose.yml ps         # app should become "healthy"
docker compose -f deploy/docker-compose.yml logs -f    # Ctrl+C to stop following
curl http://127.0.0.1:3000/api/health                  # works on the host machine only
```

If the app keeps restarting, read its log. The most common cause is a missing `PUBLIC_ORIGIN`: in
production the server refuses to start without it.

Open your `PUBLIC_ORIGIN` in a browser, sign in, create a room and share the 6-letter room code with
your friends. To stop everything, run `docker compose -f deploy/docker-compose.yml down`. Your data
stays in the `hexhaven_hexhaven-data` volume.

**What the compose file does for you:**

- **Restarts.** Every container has `restart: unless-stopped`, so it comes back after a crash or a
  reboot, as long as Docker itself starts at boot (Docker Desktop: "Start when you sign in").
- **Health check.** Docker calls `/api/health` every 30 seconds and marks the app unhealthy after 3
  failures. cloudflared only starts once the app is healthy.
- **Locked-down container.** The app runs as the unprivileged `node` user with a read-only filesystem,
  no Linux capabilities and `no-new-privileges`. It can write only to the `/data` volume (the SQLite
  database) and a small in-memory `/tmp`. Logs are rotated (3 × 10 MB per container).
- **Only local port.** Port 3000 is bound to `127.0.0.1`; friends reach the game only through the
  tunnel.

## 6. Check voice from a phone on mobile data

Home Wi-Fi often hides TURN problems, because two browsers on friendly networks connect directly.
Mobile networks usually need the relay, so test there once after setup and after changing TURN
settings:

1. On your phone, **turn Wi-Fi off** so it uses mobile data. Open your `PUBLIC_ORIGIN` and sign in.
2. Open a room, then open **Connection test** under the voice controls and tap **Test connection**.
   It fetches fresh TURN credentials and asks the relay for addresses, without using the microphone.
   - **TURN relay: UDP** (or TCP/TLS) means the relay answered. The result should be green.
   - **TURN relay: no answer** means the credentials or the TURN server are wrong (see
     Troubleshooting). **not configured** means `TURN_PROVIDER=none` or missing keys.
   - **STUN: yes** means the phone found its public address. That alone is not enough on most
     mobile networks.
3. For an end-to-end check, join voice on the phone and on a computer at home, in the same room. Each
   person in the voice list gets a small badge once connected (hover or long-press it for details):
   **LAN** = same network, **P2P** = direct (usually over the internet), **TURN** = relayed. On mobile data
   you will usually see **TURN** or **P2P**; both are fine if you can hear each other.
4. To force the relay and prove it carries audio, open the game on the computer with
   `?voiceRelay=1` added to the address (for example `https://hexhaven.yourdomain.com/?voiceRelay=1`)
   and join voice again. Every badge must show **TURN** and audio must still work.

## Backups

All game data lives in one SQLite database inside the Docker volume `hexhaven_hexhaven-data`.

**Back up** while the game is running (uses SQLite's online backup, then checks the copy):

```bash
sh deploy/backup.sh      # → deploy/backups/hexhaven-<date>-<time>.sqlite, keeps the newest 14
KEEP=30 sh deploy/backup.sh   # keep 30 instead (KEEP=0 keeps all)
```

Nightly backups with cron (`crontab -e`), adjusting the path:

```cron
17 4 * * * cd /path/to/hexhaven && sh deploy/backup.sh >> deploy/backups/backup.log 2>&1
```

`deploy/backups/` is on the same disk as the game. Copy it to another disk or a cloud drive now and
then.

**Restore** a backup (stops the app, checks the file, swaps the database, starts the app again; if the
file is damaged nothing is changed):

```bash
sh deploy/restore.sh deploy/backups/hexhaven-20250101-041700.sqlite
```

Games in progress since that backup are lost, so restore between game nights.

## Updating

```bash
sh deploy/backup.sh                                     # 1. back up first
git pull                                                # 2. get the new version
diff <(grep -o '^#* *[A-Z_]*=' .env.example | tr -d '# ' | sort) \
     <(grep -o '^#* *[A-Z_]*=' .env | tr -d '# ' | sort)  # 3. new settings? (lines with <; bash)
docker compose -f deploy/docker-compose.yml pull cloudflared   # 4. newer tunnel image
docker compose -f deploy/docker-compose.yml up -d --build      # 5. rebuild and restart
docker compose -f deploy/docker-compose.yml ps                 # 6. wait for "healthy"
docker image prune -f                                   # optional: remove old images
```

Add `--profile coturn` to steps 4–5 (and `pull coturn`) if you run your own TURN server. The database
survives updates because it lives in the volume, not in the image; the server applies database
migrations by itself on start.

**Rolling back:** `git checkout <previous-commit>`, then `docker compose ... up -d --build`. If the new
version had already migrated the database, also restore the backup from step 1 with
`deploy/restore.sh`.

## Troubleshooting

**The site doesn't load (tunnel down).**

- `docker compose -f deploy/docker-compose.yml ps`: the app must be **healthy** and cloudflared
  **running**. cloudflared waits for a healthy app, so an app problem also keeps the tunnel down.
- `docker compose -f deploy/docker-compose.yml logs --tail 50 cloudflared`: "Unauthorized" or "token is
  not valid" means `TUNNEL_TOKEN` is wrong. Repeated "connection failed" lines mean this machine can't
  reach Cloudflare (internet or firewall; outbound port 7844 must be allowed).
- In Zero Trust → Networks → Tunnels the tunnel should say **Healthy**, and its public hostname must
  point to `http://app:3000`.
- Error 502/1033 in the browser: the tunnel is up but cannot reach the app. Check the app log.
- Restart both with `docker compose -f deploy/docker-compose.yml restart`.

**Google sign-in fails ("origin_mismatch", "invalid client", or the button does nothing).** The
**Authorized JavaScript origin** in the Google console must match `PUBLIC_ORIGIN` exactly: same
`https://`, same host name, no trailing slash, no path. If you changed the hostname, update both,
then restart the app (`docker compose ... up -d`). Google can take a few minutes to apply changes.
"Access blocked: app is in testing" means the account is not in the consent screen's test users;
"This account is not on the guest list" from the game means it is not in `ALLOWED_EMAILS`.

**Voice: "Microphone access was blocked".** Browsers only allow the microphone on `https://` pages (or
`http://localhost`). Click the lock or site-settings icon next to the address and allow the microphone,
then turn the mic on again. On macOS, also check **System Settings → Privacy & Security → Microphone**
for your browser.

**Voice: "Voice chat is full".** The room already has `VOICE_MAX_PEERS` people in voice (8 by
default). Raise it in `.env` and restart the app, but every extra person adds an upload stream for
everyone, which phones notice.

**Voice: no audio / you can't hear someone.**

- If the game shows a "Click to enable audio" button, click it. Browsers block sound until you interact
  with the page. On phones, check the ringer/silent switch and media volume.
- Check that the other player's mic is on (their row shows a crossed-out mic when it is off) and
  their volume slider.
- A peer whose status dot stays orange or red never connected. That is almost always TURN:
  - Run the **Connection test** (step 6) on the affected device. "TURN relay: no answer" or "not
    configured" confirms it.
  - `docker compose -f deploy/docker-compose.yml logs app | grep -i -E 'voice|turn|ice'`: "falling back
    to STUN only" means the Cloudflare TURN key ID or API token is wrong or missing.
  - In Chrome, `chrome://webrtc-internals` (Firefox: `about:webrtc`) during a call shows the
    **selected candidate pair**. No succeeded pair and no `relay` candidates means TURN isn't working.
  - For coturn: `docker compose -f deploy/docker-compose.yml logs coturn`, check the router port
    forwards, and check that `COTURN_EXTERNAL_IP` is your current public IP.
- Voice reconnects by itself after short network drops (it renegotiates a peer connection that has been
  down for 5 seconds, and re-joins voice when the game's connection comes back). If a peer stays red,
  leave and re-join voice.

**Voice stops after a while (about an hour by default).** TURN credentials expire after `TURN_TTL_SEC`
(default 3600 seconds). The game fetches new ones when a connection fails, and leaving and re-joining
voice also refreshes them.

## Running without Docker (development or a quick test)

You need Node.js 22+ and pnpm. Enable pnpm with `corepack enable`.

```bash
pnpm install
cp .env.example .env          # then edit it, as in step 1
pnpm dev                      # server on :3000 + Vite dev server on http://localhost:5173 (hot reload)
```

To run a production build without Docker:

```bash
pnpm build                                   # bundles the web app into apps/web/dist
set -a && . ./.env && set +a                 # load .env into this shell
WEB_DIST="$PWD/apps/web/dist" pnpm start     # serves everything on http://localhost:$PORT
```

The microphone works on `http://localhost` without HTTPS. Other devices on your network need HTTPS
(the tunnel) for voice.
