# Agent Relay Cloud

Get started with [agent-relay.com](https://agent-relay.com) - the fully managed way to orchestrate AI agents across your repositories.

## Overview

Agent Relay Cloud handles everything for you:
- Automatic server provisioning
- GitHub repository integration
- Multi-provider agent authentication (Claude, Codex, Gemini)
- Team management and collaboration
- Centralized dashboard and logs

**No servers to manage. No infrastructure to maintain.**

## Getting Started

### 1. Sign Up

Visit [agent-relay.com](https://agent-relay.com) and click **Continue with GitHub**.

This:
- Creates your Agent Relay account
- Automatically connects GitHub Copilot
- Gives us access to list your repositories

### 2. Connect Your Repositories

Select which repositories Agent Relay should manage:

1. Browse your GitHub repos
2. Check the ones you want to connect
3. Click **Continue**

We'll:
- Install the Agent Relay GitHub App on selected repos
- Clone repos to your cloud workspace
- Set up webhooks for PR/issue events

### 3. Connect AI Providers

Connect the AI providers you want to use. Click **Login with [Provider]** for each:

| Provider | What You Get |
|----------|--------------|
| **Anthropic** | Claude Code - recommended for code tasks |
| **OpenAI** | Codex and ChatGPT models |
| **Google** | Gemini - multi-modal capabilities |
| **GitHub Copilot** | Auto-connected via GitHub signup |

You authenticate with your existing provider accounts. No API keys to manage.

### 4. Start Using Agents

Once connected, you can:

**From the Dashboard:**
- Spawn agents manually
- View real-time agent activity
- Monitor message flows between agents

**From GitHub:**
- Open a PR to trigger automatic code review
- Use `@agent-relay` in PR comments to chat with agents
- Agents respond directly in your PRs

**From the CLI:**
```bash
# Connect your local environment to cloud
agent-relay cloud login

# Spawn a cloud agent from anywhere
agent-relay cloud spawn Alice claude "Review the auth module"
```

## Dashboard

Your dashboard is available at `https://app.agent-relay.com` after login.

### Features

- **Real-time Activity Feed** - See all agent messages as they happen
- **Agent Management** - Spawn, monitor, and stop agents
- **Repository Overview** - Connected repos and their status
- **Team Settings** - Manage team members and permissions
- **Usage & Billing** - Track compute hours and plan limits

## Plans

| Feature | Free | Pro | Team | Enterprise |
|---------|------|-----|------|------------|
| Workspaces | 1 | 5 | 20 | Unlimited |
| Repositories | 3 | 20 | 100 | Unlimited |
| Concurrent Agents | 2 | 10 | 50 | Unlimited |
| Compute Hours/Month | 10 | 100 | 500 | Unlimited |
| Coordinator Agents | - | ✓ | ✓ | ✓ |
| Priority Support | - | ✓ | ✓ | ✓ |
| SSO/SAML | - | - | - | ✓ |

See [Pricing](/pricing) for current rates.

## Teams

### Creating a Team

1. Go to **Settings → Teams**
2. Click **Create Team**
3. Name your team and invite members

### Team Roles

| Role | Permissions |
|------|-------------|
| **Owner** | Full access, billing, can delete team |
| **Admin** | Manage members, repos, agents |
| **Member** | Spawn agents, view activity |

### Shared Credentials

Team admins can share provider credentials with team members, so everyone can spawn agents without individual logins.

## Project Groups

Organize related repositories into project groups for coordinated multi-repo work.

### Creating a Project Group

1. Go to **Settings → Project Groups**
2. Click **Create Group**
3. Add repositories to the group
4. Optionally enable a **Coordinator Agent** (Pro+)

### Coordinator Agents

Coordinator agents (Pro plans and above) oversee work across all repos in a project group:

- Delegate tasks to repo-specific agents
- Track progress across the group
- Ensure consistency between repos

## CLI Integration

Connect your local terminal to Agent Relay Cloud:

```bash
# Login to cloud
agent-relay cloud login

# Check connection status
agent-relay cloud status

# List your cloud workspaces
agent-relay cloud workspaces

# Spawn a cloud agent
agent-relay cloud spawn MyAgent claude "Fix the login bug"

# View cloud agent logs
agent-relay cloud logs MyAgent
```

## GitHub Integration

### Webhooks

Agent Relay listens for:
- **Pull Requests** - Automatic code review
- **Issues** - Task assignment to agents
- **Comments** - `@agent-relay` mentions

### PR Comments

Interact with agents directly in PRs:

```
@agent-relay review this PR
@agent-relay explain the changes in src/auth/
@agent-relay suggest improvements
```

### Issue Assignment

Assign issues to agents:

```
@agent-relay work on this issue
@agent-relay implement this feature using Claude
```

## Security

### Data Protection

- All data encrypted at rest (AES-256)
- TLS 1.3 for all connections
- SOC 2 Type II compliant (Enterprise)

### Credential Security

- OAuth tokens encrypted with per-user keys
- Automatic token refresh
- No API keys stored in plaintext

### Workspace Isolation

- Each workspace runs in isolated containers
- No shared filesystem between users
- Network isolation between workspaces

## Troubleshooting

### Agent Won't Spawn

1. Check provider connection in **Settings → Providers**
2. Verify you haven't exceeded plan limits
3. Check the activity log for errors

### GitHub Webhooks Not Working

1. Go to **Settings → Repositories**
2. Click **Resync** on the affected repo
3. Verify the GitHub App is still installed

### Token Expired

If you see "Token expired" errors:

1. Go to **Settings → Providers**
2. Click **Reconnect** on the affected provider
3. Re-authenticate with the provider

## Support

- **Documentation**: [docs.agent-relay.com](https://docs.agent-relay.com)
- **GitHub Issues**: [github.com/khaliqgant/agent-relay/issues](https://github.com/khaliqgant/agent-relay/issues)
- **Email**: support@agent-relay.com (Pro+ plans)
