# @agent-relay/dashboard

Optional web dashboard for [Agent Relay](https://github.com/AgentWorkforce/relay).

## Installation

```bash
# Install alongside the main CLI
npm install -g agent-relay @agent-relay/dashboard
```

## Usage

Once installed, the dashboard is automatically available:

```bash
# Start daemon with dashboard enabled
agent-relay up --dashboard

# Dashboard will be available at http://localhost:3888
```

## Features

- Real-time agent activity monitoring
- Message history and search
- Agent spawn/release controls
- System metrics and health status
- Multi-project bridge visualization

## Requirements

- `agent-relay` >= 1.6.0 (peer dependency)
- Node.js >= 18.0.0

## Development

```bash
# Build server and UI
npm run build

# Run tests
npm test
```

## License

MIT
