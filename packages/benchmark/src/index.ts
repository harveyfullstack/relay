/**
 * @agent-relay/benchmark
 *
 * Performance benchmarking for agent swarms, sub-agents, and single agents.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ComparisonBenchmark, type Task } from '@agent-relay/benchmark';
 *
 * const task: Task = {
 *   id: 'refactor-auth',
 *   description: 'Refactor authentication to use JWT',
 *   files: ['src/auth/session.ts', 'src/auth/middleware.ts'],
 *   expectedOutcome: 'All tests pass, JWT tokens used',
 *   complexity: 'medium',
 * };
 *
 * const benchmark = new ComparisonBenchmark();
 * const comparison = await benchmark.runComparison(task);
 *
 * console.log(`Winner: ${comparison.winner}`);
 * benchmark.printComparison(comparison);
 * ```
 *
 * ## With Harbor
 *
 * ```bash
 * harbor run \
 *   --dataset tasks.yaml \
 *   --agent @agent-relay/benchmark/harbor \
 *   --parallel 10
 * ```
 *
 * ## CLI Usage
 *
 * ```bash
 * relay-benchmark run --dataset tasks.yaml --config all
 * relay-benchmark run --dataset tasks.yaml --config swarm
 * relay-benchmark list tasks.yaml
 * ```
 */

// Types
export type {
  ConfigurationType,
  TaskComplexity,
  Task,
  RunResult,
  ComparisonResult,
  ScoreBreakdown,
  BenchmarkConfig,
  RunMetrics,
  TaskDataset,
  HarborTaskInput,
  HarborEvaluationOutput,
} from './types.js';

export { DEFAULT_BENCHMARK_CONFIG } from './types.js';

// Main benchmark class
export { ComparisonBenchmark, runComparison } from './benchmark.js';

// Runners
export {
  ConfigurationRunner,
  SingleAgentRunner,
  SubAgentRunner,
  SwarmRunner,
} from './runners/index.js';

// Harbor integration
export { evaluate, evaluateSingle, evaluateCustom } from './harbor.js';
