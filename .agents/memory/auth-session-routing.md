---
name: Auth session routing
description: The app has local customer/team sessions alongside Replit OIDC sessions, and logout must identify which one is active.
---

Customer and team users authenticate with the local `team_session` cookie; they should be invalidated locally and returned to the app. Replit-authenticated users require the OIDC end-session flow.

**Why:** Production customer sign-outs were incorrectly sent to Replit OIDC, whose intermediate browser form made the app appear stuck on “Found. Redirecting” / “Submitting Callback”.

**How to apply:** Before redirecting to the provider, inspect whether the request actually has a validated team session. Do not treat `/api/logout` as a generic logout endpoint for every auth mode.