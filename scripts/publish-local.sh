#!/bin/bash
# Publish all @agent-relay packages to a local Verdaccio registry
# Usage:
#   1. Start Verdaccio: npx verdaccio
#   2. Run this script: ./scripts/publish-local.sh

set -e

REGISTRY="${LOCAL_REGISTRY:-http://localhost:4873}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "🔨 Building all packages..."
npm run build

# Packages in dependency order
packages=(
  "protocol"
  "utils"
  "config"
  "api-types"
  "storage"
  "state"
  "policy"
  "trajectory"
  "hooks"
  "memory"
  "continuity"
  "resiliency"
  "user-directory"
  "spawner"
  "mcp"
  "wrapper"
  "bridge"
  "cloud"
  "daemon"
  "sdk"
  "dashboard"
  "dashboard-server"
)

echo ""
echo "📦 Publishing packages to $REGISTRY..."
echo ""

for pkg in "${packages[@]}"; do
  pkgdir="$ROOT_DIR/packages/$pkg"
  if [ -d "$pkgdir" ]; then
    echo "  Publishing @agent-relay/$pkg..."
    (cd "$pkgdir" && npm publish --registry "$REGISTRY" 2>/dev/null) || echo "    ⚠️  Failed (may already exist)"
  fi
done

# Also publish the root package
echo "  Publishing agent-relay (root)..."
npm publish --registry "$REGISTRY" 2>/dev/null || echo "    ⚠️  Failed (may already exist)"

echo ""
echo "✅ Done! Packages published to $REGISTRY"
echo ""
echo "To install from local registry:"
echo "  npm install agent-relay --registry $REGISTRY"
