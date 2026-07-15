# Scoped Active Users World Map Plan

## Status

Proposed on 2026-07-14. This plan intentionally covers only the small,
single-bay version suitable for the current production cluster.

## Goal

Add an admin-only `/admin/active-users` page that answers:

- how many accounts have been active recently
- which countries those active accounts are in
- which active accounts are represented by a country bubble
- how to open the existing admin user details for one of those accounts

For this version, an active user means only:

```text
accounts.last_active >= now() - selected_window
```

The supported windows are 5, 15, and 60 minutes, plus 1 day (1440 minutes).
The default is 15 minutes. Connected Conat or websocket state is not part of
the definition.

## Explicit Scope

This version includes:

- one current bay only
- `accounts.last_active` as the sole activity signal
- one bubble per country
- total, mapped, and unknown-location counts
- a list of users after clicking a country bubble
- reuse of the existing admin user result/details component
- manual refresh and a bounded periodic refresh
- one short-lived current-location row per account

This version does not include:

- cross-bay aggregation
- websocket or Conat connection status
- historical movement, snapshots, or location history
- city-level bubbles
- names or email addresses permanently drawn over the map
- map pan, zoom, tiles, or an external map service
- analytics based on the location data
- exporting location data

The API and UI should say "current bay" rather than "global" so this does not
silently become incorrect when production gains additional bays.

## Existing Building Blocks

The implementation should build on these existing paths:

- `src/packages/util/db-schema/accounts.ts`
  - `accounts.last_active` already exists and has a PostgreSQL index.
- `src/packages/database/postgres/stats/activity.ts`
  - account activity is already recorded and throttled.
- `src/packages/frontend/conat/browser-session/session-heartbeat.ts`
  - browser session state is already sent periodically.
- `src/packages/frontend/conat/browser-session/index.ts`
  - the periodic browser-session heartbeat currently runs every 60 seconds.
- `src/packages/server/conat/api/system.ts`
  - `upsertBrowserSession` already authenticates the account and updates account
    activity.
- `src/packages/hub/servers/app/customize.ts`
  - Cloudflare country, region, city, continent, timezone, latitude, and
    longitude request headers are already exposed through customize data.
- `src/packages/frontend/customize.tsx`
  - the frontend customize type already includes those Cloudflare fields.
- `src/packages/frontend/admin/users/user.tsx`
  - `UserResult` is the existing admin account details component.
- `src/packages/database/postgres/core/delete.ts`
  - generic `delete_expired` discovers schema tables with an `expire` timestamp
    and deletes rows where `expire <= NOW()`.
- `src/packages/hub/hub.ts`
  - Launchpad runs `delete_expired` periodically. The default interval is two
    hours.

## Privacy And Data-Minimization Requirements

IP-derived location is personal data. The feature should store only the
minimum current state needed to render the map.

Hard requirements:

1. Store no IP address.
2. Store no request headers verbatim.
3. Store no location history or append-only events.
4. Keep at most one location row per account.
5. Overwrite the current row when a newer observation arrives.
6. Give every row a non-null `expire` timestamp.
7. Do not return expired rows even if physical cleanup has not run yet.
8. Do not write country, city, coordinates, names, or emails to application
   logs.
9. Do not use location for authorization, billing, abuse enforcement, or any
   other security decision. Browser-provided customize values are advisory.
10. Stop collecting when the feature is disabled; existing rows then disappear
    through expiration.

Use a 26-hour logical TTL. This provides the 24-hour active view plus a
two-hour margin for delayed activity and cleanup processing:

```text
expire = observed_at + interval '26 hours'
```

The existing Launchpad cleanup loop runs every two hours by default, so an
observation normally remains physically present for less than 28 hours after
the final refresh. Queries must still require `expire > NOW()` so the logical
retention boundary is exactly 26 hours regardless of cleanup timing.

Production rollout must verify that
`COCALC_DELETE_EXPIRED_INTERVAL_S` is no greater than 7200. If production ever
increases that interval, the privacy review must explicitly account for the
longer physical deletion delay.

