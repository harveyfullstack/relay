/**
 * Harbor Integration
 *
 * Entry points for Harbor benchmark framework integration.
 * https://github.com/laude-institute/harbor
 */

import type {
  Task,
  TaskComplexity,
  ConfigurationType,
  HarborTaskInput,
  HarborEvaluationOutput,
  BenchmarkConfig,
} from './types.js';
import { ComparisonBenchmark } from './benchmark.js';

const BENCHMARK_VERSION = '1.0.0';

/**
 * Convert Harbor task input to internal Task format
 */
function convertHarborTask(input: HarborTaskInput): Task {
  return {
    id: input.id,
    description: input.description,
    files: input.files || [],
    expectedOutcome: input.success_criteria || 'Task completed successfully',
    complexity: (input.complexity as TaskComplexity) || 'medium',
    timeoutMs: 300000, // 5 minute default
    tags: [],
  };
}

/**
 * Main Harbor evaluation entry point
 *
 * This function is called by Harbor to evaluate a task across all configurations.
 *
 * @example Harbor dataset format:
 * ```yaml
 * tasks:
 *   - id: refactor-auth
 *     description: "Refactor authentication to use JWT"
 *     files:
 *       - src/auth/session.ts
 *       - src/auth/middleware.ts
 *     success_criteria: "All tests pass, JWT tokens used"
 *     complexity: medium
 * ```
 *
 * @example Running with Harbor:
 * ```bash
 * harbor run \
 *   --dataset tasks.yaml \
 *   --agent @agent-relay/benchmark/harbor \
 *   --parallel 10
 * ```
 */
export async function evaluate(
  input: HarborTaskInput
): Promise<HarborEvaluationOutput> {
  const startedAt = Date.now();
  const task = convertHarborTask(input);

  const benchmark = new ComparisonBenchmark({
    configurations: ['single', 'subagent', 'swarm'],
    cli: 'claude',
    quiet: true, // Suppress output in Harbor runs
    cooldownMs: 2000,
  });

  const comparison = await benchmark.runComparison(task);

  const completedAt = Date.now();

  return {
    task_id: task.id,
    configurations: Object.fromEntries(comparison.results) as Record<
      ConfigurationType,
      any
    >,
    winner: comparison.winner,
    scores: Object.fromEntries(comparison.scores) as Record<
      ConfigurationType,
      any
    >,
    metadata: {
      benchmark_version: BENCHMARK_VERSION,
      started_at: startedAt,
      completed_at: completedAt,
      total_duration_ms: completedAt - startedAt,
    },
  };
}

/**
 * Run a single configuration (for targeted Harbor evaluations)
 *
 * @example Running single config with Harbor:
 * ```bash
 * harbor run \
 *   --dataset tasks.yaml \
 *   --agent "@agent-relay/benchmark/harbor:evaluateSingle" \
 *   --env-var CONFIG=swarm
 * ```
 */
export async function evaluateSingle(
  input: HarborTaskInput & { config?: ConfigurationType }
): Promise<Record<string, unknown>> {
  const config = input.config || 'single';
  const task = convertHarborTask(input);

  const benchmark = new ComparisonBenchmark({
    configurations: [config],
    cli: 'claude',
    quiet: true,
    cooldownMs: 0,
  });

  const result = await benchmark.runSingle(task, config);

  return {
    task_id: task.id,
    configuration: config,
    result,
    success: result.success,
  };
}

/**
 * Evaluate with custom configuration
 */
export async function evaluateCustom(
  input: HarborTaskInput,
  config: Partial<BenchmarkConfig>
): Promise<HarborEvaluationOutput> {
  const startedAt = Date.now();
  const task = convertHarborTask(input);

  const benchmark = new ComparisonBenchmark({
    ...config,
    quiet: true,
  });

  const comparison = await benchmark.runComparison(task);
  const completedAt = Date.now();

  return {
    task_id: task.id,
    configurations: Object.fromEntries(comparison.results) as Record<
      ConfigurationType,
      any
    >,
    winner: comparison.winner,
    scores: Object.fromEntries(comparison.scores) as Record<
      ConfigurationType,
      any
    >,
    metadata: {
      benchmark_version: BENCHMARK_VERSION,
      started_at: startedAt,
      completed_at: completedAt,
      total_duration_ms: completedAt - startedAt,
    },
  };
}

// Default export for Harbor
export default evaluate;
