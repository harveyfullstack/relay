#!/usr/bin/env bash
#
# agent-relay installer
# Usage: curl -fsSL https://raw.githubusercontent.com/anthropics/agent-relay/main/install.sh | bash
#
# Options (via environment variables):
#   AGENT_RELAY_DIR     - Installation directory (default: ~/.agent-relay)
#   AGENT_RELAY_BRANCH  - Git branch to install (default: main)
#   AGENT_RELAY_START   - Start daemon after install (default: false)
#   AGENT_RELAY_QUIET   - Minimal output for agents (default: false)
#

set -euo pipefail

# Colors (disabled if not a terminal or AGENT_RELAY_QUIET is set)
if [[ -t 1 ]] && [[ "${AGENT_RELAY_QUIET:-}" != "true" ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  BOLD=''
  NC=''
fi

# Configuration
INSTALL_DIR="${AGENT_RELAY_DIR:-$HOME/.agent-relay}"
BRANCH="${AGENT_RELAY_BRANCH:-main}"
REPO_URL="${AGENT_RELAY_REPO:-https://github.com/khaliqgant/agent-relay.git}"
LOCAL_SOURCE="${AGENT_RELAY_LOCAL:-}"  # Set to local path to install from source
MIN_NODE_VERSION=18
START_DAEMON="${AGENT_RELAY_START:-false}"
QUIET="${AGENT_RELAY_QUIET:-false}"

# Logging functions
log() {
  if [[ "$QUIET" != "true" ]]; then
    echo -e "${GREEN}[agent-relay]${NC} $1"
  fi
}

log_warn() {
  echo -e "${YELLOW}[agent-relay]${NC} $1" >&2
}

log_error() {
  echo -e "${RED}[agent-relay]${NC} $1" >&2
}

log_info() {
  if [[ "$QUIET" != "true" ]]; then
    echo -e "${BLUE}[agent-relay]${NC} $1"
  fi
}

# Machine-readable output for agents
agent_output() {
  echo "AGENT_RELAY_$1=$2"
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Version comparison
version_gte() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# Check prerequisites
check_prerequisites() {
  log_info "Checking prerequisites..."

  # Check Node.js
  if ! command_exists node; then
    log_error "Node.js is not installed."
    log_error "Please install Node.js >= $MIN_NODE_VERSION from https://nodejs.org/"
    agent_output "ERROR" "NODE_NOT_FOUND"
    exit 1
  fi

  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

  if [[ "$NODE_MAJOR" -lt "$MIN_NODE_VERSION" ]]; then
    log_error "Node.js version $NODE_VERSION is too old."
    log_error "Please upgrade to Node.js >= $MIN_NODE_VERSION"
    agent_output "ERROR" "NODE_VERSION_TOO_OLD"
    exit 1
  fi

  log "Node.js v$NODE_VERSION detected"

  # Check npm
  if ! command_exists npm; then
    log_error "npm is not installed."
    agent_output "ERROR" "NPM_NOT_FOUND"
    exit 1
  fi

  # Check git
  if ! command_exists git; then
    log_error "git is not installed."
    log_error "Please install git from https://git-scm.com/"
    agent_output "ERROR" "GIT_NOT_FOUND"
    exit 1
  fi

  log "All prerequisites satisfied"
}

# Install or update agent-relay
install_agent_relay() {
  # Local source installation (for development)
  if [[ -n "$LOCAL_SOURCE" ]]; then
    if [[ ! -d "$LOCAL_SOURCE" ]]; then
      log_error "Local source directory not found: $LOCAL_SOURCE"
      agent_output "ERROR" "LOCAL_SOURCE_NOT_FOUND"
      exit 1
    fi

    log_info "Installing from local source: $LOCAL_SOURCE"

    if [[ "$INSTALL_DIR" != "$LOCAL_SOURCE" ]]; then
      rm -rf "$INSTALL_DIR"
      cp -R "$LOCAL_SOURCE" "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
  # Git installation
  elif [[ -d "$INSTALL_DIR" ]]; then
    log_info "Updating existing installation..."
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
  else
    log_info "Cloning agent-relay..."
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi

  log_info "Installing dependencies..."
  npm install --silent

  log_info "Building..."
  npm run build --silent

  log "Installation complete"
  agent_output "INSTALL_DIR" "$INSTALL_DIR"
}

# Set up shell integration
setup_shell() {
  log_info "Setting up shell integration..."

  # Create bin directory and symlink
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"

  # Create wrapper script
  WRAPPER="$BIN_DIR/agent-relay"
  cat > "$WRAPPER" << EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/dist/cli/index.js" "\$@"
EOF
  chmod +x "$WRAPPER"

  # Detect shell and config file
  SHELL_NAME=$(basename "$SHELL")
  case "$SHELL_NAME" in
    bash)
      SHELL_RC="$HOME/.bashrc"
      [[ -f "$HOME/.bash_profile" ]] && SHELL_RC="$HOME/.bash_profile"
      ;;
    zsh)
      SHELL_RC="$HOME/.zshrc"
      ;;
    fish)
      SHELL_RC="$HOME/.config/fish/config.fish"
      ;;
    *)
      SHELL_RC=""
      ;;
  esac

  # Add to PATH if not already there
  if [[ -n "$SHELL_RC" ]] && ! grep -q "/.local/bin" "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# agent-relay" >> "$SHELL_RC"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
    log "Added ~/.local/bin to PATH in $SHELL_RC"
    log_warn "Run 'source $SHELL_RC' or restart your terminal to update PATH"
  fi

  # Export for current session
  export PATH="$BIN_DIR:$PATH"

  agent_output "BIN_PATH" "$WRAPPER"
}

# Optionally start daemon
maybe_start_daemon() {
  if [[ "$START_DAEMON" == "true" ]]; then
    log_info "Starting daemon..."
    cd "$INSTALL_DIR"
    nohup node dist/cli/index.js start -f > /tmp/agent-relay.log 2>&1 &
    DAEMON_PID=$!
    sleep 1

    if kill -0 "$DAEMON_PID" 2>/dev/null; then
      log "Daemon started (PID: $DAEMON_PID)"
      agent_output "DAEMON_PID" "$DAEMON_PID"
      agent_output "DAEMON_LOG" "/tmp/agent-relay.log"
    else
      log_warn "Daemon may have failed to start. Check /tmp/agent-relay.log"
    fi
  fi
}

# Print success message
print_success() {
  if [[ "$QUIET" != "true" ]]; then
    echo ""
    echo -e "${GREEN}${BOLD}agent-relay installed successfully!${NC}"
    echo ""
    echo -e "${BOLD}Quick Start:${NC}"
    echo "  # Start the daemon"
    echo "  agent-relay start -f"
    echo ""
    echo "  # In another terminal, wrap an agent"
    echo "  agent-relay wrap \"claude\""
    echo ""
    echo -e "${BOLD}Documentation:${NC}"
    echo "  $INSTALL_DIR/README.md"
    echo ""
  fi

  agent_output "STATUS" "SUCCESS"
  agent_output "VERSION" "$(cd "$INSTALL_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "unknown")"
}

# Main
main() {
  echo ""
  if [[ "$QUIET" != "true" ]]; then
    echo -e "${BOLD}Installing agent-relay${NC}"
    echo -e "${BLUE}Real-time agent-to-agent communication${NC}"
    echo ""
  fi

  check_prerequisites
  install_agent_relay
  setup_shell
  maybe_start_daemon
  print_success
}

main "$@"