The browser-session heartbeat may renew the row while the account continues to
be considered active by the existing `last_active` mechanism. This is current
presence, not retained history. Once the browser session stops updating, the
row expires.

## Feature Gate

Add a boolean site setting such as:

```text
active_user_map_enabled
```

It should default to `false`.

When disabled:

- browser-session updates must not persist location
- the admin page should explain that collection is disabled
- existing rows must not be returned
- existing rows are allowed to age out through their 26-hour expiration

Enable it on `cocalc.ai` only after Cloudflare visitor-location headers pass the
existing admin configuration test. Other sites should not begin collecting
location merely because they upgrade the code.

## Data Model

Add one backend-only schema table named `account_presence_locations`.

Suggested shape:

```ts
{
  account_id: uuid,          // primary key; exactly one current row per account
  bay_id: uuid,              // bay that observed this location
  observed_at: timestamp,    // server timestamp of the accepted observation
  expire: timestamp,         // non-null; observed_at + 26 hours
  country_code: string,      // ISO alpha-2, plus existing K1/XX conventions
  region_code: string | null,
  region: string | null,
  city: string | null,
  continent: string | null,
  timezone: string | null,
  latitude: number | null,
  longitude: number | null
}
```

Schema requirements:

- primary key on `account_id`
- index on `expire`
- index on `country_code`
- soft/ephemeral durability
- no frontend `user_query`
- no email address, display name, or IP address
- add the table to `src/packages/util/db-schema/index.ts`
- classify it in `src/packages/util/db-schema/table-ownership.ts` as
  ephemeral, bay-local, and rebuildable
- use account deletion cascading if supported by the schema layer; otherwise
  explicitly delete the row during account deletion and test that path

The table is deliberately not account-home authoritative state. Losing it
during a restart, restore, or future rehome is harmless because it is rebuilt
from a later browser-session observation.

## Location Collection

Do not add a new heartbeat.

Extend the existing browser-session snapshot with an optional location object
derived from the existing customize store:

```ts
location?: {
  country_code?: string;
  region_code?: string;
  region?: string;
  city?: string;
  continent?: string;
  timezone?: string;
  latitude?: string;
  longitude?: string;
}
```

The browser-session heartbeat already calls `upsertBrowserSession` every 60
seconds. Extend that server implementation so it may also upsert the current
location when the feature is enabled.

Server rules:

1. Derive `account_id` from authenticated RPC context. Never accept an account
   ID inside the location payload.
2. Derive `bay_id` on the server.
3. Apply a server-side per-account write throttle of at least five minutes so a
   one-minute heartbeat does not cause unnecessary database writes.
4. Use server time for `observed_at` and `expire`.
5. Accept country codes only after normalization and a strict length check. 
6. Cap all text field lengths before writing.
7. Parse coordinates as finite numbers and require latitude in `[-90, 90]` and
   longitude in `[-180, 180]`.
8. Treat `XX`, missing values, and invalid coordinates as unavailable rather
   than errors visible to the user.
9. Do not overwrite a recent valid row with an invalid or empty observation.
10. Use an upsert guarded by observation time so a delayed request cannot
    replace a newer row.
11. Failure to write location must never fail the browser-session heartbeat.
    Log only a generic error and account-independent diagnostic code.

The five-minute write throttle and 26-hour TTL preserve enough location state
for the 1-day view while the existing one-minute browser heartbeat is healthy.

## Admin RPC

Add a dedicated admin-only Conat RPC rather than a Next API route. A name such
as `getActiveUserMap` is sufficient for the scoped version.

Input:

```ts
{
  active_minutes: 5 | 15 | 60 | 1440;
}
```

Response:

```ts
{
  checked_at: string;
  bay_id: string;
  active_minutes: 5 | 15 | 60 | 1440;
  total_active: number;
  mapped_active: number;
  unknown_location: number;
  countries: Array<{
    country_code: string;
    count: number;
    users: ActiveMapUser[];
  }>;
}
```

`ActiveMapUser` should contain only what the admin drawer needs:

