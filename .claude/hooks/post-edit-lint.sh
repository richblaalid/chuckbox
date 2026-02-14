#!/bin/bash
# Post-edit hook: Run ESLint on edited TypeScript/React files
# This hook runs after Edit or Write tool completes

# Read input from stdin
INPUT=$(cat)

# Extract the file path from the tool input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path or not a TS/TSX file
if [[ -z "$FILE_PATH" ]] || [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
    exit 0
fi

# Skip node_modules and generated files
if [[ "$FILE_PATH" =~ node_modules ]] || [[ "$FILE_PATH" =~ \.d\.ts$ ]]; then
    exit 0
fi

# Run ESLint on the specific file (quiet mode, only show errors)
cd "$CLAUDE_PROJECT_DIR" || exit 0
npx eslint "$FILE_PATH" --quiet 2>/dev/null

# Always exit 0 - we don't want to block on lint errors
# Claude will see the lint output and can fix issues
exit 0
