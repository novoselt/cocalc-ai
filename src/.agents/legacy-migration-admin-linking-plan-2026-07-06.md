# Legacy Migration Admin Account Linking Plan

## Context

cocalc.com is no longer available as a live login surface, so some legitimate
users cannot prove legacy ownership through the normal verified-email flow. The
current migration system already has the right central authorization primitive:
`legacy_migration_account_links`. Project listing and import authorization use
that table to decide which legacy projects a current account can see and
migrate.

The missing capability is an admin-only, audited support workflow for creating
and removing explicit legacy-account links after a human review.

This plan intentionally avoids embedding real support names, email addresses,
or identifying project titles.

## Goals

- Add an admin-only "Migration" tool to `/admin/user-search` for the selected
  current account.
- Let support search the legacy migration catalog by account evidence and
  project evidence.
- Let support explicitly link a legacy account to the selected current account.
- Let support unlink a mistaken explicit link without deleting historical audit
  evidence.
- Let support inspect linked legacy accounts and load a capped list of their
  non-hidden legacy projects.
- Make linked legacy accounts immediately authorize the existing user-facing
  migration page and import APIs.
- Audit every admin mutation with actor, reason, timestamp, and optional support
  reference.

## Non-Goals

- Do not reopen or depend on live cocalc.com authentication.
- Do not mutate legacy email verification state.
- Do not bypass project import ownership rules outside the legacy migration
  subsystem.
- Do not build a general-purpose support CRM.
- Do not expose raw legacy metadata blobs in the default UI.
- Do not proxy project archive data through the hub; the existing restore path
  remains responsible for data-plane work.

## Existing Integration Points

- User-facing legacy migration UI:
  `src/packages/frontend/account/legacy-migration-page.tsx`
- Hub API type surface:
  `src/packages/conat/hub/api/legacy-migration.ts`
- Hub API implementation:
  `src/packages/server/conat/api/legacy-migration.ts`
- Core legacy migration logic:
  `src/packages/server/legacy-migration/index.ts`
- Legacy migration schema:
  `src/packages/util/db-schema/legacy-migration.ts`
- Admin user search entry point:
  `src/packages/frontend/admin/users/user-search.tsx`
- Admin user result row:
  `src/packages/frontend/admin/users/user.tsx`
- Table ownership manifest:
  `src/packages/util/db-schema/table-ownership.ts`

## Data Model

### Keep `legacy_migration_account_links`

Use the existing table as the authoritative active-link source:

- `legacy_account_id`
- `account_id`
- `claim_method`
- `metadata`
- `created`
- `updated`

Existing automatic links use `claim_method='verified-email'`. Admin-created
links should use `claim_method='support-admin'`.

### Extend Link Metadata

For admin links, store structured metadata:

```json
{
  "reason": "short human-entered reason",
  "support_reference": "optional ticket/reference",
  "created_by": "admin account uuid",
  "created_by_email": "admin email if cheap and already available",
  "evidence": {
    "kind": "account-search|project-search|manual",
    "query": "redacted or admin-entered search string",
    "matched_fields": ["email", "name", "provider", "project-title"]
  }
}
```

Do not store large raw result payloads in link metadata.

### Add Audit Events Table

Add `legacy_migration_account_link_events` in
`src/packages/util/db-schema/legacy-migration.ts`.

Fields:

- `id uuid primary key`
- `legacy_account_id varchar(128) not null`
- `account_id uuid not null`
- `actor_account_id uuid not null`
- `action varchar(32) not null`
- `reason text not null`
- `support_reference text`
- `claim_method varchar(64)`
- `metadata jsonb default '{}'::jsonb`
- `created timestamptz not null default now()`

Actions:

- `link`
- `unlink`
- `relink-attempt-denied`
- `search-projects`

Indexes:

- `account_id`
- `legacy_account_id`
- `actor_account_id`
- `action`
- `created`

Update `src/packages/util/db-schema/table-ownership.ts` so table ownership tests
classify the new table as seed-global legacy migration state.

### Unlink Semantics

The current link table has a composite primary key and no `disabled_at`. For a
first implementation, unlink can hard-delete the active link row but must insert
an audit event before deletion.

If we want recoverable inactive links in the active table later, add:

- `disabled_at`
- `disabled_by`
- `disable_reason`

That is cleaner long term but not required for the first support workflow.

## Backend APIs

Add admin-only methods to the legacy migration API surface. Keep them in the
existing `legacyMigration` namespace unless there is a strong reason to split a
new namespace.

Type definitions go in:

- `src/packages/conat/hub/api/legacy-migration.ts`

Implementation routing goes in:

- `src/packages/server/conat/api/legacy-migration.ts`

Core SQL and policy logic goes in:

- `src/packages/server/legacy-migration/index.ts`

### Proposed Methods

```ts
adminSearchLegacyAccounts(opts: {
  account_id: string;
  query: string;
  limit?: number;
}): Promise<LegacyMigrationAdminAccountSearchResponse>
```

Searches legacy accounts by email-like text, name fields, display name, and
selected safe metadata/provider identity fields. `account_id` is the current
account being reviewed and is included so the response can mark whether each
legacy account is already linked to that account or another account.

