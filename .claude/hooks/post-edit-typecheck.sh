#!/bin/bash
# Post-edit hook: Quick TypeScript type check after file edits
# Only runs type check if a significant change was made

# Read input from stdin
INPUT=$(cat)

# Extract the file path from the tool input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path or not a TS/TSX file
if [[ -z "$FILE_PATH" ]] || [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
    exit 0
fi

# Skip node_modules, test files, and type definition files
if [[ "$FILE_PATH" =~ node_modules ]] || [[ "$FILE_PATH" =~ \.test\. ]] || [[ "$FILE_PATH" =~ \.d\.ts$ ]]; then
    exit 0
fi

# Run TypeScript compiler in no-emit mode to check for type errors
cd "$CLAUDE_PROJECT_DIR" || exit 0

# Quick check - only report errors, don't output all diagnostics
npx tsc --noEmit --pretty false 2>&1 | head -20

# Always exit 0 - we report errors but don't block
exit 0
