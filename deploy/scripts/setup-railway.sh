#!/bin/bash
# Setup Agent Relay Cloud on Railway
# Run this from the project root

set -e

echo "=== Agent Relay Cloud - Railway Setup ==="
echo ""

# Check for railway CLI
if ! command -v railway &> /dev/null; then
    echo "Error: Railway CLI not found. Install it with:"
    echo "  npm install -g @railway/cli"
    exit 1
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo "Please log in to Railway first:"
    railway login
fi

echo "Creating Railway project..."
railway init --name agent-relay-cloud

echo ""
echo "Adding PostgreSQL database..."
railway add --plugin postgresql

echo ""
echo "Adding Redis..."
railway add --plugin redis

echo ""
echo "=== Required Environment Variables ==="
echo "Please set these in Railway dashboard or via CLI:"
echo ""
echo "Required:"
echo "  SESSION_SECRET          - openssl rand -hex 32"
echo "  GITHUB_CLIENT_ID        - From GitHub OAuth App"
echo "  GITHUB_CLIENT_SECRET    - From GitHub OAuth App"
echo "  VAULT_ENCRYPTION_KEY    - openssl rand -hex 32"
echo ""
echo "For Fly.io workspaces:"
echo "  COMPUTE_PROVIDER=fly"
echo "  FLY_API_TOKEN           - fly auth token"
echo "  FLY_ORG=personal"
echo "  FLY_WORKSPACE_DOMAIN    - e.g., ws.agent-relay.com"
echo ""
echo "For Stripe billing:"
echo "  STRIPE_SECRET_KEY"
echo "  STRIPE_PUBLISHABLE_KEY"
echo "  STRIPE_WEBHOOK_SECRET"
echo ""

echo "Set variables with:"
echo "  railway variables set KEY=value"
echo ""

echo "When ready, deploy with:"
echo "  railway up"
echo ""

echo "=== DNS Configuration ==="
echo "After deployment, configure your DNS:"
echo ""
echo "1. Get your Railway domain:"
echo "   railway domain"
echo ""
echo "2. Configure DNS records:"
echo "   api.agent-relay.com    CNAME  <railway-domain>"
echo "   app.agent-relay.com    CNAME  <your-dashboard-host>"
echo "   agent-relay.com        A      <your-landing-host>"
echo "   *.ws.agent-relay.com   CNAME  fly.dev (for workspaces)"
echo ""
