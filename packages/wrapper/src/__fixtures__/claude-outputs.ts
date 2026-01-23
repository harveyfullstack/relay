/**
 * Claude CLI output fixtures for parser regression testing.
 *
 * These fixtures capture real-world patterns from Claude CLI sessions,
 * including ANSI escape codes, thinking blocks, and various edge cases.
 *
 * When Claude changes its output format, add new fixtures here and
 * ensure the parser still handles them correctly.
 */

export interface OutputFixture {
  name: string;
  description: string;
  input: string;
  expectedCommands: Array<{
    to: string;
    body: string;
    kind?: string;
    thread?: string;
    project?: string;
  }>;
  expectedOutputContains?: string[];
  expectedOutputNotContains?: string[];
}

/**
 * ANSI escape codes commonly seen in Claude output
 */
export const ANSI = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  BLUE: '\x1b[34m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  // Cursor movements
  CURSOR_UP: '\x1b[1A',
  CURSOR_DOWN: '\x1b[1B',
  CURSOR_RIGHT: '\x1b[1C',
  CURSOR_LEFT: '\x1b[1D',
  CLEAR_LINE: '\x1b[2K',
  // Box drawing used by Claude TUI
  BOX_VERTICAL: '│',
  BOX_HORIZONTAL: '─',
  BOX_CORNER_TL: '┌',
  BOX_CORNER_TR: '┐',
  BOX_CORNER_BL: '└',
  BOX_CORNER_BR: '┘',
};

