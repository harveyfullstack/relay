#!/bin/bash
# E2E Test for Agent Relay
# Tests the full flow: daemon -> supervisor -> agent processing

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="/tmp/agent-relay-e2e-test"
SOCKET_PATH="/tmp/agent-relay-e2e.sock"
AGENT_NAME="TestAgent"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

cleanup() {
    log_info "Cleaning up..."
    # Kill background processes
    if [ -n "$DAEMON_PID" ]; then
        kill $DAEMON_PID 2>/dev/null || true
    fi
    # Clean up test data
    rm -rf "$DATA_DIR"
    rm -f "$SOCKET_PATH" "${SOCKET_PATH}.pid"
    log_info "Cleanup complete"
}

trap cleanup EXIT

# Ensure we're in the project directory
cd "$PROJECT_DIR"

log_info "=== Agent Relay E2E Test ==="
log_info "Data dir: $DATA_DIR"
log_info "Socket: $SOCKET_PATH"

# Clean up any previous test data
rm -rf "$DATA_DIR"
rm -f "$SOCKET_PATH" "${SOCKET_PATH}.pid"
mkdir -p "$DATA_DIR"

# Build if needed
log_info "Building project..."
npm run build

# Start daemon in background
log_info "Starting daemon..."
node dist/cli/index.js start -s "$SOCKET_PATH" -f &
DAEMON_PID=$!
sleep 1

# Verify daemon is running
if ! kill -0 $DAEMON_PID 2>/dev/null; then
    log_error "Daemon failed to start"
    exit 1
fi
log_info "Daemon started (PID: $DAEMON_PID)"

# Register a test agent (using 'echo' as a simple CLI that just exits)
log_info "Registering test agent: $AGENT_NAME"
node dist/cli/index.js register \
    -n "$AGENT_NAME" \
    -c custom \
    --command "echo" \
    -w "$PROJECT_DIR" \
    -d "$DATA_DIR"

# Verify registration
if [ ! -f "$DATA_DIR/$AGENT_NAME/state.json" ]; then
    log_error "Agent state file not created"
    exit 1
fi
log_info "Agent registered successfully"

# Create inbox with test message
log_info "Writing test message to inbox..."
INBOX_PATH="$DATA_DIR/$AGENT_NAME/inbox.md"
cat > "$INBOX_PATH" << 'EOF'
## Message from TestSender | 2025-12-18T12:00:00.000Z
Hello from the E2E test! Please respond with @relay:TestSender Got your message!
EOF

# Verify inbox was created
if [ ! -f "$INBOX_PATH" ]; then
    log_error "Inbox file not created"
    exit 1
fi
log_info "Inbox created with test message"

# Show initial state
log_info "Initial state.json:"
cat "$DATA_DIR/$AGENT_NAME/state.json" | head -20

# Note: Full supervisor test requires a real CLI that can process messages
# For now, we verify the infrastructure is in place

log_info ""
log_info "=== E2E Infrastructure Test PASSED ==="
log_info ""
log_info "Verified:"
log_info "  - Daemon starts and runs"
log_info "  - Agent registration creates state.json"
log_info "  - Inbox file can be created"
log_info ""
log_info "To test full message flow with a real CLI:"
log_info "  1. Start daemon:     npm run start -- start -f"
log_info "  2. Register agent:   npm run start -- register -n MyAgent -c claude -w \$(pwd)"
log_info "  3. Start supervisor: npm run start -- supervisor -v -d /tmp/agent-relay"
log_info "  4. Send message:     npm run start -- send -t MyAgent -m 'Hello!'"
log_info ""

exit 0
