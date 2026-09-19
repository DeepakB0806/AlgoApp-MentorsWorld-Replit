---
name: Auth session routing
description: The app has local customer/team sessions alongside Replit OIDC sessions, and logout must identify which one is active.
---

Customer and team users authenticate with the local `team_session` cookie; they should be invalidated locally and returned to the app. Replit-authenticated users require the OIDC end-session flow.

**Why:** Production customer sign-outs were incorrectly sent to Replit OIDC, whose intermediate browser form made the app appear stuck on “Found. Redirecting” / “Submitting Callback”.

**How to apply:** Before redirecting to the provider, inspect whether the request actually has a validated team session. Do not treat `/api/logout` as a generic logout endpoint for every auth mode.

The browser should enter logout through one server-owned route. That route clears a validated local session and redirects home; only requests without a local session may delegate to the Replit OIDC endpoint. Provider cleanup errors must stop before provider navigation.

**Why:** A client-side “clear local session, then decide whether to visit OIDC” flow can misroute when the local cleanup request fails or when auth state changes between the two requests.

**How to apply:** Keep the local/provider decision on the server, and make authenticated browser logout tests assert both the home redirect and the absence of provider navigation.