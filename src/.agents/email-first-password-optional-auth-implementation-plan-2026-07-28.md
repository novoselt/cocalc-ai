# Email-First, Password-Optional Authentication

Status: proposed implementation plan

Last updated: 2026-07-28

Related architecture and implementation:

- `src/.agents/scalable-architecture.md`
- `src/.agents/secure-sso-redesign-plan-2026-05-12.md`
- `src/.agents/passkeys-second-factor-design-plan-2026-05-14.md`
- `src/packages/frontend/public/auth/app.tsx`
- `src/packages/frontend/public/auth/forms.tsx`
- `src/packages/frontend/public/auth/completion-views.tsx`
- `src/packages/frontend/public/auth/routes.ts`
- `src/packages/http-api/pages/api/v2/auth/sign-up.ts`
- `src/packages/http-api/pages/api/v2/auth/sign-in.ts`
- `src/packages/server/auth/redeem-verify-email.ts`
- `src/packages/server/email/verify.ts`
- `src/packages/server/inter-bay/accounts.ts`
- `src/packages/server/accounts/cluster-directory.ts`
- `src/packages/server/auth/auth-sessions.ts`
- `src/packages/util/db-schema/accounts.ts`
- `src/packages/util/db-schema/auth.ts`
- `src/packages/util/db-schema/table-ownership.ts`

## Executive Decision

Make email verification part of authentication itself.

For sites with working outbound email, the default public email flow becomes:

1. enter an email address;
2. receive a six-digit code and a magic link;
3. redeem either proof;
4. sign in to an existing account or atomically create a verified account;
5. complete required CoCalc 2FA, if configured;
6. resume the exact invite, share, project, CLI, support, or other action that
   initiated authentication.

New email-created accounts do not require a password. Existing passwords remain
supported indefinitely, and a verified account may add a password later.
Google and organization SSO remain first-class alternatives.

The target architecture does not create a permanent account before the email is
verified. A short-lived seed-global email-auth challenge exists before account
ownership is known. Successful redemption creates the account on its selected
home bay and establishes a normal account-home auth session.

The rollout is intentionally incremental:

1. first make verification a continuous, unavoidable part of the current
   password signup experience;
2. add the durable email-auth challenge and passwordless sign-in foundation
   behind a feature setting;
3. enable email-first account creation;
4. unify the public sign-in and sign-up experiences;
5. retire the confusing post-signup verification banner as a normal signup
   mechanism while retaining it for old unverified accounts and email changes.

Self-hosted deployments without reliable outbound email retain the current
password and registration-token account-creation path.

## Why Change

The current public password signup flow:

1. collects email, password, password confirmation, and display name;
2. creates an unverified account;
3. signs that account in;
4. sends an email verification link;
5. redirects immediately into the application.

The resulting account can browse much of CoCalc but encounters verification
errors only when attempting protected operations. This produces failures far
from the cause. Copying a public share, creating a project, accepting an
invite, using Codex, creating an API key, or purchasing a membership may show
an isolated "verify email" error after the user reasonably believes signup is
complete.

Production cohorts measured on 2026-07-28 showed:

- external-identity accounts are verified immediately;
- 108 of 123 non-legacy password signups in the preceding 24 hours eventually
  verified;
- successful users usually verified in about one minute;
- almost all successful verification happened in the first ten minutes;
- users who did not verify quickly rarely appeared to return later.

The product is therefore creating a binary outcome without presenting a
correspondingly clear binary step. Email-first authentication makes the actual
requirement explicit and removes unusable unverified account rows from the
headline signup metric.

## Product Principles

1. **One continuous flow.** The user must not believe signup is complete while
   an essential verification step remains elsewhere.
2. **Email possession is a primary authentication method.** It is already
   sufficient for password recovery, so using it directly does not create a
   fundamentally weaker trust boundary.
3. **Passwords are optional, not removed.** Existing users keep password
   sign-in, and any verified account may add one.
4. **No destination loss.** Authentication must resume the exact safe action
   the user intended.
5. **No account enumeration.** Public responses must not reveal whether an
   email belongs to an account.
6. **No permanent pre-verification account.** The target implementation stores
   a short-lived challenge, not an account with partial authority.
7. **Home-bay authority remains intact.** Account creation, auth sessions, 2FA,
   passwords, and account security state remain authoritative on the account's
   home bay.
8. **The seed owns only the pre-account directory problem.** Pending email
   challenges and global email uniqueness are seed-global because no account
   home exists yet.
9. **SSO policy remains authoritative.** Email login must not bypass a domain
   policy that requires organization SSO.
10. **Email-disabled installations remain usable.** Email-first mode cannot be
    required when email delivery is unavailable.

## Goals

- Make public email signup email-first and password-optional.
- Let an existing user sign in with a one-time email code or magic link.
- Preserve password, Google, SAML, registration-token, bootstrap-admin, CLI,
  API-key, and local 2FA behavior.
- Require email proof before creating a normal public email account.
- Support the same flow in one-bay Launchpad and multibay Rocket.
- Avoid duplicate accounts during concurrent email, SSO, and migration flows.
- Preserve analytics attribution through verification and account creation.
- Preserve safe redirect targets and richer continuation actions.
- Make legacy CoCalc.com account claiming easier after verified email proof.
- Add enough observability to measure delivery, verification, account creation,
  sign-in, continuation, and activation as separate funnel stages.
- Make rollback a site-setting change rather than a database rollback.

## Non-Goals

- Removing password sign-in.
- Converting current passkeys from second factors into discoverable first-factor
  credentials in the first release.
- Replacing Google or organization SSO.
- Treating email authentication as sufficient when a domain requires SSO.
- Automatically accepting project invitations or performing purchases merely
  because authentication completed.
