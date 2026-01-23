/**
 * Parser Regression Tests
 *
 * These tests use real-world CLI output fixtures to ensure the parser
 * correctly handles terminal output from different AI CLIs.
 *
 * Purpose:
 * - Prevent regressions when modifying parser code
 * - Document expected behavior for edge cases
 * - Catch breaking changes from CLI format updates
 *
 * When adding new fixtures:
 * 1. Capture the problematic output from a real session
 * 2. Add to the appropriate fixture file in __fixtures__/
 * 3. Run this test to verify correct parsing
 *
 * When a bug is fixed:
 * 1. Add a fixture that reproduces the bug
 * 2. Verify the test fails before the fix
 * 3. Apply the fix and verify the test passes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OutputParser } from './parser.js';
import {
  claudeOutputFixtures,
  geminiOutputFixtures,
  codexOutputFixtures,
  allFixtures,
  type OutputFixture,
} from './__fixtures__/index.js';

/**
 * Helper to run a fixture through the parser and verify results
 */
function runFixture(parser: OutputParser, fixture: OutputFixture) {
  const result = parser.parse(fixture.input);

  // Verify expected commands
  expect(result.commands.length).toBe(
    fixture.expectedCommands.length,
    `Fixture "${fixture.name}": expected ${fixture.expectedCommands.length} commands, got ${result.commands.length}`
  );

  fixture.expectedCommands.forEach((expected, i) => {
    const actual = result.commands[i];
    expect(actual.to).toBe(expected.to, `Fixture "${fixture.name}" command ${i}: wrong target`);
    expect(actual.body).toBe(expected.body, `Fixture "${fixture.name}" command ${i}: wrong body`);

    if (expected.kind) {
      expect(actual.kind).toBe(expected.kind, `Fixture "${fixture.name}" command ${i}: wrong kind`);
    }

    if (expected.thread) {
      expect(actual.thread).toBe(expected.thread, `Fixture "${fixture.name}" command ${i}: wrong thread`);
    }

    if (expected.project) {
      expect(actual.project).toBe(expected.project, `Fixture "${fixture.name}" command ${i}: wrong project`);
    }
  });

  // Verify expected output contains
  if (fixture.expectedOutputContains) {
    fixture.expectedOutputContains.forEach((text) => {
      expect(result.output).toContain(
        text,
        `Fixture "${fixture.name}": output should contain "${text}"`
      );
    });
  }

  // Verify expected output does not contain
  if (fixture.expectedOutputNotContains) {
    fixture.expectedOutputNotContains.forEach((text) => {
      expect(result.output).not.toContain(
        text,
        `Fixture "${fixture.name}": output should NOT contain "${text}"`
      );
    });
  }

  return result;
}

