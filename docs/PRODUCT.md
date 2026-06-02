# Product

Orbiter is a local-first personal operating system for capture, memory, travel planning, email awareness, and reviewable Codex assistance.

The target user should not need to understand agent infrastructure. Orbiter should feel like a practical home/life manager that runs from the owner machine, keeps data inspectable, and asks for review before high-impact actions.

## Primary Users

- Owner/operator: runs Orbiter, reviews commands, manages remote access, and uses Codex to improve the system.
- Trusted household user: can share selected surfaces such as travel planning.
- Guest/family user: can sign in with Google, import limited travel email, view an itinerary, and wipe local data on logout.

## Current Product Pillars

- Quick capture from browser and iPhone.
- Local markdown workspace.
- Search and graph views.
- Mobile usernote review.
- Command review and Codex handoff.
- Gmail/email import with filtering.
- Reviewable outbound email drafts and sends.
- Travel itinerary and gap planning.
- Local production access through Tailscale or Cloudflare Tunnel.
- Self-heal and self-upgrade scaffolding.

## Product Rules

- Local files remain readable without Orbiter.
- Automation must earn trust through visible review states.
- Remote access must not weaken data boundaries.
- Guest/family flows should be simpler than owner/admin flows.
- Email and travel data are sensitive and should be scoped by user.
- Orbiter should prefer official confirmations over inferred state.

## Non-Goals For Now

- Public SaaS multi-tenant hosting.
- Direct autonomous purchases or bookings.
- Unreviewed remote code execution.
- Broad cloud sync.
- Plugin marketplace.
- Replacing Gmail, Calendar, or ChatGPT; Orbiter should integrate and organize.

## Near-Term Direction

1. Make Google SSO plus 100-message travel import reliable for family users.
2. Make Travel the premium daily-use feature for Japan/Korea/Vietnam planning.
3. Add a System dashboard for health, tunnel, email, command, and self-heal status.
4. Improve command UX so long descriptions and running/done states are obvious.
5. Keep documentation organized around architecture plus subsystem runbooks.
