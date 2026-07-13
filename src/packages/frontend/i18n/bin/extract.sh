#!/usr/bin/env bash

# The interpolation pattern is a fixed string, because we intentionally trigger ID colissions.
# There is just one (unused) string without a unique ID – otherwise we always set an explicit hierarchical ID.
# Read the README in this directory for more information.
TS=$(git grep -l "defaultMessage" -- '*.ts')
TSX=$(git grep -l "defaultMessage" -- '*.tsx')
pnpm exec formatjs extract $TS $TSX i18n/*.ts ../util/compute-states.ts ../util/i18n/*.ts \
	--ignore='**/*.d.ts' --ignore='node_modules/*' \
	--ignore='dist/*' \
	--out-file i18n/extracted.json \
	--throws \
	--id-interpolation-pattern 'UNIQUE_ID_IS_MISSING'

# Guard: every extracted message must have a non-empty defaultMessage.
# A template literal with an interpolation (`... ${foo} ...`) cannot be
# statically evaluated by the extractor and silently yields an empty message,
# which would be uploaded as an empty English source and "translated" into
# empty strings in every language. Use ICU syntax instead of interpolation.
empty=$(jq -r 'to_entries[] | select((.value.defaultMessage // "") == "") | .key' i18n/extracted.json)
if [ -n "$empty" ]; then
	echo "Error: extracted keys with an empty defaultMessage (interpolated template literal in the source?):" >&2
	echo "$empty" >&2
	exit 1
fi