describe('Parser Regression Tests', () => {
  let parser: OutputParser;

  beforeEach(() => {
    parser = new OutputParser();
  });

  describe('Claude CLI outputs', () => {
    claudeOutputFixtures.forEach((fixture) => {
      it(`[${fixture.name}] ${fixture.description}`, () => {
        runFixture(parser, fixture);
      });
    });
  });

  describe('Gemini CLI outputs', () => {
    geminiOutputFixtures.forEach((fixture) => {
      it(`[${fixture.name}] ${fixture.description}`, () => {
        runFixture(parser, fixture);
      });
    });
  });

  describe('Codex CLI outputs', () => {
    codexOutputFixtures.forEach((fixture) => {
      it(`[${fixture.name}] ${fixture.description}`, () => {
        runFixture(parser, fixture);
      });
    });
  });

  describe('Cross-CLI consistency', () => {
    it('handles basic relay command consistently across simulated CLI outputs', () => {
      const basicMessage = '->relay:Lead Hello\n';

      // Reset parser between tests
      const results = [
        new OutputParser().parse(basicMessage),
        new OutputParser().parse(basicMessage),
        new OutputParser().parse(basicMessage),
      ];

      results.forEach((result, i) => {
        expect(result.commands.length).toBe(1, `Iteration ${i}: should parse one command`);
        expect(result.commands[0].to).toBe('Lead');
        expect(result.commands[0].body).toBe('Hello');
      });
    });

    it('maintains parser state correctly across multiple chunks', () => {
      // Simulate streaming output
      const chunks = [
        '->relay:Lead <<<\n',
        'First line\n',
        'Second line\n',
        '>>>\n',
      ];

      let totalCommands = 0;
      for (const chunk of chunks) {
        const result = parser.parse(chunk);
        totalCommands += result.commands.length;
      }

      expect(totalCommands).toBe(1);
    });
  });

  describe('Regression scenarios', () => {
    it('handles ANSI codes without breaking command detection', () => {
      // Regression: ANSI codes could interfere with start-of-line detection
      const input = '\x1b[0m\x1b[1m->relay:Lead Message\x1b[0m\n';
      const result = parser.parse(input);

      expect(result.commands.length).toBe(1);
      expect(result.commands[0].to).toBe('Lead');
    });

    it('does not strip valid text that looks like orphaned CSI', () => {
      // Regression: [Agent Relay] was being stripped as orphaned CSI
      const input = '[Agent Relay] System message\n->relay:Lead ACK\n';
      const result = parser.parse(input);

      expect(result.output).toContain('[Agent Relay]');
      expect(result.commands.length).toBe(1);
    });

    it('handles fence end at end of line correctly', () => {
      // Regression: >>> at end of content line wasn't detected
      const input = '->relay:Lead <<<\nMessage content>>>\n';
      const result = parser.parse(input);

      expect(result.commands.length).toBe(1);
      expect(result.commands[0].body).toBe('Message content');
    });

    it('auto-closes fenced block when new relay starts', () => {
      // Regression: incomplete fenced block would discard content
      const input = '->relay:Alice <<<\nImportant\n->relay:Bob Hi\n';
      const result = parser.parse(input);

      expect(result.commands.length).toBe(2);
      expect(result.commands[0].to).toBe('Alice');
      expect(result.commands[0].body).toBe('Important');
      expect(result.commands[1].to).toBe('Bob');
    });

    it('filters instructional text in thinking blocks correctly', () => {
      // Regression: relay commands in thinking blocks were being parsed
      // Thinking block content is now stripped from output entirely
      const input = `<thinking>
->relay:Test This should be ignored
</thinking>
->relay:Lead Real message
`;
      const result = parser.parse(input);

      expect(result.commands.length).toBe(1);
      expect(result.commands[0].to).toBe('Lead');
      // Thinking content is stripped from output - verify it's NOT there
      expect(result.output).not.toContain('->relay:Test');
    });

    it('handles spawn/release commands as passthrough', () => {
      // Regression: spawn commands were parsed as messages to target "spawn"
      const input = '->relay:spawn Worker claude\n->relay:Lead Done\n';
      const result = parser.parse(input);

      expect(result.commands.length).toBe(1);
      expect(result.commands[0].to).toBe('Lead');
      expect(result.output).toContain('->relay:spawn');
    });

    it('handles cursor movement codes gracefully', () => {
      // Regression: cursor codes could break line detection
      const input = '\x1b[1A\x1b[2K->relay:Lead After cursor move\n';
      const result = parser.parse(input);

      expect(result.commands.length).toBe(1);
      expect(result.commands[0].to).toBe('Lead');
    });
  });

  describe('Fixture coverage summary', () => {
    it('has comprehensive fixture coverage', () => {
      // This test documents the fixture coverage
      const totalFixtures = allFixtures.length;
      const claudeCount = claudeOutputFixtures.length;
      const geminiCount = geminiOutputFixtures.length;
      const codexCount = codexOutputFixtures.length;

      console.log(`
Parser Regression Test Coverage:
- Total fixtures: ${totalFixtures}
- Claude fixtures: ${claudeCount}
- Gemini fixtures: ${geminiCount}
- Codex fixtures: ${codexCount}
      `);

      // Ensure we have reasonable coverage
      expect(claudeCount).toBeGreaterThanOrEqual(15, 'Should have at least 15 Claude fixtures');
      expect(geminiCount).toBeGreaterThanOrEqual(5, 'Should have at least 5 Gemini fixtures');
      expect(codexCount).toBeGreaterThanOrEqual(3, 'Should have at least 3 Codex fixtures');
    });
  });
});
