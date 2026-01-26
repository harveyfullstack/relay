#!/bin/bash
# Start the CLI tester Docker environment
# Usage: ./start.sh [--clean] [--build]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PACKAGE_DIR/docker"

# Parse arguments
CLEAN=false
BUILD=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            CLEAN=true
            shift
            ;;
        --build)
            BUILD=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./start.sh [--clean] [--build]"
            echo "  --clean  Remove credential volumes before starting"
            echo "  --build  Force rebuild of Docker image"
            exit 1
            ;;
    esac
done

cd "$DOCKER_DIR"

# Clean volumes if requested
if [ "$CLEAN" = true ]; then
    echo "Removing credential volumes..."
    docker compose down -v 2>/dev/null || true
fi

# Build if requested or if image doesn't exist
if [ "$BUILD" = true ]; then
    echo "Building Docker image..."
    docker compose build
fi

# Start the container interactively
echo ""
echo "Starting CLI tester environment..."
echo "Use Ctrl+D or 'exit' to leave the container."
echo ""

docker compose run --rm cli-tester
