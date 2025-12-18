#!/bin/bash
# Claude Code hook to check agent-relay inbox
# Add to .claude/settings.json PostToolUse hooks

# Get agent name from environment or argument
AGENT_NAME="${AGENT_RELAY_NAME:-$1}"
DATA_DIR="${AGENT_RELAY_DIR:-/tmp/agent-relay-team}"

# Silent exit if no agent name
[ -z "$AGENT_NAME" ] && exit 0

INBOX_PATH="$DATA_DIR/$AGENT_NAME/inbox.md"

# Silent exit if no inbox
[ ! -f "$INBOX_PATH" ] && exit 0

# Check for actual messages
CONTENT=$(cat "$INBOX_PATH" 2>/dev/null)
if ! echo "$CONTENT" | grep -q "## Message from"; then
    exit 0
fi

# Count messages
MSG_COUNT=$(echo "$CONTENT" | grep -c "## Message from")

# Output notification (this appears in Claude's context)
cat << EOF

--- RELAY NOTIFICATION ---
You have $MSG_COUNT message(s) in your inbox!

$CONTENT

--- END RELAY ---

ACTION REQUIRED: Respond to these messages, then clear inbox with:
node $DATA_DIR/../dist/cli/index.js team-check -n $AGENT_NAME -d $DATA_DIR --clear --no-wait

EOF

exit 0
