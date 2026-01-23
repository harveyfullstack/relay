/**
 * Parser regression test fixtures
 *
 * This module exports CLI output fixtures for testing the parser
 * against real-world terminal output patterns.
 *
 * To add new fixtures:
 * 1. Capture the problematic output from a real CLI session
 * 2. Add it to the appropriate CLI-specific fixture file
 * 3. Run tests to ensure parser handles it correctly
 *
 * When a parser bug is fixed, add a regression test fixture
 * to prevent the bug from recurring.
 */

export { claudeOutputFixtures, type OutputFixture, ANSI } from './claude-outputs.js';
export { geminiOutputFixtures, GEMINI } from './gemini-outputs.js';
export { codexOutputFixtures } from './codex-outputs.js';

import { claudeOutputFixtures } from './claude-outputs.js';
import { geminiOutputFixtures } from './gemini-outputs.js';
import { codexOutputFixtures } from './codex-outputs.js';

/**
 * All fixtures combined for comprehensive testing
 */
export const allFixtures = [
  ...claudeOutputFixtures.map(f => ({ ...f, cli: 'claude' as const })),
  ...geminiOutputFixtures.map(f => ({ ...f, cli: 'gemini' as const })),
  ...codexOutputFixtures.map(f => ({ ...f, cli: 'codex' as const })),
];

/**
 * Get fixtures by CLI type
 */
export function getFixturesByCli(cli: 'claude' | 'gemini' | 'codex') {
  switch (cli) {
    case 'claude':
      return claudeOutputFixtures;
    case 'gemini':
      return geminiOutputFixtures;
    case 'codex':
      return codexOutputFixtures;
    default:
      return [];
  }
}
