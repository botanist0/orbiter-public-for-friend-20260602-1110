# Remote 5G Access

Orbiter's iPhone Shortcut works on home Wi-Fi because the phone can reach the Windows machine at a private LAN IP such as `10.0.0.118`.

That IP is not reachable from 5G. The MVP remote path is Tailscale: the iPhone and Windows PC join the same private tailnet, and the Shortcut calls Orbiter through the PC's Tailscale address.

For full browser access and multi-user access, use `docs/LOCAL_PRODUCTION.md` and, when public HTTPS is needed, `docs/CLOUDFLARE_TUNNEL.md`. The older `remote:setup` flow is still useful for capture-only testing.

## Decision

Use Tailscale first.

Do not use router port forwarding for Orbiter's first remote access path. Orbiter currently serves private notes and APIs from the same backend, so exposing port `4173` to the public internet is the wrong default.

Cloudflare Tunnel is the current public-HTTPS option if Orbiter needs browser access without requiring the phone to run a VPN. It has a wider exposure boundary than Tailscale, so production auth, host checks, and origin checks are required.

## Why Tailscale

- No router port forwarding.
- No public Orbiter URL.
- Works from iPhone cellular data when Tailscale is connected.
- Keeps the existing iPhone Shortcut request shape.
- Allows MagicDNS names or stable Tailscale IPs.

## Setup Steps

### 1. Install Tailscale

Install Tailscale on Windows:

https://tailscale.com/docs/install/windows

Install Tailscale on the iPhone from the App Store:

https://apps.apple.com/us/app/tailscale/id1470499037

Sign into the same Tailscale account on both devices.

### 2. Confirm The PC Has A Tailscale Address

After Windows is signed in to Tailscale, run:

```powershell
npm run remote:setup
```

The command prints:

- Tailscale DNS name, if available.
- Tailscale IPv4 address.
- Orbiter remote Shortcut URL.
- Mobile token header.
- Optional Windows Firewall command.

### 3. Start Orbiter For Remote Capture

Run:

```powershell
npm run start:remote
```

This binds Orbiter to `0.0.0.0` so the Tailscale interface can reach it and enables the Tailscale network guard.

For the protected app, prefer:

```powershell
npm run prod:setup
npm run start:prod
```

Production mode adds browser login and rejects non-Tailscale/non-loopback clients.

### 4. Update The iPhone Shortcut

In the Shortcut's `Get Contents of URL` action, replace the Wi-Fi URL with the Tailscale IP URL printed by `npm run remote:setup`:

```text
http://<windows-tailscale-ip>:4173/api/mobile/capture
```

Use the numeric Tailscale IP first. MagicDNS hostnames are convenient later, but if the iPhone shows `A server with the specified hostname could not be found`, the hostname is not resolving on the phone. The numeric Tailscale IP avoids that DNS dependency.

Keep the same headers:

```text
x-orbiter-mobile-token: <token from setup>
Content-Type: application/json
```

In production mode, prefer user-attributed headers:

```text
x-orbiter-access-token: <user access token>
Content-Type: application/json
```

Keep the same JSON body:

```text
text: Provided Input
skill: capture
source: iphone-back-tap-5g
```

### 5. Test From 5G

1. Make sure Orbiter is running with `npm run start:remote`.
2. Make sure Tailscale is connected on Windows.
3. On the iPhone, open Tailscale and connect.
4. Turn off Wi-Fi so the phone uses cellular data.
5. Run the Shortcut.
6. Check Orbiter's Mobile view or `usernotes/mobile/`.

## iPhone VPN On Demand

After manual testing works, enable Tailscale VPN On Demand on iPhone so it connects automatically on cellular.

Recommended starting rule:

- Cellular: Always.
- Wi-Fi: Do Nothing, or only connect outside your home Wi-Fi.

Tailscale documents that iOS VPN On Demand can connect automatically on cellular and can also connect based on MagicDNS hostnames ending in `*.ts.net`.

## Windows Firewall

If the iPhone times out while Tailscale is connected, Windows Firewall may be blocking inbound port `4173`.

Run PowerShell as Administrator:

```powershell
New-NetFirewallRule -DisplayName "Orbiter Tailscale 4173" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4173 -RemoteAddress 100.64.0.0/10
```

Tailscale assigns device IPv4 addresses from `100.64.0.0/10`.

## Operational Rules

- Orbiter must be running on the Windows PC.
- The Windows PC must be awake and online.
- Tailscale must be connected on both devices.
- Use the numeric Tailscale IP endpoint first if MagicDNS fails on iPhone.
- The Shortcut must keep either the `x-orbiter-mobile-token` header or a user-specific `x-orbiter-access-token` header.
- If the Shortcut says the hostname could not be found, use the numeric Tailscale IP and confirm the iPhone is connected to the same tailnet.
- If the request times out, check Tailscale connection first, then Windows Firewall, then Orbiter backend status.

## Public HTTPS Option: Cloudflare Tunnel

Cloudflare Tunnel can publish a local service through Cloudflare without opening inbound router ports. It is useful if Orbiter needs to receive requests from places that cannot join your tailnet.

Use Cloudflare only with production auth enabled, because it creates a public hostname. See `docs/CLOUDFLARE_TUNNEL.md`.