```ts
adminSearchLegacyProjects(opts: {
  account_id: string;
  query: string;
  limit?: number;
}): Promise<LegacyMigrationAdminProjectSearchResponse>
```

Searches non-hidden legacy projects by title, legacy project id, URL name, and
safe project metadata. Each result should include the owner legacy account and
matched collaborator legacy account ids when cheap.

```ts
adminListLegacyAccountLinks(opts: {
  account_id: string;
}): Promise<LegacyMigrationAdminLinksResponse>
```

Lists active links for the selected current account, including automatic and
support-admin links.

```ts
adminLinkLegacyAccount(opts: {
  account_id: string;
  legacy_account_id: string;
  reason: string;
  support_reference?: string;
  evidence?: Record<string, unknown>;
}): Promise<LegacyMigrationAdminLinkResult>
```

Creates or updates a `support-admin` link and writes a `link` audit event.

```ts
adminUnlinkLegacyAccount(opts: {
  account_id: string;
  legacy_account_id: string;
  reason: string;
  support_reference?: string;
}): Promise<LegacyMigrationAdminUnlinkResult>
```

Deletes the active link row for that pair and writes an `unlink` audit event.
The UI should only offer unlink for `claim_method='support-admin'` by default.
Automatic verified-email links should require a stronger confirmation or be
read-only in the first version.

```ts
adminListLinkedLegacyProjects(opts: {
  account_id: string;
  legacy_account_id: string;
  limit?: number;
}): Promise<LegacyMigrationAdminLinkedProjectsResponse>
```

Lists up to 250 non-hidden projects associated with one linked legacy account.
Include import status by left-joining `legacy_migration_project_imports` and
join status from `legacy_migration_project_import_accounts`.

### Authorization

- All admin methods require current account authentication.
- All admin methods require admin privileges.
- Link and unlink should require fresh admin auth if there is already a helper
  for dangerous admin mutations. If not, document this as a follow-up and still
  require admin plus audit reason in the first version.
- User-facing `listProjects`, `importProjects`, `retryProjectRestore`,
  `previewFinancialMigration`, and `applyFinancialMigration` should continue to
  use `legacy_migration_account_links`; no special case is needed once the link
  exists.

### Link Collision Policy

Default safety policy:

- A legacy account can have automatic verified-email links to matching current
  accounts as today.
- A `support-admin` link can be created for the reviewed account even if an
  automatic verified-email link exists elsewhere, but the API must warn in the
  response.
- A second active `support-admin` link for the same legacy account should be
  denied unless a later implementation adds an explicit force path.

This avoids accidental broad disclosure while preserving the current automatic
email-link behavior.

## Search Implementation

The legacy migration dataset is finite and operational/support focused, so the
first version can use capped SQL searches before adding specialized indexes.

### Account Search

Use normalized `ILIKE`/lowercase matching against:

- `legacy_account_id`
- `email_address`
- `first_name`
- `last_name`
- `display_name`
- selected provider identity fields in `metadata`

Provider identity search is important for legacy SSO-only accounts. Implement a
small extraction helper that returns safe searchable strings from known metadata
locations rather than exposing arbitrary raw metadata.

Return safe display fields:

- legacy account id
- redacted or plainly displayed email according to existing admin conventions
- first/last/display name
- last active
- claim/link status for selected current account
- whether active support-admin links already exist elsewhere
- project count summary when cheap

### Project Search

Search non-hidden projects by:

- `legacy_project_id`
- `title`
- `name`
- safe metadata title/name fields

Return:

- legacy project id
- title
- name
- owner legacy account id
- last edited / last active
- disk size
- artifact availability
- linked/import status
- small list of candidate legacy account ids from owner/collaborators

Do not show hidden projects unless a later admin-only checkbox is added.

## Frontend UX

Add a new `Migration` toggle next to the existing admin user-result actions in:

- `src/packages/frontend/admin/users/user.tsx`

Create a component:

- `src/packages/frontend/admin/users/legacy-migration.tsx`

### Panel Layout

For the selected current account:

- Header with current account id, display name, primary email, and home bay.
- Linked legacy accounts table.
- Account search tab.
- Project search tab.
- Audit/history summary for visible links if cheap.

### Linked Accounts Table

Columns:

- legacy account id
- legacy display name
- legacy email
- claim method
- created/updated
- support reference
- actions

Actions:

- `Load projects`
- `Unlink` for support-admin links

`Load projects` shows up to 250 non-hidden projects and clearly says if the
limit was reached.

### Search Results

Account search result actions:

- `Link` when not linked to this account.
- `Linked` badge when already linked to this account.
- Warning badge when support-admin linked to another account.

Project search result actions:

- Show owner/collaborator candidate legacy accounts.
- `Link owner` when there is one clear owner.
- `Choose account to link` when several candidate legacy accounts are plausible.

### Link Dialog

Require:

- reason
- optional support reference

Show:

- current account summary
- legacy account summary
- warning if the legacy account is linked elsewhere
- statement that this grants access to migrate associated legacy projects

