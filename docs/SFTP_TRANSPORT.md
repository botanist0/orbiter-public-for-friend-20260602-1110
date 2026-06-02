# SFTP Transport Plan

SFTP is for file movement, not quick text capture. The Back Tap HTTP capture path remains the fastest way to send ideas into Orbiter. SFTP should handle larger files, attachments, exports, and bulk transfer between the iPhone and the Windows workspace.

Status: future research. Orbiter does not currently include an SFTP scanner, SFTP UI, or upload manifest workflow. Use this document only when deciding whether to build that subsystem.

## Research Notes

- Windows includes OpenSSH components, and Microsoft documents `sftp` as the Secure File Transfer Protocol service that runs over SSH.
- Microsoft documents installing and starting OpenSSH Server from an elevated PowerShell prompt.
- Apple's built-in Files app can connect to file servers, but the native flow is oriented around server connections such as SMB. For SFTP on iPhone, a third-party file manager or Shortcut-capable SFTP client is likely the pragmatic path.

## Recommended MVP

1. Keep Orbiter HTTP capture as the main quick-entry path.
2. Enable Windows OpenSSH Server only on the trusted LAN.
3. Create a dedicated Windows user or restricted SFTP-only target for Orbiter transfers.
4. Point uploads at `usernotes/mobile-files/` or `inbox/attachments/`.
5. Add an Orbiter file intake scanner that notices new uploaded files and creates a markdown manifest note.

## Windows Setup Outline

Run PowerShell as Administrator:

```powershell
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

Then add a firewall rule for port `22` scoped to the local subnet only.

## iPhone Path

Use a third-party iPhone file manager that supports SFTP and iOS share sheet/Shortcuts. Configure:

- Host: Windows Wi-Fi IP, currently `10.0.0.118`
- Protocol: SFTP
- Port: `22`
- User: dedicated Orbiter transfer user
- Remote folder: Orbiter upload folder

## Orbiter Work Needed

- Create `usernotes/mobile-files/`.
- Create `inbox/attachments/`.
- Add a backend endpoint or scanner for uploaded files.
- Generate one markdown manifest per upload.
- Add a UI view for file captures.
- Add issue-journal entries for failed uploads or unrecognized file types.

## Risks

- SSH credentials expose filesystem access if configured too broadly.
- Windows firewall scope must stay local-only.
- iPhone SFTP app quality varies; test before relying on it.
- SFTP is not ideal for instant typed notes; keep Back Tap HTTP capture.
