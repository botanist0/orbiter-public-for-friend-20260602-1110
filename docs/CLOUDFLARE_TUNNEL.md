# Cloudflare Tunnel for Orbiter

This is the next local-production path for exposing Orbiter at:

```text
https://example.com/
```

Cloudflare Tunnel forwards public HTTPS traffic to Orbiter running on the home Windows PC:

```text
http://127.0.0.1:4173
```

This does not move Orbiter to AWS. Markdown data and `.orbiter/` secrets stay local.

## What Is Implemented

Orbiter now has:

```powershell
npm run start:cloudflare
npm run start:cloudflare:dev
npm run cloudflare:check
npm run cloudflare:setup
npm run cloudflare:setup -- --uuid <TUNNEL_UUID>
npm run cloudflare:run
```

`start:cloudflare` starts Orbiter with:

- auth required
- local bind to `127.0.0.1`
- public origin set to `https://example.com`
- Host checks for `example.com`, `www.example.com`, `orbiter.example.com`, `localhost`, and `127.0.0.1`
- Origin checks for the public domain, including normalized browser origins such as `https://example.com:443`
- network guard off because Cloudflare Tunnel reaches Orbiter through loopback

The server also protects the public tunnel mode with:

- allowed Host checks
- Origin checks on `POST`, `PATCH`, and `DELETE`
- `Secure` session cookies when HTTPS is the public origin
- baseline browser security headers

`start:cloudflare:dev` starts a separate lower environment with:

- port `4174`
- public origin `https://dev.example.com`
- allowed Host/Origin checks for `dev.example.com`, `example.com`, and `www.example.com`
- production auth required
- Command Center feature flag enabled

Do not add the Command Center feature flag to `start:cloudflare` until you decide to roll it out.

If token login returns `Request origin is not allowed.`, the browser is reaching Orbiter through a hostname that is not in the running profile's `ORBITER_ALLOWED_ORIGINS`. Restart Orbiter with the corrected Cloudflare profile after changing these values; the running Node process does not reload package script changes automatically.

For local dev testing at `http://localhost:4174`, Orbiter should not emit a `Secure` session cookie unless the request was actually forwarded over HTTPS by Cloudflare. If login says it succeeded but the next page still shows the login screen, check the `Set-Cookie` header and restart the dev server after auth-cookie changes.

## Current Status

`cloudflared` is installed as a Windows service, the `Orbiter` tunnel is connected, and `example.com` is routed through Cloudflare to the local Orbiter server.

Run:

```powershell
npm run cloudflare:check
```

Expected result:

```text
cloudflared is installed.
```

If Windows says `This app can't run on your PC`, check whether the installed executable is corrupt:

```powershell
where.exe cloudflared
Get-Item C:\Windows\System32\cloudflared.exe
cloudflared --version
```

If the file size is `0`, delete the corrupt executable from an elevated terminal and reinstall `cloudflared`. Do not retry the tunnel token command until `cloudflared --version` prints a real version.

## One-Time Cloudflare Setup

Install `cloudflared` for Windows from Cloudflare's official download page.

### Option A: Cloudflare Dashboard Managed Tunnel

If Cloudflare gives you a command shaped like this:

```powershell
cloudflared.exe service install <TUNNEL_TOKEN>
```

you are using a dashboard-managed tunnel. This is fine, and it is the simplest Windows service path once `cloudflared --version` works.

In the current Cloudflare dashboard, configure the tunnel as a published application route:

```text
Cloudflare dashboard -> Networking -> Tunnels -> Orbiter -> Routes -> Add route -> Published application
```

Use:

```text
Tunnel: Orbiter
Tunnel ID: 30dcd054-a8f9-45c6-ae0d-553083eeda66
Hostname: example.com
Service URL: http://127.0.0.1:4173
```

If the UI splits hostname into subdomain and domain:

```text
Subdomain: leave blank
Domain: example.com
Service URL: http://127.0.0.1:4173
```