- Persisting arbitrary external redirect URLs.
- Building a general marketing-email system.
- Making email-auth challenges a durable customer record.
- Changing project-host or project data-plane authentication.
- Forcing email-first mode on self-hosted sites without configured email.

## Current Architecture

### Public frontend

`src/packages/frontend/public/auth/forms.tsx` contains separate password sign-in
and password signup forms.

Password signup currently:

- reads registration-token requirements;
- enforces public signup domain policy;
- requires email, password, password confirmation, and display name;
- records terms acceptance and marketing consent;
- invokes `POST /api/v2/auth/sign-up`;
- follows a wrong-bay response by signing in on the selected home bay;
- redirects to the requested target or `/projects`.

Password sign-in currently:

- checks domain sign-in policy;
- invokes `POST /api/v2/auth/sign-in`;
- routes to the account's home bay;
- creates a local 2FA challenge when required;
- preserves a validated relative redirect target.

### Account creation

`src/packages/http-api/pages/api/v2/auth/sign-up.ts`:

- checks password strength and account availability;
- applies public signup, registration-token, SSO-domain, email-domain, captcha,
  and banned-equivalent-email policies;
- selects a home bay;
- calls `createClusterAccount`;
- sends a verification or welcome email;
- creates an authenticated browser session immediately.

The seed-global `cluster_account_directory` reserves normalized email uniqueness
and maps the account to its home bay. The actual `accounts` row and auth state
are account-home authoritative.

### Verification

Current verification:

- stores a plaintext token in `accounts.email_address_challenge`;
- sends `/auth/verify/<token>?email=<email>`;
- redeems automatically when the React verification page mounts;
- marks the current email in `accounts.email_address_verified`;
- updates the seed-global directory's verified boolean;
- does not establish a session in a different browser;
- does not include a six-digit code;
- does not safely support passwordless sign-in.

The current account-level challenge remains useful for compatibility and email
changes, but it is not the right authority for a challenge that begins before
an account exists.

### Product gating

`assertAccountTrustedForProductAccess` treats these accounts as trusted:

- admin accounts;
- accounts on sites where verification is not required;
- accounts with a verified current email;
- accounts explicitly trusted by a valid registration token.

This gate is correct as defense in depth. Email-first signup removes the normal
public case in which a new user is signed in but not trusted.

## Target User Experience

### Shared first screen

Keep `/auth/sign-in` and `/auth/sign-up` as stable URLs and analytics surfaces,
but render a shared email-first component.

The first screen contains:

- Google or configured public SSO buttons;
- registration-token input when relevant, labeled for new account creation;
- one email field;
- a primary **Continue with email** button;
- a secondary **Use a password instead** action;
- terms and privacy notice when public policies are configured.

The route changes explanatory copy, not security behavior:

- `/auth/sign-up`: "Create or access your CoCalc account."
- `/auth/sign-in`: "Continue to your CoCalc account."

Entering an existing email on the signup route signs into that account after
proof. Entering a new email on the sign-in route may create an account only
when site policy permits public account creation and terms were acknowledged.
This avoids an account-existence oracle.

### Check-email step

After **Continue with email**, replace the form in the same card with:

```text
Check your email

We sent a code and sign-in link to w...@example.edu.

[  six-digit code  ]

[Continue]

Resend available in 30 seconds
Use a different email
Use a password instead
```

Requirements:

- preserve the original safe destination;
- display only a masked address after submission;
- focus the code input;
- support paste and browser `one-time-code` autofill;
- show resend countdown and expiry;
- keep clear progress and delivery errors;
- work on narrow mobile screens;
- remain usable with keyboard and screen readers;
- never send the user into the application before authentication completes.

### Magic-link landing

The email contains both:

- a six-digit code;
- a magic link.

The link opens a page that identifies the masked account and requires an
explicit **Continue to CoCalc** action. A `GET` request must not redeem the
challenge, verify an address, create an account, or establish a session.

This protects against mail-security scanners and link-preview fetchers.

The preferred URL shape is:

```text
/auth/email/continue/<challenge-id>#token=<high-entropy-secret>
```

The secret is in the URL fragment so it is not sent in the initial HTTP
request, ordinary server access logs, or referrer headers. The frontend reads
the fragment and submits the secret through `POST`. The six-digit code remains
the fallback if a mail system strips or rewrites fragments.

Validate this shape with SendGrid click rewriting disabled for auth mail and
with representative Gmail, Outlook, university, and enterprise mail scanners.

### Completion

After successful proof:

- existing account: authenticate on its home bay;
- new account: atomically create a verified account, then authenticate;
- 2FA account: continue to the existing TOTP, recovery-code, or passkey second
  factor;
- SSO-required domain: direct to the required SSO provider instead of email
  auth;
- new account needing a registration token: request or validate the token
  before account creation;
- legacy email: create/sign in first, then offer or perform the existing safe
  verified-email legacy link;
- all flows: resume the validated continuation.

For a newly created account, ask for a display name after verification. This
profile step should be skippable when an invite/share continuation is urgent;
the application can continue to request a useful name later.

### Password setup

Account Security shows:

```text
Password
Not set

[Add password]
```

Adding the first password:

- requires current fresh authentication;
- permits an empty `currentPassword` only when no password hash exists;
- enforces existing password strength rules;
- revokes no sessions by default, but records an account-security audit event;
- updates the UI to show password sign-in as available.

Existing password accounts retain change-password behavior.

The first email-auth session may receive the normal 15-minute fresh-auth window
only after required 2FA is also satisfied. Later password setup can otherwise
start an email fresh-auth challenge.

## Authentication State Machine

### Challenge states

Use explicit states:

```text
pending
email_proved
account_creating
account_ready
mfa_required
completed
superseded
expired
blocked
failed
```

Valid transitions:

```text
pending -> email_proved
pending -> superseded | expired | blocked
email_proved -> account_creating
email_proved -> account_ready                 # existing account
email_proved -> blocked                       # policy changed
account_creating -> account_ready | failed
account_ready -> mfa_required | completed
mfa_required -> completed | expired | blocked
```

Retries must be idempotent:

- repeated start supersedes or reuses the active challenge;
- repeated valid redemption returns the existing completion result;
- repeated account creation observes the globally unique email reservation;
- repeated home-bay session exchange does not create multiple active challenge
  chains;
- completed or superseded secrets never authenticate another session.

### Meaning of email proof

Email proof establishes:

- possession of the normalized email address;
- the primary auth method `email_code` or `email_link`;
- verified status for that email;
- permission to create an account if all creation policy passes.

It does not bypass:

- account bans;
- deleted-account policy;
- required organization SSO;
- CoCalc 2FA;
- registration-token requirements for new accounts;
- admin-only bootstrap policy;
- fresh-auth requirements after the initial freshness window;
- impersonation restrictions.

## Seed-Global Email Challenge Model

### Ownership

Add `email_auth_challenges` as a formal `seed-global` table in
`src/packages/util/db-schema` and `table-ownership.ts`.

Seed authority is required because:

- a new email does not yet have an account home bay;
- normalized email uniqueness is already seed-global;
- a challenge may resolve to either an existing account or a new account;
- responses must not reveal which case applies;
- concurrent SSO, legacy migration, and email creation must converge through
  one global directory.

Launchpad uses the same table in its single bay.

### Proposed fields

```text
challenge_id                  UUID primary key
normalized_email              VARCHAR(254), short-lived PII
email_lookup_hash             CHAR(64)
account_id                    UUID nullable
selected_home_bay_id          VARCHAR(64) nullable
purpose                       VARCHAR(32)
state                         VARCHAR(32)
code_digest                   TEXT
link_token_digest             TEXT
browser_binding_digest        TEXT nullable
exchange_id                   UUID nullable
auth_method                   VARCHAR(32) nullable
terms_accepted_at             TIMESTAMP nullable
terms_version                 TEXT nullable
registration_token_reservation_id UUID nullable
continuation                  JSONB nullable
analytics_token               UUID nullable
attempt_count                 INTEGER
max_attempts                  INTEGER
send_count                    INTEGER
resend_available_at           TIMESTAMP
message_queued_at             TIMESTAMP nullable
message_sent_at               TIMESTAMP nullable
message_failed_at             TIMESTAMP nullable
message_error_code            VARCHAR(64) nullable
first_viewed_at               TIMESTAMP nullable
email_proved_at               TIMESTAMP nullable
account_created_at            TIMESTAMP nullable
session_completed_at          TIMESTAMP nullable
expires_at                    TIMESTAMP
completed_at                  TIMESTAMP nullable
superseded_at                 TIMESTAMP nullable
created_at                    TIMESTAMP
updated_at                    TIMESTAMP
request_ip_hash               CHAR(64) nullable
request_network_prefix        INET nullable
user_agent_family             VARCHAR(64) nullable
metadata                      JSONB
```

Do not store plaintext codes or link secrets. Store keyed HMAC-SHA256 digests
using a dedicated rotatable email-auth pepper. Include challenge ID and purpose
in the HMAC input.

Recommended initial limits:

- six-digit code;
- 128-bit or stronger magic-link secret;
- 15-minute challenge validity;
- at most eight code failures;
- first resend after 30 seconds;
- bounded sends per email, browser, network, and day;
- completed/failed challenge retention of 30 days for funnel analysis;
- expired pending challenge deletion after a short operational grace period.

The table must have indexes on:

- `email_lookup_hash`;
- `account_id`;
- `state`;
- `expires_at`;
- `created_at`;
- `analytics_token`;
- `registration_token_reservation_id`.

Permit only one active challenge for a normalized email and compatible purpose.
A newer challenge may supersede the previous one while preserving audit
timestamps.

### Browser binding

Starting a challenge sets an essential, HttpOnly, SameSite cookie containing a
random browser-flow nonce. Store only its digest.

Browser binding is not the email proof and must not prevent legitimate
cross-device magic-link use. It is used to:

- correlate the original tab;
- distinguish same-browser completion;
- prevent a bare challenge ID from becoming an authentication credential;
- support safe status polling;
- reduce login-CSRF risk.

Status polling must never mint a session merely because another device
completed the challenge. Otherwise an attacker could start a challenge for a
victim, wait for the victim to click the email on another device, and acquire
the victim's session from the attacker's original tab.

Safe behavior:

- same browser: the completion tab receives the session cookie; the original
  tab notices that normal auth bootstrap now succeeds and redirects;
- different browser: only the browser that submitted the code or link secret
  receives a session;
- polling without a valid auth cookie reports terminal state but cannot
  exchange it for account authority.

## API Design

Add public JSON endpoints under `/api/v2/auth/email`.

### `POST /auth/email/start`

Input:

```ts
{
  email: string;
  intent?: "sign-in" | "sign-up" | "continue";
  registrationToken?: string;
  terms?: boolean;
  termsVersion?: string;
  continuation?: AuthContinuationInput;
  analyticsToken?: string;
}
```

Responsibilities:

- normalize and validate email;
- apply site email-auth mode;
- apply captcha/Turnstile and durable throttles;
- evaluate public email-domain and SSO-domain policy;
- look up the email in the seed-global account directory;
- select a prospective home bay without exposing it;
- create or reuse a seed-global challenge;
- queue the critical auth email;
- set the browser-flow cookie;
- return a neutral response.

Normal response:

```ts
{
  challenge_id: string;
  status: "pending";
  masked_email: string;
  expires_at: string;
  resend_available_at: string;
}
```

Do not include:

- whether the account exists;
- account ID;
- home bay;
- password availability;
- legacy-account status;
- ban state;
- whether a new account will ultimately be permitted.

