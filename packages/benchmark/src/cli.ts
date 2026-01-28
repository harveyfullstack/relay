#!/usr/bin/env node
/**
 * Benchmark CLI
 *
 * Command-line interface for running agent swarm benchmarks.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ComparisonBenchmark } from './benchmark.js';
import type {
  Task,
  TaskDataset,
  ConfigurationType,
  BenchmarkConfig,
} from './types.js';

const program = new Command();

program
  .name('relay-benchmark')
  .description('Benchmark agent swarms, sub-agents, and single agents')
  .version('1.0.0');

program
  .command('run')
  .description('Run a benchmark comparison')
  .option('-d, --dataset <path>', 'Path to task dataset (YAML or JSON)')
  .option('-t, --task <id>', 'Run only a specific task by ID')
  .option(
    '-c, --config <types>',
    'Configurations to run (single,subagent,swarm,all)',
    'all'
  )
  .option('--cli <name>', 'CLI to use for agents', 'claude')
  .option('--cwd <path>', 'Working directory for tasks')
  .option('-q, --quiet', 'Suppress output', false)
  .option('--cooldown <ms>', 'Cooldown between runs in ms', '5000')
  .option('--max-swarm <n>', 'Maximum swarm size', '10')
  .option('-o, --output <path>', 'Output results to JSON file')
  .action(async (options) => {
    try {
      await runBenchmark(options);
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List tasks in a dataset')
  .argument('<dataset>', 'Path to task dataset')
  .action((datasetPath) => {
    const dataset = loadDataset(datasetPath);
    console.log(`\nDataset: ${dataset.name || 'Unnamed'}`);
    if (dataset.description) {
      console.log(`Description: ${dataset.description}`);
    }
    console.log(`\nTasks (${dataset.tasks.length}):\n`);

    for (const task of dataset.tasks) {
      console.log(`  ${task.id}`);
      console.log(`    Complexity: ${task.complexity}`);
      console.log(`    Files: ${task.files.length}`);
      console.log(`    ${task.description.substring(0, 60)}...`);
      console.log('');
    }
  });

async function runBenchmark(options: {
  dataset?: string;
  task?: string;
  config: string;
  cli: string;
  cwd?: string;
  quiet: boolean;
  cooldown: string;
  maxSwarm: string;
  output?: string;
}): Promise<void> {
  // Parse configurations
  const configurations = parseConfigurations(options.config);

  // Build benchmark config
  const benchmarkConfig: Partial<BenchmarkConfig> = {
    configurations,
    cli: options.cli,
    cwd: options.cwd,
    quiet: options.quiet,
    cooldownMs: parseInt(options.cooldown, 10),
    maxSwarmSize: parseInt(options.maxSwarm, 10),
  };

  const benchmark = new ComparisonBenchmark(benchmarkConfig);

  // Load tasks
  let tasks: Task[];
  if (options.dataset) {
    const dataset = loadDataset(options.dataset);
    tasks = dataset.tasks;

    if (options.task) {
      tasks = tasks.filter((t) => t.id === options.task);
      if (tasks.length === 0) {
        throw new Error(`Task not found: ${options.task}`);
      }
    }
  } else if (options.task) {
    // Create a simple task from command line
    tasks = [
      {
        id: options.task,
        description: options.task,
        files: [],
        expectedOutcome: 'Task completed',
        complexity: 'medium',
      },
    ];
  } else {
    throw new Error('Either --dataset or --task is required');
  }

  // Run benchmarks
  const results = [];
  for (const task of tasks) {
    if (!options.quiet) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Running task: ${task.id}`);
      console.log('='.repeat(60));
    }

    const comparison = await benchmark.runComparison(task);

    if (!options.quiet) {
      benchmark.printComparison(comparison);
    }

    results.push({
      taskId: task.id,
      winner: comparison.winner,
      results: Object.fromEntries(comparison.results),
      scores: Object.fromEntries(comparison.scores),
    });
  }

  // Output results
  if (options.output) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(options.output, JSON.stringify(results, null, 2));
    console.log(`\nResults written to: ${options.output}`);
  }

  // Print summary
  if (!options.quiet && results.length > 1) {
    printSummary(results);
  }
}

function parseConfigurations(config: string): ConfigurationType[] {
  if (config === 'all') {
    return ['single', 'subagent', 'swarm'];
  }

  const configs = config.split(',').map((c) => c.trim()) as ConfigurationType[];
  const valid: ConfigurationType[] = ['single', 'subagent', 'swarm'];

  for (const c of configs) {
    if (!valid.includes(c)) {
      throw new Error(`Invalid configuration: ${c}. Valid: ${valid.join(', ')}`);
    }
  }

  return configs;
}

function loadDataset(path: string): TaskDataset {
  const content = readFileSync(path, 'utf-8');

  let data: TaskDataset;
  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    data = parseYaml(content) as TaskDataset;
  } else {
    data = JSON.parse(content) as TaskDataset;
  }

  // Validate and normalize tasks
  if (!data.tasks || !Array.isArray(data.tasks)) {
    throw new Error('Dataset must have a "tasks" array');
  }

  data.tasks = data.tasks.map((t, i) => ({
    id: t.id || `task-${i}`,
    description: t.description || '',
    files: t.files || [],
    expectedOutcome: t.expectedOutcome || t.success_criteria || 'Completed',
    complexity: t.complexity || 'medium',
    timeoutMs: t.timeoutMs || 300000,
    tags: t.tags || [],
  }));

  return data;
}

function printSummary(
  results: Array<{
    taskId: string;
    winner: ConfigurationType;
    results: Record<string, unknown>;
    scores: Record<string, unknown>;
  }>
): void {
  console.log('\n' + '='.repeat(60));
  console.log('BENCHMARK SUMMARY');
  console.log('='.repeat(60));

  const wins: Record<ConfigurationType, number> = {
    single: 0,
    subagent: 0,
    swarm: 0,
  };

  for (const result of results) {
    wins[result.winner]++;
  }

  console.log('\nWins by configuration:');
  for (const [config, count] of Object.entries(wins)) {
    const bar = '█'.repeat(count) + '░'.repeat(results.length - count);
    console.log(`  ${config.padEnd(10)} ${bar} ${count}/${results.length}`);
  }

  const overallWinner = (Object.entries(wins) as [ConfigurationType, number][])
    .sort((a, b) => b[1] - a[1])[0][0];

  console.log(`\nOverall winner: ${overallWinner.toUpperCase()}`);
}

program.parse();