If Cloudflare rejects a blank subdomain, try `@` only if the preview resolves to exactly `example.com`. Do not save anything that previews as `@.example.com`.

If Cloudflare says an A, AAAA, or CNAME record already exists for `example.com`, delete or replace only that apex website record. Do not delete MX, TXT, SPF, DKIM, DMARC, or other email/verification records.

Then start Orbiter in Cloudflare mode:

```powershell
npm run start:cloudflare
```

The Cloudflare Windows service will keep the tunnel running separately from Orbiter.

Treat the `<TUNNEL_TOKEN>` as a secret. If it is pasted into an unsafe location, refresh or recreate it before final service install.

If `https://example.com/` returns Cloudflare `503`, the tunnel is likely connected but missing this Published application route. A diagnostic report showing `service: http_status:503` confirms the missing ingress rule.

### Dev Public Hostname

Use this for the hidden lower environment:

```text
https://dev.example.com/
```

Add a second published application route on the same `Orbiter` tunnel:

```text
Subdomain: dev
Domain: example.com
Path: leave blank
Service type: HTTP
Service URL: http://127.0.0.1:4174
Tunnel: Orbiter
```

Then run the dev profile in a separate terminal:

```powershell
npm run start:cloudflare:dev
```

Production can remain on:

```powershell
npm run start:cloudflare
```

Cloudflare documentation calls this a public hostname or published application route. Do not use a private network CIDR route for this browser app unless you intentionally want Cloudflare One Client/Gateway requirements.

### Option B: Locally Managed Tunnel

Then authenticate:

```powershell
cloudflared tunnel login
```

Create the tunnel:

```powershell
cloudflared tunnel create Orbiter
```

Copy the tunnel UUID from the output, then generate Orbiter's project-local tunnel config:

```powershell
npm run cloudflare:setup -- --uuid <TUNNEL_UUID>
```

This writes:

```text
.orbiter/cloudflare/config.yml
.orbiter/cloudflare/commands.txt
```

Route the domain to the tunnel:

```powershell
cloudflared tunnel route dns Orbiter example.com
```

If Cloudflare reports that a DNS record already exists for `example.com`, delete or replace only the existing apex A/AAAA/CNAME website record, then rerun the route command.

## Run Manually

Terminal 1:

```powershell
npm run start:cloudflare
```

Terminal 2:

```powershell
npm run cloudflare:run
```

Open:

```text
https://example.com/
```

You should see the Orbiter login page directly at the root domain. After entering an access token, Orbiter redirects back to `/` and loads the app.

Confirm the public route and health check:

```powershell
curl.exe -I https://example.com/login.html
curl.exe -I https://example.com/api/health
curl.exe https://example.com/api/health
```

Expected:

- `login.html` returns `200 OK`.
- `HEAD /api/health` returns `200 OK`.
- `GET /api/health` returns JSON with `"ok": true`.

## Japan Readiness Checklist

Before relying on this while traveling:

- Confirm `https://example.com/` loads from an iPhone on cellular with Wi-Fi off.
- Confirm login works with the `nitro` admin token.
- Confirm Commands view loads after login.
- Confirm `Claim next for Codex` works from the mobile browser.
- Confirm the home PC does not sleep while you are away.
- Confirm Orbiter starts after reboot.
- Confirm the tunnel starts after reboot.
- Keep Tailscale capture working as the fallback path.

## Service Mode

Cloudflare supports running `cloudflared` as a Windows service. Do this only after the manual run path works.

The service setup may require an elevated terminal. Cloudflare's Windows service documentation expects `cloudflared` and config files to be available to the service account. If the service cannot see your user-profile `.cloudflared` files, copy the config and credentials into the service account location or use Cloudflare's dashboard-provided service install token.

## Sources

- Cloudflare Tunnel local tunnel creation: https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/
- Cloudflare Tunnel routing: https://developers.cloudflare.com/tunnel/routing/
- Cloudflare Tunnel configuration file: https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/
- Cloudflare Tunnel Windows service: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/
