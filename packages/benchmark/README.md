# @agent-relay/benchmark

Performance benchmarking for comparing agent configurations: single agents, sub-agents (hierarchical), and swarms (peer-to-peer).

## Overview

This package provides tools to measure and compare the performance of different agent configurations on the same tasks:

| Configuration | Description | Communication |
|---------------|-------------|---------------|
| **Single** | One agent handles everything | None |
| **Sub-agent** | Lead spawns and coordinates workers | Hierarchical (parent → child) |
| **Swarm** | Peer agents coordinate as equals | Peer-to-peer via channels |

## Installation

```bash
npm install @agent-relay/benchmark
```

For standalone mode (in-process daemon):
```bash
npm install @agent-relay/benchmark @agent-relay/daemon
```

## Quick Start

### Programmatic Usage

```typescript
import { ComparisonBenchmark, type Task } from '@agent-relay/benchmark';

const task: Task = {
  id: 'refactor-auth',
  description: 'Refactor authentication to use JWT',
  files: ['src/auth/session.ts', 'src/auth/middleware.ts'],
  expectedOutcome: 'All tests pass, JWT tokens used',
  complexity: 'medium',
};

const benchmark = new ComparisonBenchmark();
const comparison = await benchmark.runComparison(task);

console.log(`Winner: ${comparison.winner}`);
benchmark.printComparison(comparison);
```

### CLI Usage

```bash
# Run comparison on all configurations
relay-benchmark run --dataset tasks.yaml --config all

# Run specific configuration
relay-benchmark run --dataset tasks.yaml --config swarm

# List tasks in a dataset
relay-benchmark list tasks.yaml

# Output results to JSON
relay-benchmark run --dataset tasks.yaml -o results.json
```

### Harbor Integration

This package integrates with [Harbor](https://github.com/laude-institute/harbor) for large-scale agent evaluation:

```bash
# Install Harbor
pip install harbor-bench

# Run benchmark via Harbor
harbor run \
  --dataset tasks.yaml \
  --agent @agent-relay/benchmark/harbor \
  --parallel 10

# Run at scale with cloud providers
harbor run \
  --dataset tasks.yaml \
  --agent @agent-relay/benchmark/harbor \
  --env daytona \
  --parallel 100
```

## Task Dataset Format

Tasks can be defined in YAML or JSON:

```yaml
name: My Tasks
description: Tasks for benchmarking

tasks:
  - id: add-feature
    description: Add user preferences feature
    files:
      - src/models/preferences.ts
      - src/routes/preferences.ts
      - tests/preferences.test.ts
    expectedOutcome: Feature working, tests pass
    complexity: medium  # low, medium, high
    timeoutMs: 300000   # optional, default 5 minutes
    tags:               # optional
      - feature
      - api
```

## Metrics Collected

| Metric | Description |
|--------|-------------|
| `totalTimeMs` | Total execution time |
| `timeToFirstActionMs` | Time until first agent action |
| `messageCount` | Inter-agent messages sent |
| `avgLatencyMs` | Average message latency |
| `latencyP50Ms` | 50th percentile latency |
| `latencyP99Ms` | 99th percentile latency |
| `coordinationRounds` | Communication rounds |
| `agentCount` | Agents used |
| `totalTokensUsed` | LLM tokens consumed |
| `peakMemoryMb` | Peak memory usage |
| `success` | Task completed successfully |
| `completionRate` | Partial completion (0-1) |

## Scoring

Results are scored on three components:

- **Success (50 points)**: Task completion
- **Time (30 points)**: Faster is better
- **Efficiency (20 points)**: Fewer agents is better

The configuration with the highest total score wins.

## Configuration

```typescript
interface BenchmarkConfig {
  configurations: ConfigurationType[];  // ['single', 'subagent', 'swarm']
  cli: string;                          // CLI to use (default: 'claude')
  cwd?: string;                         // Working directory
  quiet: boolean;                       // Suppress output
  cooldownMs: number;                   // Delay between runs
  maxSwarmSize: number;                 // Max agents in swarm
  socketPath?: string;                  // Custom relay socket
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ComparisonBenchmark                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Single    │  │  SubAgent   │  │    Swarm    │         │
│  │   Runner    │  │   Runner    │  │   Runner    │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                  │
│         └────────────────┼────────────────┘                  │
│                          │                                   │
│                          ▼                                   │
│              ┌───────────────────────┐                      │
│              │   @agent-relay/sdk    │                      │
│              │   (standalone mode)   │                      │
│              └───────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## Example Output

```
============================================================
COMPARISON RESULTS
============================================================
Task: refactor-auth
Winner: SUBAGENT

+------------+--------+----------+-------+
| Metric     | Single | Subagent | Swarm |
+------------+--------+----------+-------+
| Success    | ✓      | ✓        | ✓     |
| Time (s)   | 45.2   | 28.1     | 32.5  |
| Agents     | 1      | 3        | 3     |
| Messages   | 0      | 12       | 24    |
| Completion | 100%   | 100%     | 100%  |
| Score      | 65.3   | 78.2     | 71.8  |
+------------+--------+----------+-------+
```

## Included Datasets

The package includes example datasets in `datasets/`:

- `coding-tasks.yaml` - Standard software engineering tasks
- `coordination-tasks.yaml` - Tasks requiring multi-agent coordination

## License

Apache-2.0
