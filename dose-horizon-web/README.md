# Dose Horizon — username & PIN edition

This version adds real accounts to the web tracker. Each person creates a username and a 4–12 digit PIN. Records are saved separately in a Supabase database and can be loaded from another device. The package contains no personal records, accounts, PINs, or production credentials.

**This version requires backend setup. Uploading only the public folder to Netlify Drop is no longer sufficient.** Use the steps in SETUP.md. No database connection has been configured for you, and this package has not been deployed.

## What changed

- Create account, log in, and log out.
- Case-insensitive usernames (3–24 letters, numbers, underscores).
- PINs hashed with a server-held secret and bcrypt; raw PINs are never stored.
- Separate account records with server-side session authorization.
- Recovery code shown at signup and after recovery; save it privately. No email required.
- Change PIN in Settings. PIN changes end other sessions; recovery ends all previous sessions.
- Seven-day sessions in secure, HttpOnly cookies. Log out on a shared device.
- Failed attempt limits and conflict detection for saves from multiple tabs/devices.

The existing shots, standard dose dropdowns, charts, weight goals, cumulative water/protein, injection recency map, journal, dark mode, reminders, and export/import remain available. Account access and saving now require an internet connection. The cached app shell does not include account records or API responses.

## Important behavior

New accounts start empty. Old browser-only records are not automatically assigned to any account. If you have existing entries, export them from the older version first, then log in to the correct account and import that JSON backup in Settings. Android backups can also be imported voluntarily. Keep backups private.

Settings → Clear my records clears the signed-in account's tracking data and preferences across its devices; it keeps the account and PIN. It does not affect other accounts. Settings → Refresh records loads changes made on another device. If two devices save the same revision, the second save is rejected and the latest records loaded, rather than overwriting the first device's change. Review and retry that entry.

There is no email recovery or administrator PIN lookup. If both the PIN and recovery code are lost, this app cannot restore login access. The site operator controls the database and can access its records; this is not end-to-end encryption.

Reminders are unchanged: browser alerts need the app open and permitted by the browser. Download/import the calendar reminders for closed-app alerts. Account login does not add native background alarms. Calendar events are external to the app and remain until removed from the calendar.

## Development and verification

Runtime: Node 22 or newer. There are no production npm dependencies. `npm ci` installs the SQL test dependency. `npm run check` checks JavaScript syntax. `npm test` runs the actual database SQL in an isolated Postgres-compatible PGlite database, including the pgcrypto extension, with fake test credentials and no external service. Test fixtures are never published: Netlify publishes only `public/`.

The backend is `netlify/functions/account.mjs`. `database/setup.sql` creates the private tables and service-only RPC. `public/` contains the interface. Keep `.env` out of source control. The Netlify project configuration is in `netlify.toml`.

## Medication estimates

The chart estimates amount remaining, not measured blood concentration. It assumes immediate absorption and fixed elimination half-lives of 5.5 days for tirzepatide and 7 days for semaglutide. It does not recommend doses.
