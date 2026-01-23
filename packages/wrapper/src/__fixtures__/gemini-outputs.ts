/**
 * Gemini CLI output fixtures for parser regression testing.
 *
 * Gemini has unique characteristics:
 * - Uses sparkle character (✦) as output prefix
 * - Can drop into shell mode ($ prompt)
 * - Has specific keyword interpretation issues
 */

import type { OutputFixture } from './claude-outputs.js';

/**
 * Gemini-specific characters and patterns
 */
export const GEMINI = {
  SPARKLE: '✦',
  SHELL_PROMPT: '$',
};

export const geminiOutputFixtures: OutputFixture[] = [
  // =====================================================================
  // Sparkle prefix handling
  // =====================================================================
  {
    name: 'gemini-sparkle-prefix',
    description: 'Relay command with Gemini sparkle prefix',
    input: `${GEMINI.SPARKLE} ->relay:Lead STATUS: Ready for task
`,
    expectedCommands: [
      { to: 'Lead', body: 'STATUS: Ready for task' },
    ],
  },
  {
    name: 'gemini-sparkle-with-space',
    description: 'Sparkle with extra spacing',
    input: `${GEMINI.SPARKLE}  ->relay:Lead Message with extra space
`,
    expectedCommands: [
      { to: 'Lead', body: 'Message with extra space' },
    ],
  },
  {
    name: 'gemini-multiple-sparkle-lines',
    description: 'Multiple lines with sparkle prefix',
    input: `${GEMINI.SPARKLE} Processing your request...
${GEMINI.SPARKLE} ->relay:Lead Task complete
${GEMINI.SPARKLE} Ready for next task.
`,
    expectedCommands: [
      { to: 'Lead', body: 'Task complete' },
    ],
    expectedOutputContains: ['Processing your request', 'Ready for next task'],
  },

  // =====================================================================
  // Shell mode detection
  // =====================================================================
  {
    name: 'gemini-shell-mode-output',
    description: 'Output that includes shell prompt',
    input: `${GEMINI.SPARKLE} Let me run that command for you.
$ ls -la
total 48
drwxr-xr-x  5 user user 4096 Jan 23 10:00 .
${GEMINI.SPARKLE} ->relay:Lead Command executed successfully
`,
    expectedCommands: [
      { to: 'Lead', body: 'Command executed successfully' },
    ],
    expectedOutputContains: ['$ ls -la', 'total 48'],
  },

  // =====================================================================
  // Gemini-specific edge cases
  // =====================================================================
  {
    name: 'gemini-fenced-with-sparkle',
    description: 'Fenced message with sparkle prefix',
    input: `${GEMINI.SPARKLE} ->relay:Lead <<<
Here's my detailed analysis:

The issue is in the authentication flow.
Consider these changes:
1. Update token validation
2. Add refresh logic
>>>
`,
    expectedCommands: [
      {
        to: 'Lead',
        body: `Here's my detailed analysis:

The issue is in the authentication flow.
Consider these changes:
1. Update token validation
2. Add refresh logic`,
      },
    ],
  },
  {
    name: 'gemini-mixed-output',
    description: 'Mix of sparkle and non-sparkle output',
    input: `Processing...
${GEMINI.SPARKLE} Analyzing the codebase
${GEMINI.SPARKLE} Found 3 issues
->relay:Lead Analysis complete with 3 issues found
${GEMINI.SPARKLE} Done!
`,
    expectedCommands: [
      { to: 'Lead', body: 'Analysis complete with 3 issues found' },
    ],
  },

  // =====================================================================
  // Complex Gemini scenarios
  // =====================================================================
  {
    name: 'gemini-code-execution-output',
    description: 'Gemini executing code with relay after',
    input: `${GEMINI.SPARKLE} I'll run the tests for you.

$ npm test

> project@1.0.0 test
> vitest run

 ✓ src/auth.test.ts (5 tests)
 ✓ src/api.test.ts (12 tests)

Test Files  2 passed
Tests       17 passed

${GEMINI.SPARKLE} ->relay:Lead Tests passed: 17/17. Build is green.
`,
    expectedCommands: [
      { to: 'Lead', body: 'Tests passed: 17/17. Build is green.' },
    ],
    expectedOutputContains: ['npm test', '17 passed'],
  },
  {
    name: 'gemini-broadcast',
    description: 'Gemini sending broadcast message',
    input: `${GEMINI.SPARKLE} ->relay:* All agents: deployment starting in 5 minutes
`,
    expectedCommands: [
      { to: '*', body: 'All agents: deployment starting in 5 minutes' },
    ],
  },
];

export default geminiOutputFixtures;
