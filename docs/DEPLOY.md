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
player short-lived credentials (`TURN_TTL_SEC`, 6 hours by default). The API token itself never leaves
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

Open your `PUBLIC_ORIGIN` in a browser, sign in, create a room and share the 6-letter room code with
your friends. The containers restart by themselves after a reboot (`restart: unless-stopped`) as long as
Docker starts at boot.

To stop everything, run `docker compose -f deploy/docker-compose.yml down`. Your data stays in the
`hexhaven_hexhaven-data` volume.

## Backups

All game data lives in one SQLite database inside the Docker volume `hexhaven_hexhaven-data`.

- **While running** (safe, uses SQLite's online backup):

  ```bash
  sh deploy/backup.sh      # writes deploy/backups/hexhaven-<date>-<time>.sqlite
  ```

  To back up every night, add a cron job with `crontab -e`:
  `0 4 * * * cd /path/to/hexhaven && sh deploy/backup.sh`. Copy the backups to another disk or a cloud
  drive now and then.

- **Restore**:

  ```bash
  docker compose -f deploy/docker-compose.yml stop app
  docker compose -f deploy/docker-compose.yml cp deploy/backups/<file>.sqlite app:/data/hexhaven.sqlite
  docker compose -f deploy/docker-compose.yml run --rm --user root app \
    sh -c 'rm -f /data/hexhaven.sqlite-wal /data/hexhaven.sqlite-shm; chown node:node /data/hexhaven.sqlite'
  docker compose -f deploy/docker-compose.yml start app
  ```

## Updating

```bash
sh deploy/backup.sh                       # just in case
git pull
docker compose -f deploy/docker-compose.yml up -d --build
docker image prune -f                     # optional: remove old images
```

The database survives updates because it lives in the volume, not in the image. Read `.env.example`
after pulling, because new settings may appear there.

## Troubleshooting

**The site doesn't load.** Run `docker compose -f deploy/docker-compose.yml logs cloudflared`. A
"Unauthorized" error means `TUNNEL_TOKEN` is wrong. In Zero Trust → Tunnels, the tunnel should say
**Healthy**. Check that the public hostname points to `http://app:3000` and that the app container is
healthy (`ps`).

**Google sign-in button fails** with an "origin_mismatch" or "invalid client" error. The Authorized
JavaScript origin must match `PUBLIC_ORIGIN` exactly, including `https://` and without a trailing
slash. Google can take a few minutes to apply changes.

**Voice: "Microphone access was blocked".** Browsers only allow the microphone on `https://` pages (or
`http://localhost`). Click the lock or site-settings icon next to the address and allow the microphone,
then turn the mic on again. On macOS, also check **System Settings → Privacy & Security → Microphone**
for your browser.

**Voice: you can't hear someone.**

- If the game shows a "Click to enable audio" button, click it. Browsers block sound until you interact
  with the page.
- Check that the other player's mic is on. Their row shows a crossed-out mic icon when it is off.
  Also check their volume slider.
- A peer whose status dot stays orange or red never connected. That usually means a TURN problem:
  - Run `docker compose -f deploy/docker-compose.yml logs app | grep voice`. Look for "falling back to
    STUN only", which means the Cloudflare TURN credentials are wrong or missing.
  - In Chrome, open `chrome://webrtc-internals` in a new tab during a call. Under the connection, find
    the **selected candidate pair**. `relay` means TURN is in use. If no pair succeeds and you see no
    `relay` candidates at all, TURN isn't working. In Firefox, use `about:webrtc`.
  - To test TURN on purpose, open the game with `?voiceRelay=1&debug=1` added to the address. This
    forces every voice connection through the relay. Then run `await __hexVoice.candidates()` in the
    browser console. It should show `relay/...` for each peer.
- For coturn: run `docker compose -f deploy/docker-compose.yml logs coturn`, check the router port
  forwards, and check that `COTURN_EXTERNAL_IP` is your current public IP.

**Voice stops after a few hours.** TURN credentials expire after `TURN_TTL_SEC`. The game fetches new
ones when a connection fails, but leaving and re-joining voice also refreshes them.

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
