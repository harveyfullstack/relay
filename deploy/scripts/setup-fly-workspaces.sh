#!/bin/bash
# Setup Fly.io for Agent Relay Workspaces
# Run this from the project root

set -e

echo "=== Agent Relay Cloud - Fly.io Workspace Setup ==="
echo ""

# Check for fly CLI
if ! command -v fly &> /dev/null; then
    echo "Error: Fly CLI not found. Install it with:"
    echo "  curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if logged in
if ! fly auth whoami &> /dev/null; then
    echo "Please log in to Fly.io first:"
    fly auth login
fi

# Get org
FLY_ORG=${FLY_ORG:-personal}
echo "Using Fly.io org: $FLY_ORG"

echo ""
echo "=== Building Workspace Image ==="
echo ""

# Build and push the workspace image
cd deploy/workspace

echo "Building workspace Docker image..."
docker build -t ghcr.io/khaliqgant/agent-relay-workspace:latest .

echo ""
echo "Pushing to GitHub Container Registry..."
echo "(Make sure you're logged in: docker login ghcr.io)"
docker push ghcr.io/khaliqgant/agent-relay-workspace:latest

cd ../..

echo ""
echo "=== Get Your API Token ==="
echo ""
echo "Run this to get your Fly.io API token:"
echo "  fly auth token"
echo ""
echo "Add it to your Railway environment:"
echo "  FLY_API_TOKEN=<token>"
echo "  FLY_ORG=$FLY_ORG"
echo "  COMPUTE_PROVIDER=fly"
echo ""

echo "=== Custom Domain Setup ==="
echo ""
echo "To use custom workspace domains (e.g., abc123.ws.agent-relay.com):"
echo ""
echo "1. Add a wildcard CNAME record in your DNS:"
echo "   *.ws.agent-relay.com  CNAME  fly.dev"
echo ""
echo "2. Set the domain in Railway:"
echo "   FLY_WORKSPACE_DOMAIN=ws.agent-relay.com"
echo ""
echo "3. Each workspace will be accessible at:"
echo "   https://{workspace-id}.ws.agent-relay.com"
echo ""
echo "Setup complete!"
