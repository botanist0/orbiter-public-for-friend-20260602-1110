# Environment Widget

Orbiter's topbar environment widget combines backend-local time, optional local weather, and curated eclipse-event matching.

## What It Shows

- Local backend time from `/api/time`.
- Sun icon from 12:00 AM through 11:59 AM.
- Moon icon from 12:00 PM through 11:59 PM.
- Weather from `/api/environment` when a location is configured.
- Eclipse override when the configured location is inside a curated event path and the current time falls inside that event window.

## Location Config

Private location config belongs in `.orbiter/environment-config.json`:

```json
{
  "location": {
    "label": "Home",
    "latitude": 39.0,
    "longitude": -77.0,
    "timeZone": "America/New_York"
  }
}
```

Environment variables can override the file:

```powershell
$env:ORBITER_HOME_LABEL = "Home"
$env:ORBITER_HOME_LATITUDE = "39.0"
$env:ORBITER_HOME_LONGITUDE = "-77.0"
$env:ORBITER_HOME_TIMEZONE = "America/New_York"
```

## Data Sources

- Weather: Open-Meteo forecast API, called server-side with no API key.
- Eclipse events: `data/eclipse-events.json`, a curated local catalog with event time windows and approximate path waypoints.

## Limits

The eclipse matcher is intentionally conservative MVP logic. It checks curated event windows and approximate totality-path waypoints, not a full NASA Besselian-element path calculation. It is good enough to light up a local "watch this" state, but official event maps should remain the source of truth before travel or safety decisions.
