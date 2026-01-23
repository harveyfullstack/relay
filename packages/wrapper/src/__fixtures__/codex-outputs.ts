/**
 * Codex CLI output fixtures for parser regression testing.
 *
 * Codex (OpenAI) has its own output formatting patterns.
 */

import type { OutputFixture } from './claude-outputs.js';

export const codexOutputFixtures: OutputFixture[] = [
  // =====================================================================
  // Basic Codex output
  // =====================================================================
  {
    name: 'codex-basic-relay',
    description: 'Basic relay command from Codex',
    input: `I'll help you with that task.

->relay:Lead Task analysis complete. Ready for review.

Let me know if you need anything else.
`,
    expectedCommands: [
      { to: 'Lead', body: 'Task analysis complete. Ready for review.' },
    ],
    expectedOutputContains: ['help you with that task', 'Let me know'],
  },
  {
    name: 'codex-with-code-output',
    description: 'Codex output with code blocks',
    input: `Here's the fix:

\`\`\`python
def authenticate(user, password):
    # ->relay:Agent This is in code, ignore
    return check_credentials(user, password)
\`\`\`

->relay:Lead Code fix implemented. Please review.
`,
    expectedCommands: [
      { to: 'Lead', body: 'Code fix implemented. Please review.' },
    ],
    expectedOutputContains: ['->relay:Agent This is in code'],
  },

  // =====================================================================
  // Codex multi-line messages
  // =====================================================================
  {
    name: 'codex-fenced-message',
    description: 'Codex sending fenced multi-line message',
    input: `->relay:Lead <<<
Code review complete. Issues found:

1. Missing error handling in auth.py:45
2. SQL injection risk in query.py:120
3. Unused import in utils.py:3

Priority: Fix items 1 and 2 immediately.
>>>

I've documented all issues above.
`,
    expectedCommands: [
      {
        to: 'Lead',
        body: `Code review complete. Issues found:

1. Missing error handling in auth.py:45
2. SQL injection risk in query.py:120
3. Unused import in utils.py:3

Priority: Fix items 1 and 2 immediately.`,
      },
    ],
  },

  // =====================================================================
  // Codex with tool use
  // =====================================================================
  {
    name: 'codex-after-tool-use',
    description: 'Relay command after Codex tool execution',
    input: `Running: git status

On branch main
Changes not staged for commit:
  modified:   src/auth.ts

->relay:Lead Git status shows 1 modified file: src/auth.ts
`,
    expectedCommands: [
      { to: 'Lead', body: 'Git status shows 1 modified file: src/auth.ts' },
    ],
    expectedOutputContains: ['Running: git status', 'On branch main'],
  },
];

export default codexOutputFixtures;
