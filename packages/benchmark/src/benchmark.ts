/**
 * Comparison Benchmark
 *
 * Main orchestrator for running comparison benchmarks across configurations.
 */

import type {
  ConfigurationType,
  Task,
  RunResult,
  ComparisonResult,
  ScoreBreakdown,
  BenchmarkConfig,
} from './types.js';
import { DEFAULT_BENCHMARK_CONFIG } from './types.js';
import {
  ConfigurationRunner,
  SingleAgentRunner,
  SubAgentRunner,
  SwarmRunner,
} from './runners/index.js';

/**
 * Main benchmark orchestrator
 */
export class ComparisonBenchmark {
  private config: BenchmarkConfig;
  private runners: Map<ConfigurationType, ConfigurationRunner>;

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_BENCHMARK_CONFIG, ...config };

    // Initialize runners for configured configurations
    this.runners = new Map();
    for (const configType of this.config.configurations) {
      this.runners.set(configType, this.createRunner(configType));
    }
  }

  /**
   * Create a runner for a configuration type
   */
  private createRunner(type: ConfigurationType): ConfigurationRunner {
    switch (type) {
      case 'single':
        return new SingleAgentRunner(this.config);
      case 'subagent':
        return new SubAgentRunner(this.config);
      case 'swarm':
        return new SwarmRunner(this.config);
      default:
        throw new Error(`Unknown configuration type: ${type}`);
    }
  }

  /**
   * Run a comparison across all configured configurations
   */
  async runComparison(task: Task): Promise<ComparisonResult> {
    const results = new Map<ConfigurationType, RunResult>();
    const scores = new Map<ConfigurationType, ScoreBreakdown>();

    for (const [configType, runner] of this.runners) {
      if (!this.config.quiet) {
        console.log(`\n=== Running ${configType} configuration ===`);
        console.log(`Task: ${task.id}`);
      }

      try {
        await runner.setup();
        const result = await runner.run(task);
        await runner.teardown();

        results.set(configType, result);
        scores.set(configType, this.calculateScore(result));

        if (!this.config.quiet) {
          this.printRunResult(result);
        }
      } catch (err) {
        console.error(`Error running ${configType}:`, (err as Error).message);

        // Create failed result
        const failedResult: RunResult = {
          taskId: task.id,
          configuration: configType,
          totalTimeMs: 0,
          timeToFirstActionMs: 0,
          messageCount: 0,
          avgLatencyMs: 0,
          latencyP50Ms: 0,
          latencyP99Ms: 0,
          coordinationRounds: 0,
          agentCount: 0,
          totalTokensUsed: 0,
          peakMemoryMb: 0,
          success: false,
          completionRate: 0,
          errors: [(err as Error).message],
          startedAt: Date.now(),
          completedAt: Date.now(),
        };
        results.set(configType, failedResult);
        scores.set(configType, { total: 0, successScore: 0, timeScore: 0, efficiencyScore: 0 });
      }

      // Cool-down between runs
      if (this.config.cooldownMs > 0) {
        await new Promise((r) => setTimeout(r, this.config.cooldownMs));
      }
    }

    const winner = this.determineWinner(results, scores);

    return {
      taskId: task.id,
      results,
      winner,
      scores,
    };
  }

  /**
   * Run a single configuration
   */
  async runSingle(
    task: Task,
    configType: ConfigurationType
  ): Promise<RunResult> {
    const runner = this.runners.get(configType);
    if (!runner) {
      throw new Error(`Configuration ${configType} not enabled`);
    }

    await runner.setup();
    const result = await runner.run(task);
    await runner.teardown();

    return result;
  }

  /**
   * Calculate score breakdown for a result
   */
  private calculateScore(result: RunResult): ScoreBreakdown {
    const maxTimeMs = 300000; // 5 minutes baseline

    // Success component (0-50 points)
    const successScore = result.success ? 50 : result.completionRate * 25;

    // Time component (0-30 points) - faster is better
    const timeScore = result.success
      ? 30 * Math.max(0, 1 - result.totalTimeMs / maxTimeMs)
      : 0;

    // Efficiency component (0-20 points) - fewer agents is better for same result
    const efficiencyScore = result.success
      ? 20 / Math.max(1, result.agentCount)
      : 0;

    return {
      total: successScore + timeScore + efficiencyScore,
      successScore,
      timeScore,
      efficiencyScore,
    };
  }

  /**
   * Determine the winning configuration
   */
  private determineWinner(
    results: Map<ConfigurationType, RunResult>,
    scores: Map<ConfigurationType, ScoreBreakdown>
  ): ConfigurationType {
    let best: ConfigurationType = 'single';
    let bestScore = -1;

    for (const [configType, score] of scores) {
      if (score.total > bestScore) {
        bestScore = score.total;
        best = configType;
      }
    }

    return best;
  }

  /**
   * Print a single run result
   */
  private printRunResult(result: RunResult): void {
    console.log(`\nResult for ${result.configuration}:`);
    console.log(`  Success: ${result.success ? '✓' : '✗'}`);
    console.log(`  Time: ${(result.totalTimeMs / 1000).toFixed(1)}s`);
    console.log(`  Agents: ${result.agentCount}`);
    console.log(`  Messages: ${result.messageCount}`);
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.join(', ')}`);
    }
  }

  /**
   * Print comparison table
   */
  printComparison(comparison: ComparisonResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('COMPARISON RESULTS');
    console.log('='.repeat(60));
    console.log(`Task: ${comparison.taskId}`);
    console.log(`Winner: ${comparison.winner.toUpperCase()}`);
    console.log('');

    // Build table data
    const configs = Array.from(comparison.results.keys());
    const headers = ['Metric', ...configs.map((c) => c.charAt(0).toUpperCase() + c.slice(1))];

    const rows = [
      [
        'Success',
        ...configs.map((c) =>
          comparison.results.get(c)?.success ? '✓' : '✗'
        ),
      ],
      [
        'Time (s)',
        ...configs.map((c) =>
          ((comparison.results.get(c)?.totalTimeMs || 0) / 1000).toFixed(1)
        ),
      ],
      [
        'Agents',
        ...configs.map((c) =>
          String(comparison.results.get(c)?.agentCount || 0)
        ),
      ],
      [
        'Messages',
        ...configs.map((c) =>
          String(comparison.results.get(c)?.messageCount || 0)
        ),
      ],
      [
        'Avg Latency (ms)',
        ...configs.map((c) =>
          (comparison.results.get(c)?.avgLatencyMs || 0).toFixed(0)
        ),
      ],
      [
        'Completion %',
        ...configs.map((c) =>
          ((comparison.results.get(c)?.completionRate || 0) * 100).toFixed(0) + '%'
        ),
      ],
      [
        'Score',
        ...configs.map((c) =>
          (comparison.scores.get(c)?.total || 0).toFixed(1)
        ),
      ],
    ];

    // Print table
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => String(r[i]).length))
    );

    const separator = colWidths.map((w) => '-'.repeat(w + 2)).join('+');

    console.log(separator);
    console.log(
      '|' +
        headers.map((h, i) => ` ${h.padEnd(colWidths[i])} `).join('|') +
        '|'
    );
    console.log(separator);

    for (const row of rows) {
      console.log(
        '|' +
          row.map((cell, i) => ` ${String(cell).padEnd(colWidths[i])} `).join('|') +
          '|'
      );
    }
    console.log(separator);
  }
}

/**
 * Quick helper to run a comparison benchmark
 */
export async function runComparison(
  task: Task,
  config?: Partial<BenchmarkConfig>
): Promise<ComparisonResult> {
  const benchmark = new ComparisonBenchmark(config);
  return benchmark.runComparison(task);
}
