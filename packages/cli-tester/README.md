# @agent-relay/cli-tester

Manual interactive testing environment for CLI authentication flows.

## Purpose

This package provides a Docker-based environment for testing CLI authentication with real OAuth providers. It's designed for:

- **Debugging auth issues** - Isolate problems with specific CLIs (e.g., "Cursor doesn't work")
- **Testing auth flows** - Verify OAuth flows work end-to-end
- **Message injection** - Test relay-pty message delivery
- **Credential verification** - Check that credentials are saved correctly

## Quick Start

From the relay repo root:

```bash
# Start the test environment (drops into container shell)
npm run cli-tester:start

# Start with clean credentials (removes any cached auth)
npm run cli-tester:start:clean
```

## Inside the Container

### Test a CLI

```bash
# Test Claude CLI with relay-pty
./scripts/test-cli.sh claude

# Test Codex with device auth
./scripts/test-cli.sh codex --device-auth

# Test with debug output
DEBUG=1 ./scripts/test-cli.sh cursor
```

### Verify Credentials

```bash
# Check if credentials exist (after authenticating)
./scripts/verify-auth.sh claude
./scripts/verify-auth.sh codex
./scripts/verify-auth.sh gemini
```

### Inject Messages

In a second terminal (while CLI is running):

```bash
# Send a message via relay-pty socket
./scripts/inject-message.sh test-claude "What is 2+2?"
```

### Clear Credentials

```bash
# Clear credentials for fresh testing
./scripts/clear-auth.sh claude
./scripts/clear-auth.sh all  # Clear all CLIs
```

## Debugging a Broken CLI

When a CLI isn't working, use this workflow:

```bash
# 1. Start fresh
npm run cli-tester:start:clean

# 2. Test the problematic CLI
./scripts/test-cli.sh cursor

# 3. Observe the output for:
#    - Auth URLs being printed
#    - Error messages
#    - Prompt patterns

# 4. Check credentials
./scripts/verify-auth.sh cursor
ls -la ~/.cursor/

# 5. Compare with a working CLI
./scripts/test-cli.sh claude
```

## Available CLIs

The container includes these pre-installed CLIs:

- `claude` - Anthropic's Claude CLI
- `codex` - OpenAI's Codex CLI
- `gemini` - Google's Gemini CLI
- `cursor` - Cursor CLI
- `opencode` - OpenCode CLI
- `droid` - Droid CLI

## How It Works

1. **relay-pty** wraps the CLI and provides:
   - Unix socket for message injection
   - Output parsing for relay commands
   - Idle detection for message timing

2. **Docker volumes** persist credentials between runs so you don't have to re-authenticate each time.

3. **Shell scripts** provide simple commands for common operations.

## TypeScript API

For programmatic use:

```typescript
import { RelayPtyClient, checkCredentials } from '@agent-relay/cli-tester';

// Check credentials
const result = checkCredentials('claude');
console.log(result.exists, result.valid, result.hasAccessToken);

// Inject messages via socket
const client = new RelayPtyClient('/tmp/relay-pty-test-claude.sock');
await client.connect();
await client.inject({ from: 'Test', body: 'Hello' });
```

## File Structure

```
packages/cli-tester/
├── docker/
│   ├── Dockerfile           # Test environment image
│   └── docker-compose.yml   # Container configuration
├── scripts/
│   ├── start.sh             # Start container
│   ├── test-cli.sh          # Test a CLI with relay-pty
│   ├── verify-auth.sh       # Check credentials
│   ├── inject-message.sh    # Send message via socket
│   └── clear-auth.sh        # Clear credentials
├── src/
│   └── utils/
│       ├── socket-client.ts     # relay-pty socket communication
│       └── credential-check.ts  # Credential file utilities
└── tests/
    └── credential-check.test.ts
```
