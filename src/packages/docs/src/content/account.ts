/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export const ACCOUNT_SETTINGS_BODY = String.raw`
## What account settings are for

Account settings control your identity, preferences, API keys, SSH keys,
support access, and the billing tools attached to your CoCalc account. These
settings are account-scoped, not project-scoped: changing them follows you
across projects, courses, hosts, and browsers.

## Profile and identity

Use the profile page to edit your name, email, avatar, color, and account
metadata. The avatar image is visible in collaboration surfaces, while the
account color is also used independently in realtime editing and other shared
contexts.

Keep the account id available when working with support, admin tools, browser
automation, or agent-driven workflows. It is the stable identifier, while names
and emails can change.

## API and SSH keys

Use **Preferences -> API & SSH Keys** when managing account API keys or when the
same SSH public key should be available across projects. Project-specific SSH
access and host-specific access are different surfaces, so verify which layer
you need before adding or removing keys.

## Agent notes

For account actions, prefer stable route targets such as
\`/settings/profile\` and \`/settings/keys\` instead of legacy public-doc
links. The docs action ids are \`account.profile.open\` and
\`account.ssh-keys.open\`.
`;

export const TWO_FACTOR_AUTHENTICATION_BODY = String.raw`
## Where to configure CoCalc two-factor authentication

Open **Account Settings -> Profile -> Security**. The direct route is
[the Security section of your profile settings](/settings/profile#security).

The Security section contains CoCalc's own two-factor authentication controls.
This is separate from the two-factor authentication that may protect your
Google, GitHub, Microsoft, university, or institutional sign-in account.

## What you can configure

CoCalc supports two second-factor methods:

| Method | What it is | When to use it |
| :-- | :-- | :-- |
| Authenticator app codes | A rotating 6-digit code from an app such as Google Authenticator, 1Password, Authy, Microsoft Authenticator, or another TOTP app. | Use this when you want a portable method that works across browsers and devices. |
| Passkeys | WebAuthn credentials backed by your browser, operating system, hardware security key, phone, or password manager. | Use this when you want phishing-resistant approval that is much less tedious than typing a 6-digit code: approve with a device prompt, fingerprint, face unlock, PIN, or hardware key. |

You may configure either method, or both. Having both is useful: a passkey is
fast, phishing-resistant, and avoids repeatedly finding and typing short-lived
codes, while an authenticator app gives you a broadly compatible fallback.

## How CoCalc uses fresh authentication

CoCalc does not only ask whether you signed in sometime recently. For sensitive
operations, it asks you to prove that the person at the browser right now is
still the account owner.

| Fresh-auth level | What CoCalc checks | Typical examples |
| :-- | :-- | :-- |
| Normal fresh auth | You recently re-entered a password, completed an approved sign-in flow, or otherwise refreshed the current browser session. | Changing account profile details, changing password or email settings, adding credentials, or confirming account-level changes. |
| Two-factor fresh auth | You recently approved a CoCalc second factor, such as a 6-digit authenticator code or a passkey prompt. | Creating or deleting dedicated computer/project hosts, operations that can spend substantial money, disabling important security controls, and other high-impact destructive or administrative actions. |
| Sign-in 2FA | When your account has CoCalc 2FA enabled, sign-in may require one of your configured CoCalc second factors. | Signing in from a new browser, after a session expires, or after CoCalc decides the sign-in needs a stronger check. |

The exact prompts depend on the action, account state, site policy, and browser
session. The important distinction is that some actions require recent CoCalc
2FA, not merely an old login session.

## Why Google SSO 2FA is not enough for every CoCalc action

If you sign in with Google and your Google account has two-factor
authentication enabled, that protects the Google sign-in step. It does not prove
that you completed a second factor moments before a dangerous CoCalc action.

For example, you may have completed Google 2FA days or weeks ago, then kept a
browser session open. That is normal and convenient for everyday work, but it is
not strong enough for actions such as:

| Action category | Why CoCalc asks for its own recent 2FA |
| :-- | :-- |
| Dedicated hosts | Creating hosts can spend significant money; deleting or changing hosts can disrupt active research work. |
| Security recovery | Disabling 2FA, changing credentials, or approving sensitive support actions can lock users out or weaken account protection. |
| Administrative actions | Site administration and billing operations can affect many users, projects, or costs. |
| Destructive changes | Some project, host, or account operations are difficult or impossible to undo safely. |

This is defense in depth. Google 2FA protects the external identity provider
login. CoCalc 2FA protects high-impact CoCalc actions with a fresh,
application-specific challenge. Requiring both greatly reduces the damage from
stolen browser sessions, unattended logged-in computers, compromised SSO
sessions, phishing, and mistakes around expensive infrastructure actions.

## If CoCalc says two-factor authentication is required

When you see a message such as **Enable two-factor authentication to create
dedicated hosts**, configure CoCalc 2FA in the
[Security section of profile settings](/settings/profile#security). After adding
an authenticator app or passkey, return to the host page and try the action
again.

If your university or Google account already has 2FA, keep it enabled. CoCalc is
asking for an additional CoCalc-managed factor because the action requires
recent proof for this specific CoCalc account.

## Recommended setup

1. Open [Account Settings -> Profile -> Security](/settings/profile#security).
2. Add a passkey if your browser or password manager supports it.
3. Add an authenticator app as a backup method.
4. Save any recovery codes shown during setup in a safe place.
5. Return to the action that required 2FA, such as **Create Host**.

For support replies, it is usually enough to say: "Please enable CoCalc 2FA in
Account Settings -> Profile -> Security. Your Google 2FA protects Google
sign-in; CoCalc also requires recent CoCalc 2FA for dangerous or expensive
actions such as creating dedicated hosts."
`;

export const BILLING_SETTINGS_BODY = String.raw`
## What billing settings are for

Billing settings collect licenses, purchases, payment methods, statements,
and store access for the signed-in account. These screens are
account-scoped. Purchased membership tiers and dedicated project hosts may
change how projects run, but the purchase history and payment instruments
belong to the account.

## Membership and licenses

Use Membership settings to review recurring paid personal access. Use licenses
when access is assigned through a license object, course, team, or institution.
Before changing access, check whether the entitlement is account-wide,
project-specific, or managed by an instructor or administrator.

## Payment methods and statements

Payment methods control how future charges are paid. Statements and receipts
are the audit trail for past charges. When helping a user, open the exact billing
screen first, then inspect the relevant account, project, or license context.

## Agent notes

Billing actions should route through the in-app account settings pages:
\`account.membership.open\`, \`billing.payment-methods.open\`, and
\`billing.statements.open\`. Avoid adding new \`doc.cocalc.com\` links for
billing help; use \`/app-docs\` or an executable docs action instead.
`;