```ts
{
  account_id: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email_address?: string | null;
  last_active: string;
  country_code?: string | null;
  region_code?: string | null;
  region?: string | null;
  city?: string | null;
  timezone?: string | null;
}
```

If `UserResult` requires additional account status or membership fields, reuse
the same account projection used by admin user search rather than introducing
a second interpretation of account state.

RPC requirements:

- call the existing admin assertion before querying
- reject unsupported windows instead of accepting arbitrary SQL intervals
- query only the current bay
- determine activity only from `accounts.last_active`
- join location only where `account_presence_locations.expire > NOW()`
- count active accounts without valid locations in `unknown_location`
- exclude banned or deleted users only if existing admin user-search semantics
  already do so; otherwise include them and show their existing status tags
- order users by `last_active DESC`
- cap the returned users at a documented high bound and return a `truncated`
  flag if the bound is reached
- never cache the response publicly or outside the authenticated admin session

For the current production scale, one query and one response containing all
active users is simpler than a second lazy-loading RPC. If response size becomes
material, country-detail loading can be separated later without changing the
table or map model.

## Map UI

Add `active-users` to the typed admin routing and add an Operations card named
`Active Users Map`.

The page layout should contain:

1. A title and a small `Current bay` label.
2. A segmented active-window control for 5, 15, and 60 minutes, and 1 day.
3. A Refresh button and `Last refreshed ...` timestamp.
4. Summary cards for total active, mapped, and location unavailable.
5. A responsive world map with one bubble per country.
6. A right-side drawer opened by clicking a bubble.

Use a static, repository-owned equirectangular world SVG and a small country
centroid dataset. Natural Earth data is suitable and public domain; record the
source in the asset metadata or adjacent README.

Do not use third-party map tiles. This avoids:

- another network dependency
- leaking admin map views to a map provider
- API keys and usage billing
- CSP and offline/self-hosted complications

Bubble behavior:

- place bubbles at stable country centroids
- size by square root of account count with sensible min/max bounds
- show country name and active count in the tooltip
- use keyboard-focusable buttons or SVG elements with equivalent semantics
- expose an accessible label such as `Japan: 7 active users`
- visually distinguish a selected country
- do not place names or emails directly on the map

Country drawer:

- country name and active count in the title
- compact rows containing display name, email, city/region, and last-active time
- sort by most recently active
- clicking a row reveals or opens the existing `UserResult` admin details
- preserve the selected activity window while the drawer is open

Unknown locations should have a separate clickable summary that opens the same
user list without a geographic label. This keeps the active total honest when
Cloudflare headers are absent, Tor reports `K1`, or location parsing fails.

## Refresh Behavior

- Fetch immediately when the page opens.
- Refresh when the window selector changes.
- Provide an explicit Refresh button.
- Poll every 60 seconds while the page is visible.
- Stop polling when the component unmounts or the document is hidden.
- Do not overlap requests; if one is still pending, skip that poll.
- Keep the last successful map visible during a transient refresh error.
- Show a small non-destructive error with a retry action.

No websocket subscription is needed.

## Implementation Sequence

### Phase 1: Schema And Retention

1. Add `account_presence_locations` to the shared DB schema.
2. Register it in the schema index.
3. Add its ownership declaration.
4. Add database helpers for validated upsert and admin read.
5. Confirm `SCHEMA.account_presence_locations.fields.expire.type` is exactly
   `timestamp`, which is required by generic `delete_expired` discovery.
6. Add retention and delete-expired tests before collecting any data.

### Phase 2: Collection

1. Extend the shared `upsertBrowserSession` input type with optional location.
2. Add the customize-derived location to `buildSessionSnapshot`.
3. Validate and normalize only on the backend.
4. Add a five-minute server-side write throttle.
5. Upsert current location with a 26-hour expiration.
6. Ensure location failures do not affect browser-session health.

### Phase 3: Admin Read API

1. Add the admin-only Conat method and shared response types.
2. Implement the bounded `last_active` query.
3. Group users by country and compute all three counts.
4. Return current bay and checked-at metadata.
5. Add authorization, expiration, and count tests.