A domain-level `sso_required` response is acceptable because the policy is
already derived from the submitted domain and is not account-specific.

### `POST /auth/email/redeem-code`

Input:

```ts
{
  challenge_id: string;
  code: string;
}
```

Atomically:

- lock the challenge;
- reject expired, superseded, blocked, or exhausted challenges;
- increment attempts before returning a failure;
- constant-time compare the digest;
- mark email proof exactly once;
- run completion policy;
- create or resolve the account;
- return the home-bay exchange result.

### `POST /auth/email/redeem-link`

Input:

```ts
{
  challenge_id: string;
  token: string;
}
```

Use the same completion implementation as code redemption. The public link
landing performs this `POST` only after explicit user action.

### `POST /auth/email/resend`

Input:

```ts
{
  challenge_id: string;
}
```

Require browser binding, enforce resend and global delivery limits, and return
only neutral timing information. Reuse the existing unexpired code/link secret
when practical so delayed emails do not invalidate each other without warning.
If secrets rotate, make the UI and email state clearly that only the newest
message is valid.

### `POST /auth/email/status`

Input:

```ts
{
  challenge_id: string;
}
```

Require browser binding. Return:

```ts
{
  status:
    | "pending"
    | "completed"
    | "expired"
    | "superseded"
    | "blocked"
    | "failed";
  expires_at?: string;
  resend_available_at?: string;
}
```

Never return account ID, home bay, exchange token, or a new session from status
alone.

### Home-bay session exchange

After successful proof, seed authority returns a short-lived, signed, one-time
exchange assertion:

```text
challenge_id
exchange_id
account_id
home_bay_id
primary_auth_method
email_proved_at
expires_at
audience
```

The assertion:

- is valid for at most 60 seconds;
- is audience-bound to the selected home bay;
- is single-use;
- is never written to a URL;
- is delivered only to the browser that submitted valid email proof.

The frontend posts it to `/auth/email/exchange` on `home_bay_url`, using the
existing control-plane origin and wrong-bay patterns.

The home bay:

1. validates signature, audience, expiry, and one-time exchange state;
2. loads current account security state;
3. rejects banned/deleted accounts;
4. creates an `account_auth_challenges` row if 2FA is required;
5. otherwise creates remember-me and `account_auth_sessions` rows;
6. records primary auth method and freshness;
7. returns the standard auth response.

The exchange endpoint must be idempotent for the same browser after a network
retry but must not create a second independent session from a replay.

## Account Creation

### Atomic completion

For a new email:

1. validate current signup and domain policy again at redemption time;
2. validate or reserve any registration token;
3. select or confirm the home bay;
4. reserve the normalized email through `cluster_account_directory`;
5. create the home-bay account with no password hash;
6. set the email verified timestamp during creation;
7. mark the directory entry provisioned and verified;
8. redeem the registration token in the same logical operation;
9. attach analytics attribution;
10. produce the home-bay session exchange;
11. queue a welcome email that does not ask for verification again.

Change `AccountDirectoryCreateRequest.password` from required to optional for
internal account creation. Public legacy signup may continue requiring a
password.

Extend internal create-account input with an explicitly trusted field such as:

```ts
verified_email: {
  address: string;
  verified_at: Date;
  method: "email_code" | "email_link" | "google_oidc" | "saml";
}
```

This field must be accepted only by internal cluster account creation, never
directly from a public account-creation request.

### Creation races

At redemption, another path may already have created the account:

- Google SSO completed;
- another email challenge completed;
- an admin created the account;
- legacy migration created or linked it.

The unique directory email reservation remains authoritative. On a conflict:

1. resolve the existing active directory entry;
2. verify it represents the same normalized email;
3. continue as existing-account sign-in;
4. do not create a duplicate;
5. do not disclose the race to the user.

### Display name

Do not require display name before email proof.

For a new account:

- create with a neutral temporary display name such as `CoCalc User`;
- immediately show a lightweight profile step;
- permit deferral when a continuation should take priority;
- never derive a public display name from the email local part.

### Marketing consent

Continue defaulting onboarding/marketing consent to false. The email-auth
message is strictly transactional. The existing post-activation onboarding
offer remains separate.

## Registration Tokens and Bootstrap

Registration-token sites need separate existing-account and new-account
behavior without exposing account existence.

### Existing account

An existing account may use email authentication without a registration token.

### New account

A new account must provide a currently valid token before creation. The token
may be supplied:

- on the first screen; or
- after email proof, when the server now knows it is safe to explain that new
  account creation requires one.

Do not consume a registration token when the email challenge starts. Add a
short-lived reservation tied to `challenge_id`, or validate after email proof
and consume atomically with account creation.

The preferred durable model is a token reservation with:

- reservation ID;
- challenge ID;
- expiration equal to challenge expiration;
- release on supersede/expiry;
- conversion to redeemed use during account creation.

This prevents a scarce token from being consumed by an abandoned or mistyped
email flow and prevents a race after the user has completed verification.

### Initial bootstrap admin

Keep the existing bootstrap registration-token plus password flow. A new
self-hosted site may not have outbound email configured yet, and bootstrap must
not depend on an email service that the first admin has not configured.

## SSO, 2FA, Passkeys, and Fresh Auth

### Google and organization SSO

SSO-created accounts already require provider-verified email. Keep that path
unchanged except for sharing continuation and profile-completion components.

If domain policy requires SSO:

- do not send an email-auth message;
- return the configured SSO strategy based on domain policy;
- preserve the continuation through the SSO state;
- do not permit email auth as an undocumented bypass.

### CoCalc 2FA

Email code/link is a primary factor, not CoCalc's second factor.

After valid email proof:

- if no local second factor is active, create the session;
- if local 2FA is active, create the existing account-home second-factor
  challenge;
- permit TOTP, recovery code, or passkey according to current behavior;
- establish the session only after successful second factor.

