#!/usr/bin/env bash
. ./i18n/bin/common.sh

# Guards, before compiling:
# 1. No translated string may be empty. An empty translation silently
#    overrides the English defaultMessage with nothing at runtime – this happens
#    when an empty English source gets uploaded (see the guard in extract.sh)
#    and is then auto-"translated" into empty strings in every language.
# 2. No ASCII apostrophe directly before "<" or "{". In ICU syntax that starts
#    a quoted literal (e.g. Italian "dell'<A2>…"), which silently turns the
#    following tags/placeholders into plain text until the next apostrophe.
#    It compiles fine, but renders as visible markup. Use a typographic
#    apostrophe (’) in the translation instead.
fail=0
for lang in $LANGS; do
    empty=$(jq -r 'to_entries[] | select(.value == "") | .key' "./i18n/trans/$lang.json")
    if [ -n "$empty" ]; then
        echo "Error: empty translations in $lang.json:" >&2
        echo "$empty" >&2
        fail=1
    fi
    quoted=$(jq -r 'to_entries[] | select(.value | type == "string" and test("(^|[^'\''])'\''[<{]")) | .key' "./i18n/trans/$lang.json")
    if [ -n "$quoted" ]; then
        echo "Error: apostrophe before '<' or '{' (starts an ICU quoted literal, breaks tags/placeholders) in $lang.json:" >&2
        echo "$quoted" >&2
        fail=1
    fi
done
if [ "$fail" -ne 0 ]; then
    echo "Fix the offending translations in SimpleLocalize (not locally, they would be overwritten), then download and compile again." >&2
    exit 1
fi

# It was necessary to write a custom formatter (see formatter.js) – not clear why, but it works. It's just a trivial mapping.
# "--ast" this is the main point of compiling: we use ICU messages, which no longer need to be parsed each time.
# This compile step is called by the `pnpm build` step as well, hence there is no need to keep the compiled files in the sources.

# Each language is compiled into a separate file – this allows for dynamic imports.
node ./i18n/bin/run-for-each-lang.js \
  --label compile \
  --item-label compiling \
  --langs "$LANGS" \
  -- pnpm exec formatjs compile \
    --ast \
    --format i18n/formatter.js \
    --out-file "./i18n/trans/{lang}.compiled.json" \
    "./i18n/trans/{lang}.json"
