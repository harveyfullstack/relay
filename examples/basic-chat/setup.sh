#!/bin/bash
# Basic Chat Setup Script
# Creates file-based inboxes for two agents to chat

set -e

DATA_DIR="${1:-/tmp/agent-relay-chat}"
AGENT1="${2:-Alice}"
AGENT2="${3:-Bob}"

echo "Setting up basic chat in: $DATA_DIR"
echo "Agents: $AGENT1, $AGENT2"
echo ""

# Create inbox directories
mkdir -p "$DATA_DIR/$AGENT1"
mkdir -p "$DATA_DIR/$AGENT2"

# Create empty inboxes
touch "$DATA_DIR/$AGENT1/inbox.md"
touch "$DATA_DIR/$AGENT2/inbox.md"

# Create instruction files
cat > "$DATA_DIR/$AGENT1/INSTRUCTIONS.md" << EOF
# You are $AGENT1

You're participating in a chat with $AGENT2 using agent-relay.

## How to send messages

Write to $AGENT2's inbox:
\`\`\`bash
agent-relay inbox-write -t $AGENT2 -f $AGENT1 -m "Your message" -d $DATA_DIR
\`\`\`

## How to check for messages

Read your inbox:
\`\`\`bash
agent-relay inbox-read -n $AGENT1 -d $DATA_DIR --clear
\`\`\`

Or wait for messages (blocking):
\`\`\`bash
agent-relay inbox-poll -n $AGENT1 -d $DATA_DIR --clear
\`\`\`

## Start the conversation

Say hello to $AGENT2!
EOF

cat > "$DATA_DIR/$AGENT2/INSTRUCTIONS.md" << EOF
# You are $AGENT2

You're participating in a chat with $AGENT1 using agent-relay.

## How to send messages

Write to $AGENT1's inbox:
\`\`\`bash
agent-relay inbox-write -t $AGENT1 -f $AGENT2 -m "Your message" -d $DATA_DIR
\`\`\`

## How to check for messages

Read your inbox:
\`\`\`bash
agent-relay inbox-read -n $AGENT2 -d $DATA_DIR --clear
\`\`\`

Or wait for messages (blocking):
\`\`\`bash
agent-relay inbox-poll -n $AGENT2 -d $DATA_DIR --clear
\`\`\`

## Wait for $AGENT1's message

Check your inbox and respond!
EOF

echo "Created:"
echo "  $DATA_DIR/$AGENT1/INSTRUCTIONS.md"
echo "  $DATA_DIR/$AGENT2/INSTRUCTIONS.md"
echo ""
echo "To start:"
echo "  Terminal 1: Read $DATA_DIR/$AGENT1/INSTRUCTIONS.md and start chatting"
echo "  Terminal 2: Read $DATA_DIR/$AGENT2/INSTRUCTIONS.md and respond"