export const claudeOutputFixtures: OutputFixture[] = [
  // =====================================================================
  // Basic relay commands with ANSI codes
  // =====================================================================
  {
    name: 'basic-relay-with-ansi',
    description: 'Simple relay command wrapped in ANSI color codes',
    input: `${ANSI.CYAN}->relay:Lead${ANSI.RESET} Task completed successfully\n`,
    expectedCommands: [
      { to: 'Lead', body: 'Task completed successfully' },
    ],
  },
  {
    name: 'relay-in-bold-output',
    description: 'Relay command in bold text block',
    input: `${ANSI.BOLD}Processing request...${ANSI.RESET}
${ANSI.BOLD}->relay:DataAnalyzer${ANSI.RESET} Please analyze the data
${ANSI.DIM}Done.${ANSI.RESET}
`,
    expectedCommands: [
      { to: 'DataAnalyzer', body: 'Please analyze the data' },
    ],
  },

  // =====================================================================
  // Claude extended thinking blocks
  // =====================================================================
  {
    name: 'thinking-block-with-relay',
    description: 'Relay command inside thinking block should be ignored',
    input: `<thinking>
Let me think about this...
->relay:Agent This should NOT be parsed
</thinking>

->relay:Lead This SHOULD be parsed
`,
    expectedCommands: [
      { to: 'Lead', body: 'This SHOULD be parsed' },
    ],
    // Thinking block content is intentionally stripped from output by the parser
    expectedOutputNotContains: ['->relay:Agent This should NOT be parsed'],
  },
  {
    name: 'nested-thinking-context',
    description: 'Complex thinking block with code examples',
    input: `<thinking>
I need to send a message to the lead agent.
The format is: ->relay:Target message
Let me compose the message...
</thinking>

->relay:Lead I've analyzed the codebase and found the issue.
`,
    expectedCommands: [
      { to: 'Lead', body: "I've analyzed the codebase and found the issue." },
    ],
  },

  // =====================================================================
  // Code fences
  // =====================================================================
  {
    name: 'relay-inside-code-fence',
    description: 'Relay command inside code fence should be ignored',
    input: `Here's an example:

\`\`\`typescript
// Send a message to another agent
->relay:Agent Hello there
\`\`\`

->relay:Lead The example above shows the syntax
`,
    expectedCommands: [
      { to: 'Lead', body: 'The example above shows the syntax' },
    ],
    expectedOutputContains: ['->relay:Agent Hello there'],
  },
  {
    name: 'multiple-code-fences',
    description: 'Multiple code fences with relay commands between',
    input: `\`\`\`
First fence
->relay:Ignored1 Should not parse
\`\`\`

->relay:Valid1 This should parse

\`\`\`python
->relay:Ignored2 Also should not parse
\`\`\`

->relay:Valid2 This should also parse
`,
    expectedCommands: [
      { to: 'Valid1', body: 'This should parse' },
      { to: 'Valid2', body: 'This should also parse' },
    ],
  },

  // =====================================================================
  // Multi-line and continuation
  // =====================================================================
  {
    name: 'multiline-fenced-message',
    description: 'Multi-line message using <<< >>> fence',
    input: `->relay:Lead <<<
Here's my analysis:

1. The authentication module needs refactoring
2. The database queries are inefficient
3. Consider adding caching

Let me know your thoughts.
>>>
`,
    expectedCommands: [
      {
        to: 'Lead',
        body: `Here's my analysis:

1. The authentication module needs refactoring
2. The database queries are inefficient
3. Consider adding caching

Let me know your thoughts.`,
      },
    ],
  },
  {
    name: 'bullet-list-continuation',
    description: 'Relay command followed by bullet list',
    input: `->relay:Lead Status update:
- Completed task A
- Working on task B
- Blocked on task C

Other output here
`,
    expectedCommands: [
      {
        to: 'Lead',
        body: `Status update:
- Completed task A
- Working on task B
- Blocked on task C`,
      },
    ],
    expectedOutputContains: ['Other output here'],
  },

  // =====================================================================
  // Box drawing and TUI elements
  // =====================================================================
  {
    name: 'relay-with-box-drawing',
    description: 'Relay command near box drawing characters',
    input: `${ANSI.BOX_CORNER_TL}${ANSI.BOX_HORIZONTAL.repeat(20)}${ANSI.BOX_CORNER_TR}
${ANSI.BOX_VERTICAL} Processing...       ${ANSI.BOX_VERTICAL}
${ANSI.BOX_CORNER_BL}${ANSI.BOX_HORIZONTAL.repeat(20)}${ANSI.BOX_CORNER_BR}

->relay:Lead Task complete
`,
    expectedCommands: [
      { to: 'Lead', body: 'Task complete' },
    ],
  },

  // =====================================================================
  // Escape sequences
  // =====================================================================
  {
    name: 'escaped-relay-prefix',
    description: 'Escaped relay prefix should not trigger command',
    input: `To send a message, use: \\->relay:Target message

->relay:Lead This is the actual message
`,
    expectedCommands: [
      { to: 'Lead', body: 'This is the actual message' },
    ],
    expectedOutputContains: ['->relay:Target message'],
  },

  // =====================================================================
  // Thread and sync syntax
  // =====================================================================
  {
    name: 'thread-syntax',
    description: 'Relay command with thread identifier',
    input: `->relay:Lead [thread:auth-review] Please review the auth changes
`,
    expectedCommands: [
      { to: 'Lead', body: 'Please review the auth changes', thread: 'auth-review' },
    ],
  },
  {
    name: 'await-syntax',
    description: 'Relay command with await/sync',
    input: `->relay:Lead [await:30s] Please confirm the deployment
`,
    expectedCommands: [
      { to: 'Lead', body: 'Please confirm the deployment' },
    ],
  },
  {
    name: 'cross-project-syntax',
    description: 'Cross-project relay command',
    input: `->relay:backend-api:AuthService Please verify the token
`,
    expectedCommands: [
      { to: 'AuthService', body: 'Please verify the token', project: 'backend-api' },
    ],
  },

  // =====================================================================
  // Instructional text filtering
  // =====================================================================
  {
    name: 'filter-protocol-instruction',
    description: 'Should filter out protocol instruction text',
    input: `->relay:AgentName message. PROTOCOL: (1) Wait for task via relay...

->relay:Lead Actual message here
`,
    expectedCommands: [
      { to: 'Lead', body: 'Actual message here' },
    ],
    expectedOutputContains: ['->relay:AgentName'],
  },
  {
    name: 'filter-placeholder-target',
    description: 'Should filter out messages to placeholder targets',
    input: `->relay:Target This is an example
->relay:AgentName Another example
->relay:Lead Real message
`,
    expectedCommands: [
      { to: 'Lead', body: 'Real message' },
    ],
  },

  // =====================================================================
  // Spawn/release commands (should pass through, not parse)
  // =====================================================================
  {
    name: 'spawn-command-passthrough',
    description: 'Spawn command should pass through, not parse as message',
    input: `->relay:spawn Worker claude "Task description"
->relay:Lead Spawn initiated
`,
    expectedCommands: [
      { to: 'Lead', body: 'Spawn initiated' },
    ],
    expectedOutputContains: ['->relay:spawn Worker'],
  },
  {
    name: 'release-command-passthrough',
    description: 'Release command should pass through, not parse as message',
    input: `->relay:release Worker
->relay:Lead Worker released
`,
    expectedCommands: [
      { to: 'Lead', body: 'Worker released' },
    ],
    expectedOutputContains: ['->relay:release Worker'],
  },

  // =====================================================================
  // Edge cases that have caused bugs
  // =====================================================================
  {
    name: 'cursor-movement-before-relay',
    description: 'Cursor movement codes before relay command',
    input: `${ANSI.CURSOR_UP}${ANSI.CLEAR_LINE}->relay:Lead Status update
`,
    expectedCommands: [
      { to: 'Lead', body: 'Status update' },
    ],
  },
  {
    name: 'orphaned-csi-sequence',
    description: 'Orphaned CSI sequence that lost escape byte',
    input: `[?25l[2K->relay:Lead Message after CSI
`,
    expectedCommands: [
      { to: 'Lead', body: 'Message after CSI' },
    ],
  },
  {
    name: 'relay-injection-echo',
    description: 'Should not re-parse injected relay messages',
    input: `Relay message from Alice [abc12345]: Hello there

->relay:Lead Responding to Alice
`,
    expectedCommands: [
      { to: 'Lead', body: 'Responding to Alice' },
    ],
    expectedOutputContains: ['Relay message from Alice'],
  },
  {
    name: 'incomplete-fenced-then-new-relay',
    description: 'Auto-close incomplete fenced block when new relay starts',
    input: `->relay:Alice <<<
Important content that forgot closing fence
->relay:Bob Hello Bob
`,
    expectedCommands: [
      { to: 'Alice', body: 'Important content that forgot closing fence' },
      { to: 'Bob', body: 'Hello Bob' },
    ],
  },
  {
    name: 'fence-end-on-same-line',
    description: 'Fence end >>> at end of content line',
    input: `->relay:Lead <<<
Quick message>>>
`,
    expectedCommands: [
      { to: 'Lead', body: 'Quick message' },
    ],
  },
  {
    name: 'preserve-agent-relay-text',
    description: 'Should preserve [Agent Relay] text, not strip it as CSI',
    input: `[Agent Relay] It's been 15 minutes. Please output a [[SUMMARY]] block
->relay:Lead Acknowledged
`,
    expectedCommands: [
      { to: 'Lead', body: 'Acknowledged' },
    ],
    expectedOutputContains: ['[Agent Relay]'],
  },

  // =====================================================================
  // Block format [[RELAY]]
  // =====================================================================
  {
    name: 'json-block-format',
    description: 'JSON block format message',
    input: `[[RELAY]]{"to":"Lead","type":"message","body":"Structured message"}[[/RELAY]]
`,
    expectedCommands: [
      { to: 'Lead', body: 'Structured message', kind: 'message' },
    ],
  },
  {
    name: 'json-block-with-data',
    description: 'JSON block with additional data field',
    input: `[[RELAY]]
{
  "to": "Lead",
  "type": "action",
  "body": "Execute task",
  "data": {"taskId": "123", "priority": "high"}
}
[[/RELAY]]
`,
    expectedCommands: [
      { to: 'Lead', body: 'Execute task', kind: 'action' },
    ],
  },

  // =====================================================================
  // Real-world complex scenarios
  // =====================================================================
  {
    name: 'complex-session-output',
    description: 'Realistic complex session with mixed content',
    input: `${ANSI.BOLD}Claude${ANSI.RESET} ${ANSI.DIM}(thinking...)${ANSI.RESET}

<thinking>
Let me analyze the request and formulate a response.
I should send an update to the lead agent.
</thinking>

I've completed the analysis of the authentication module. Here are my findings:

\`\`\`typescript
// Example fix for the auth issue
function validateToken(token: string): boolean {
  // ->relay:Agent This is in a code block, should be ignored
  return jwt.verify(token, SECRET);
}
\`\`\`

->relay:Lead <<<
Analysis complete. Key findings:

1. Token validation has a timing vulnerability
2. Session handling needs improvement
3. Consider adding rate limiting

Recommended priority: HIGH
>>>

${ANSI.GREEN}Done.${ANSI.RESET}
`,
    expectedCommands: [
      {
        to: 'Lead',
        body: `Analysis complete. Key findings:

1. Token validation has a timing vulnerability
2. Session handling needs improvement
3. Consider adding rate limiting

Recommended priority: HIGH`,
      },
    ],
    expectedOutputContains: [
      '->relay:Agent This is in a code block',
      'validateToken',
    ],
  },
];

export default claudeOutputFixtures;
