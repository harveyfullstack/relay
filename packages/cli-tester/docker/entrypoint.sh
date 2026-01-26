#!/bin/bash
# CLI Tester Container Entrypoint
# Sets up the environment for CLI authentication testing

set -e

echo "========================================"
echo "  CLI Auth Tester Environment"
echo "========================================"
echo ""

# Show available CLIs
echo "Available CLI tools:"
for cli in claude codex gemini cursor opencode droid; do
    if command -v $cli &> /dev/null; then
        version=$($cli --version 2>/dev/null | head -n1 || echo "installed")
        echo "  ✓ $cli ($version)"
    else
        echo "  ✗ $cli (not installed)"
    fi
done
echo ""

# Show relay-pty status
if command -v relay-pty &> /dev/null; then
    echo "relay-pty: ✓ available"
else
    echo "relay-pty: ✗ not found"
fi
echo ""

# Show usage
echo "Quick Start:"
echo "  test-cli.sh claude      # Test Claude CLI with relay-pty"
echo "  test-cli.sh codex       # Test Codex CLI with relay-pty"
echo "  verify-auth.sh claude   # Check if credentials exist"
echo "  clear-auth.sh claude    # Clear credentials for fresh test"
echo ""
echo "For debugging:"
echo "  DEBUG=1 test-cli.sh cursor  # Verbose output"
echo ""

# Execute the provided command or drop into shell
if [ $# -gt 0 ]; then
    exec "$@"
else
    exec /bin/bash
fi
