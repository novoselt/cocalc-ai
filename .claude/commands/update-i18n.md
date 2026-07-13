# Update i18n Translations

Complete workflow for updating internationalization translations in CoCalc frontend.

## What this command does

This command runs the full i18n update sequence:
1. **Extract** new translation strings from source code
2. **Upload** them to SimpleLocalize for automatic translation to 18 languages
3. **Download** the translated files
4. **Compile** them for runtime use

## Usage

```
/update-i18n
```

## Commands executed

Run this in `./src/packages/frontend/`

```bash
pnpm i18n:update
```

This runs all four steps in one go (extract → upload → auto-translate → download → compile). The upload step waits for the auto-translation jobs to finish.

Alternatively, run the steps individually:

```bash
pnpm i18n:extract && pnpm i18n:upload
pnpm i18n:download && pnpm i18n:compile
```

If `i18n:compile` fails, a translation contains broken ICU syntax or mangled tags (e.g. a `</b>` corrupted by the translation model). Fix the offending translation in SimpleLocalize (not in the local `trans/*.json` files — they are overwritten on every download), then re-run download + compile until clean.

## When to use

- After adding new FormattedMessage components with translation IDs
- After modifying existing translation strings — note: SimpleLocalize only auto-translates *new* keys, so first delete the changed key with `pnpm i18n:delete <key-id>` to force re-translation (see `src/packages/frontend/i18n/README.md`)
- When preparing translations for a new feature release
- When onboarding new languages

## Prerequisites

- Must be in the `src/packages/frontend` directory
- SIMPLELOCALIZE_KEY environment variable must be set
- Changes to translation strings should already be committed to source code