### Phase 4: Admin Page

1. Add typed routing and the admin Operations card.
2. Add the static world asset and country centroids.
3. Implement summary metrics, selector, map bubbles, and tooltips.
4. Add the country and unknown-location drawers.
5. Reuse `UserResult` for the selected account.
6. Add polling, visibility handling, and retry behavior.

### Phase 5: Production Rollout

1. Deploy the schema and backend with the feature disabled.
2. Verify Cloudflare visitor-location headers using the existing admin test.
3. Verify the generic delete-expired interval is at most 26 hours.
4. Enable `active_user_map_enabled` on `cocalc.ai`.
5. Confirm rows contain no IP address and all have non-null expiration.
6. Confirm an expired fixture disappears from API results immediately and from
   the physical table after maintenance runs.
7. Compare `total_active` against a direct bounded `accounts.last_active` count.
8. Enable the admin page for normal use.

## Tests

### Schema And Database

- table is registered in `SCHEMA`
- `expire` is a timestamp and participates in generic cleanup
- every upsert assigns a non-null expiration 26 hours in the future
- one account has at most one row
- newer observations replace older observations
- delayed observations cannot replace newer ones
- account deletion removes or eventually eliminates its presence row
- expired rows are never returned

### Collection

- authenticated account identity overrides any client-supplied identity
- disabled feature performs no write
- valid Cloudflare customize fields are normalized and written
- missing or malformed location performs no write
- invalid coordinates are rejected
- strings are length-bounded
- empty updates do not erase a recent valid location
- repeated one-minute heartbeats respect the five-minute write throttle
- location write failure does not fail `upsertBrowserSession`

### Admin RPC

- non-admin callers are rejected
- only 5, 15, 60, and 1440 minute windows are accepted
- `last_active` alone determines inclusion
- expired location rows count as unknown
- total equals mapped plus unknown
- country grouping and user ordering are deterministic
- response identifies the current bay
- result cap and truncation are explicit

### Frontend

- route parsing accepts `/admin/active-users`
- summary counts render correctly
- window changes refetch
- country bubbles have accessible labels
- bubble click opens the correct users
- unknown count opens unknown-location users
- selected user renders existing admin details
- polling does not overlap requests
- hidden/unmounted page stops polling
- failed refresh preserves the previous successful map

## Operational Checks

The page should expose enough non-PII diagnostics for admins to understand data
quality:

- checked-at time
- current bay ID
- active window
- total active
- mapped active
- unknown location
- feature disabled or Cloudflare location unavailable state

Do not add metrics labeled by account, city, email, or coordinates. Aggregate
metrics such as mapped/unknown counts are sufficient.

## Acceptance Criteria

The scoped feature is complete when:

1. An admin can open `/admin/active-users` and select 5, 15, or 60 minutes, or
   1 day.
2. The total exactly reflects current-bay `accounts.last_active` for that
   window.
3. Active users with current location appear in country count bubbles.
4. Clicking a bubble reveals the corresponding names, emails, approximate
   city/region, and last-active times.
5. Clicking a user exposes the existing admin user details.
6. Missing location is visible as an explicit count and user list.
7. Refresh works manually and every 60 seconds while visible.
8. No websocket-connected state is queried.
9. No IP address or historical location is stored.
10. Every location row becomes logically unavailable after 26 hours without a
    refresh and is physically removed by existing expiration maintenance.

## Future Extension Boundary

A future multibay or connected-user implementation must add a separate
aggregation design. It must not reinterpret this local RPC as globally
authoritative. The expiring location table can remain bay-local and
rebuildable; a future seed-level admin aggregator may request bounded summaries
from each bay and merge them by account ID.

Showing how activity evolved during the day is also a separate future feature.
The scoped table intentionally stores only the latest location per account, so
it cannot reconstruct an intraday timeline. Adding that capability would
require a new aggregate-snapshot design, a separate short retention policy, and
an explicit privacy review; it should not be implemented by turning the current
location table into an unbounded event history.