The primary button is disabled until a non-empty reason is entered.

### Unlink Dialog

Require:

- reason
- optional support reference

Show:

- whether imported projects already exist
- statement that unlinking removes future migration authorization but does not
  delete already imported projects

## Multibay / Authority Notes

The legacy migration catalog is seed-global state. The current API already
routes legacy migration calls to the seed bay from
`src/packages/server/conat/api/legacy-migration.ts`.

Admin search and link mutations should follow the same seed-bay routing because
the link table is part of the legacy migration catalog. The selected current
account may have a different home bay; the API should only use account-home
routing to read current account identity/verified emails when needed.

Do not make project archive or file restore traffic pass through the account
home bay. The link only changes authorization metadata. Existing project import
and restore flows remain responsible for placing/restoring projects.

## Auditing and Privacy

Every link/unlink mutation writes an event before returning.

Audit entries must include:

- actor admin account id
- target current account id
- legacy account id
- action
- reason
- support reference if provided
- timestamp
- minimal evidence metadata

Do not log raw search result payloads or large metadata blobs.

Search APIs should return only fields needed to decide whether to link. If an
admin needs raw metadata for a rare case, they can use the existing admin data
explorer with explicit SQL access rather than making the normal UI noisy and
risky.

## Migration Authorization Changes

The current authorization path already joins projects to
`legacy_migration_account_links`, so support-admin links should work naturally
for:

- listing available projects
- importing projects
- retrying restores
- financial migration preview/application when those paths use
  `legacyAccounts(account_id)`

Implementation should still add tests proving:

- unlinked current account cannot list/import a legacy account's projects
- support-admin linked current account can list/import those projects
- unlink removes future list/import authorization
- already imported target projects are not deleted or hidden on unlink

## CLI Follow-Up

After the UI works, add operator CLI commands for bulk/support use:

```sh
cocalc admin legacy-migration search-accounts <query>
cocalc admin legacy-migration search-projects <query>
cocalc admin legacy-migration link --account <account-id> --legacy <legacy-account-id> --reason <reason>
cocalc admin legacy-migration unlink --account <account-id> --legacy <legacy-account-id> --reason <reason>
```

This is useful but not required before the admin UI.

## Tests

Backend tests:

- Admin methods reject non-admin callers.
- Search methods cap limits and do not return raw metadata by default.
- Link requires reason.
- Unlink requires reason.
- Link writes an audit event.
- Unlink writes an audit event before deleting the active link.
- Second support-admin link collision follows the selected policy.
- User-facing project list/import sees support-admin links.

Schema tests:

- `db-schema/table-ownership.test.ts` classifies any new audit table.
- Legacy migration schema compiles with the new table.

Frontend tests:

- User result renders `Migration` action.
- Link dialog disables submit without reason.
- Linked projects panel caps at 250 and shows the cap message.
- Already-linked results show a badge instead of a link button.

Focused validation commands:

```sh
cd src/packages/server && pnpm test legacy-migration
cd src/packages/util && pnpm test db-schema/table-ownership.test.ts
pnpm -C src lint:frontend
```

Use narrower package checks first if the full commands are too slow in the
current environment.

## Rollout

1. Backend schema and admin API.
2. Admin UI panel under `/admin/user-search`.
3. Tests for authorization, audit, and UI state.
4. Deploy to staging.
5. Test with a synthetic or non-identifying legacy account fixture.
6. Deploy to prod.
7. Use the tool for a small number of support tickets and review audit output.
8. Add CLI commands only if support volume justifies it.

## Support Runbook

1. Open `/admin/user-search` and find the current account.
2. Open `Migration`.
3. Search by the evidence provided in the support request.
4. If account search is ambiguous, search by project title or legacy project id.
5. Inspect candidate linked projects before linking.
6. Link the legacy account with a reason and support reference.
7. Ask the user to reload the legacy migration page.
8. If a mistake is discovered, unlink with a reason. Already imported projects
   remain separate and need manual review if ownership was wrong.

## Risks and Mitigations

- Wrong link exposes private legacy project metadata.
  - Mitigation: require admin, reason, audit, warnings for existing links, and
    no raw metadata in default UI.
- Ambiguous project title produces a false match.
  - Mitigation: project search should reveal owner/collaborator candidates but
    still require a deliberate account link.
- Legacy metadata contains inconsistent provider identity fields.
  - Mitigation: search safe known fields first, keep raw metadata fallback in
    admin data explorer.
- Multi-bay account lookup returns stale identity data.
  - Mitigation: keep legacy catalog/link writes on seed bay and only read
    current-account identity through existing account-home routing helpers.
- Automatic verified-email links and support-admin links conflict.
  - Mitigation: preserve automatic behavior, warn on conflicts, and restrict
    second support-admin links by default.

## First Implementation Slice

The smallest useful implementation is:

1. Add audit table.
2. Add admin account search.
3. Add list/link/unlink links.
4. Add admin UI panel with account search only.
5. Rely on existing user-facing migration authorization through
   `legacy_migration_account_links`.

Project-title search and linked-project browsing can land immediately after
that if time is tight.