For a domain that requires local CoCalc 2FA but has no configured enrollment
path for a brand-new account, retain the current block in the first release.
Designing forced 2FA enrollment during account creation is a separate security
workflow.

### Session metadata

Add an explicit primary authentication method to auth sessions instead of
overloading `factor_level`.

Suggested type:

```ts
type AuthPrimaryMethod =
  | "password"
  | "email_code"
  | "email_link"
  | "google_oidc"
  | "saml"
  | "legacy_sso"
  | "admin";
```

Add `primary_auth_method VARCHAR(32)` to `account_auth_sessions`, and add
`primary_verified_at` and `primary_auth_method` to
`account_auth_challenges`.

Keep `factor_level` for:

```text
none
totp
recovery_code
passkey
```

Backfill old sessions conservatively:

- `password_verified_at` present implies `password`;
- current Google session metadata or legacy factor value may imply
  `google_oidc`;
- otherwise leave unknown/null rather than inventing assurance.

Do not require a destructive migration of active sessions.

### Fresh authentication

Email authentication must support fresh auth for passwordless accounts.

Add purpose `email_fresh_auth`:

- requires an already authenticated browser session;
- sends only to the account's current verified email;
- cannot select another account;
- completes on the account home bay;
- preserves required 2FA;
- updates `fresh_auth_until` using existing default/extended policy.

The initial account-creating email authentication may grant the default
15-minute fresh-auth interval after all required factors complete. This allows
the user to add a password or configure account security without immediately
repeating email proof.

### Passkeys

Current CoCalc passkeys are second-factor credentials. Keep that model for this
project. Offering passkeys as discoverable first-factor credentials is
compatible with email-first authentication but requires a separate WebAuthn
account-discovery and recovery design.

## Legacy CoCalc.com Migration

Email-first auth is well suited to legacy migration because verified possession
of the same email is the strongest ordinary linking signal.

After successful email proof:

- if a new CoCalc.ai account is created and a unique legacy account has the
  same normalized verified email, run the existing idempotent verified-email
  linking path;
- if the match is ambiguous, do not guess; show Legacy Migration with the
  existing recovery/support options;
- do not authenticate with the old CoCalc.com password;
- do not reveal legacy-account existence before email proof;
- preserve current migration audit metadata and claim methods.

This should replace the current confusing sequence in which a legacy user tries
an old password, receives a missing-account error, creates a new account, then
must separately verify before migration can link safely.

## Continuations and Redirect Safety

### Existing behavior

The public frontend currently accepts only normalized same-site paths in a
`target` query parameter and rejects:

- absolute external URLs;
- protocol-relative URLs;
- auth loops;
- the site root as a meaningless nested target.

Keep these checks.

### Challenge-bound continuation

Store a normalized continuation in the seed-global challenge so it survives:

- tab reload;
- code entry;
- magic-link use;
- home-bay exchange;
- local 2FA;
- SSO routing;
- account creation.

Suggested shape:

```ts
type AuthContinuation =
  | { kind: "path"; path: string }
  | { kind: "project_invite"; invite_id: string; token_ref: string }
  | { kind: "public_share"; share_id: string; action?: "view" | "copy" }
  | { kind: "cli_login"; challenge_id: string }
  | { kind: "support"; path: string };
```

Prefer identifiers or server-side token references over embedding bearer-like
invite tokens in general analytics or logs.

Authentication completion may return the user to a confirmation screen, but it
must not automatically:

- accept an invitation;
- copy project files;
- create a paid purchase;
- approve a CLI login;
- perform another consequential action.

The user should see the original context and explicitly confirm the action.

### Public shares

When an anonymous reader chooses **Copy to my project**:

1. start the shared auth flow with a share continuation;
2. verify/create/sign in;
3. return to the same share and copy action;
4. display the destination chooser;
5. perform the copy only after explicit confirmation.

This removes the current tiny, contextless verification error.

## Email Delivery

Create a dedicated transactional email renderer for authentication rather than
reusing the old account-verification body.

Subject:

```text
Your CoCalc sign-in code
```

Body:

```text
Use this code to continue to CoCalc:

123456

Or continue securely:
[Continue to CoCalc]

This code expires in 15 minutes. If you did not request it, you can ignore this
message.
```

Requirements:

- use the `critical` email lane;
- do not include the raw email in the URL;
- disable provider click tracking for auth links;
- include both HTML and plain text;
- include site name for self-hosted deployments;
- never include account-existence, ban, billing, or legacy status;
- record queued/sent/failed state with coarse error categories;
- do not treat provider acceptance as inbox delivery.

The existing welcome email must gain a mode that does not embed another
verification link after an email-first account is created.

## Abuse Controls

Moving email to the first step increases outbound-email abuse risk. In-memory
per-process LRU throttles are insufficient across multiple hubs.

Implement durable seed-global limits using the challenge table or a dedicated
counter table:

- per normalized email;
- per browser-flow cookie;
- per source IP;
- per network prefix;
- per domain;
- global site send rate;
- resend count per challenge.

Initial policy should be class-friendly:

- strict per-email limits;
- moderate browser limits;
- high shared-IP ceilings;
- adaptive Turnstile after suspicious behavior instead of low hard IP limits;
- special handling for obvious reserved domains such as `example.com`;
- provider bounce/suppression checks where available.

Do not tell an unauthenticated requester that:

- an email is registered;
- an account is banned;
- an email is suppressed;
- a legacy account exists;
- a registration token is required only because the account is new.

The recipient may receive a safe explanatory message after proving control of
the address, but the browser response remains neutral.

Record abuse decisions using coarse reason codes and normal PII retention
limits. Do not put raw codes, magic secrets, registration tokens, or complete
continuation secrets in logs.

## Security Invariants

These are release blockers:

1. `GET` never consumes a magic link or creates a session.
2. Plaintext codes and link secrets are never stored in PostgreSQL or logs.
3. Challenge ID alone is never an authentication credential.
4. Status polling never grants a session completed on another browser.
5. Link/code redemption is atomic, bounded, expiring, and one-time.
6. Home-bay exchange is signed, audience-bound, short-lived, and replay-safe.
7. Public responses do not reveal account existence or security state.
8. Email auth does not bypass SSO-required domain policy.
9. Email auth does not bypass local 2FA.
10. New account creation rechecks policy at completion time.
11. Concurrent completion cannot create duplicate normalized-email accounts.
12. Account and session writes occur only on the account home bay.
13. Seed-global state is limited to pre-account challenge and directory data.
14. Continuations cannot redirect off-site or execute consequential actions
    without confirmation.
15. Registration tokens are never written to URLs, logs, analytics, or
    plaintext challenge metadata.
16. Banned and deleted accounts fail closed after proof without exposing state
    before proof.
17. Cookie consent and terms handling remain enforced before new account
    creation.
18. Self-hosted sites cannot enter email-first mode without a working
    transactional email backend.

## Site Configuration and Compatibility

Add one explicit mode setting instead of multiple overlapping booleans:

```text
email_authentication_mode =
  password_required
  verify_after_signup
  email_first
```

Semantics:

- `password_required`: existing email/password signup and sign-in;
- `verify_after_signup`: existing account creation, but verification is a
  continuous required signup step before app navigation;
- `email_first`: seed-global challenge, no password required, account creation
  after proof.

Defaults:

- existing/self-hosted installations: `password_required`;
- new self-hosted installations without email: `password_required`;
- `cocalc.ai`: move through `verify_after_signup`, then `email_first` after
  staging and canary validation.

Validation:

- `email_first` requires `email_enabled=true`;
- `email_first` requires `verify_emails=true`;
- the critical email lane must resolve to a configured backend;
- admin UI must show a blocking warning if configuration becomes inconsistent;
- runtime must fail closed for new email auth but keep SSO/password fallback
  available.

Retain existing settings:

- `email_signup` still controls whether new email accounts may be created;
- registration-token requirements still apply;
- email-domain and SSO-domain policies still apply;
- old public `/api/v2/auth/sign-up` remains for compatibility.

## Backward Compatibility

### Existing passwords

- Keep `/api/v2/auth/sign-in`.
- Keep password fields behind **Use a password instead**.
- Keep password reset.
- Do not expire or rewrite password hashes.
- Do not force existing users to adopt email login.

### Existing verification links

- Keep `/auth/verify/<token>?email=<email>` for at least the existing 24-hour
  token lifetime plus a release grace period.
- Existing links may verify an account but must not become passwordless
  sign-in links.
- New email-auth messages use the new challenge system.

### Existing unverified accounts

- Permit them to start email auth.
- Successful proof marks the current email verified and signs them in.
- The old application banner remains available as recovery during rollout.
- Remove the normal one-day delayed/dismissible signup banner only after
  email-first reaches full production.

### Public API and admin creation

- Keep password required in the existing public OpenAPI sign-up contract until
  a separately versioned contract is introduced.
- Keep fresh-auth-protected admin account creation.
- Keep API-key prohibition on public account creation.
- Keep bootstrap-admin flow.

### Self-hosted and offline deployments

- Password signup remains fully supported.
- Registration-token trusted-product access remains supported.
- Email-first frontend is hidden when the site cannot send auth mail.
- Personal/one-user products are not forced through email auth.

## Immediate Transitional Fix

Before the complete email-first backend is ready, implement
`verify_after_signup`:

1. keep current password account creation;
2. after successful signup, remain inside the public auth card;
3. show a full verification step with the account email, resend, edit-email,
   and clear instructions;
4. do not redirect to projects until verification is observed;
5. preserve the original target;
6. make an existing verification link update the original same-browser tab
   through normal account bootstrap/feed state;
7. provide password sign-in recovery if the browser session is lost;
8. instrument completion and abandonment.

This phase fixes the user-visible confusion quickly. It does not change the
target decision to avoid pre-verification accounts.

Do not build temporary code-entry semantics on the old plaintext
`email_address_challenge`; code authentication belongs to the new hashed
seed-global challenge.

## Observability and Growth Measurement

The challenge row itself should support the core funnel without storing raw
secrets:

```text
started
message queued
message accepted by provider
link landing viewed
code attempted
email proved
account created or existing account resolved
MFA required/completed
session established
continuation resumed
```

Add coarse, PII-retained central-log events only when row timestamps are
insufficient.

Required dashboards:

- challenges started by hour/day;
- send success/failure/latency;
- code versus link completion;
- completion within 1, 5, 10, and 60 minutes;
- resend rate;
- code failure and lockout rate;
- existing versus new account after proof;
- legacy-linked versus genuinely new;
- SSO/password/email primary auth mix;
- 2FA challenge and completion;
- continuation kind and successful resume;
- verified account creation by attribution source and landing page;
- first project association/activity within 1 and 24 hours;
- challenge abuse blocks and mail-provider suppression.

Do not use raw account-row creation as the primary signup metric after launch.
Use:

```text
verified new accounts with an established session
```

Retain:

- `analytics` landing/referrer/UTM attribution;
- challenge-to-account attribution transfer after successful creation/sign-in;
- source data under existing retention policy;
- no raw email in aggregate dashboards.

Suggested release guardrails:

- no material decline from the current approximately 80-90% legitimate
  password-email verification completion;
- no increase in duplicate normalized-email accounts;
- no unexplained increase in auth email sends per completed session;
- no continuation success regression for invites and shares;
- no increase in support incidents involving missing verification, wrong
  account, or lost destination.

## Implementation Areas

### Schema and ownership

Add or update:

- `src/packages/util/db-schema/email-auth.ts`
- `src/packages/util/db-schema/auth.ts`
- `src/packages/util/db-schema/table-ownership.ts`
- `src/packages/util/db-schema/site-defaults.ts`
- schema migration/bootstrap coverage

Changes:

- seed-global `email_auth_challenges`;
- account-home auth session primary method;
- account-home auth challenge primary method;
- optional registration-token reservation table/fields;
- site authentication mode.

### Shared types and inter-bay API

Add or update:

- `src/packages/conat/inter-bay/api.ts`
- `src/packages/server/inter-bay/service.ts`
- `src/packages/server/inter-bay/accounts.ts`
- seed directory service implementation

Operations:

- start challenge;
- status;
- resend;
- redeem code/link;
- create/resolve account;
- issue/consume home-bay exchange;
- mark email verified;
- start account-home 2FA;
- complete fresh auth.

### Server auth implementation

Create a focused package area such as:

```text
src/packages/server/auth/email/
  challenge-store.ts
  challenge-service.ts
  code.ts
  continuation.ts
  delivery.ts
  exchange.ts
  policy.ts
  rate-limit.ts
  types.ts
```

Do not spread secret verification, account creation, and routing independently
across HTTP handlers.

### HTTP API

Add:

```text
src/packages/http-api/pages/api/v2/auth/email/start.ts
src/packages/http-api/pages/api/v2/auth/email/status.ts
src/packages/http-api/pages/api/v2/auth/email/resend.ts
src/packages/http-api/pages/api/v2/auth/email/redeem-code.ts
src/packages/http-api/pages/api/v2/auth/email/redeem-link.ts
src/packages/http-api/pages/api/v2/auth/email/exchange.ts
```

Add corresponding Zod/OpenAPI schemas under
`src/packages/http-api/lib/api/schema/auth/email`.

Handlers should validate transport and delegate to the shared email-auth
service. They must not duplicate policy or SQL.

### Frontend

Refactor:

- `src/packages/frontend/public/auth/forms.tsx`;
- `src/packages/frontend/public/auth/app.tsx`;
- `src/packages/frontend/public/auth/completion-views.tsx`;
- `src/packages/frontend/public/auth/routes.ts`;
- public auth tests;
- account security password UI;
- verification-required panels and share/invite entry points.

Suggested components:

```text
EmailFirstAuthForm
EmailChallengeView
EmailMagicLinkView
PasswordFallbackForm
AuthProfileCompletion
AuthContinuationStatus
```

Keep the public auth bundle independent of the full application Redux shell.

### Email

Add a new email renderer and sender. Split welcome email from verification so a
verified email-first account receives exactly one welcome message and no
redundant verification request.

### Admin configuration

Expose mode, readiness, and diagnostics in site settings:

- selected mode;
- critical email backend;
- last successful auth-email send;
- challenge start/completion counts;
- current failure rate;
- rollback control.

Use existing secret-setting components for any pepper/secret configuration.
Prefer generated server secrets over administrator-pasted values.

## Testing Plan

### Unit tests

- email normalization and masking;
- code generation and fixed-width formatting;
- HMAC digest and constant-time comparison;
- secret rotation;
- expiry and supersede;
- max attempts;
- resend limits;
- browser binding;
- continuation normalization;
- open-redirect rejection;
- neutral account-existence responses;
- reserved-domain and email-domain policy;
- registration-token reservation lifecycle;
- session primary-auth metadata;
- fresh-auth behavior.

### Service tests

- existing password account email login;
- existing passwordless account email login;
- new account creation after code;
- new account creation after link;
- no account before proof;
- concurrent code/link redemption;
- concurrent SSO and email completion;
- unique-email conflict convergence;
- banned/deleted account;
- old unverified account;
- verified legacy account linking;
- ambiguous legacy match;
- SSO-required domain;
- global public signup disabled;
- registration-token required, valid, expired, exhausted, and concurrently
  consumed;
- email backend unavailable;
- send failure and retry;
- 2FA required and completed;
- 2FA failure and expiry;
- fresh auth by email;
- add first password;
- change existing password.

### Multibay tests

- challenge starts on a non-seed bay;
- seed challenge authority is used;
- existing account routes to its home bay only after proof;
- new account is placed according to signup home-bay selection;
- exchange assertion has the correct audience;
- wrong-bay exchange fails safely;
- replayed exchange cannot create another session;
- account rehome between challenge start and redemption;
- bay outage during account creation;
- directory reservation succeeds but local provisioning fails;
- retry repairs or rolls back partial provisioning;
- seed unavailability fails without creating a local account;
- Launchpad exercises the same interfaces locally.

### Browser tests

- email-first signup from `/auth/sign-up`;
- email-first creation from `/auth/sign-in`;
- Google SSO remains available;
- password fallback remains available;
- code paste and autofill;
- magic link same browser;
- magic link different browser/device;
- original tab observes same-browser session only;
- security scanner `GET` does not mutate state;
- resend countdown;
- expired code restart;
- wrong code lockout;
- edit/use different email;
- cookie consent;
- signed-in visit to signup;
- mobile layout;
- keyboard and screen-reader labels;
- refresh at every state;
- lost browser-flow cookie recovery.

### Continuation tests

- project invite;
- public-share view;
- public-share copy;
- project route;
- support ticket;
- CLI login approval;
- nested auth target;
- target with query and hash;
- external target rejection;
- auth-loop rejection;
- consequential action still requires confirmation.

### Email-client tests

- Gmail;
- Google Workspace;
- Outlook/Office 365;
- representative university mail;
- plain-text client;
- SendGrid click rewriting disabled;
- link scanner/prefetch;
- delayed first email followed by resend;
- spam-folder instructions;
- Unicode display/site name.

### Compatibility tests

- `password_required` mode unchanged;
- `verify_after_signup` rollback;
- existing `/auth/verify` links;
- password reset;
- bootstrap admin;
- admin account creation;
- token-gated Launchpad;
- no-email backend;
- base path deployment;
- custom site name and policy URLs.

## Rollout Plan

### Phase 0: Baseline

- Preserve current production funnel queries.
- Add dashboards for password signup, verification latency, legacy linking,
  project association, and attribution.
- Record the release baseline for at least several days.

### Phase 1: Continuous verification

- Implement `verify_after_signup`.
- Deploy to staging.
- Test signup, verification link, wrong email, resend, lost tab, invite, share,
  and multibay redirect.
- Enable for internal/admin accounts on staging.
- Enable for all staging password signups.
- Canary on production with a rapid site-setting rollback.

### Phase 2: Additive email-auth backend

- Deploy schema, seed service, APIs, email renderer, session metadata, and
  diagnostics with `email_first` disabled.
- Exercise synthetic challenges in staging.
- Complete security and multibay tests.
- Run failure injection for seed, home bay, email provider, and account
  creation.

### Phase 3: Existing-account passwordless sign-in

- Enable email code/link sign-in for selected staging accounts.
- Keep password sign-in as the default visible fallback.
- Validate 2FA, fresh auth, add-password, session revocation, and cross-device
  behavior.
- Canary selected production staff accounts.

### Phase 4: Email-first new accounts

- Enable account creation after proof on staging.
- Validate registration tokens, signup policy, analytics attribution, legacy
  linking, welcome email, and profile completion.
- Run a small production cohort selected by stable analytics-token hashing.
- Compare verified-session and first-project activation against the current
  flow.

### Phase 5: Public frontend

- Set `cocalc.ai` to `email_first` for 10%, then 25%, 50%, and 100% of eligible
  public email flows.
- Hold each step long enough to observe delivery and completion cohorts.
- Keep Google and password fallback visible.
- Exclude bootstrap/admin and incompatible domain-policy cases.

### Phase 6: Cleanup

- Make email-first the default only for new hosted deployments with verified
  email readiness.
- Stop using old `email_address_challenge` for new public signup.
- Keep old verification-link redemption for compatibility.
- Remove the normal delayed/dismissible verification banner for accounts
  created through email-first.
- Retain recovery UI for old unverified accounts and email-address changes.
- Update docs, support runbooks, translations, and analytics definitions.

## Rollback

Rollback must be a site-setting change:

```text
email_first -> verify_after_signup -> password_required
```

During rollback:

- keep password and SSO sign-in available;
- stop starting new seed-global challenges;
- allow already-issued challenges to complete for their normal 15-minute
  lifetime unless a security incident requires revocation;
- do not delete challenge or session rows;
- do not remove additive columns;
- do not invalidate verified accounts or newly set passwords;
- preserve continuation and funnel diagnostics;
- keep old `/auth/verify` compatibility.

If email delivery is impaired, automatically stop offering new email-first
starts while preserving password/SSO fallback. Do not silently present a flow
that cannot send mail.

## Release Acceptance Criteria

Functional:

- a new public email user cannot enter normal application state before proving
  email possession;
- no permanent account row exists before proof in `email_first` mode;
- existing users can sign in by email or password;
- required SSO and 2FA remain enforced;
- registration-token and bootstrap deployments remain functional;
- invite/share/project continuations survive all auth stages;
- a passwordless account can add a password safely;
- old verification links remain valid during compatibility lifetime.

Security:

- all security invariants above have automated coverage;
- scanner `GET` requests cause no state mutation;
- account-existence response tests pass;
- code/link and exchange replay tests pass;
- multibay authority tests pass;
- no raw secrets appear in logs, analytics, URLs sent to the server on `GET`, or
  database rows.

Reliability:

- account creation is idempotent under concurrent completion;
- partial directory/home-bay failure is repairable;
- email provider failure is visible and has a fallback;
- rollback works without schema reversal;
- staging soak shows no accumulating challenge backlog.

Product:

- legitimate verification completion does not materially regress from the
  current baseline;
- median successful completion remains within a few minutes;
- fewer users encounter verification errors inside project/share/purchase
  workflows;
- verified-session signup becomes the canonical growth metric;
- first-project activation and legacy migration completion can be attributed to
  the originating auth challenge.

## Recommended Implementation Order

1. Add site mode and baseline observability.
2. Implement `verify_after_signup`.
3. Add seed-global challenge schema and secret helpers.
4. Add durable throttling and auth email renderer.
5. Add start/status/resend APIs.
6. Add code/link redemption without session creation.
7. Add home-bay exchange and explicit session primary method.
8. Integrate existing-account 2FA and fresh auth.
9. Enable existing-account passwordless sign-in in staging.
10. Add passwordless internal account creation and verified directory update.
11. Add registration-token reservation and legacy linking.
12. Add shared email-first frontend and continuation storage.
13. Add profile completion and account-security password setup.
14. Complete browser, multibay, failure-injection, and compatibility tests.
15. Canary production in measured cohorts.
16. Make `email_first` the `cocalc.ai` default.
17. Remove obsolete signup-time verification UI only after the observation
    window.

## Review Decisions

The following are recommended decisions, not unresolved implementation
questions:

- Target architecture uses seed-global pre-account challenges.
- New normal email accounts are created only after proof.
- Six-digit code and magic link are both provided.
- Magic-link `GET` is non-mutating.
- Passwords remain supported and optional.
- Current passkeys remain second factors in this project.
- Existing `/auth/sign-in` and `/auth/sign-up` URLs remain stable.
- Passwordless email auth does not bypass SSO or CoCalc 2FA.
- Password-required mode remains supported for self-hosted/offline sites.
- Rollout passes through `verify_after_signup` before full email-first mode.

Implementation should not begin until this plan's product flow, seed-global
ownership, registration-token behavior, and session assurance model are
reviewed together.
