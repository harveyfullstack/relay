/**
 * Tic-Tac-Toe Setup Helpers
 *
 * This is a lightweight “game module” focused on generating instructions and
 * directory setup for manual or scripted agent runs.
 *
 * It intentionally does NOT spawn agent processes (that stays in CLI tooling),
 * and it uses the inbox CLI commands (`inbox-poll`, `inbox-write`) so it works
 * with any agent runtime.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface TicTacToeSetupOptions {
  dataDir: string;
  playerX?: string;
  playerO?: string;
}

export interface TicTacToeSetupResult {
  dataDir: string;
  playerX: string;
  playerO: string;
  instructionsXPath: string;
  instructionsOPath: string;
}

function instructionsForPlayerX(dataDir: string, playerX: string, playerO: string): string {
  return `# Tic-Tac-Toe Autonomous Game Protocol

You are **${playerX}** (X). You play FIRST. Your opponent is **${playerO}** (O).

## Board Positions
\`\`\`
 1 | 2 | 3
-----------
 4 | 5 | 6
-----------
 7 | 8 | 9
\`\`\`

## Commands Available
You have these \`agent-relay\` commands to communicate:

**Wait for opponent's message (blocking):**
\`\`\`bash
agent-relay inbox-poll -n ${playerX} -d ${dataDir} --clear
\`\`\`

**Send a move to opponent:**
\`\`\`bash
agent-relay inbox-write -t ${playerO} -f ${playerX} -m "MOVE: X at position N" -d ${dataDir}
\`\`\`

## PROTOCOL (follow EXACTLY)

### Since you're X, you go FIRST:
1. Make your first move to position 5 (center)
2. Send it to opponent:
   \`\`\`bash
   agent-relay inbox-write -t ${playerO} -f ${playerX} -m "MOVE: X at position 5" -d ${dataDir}
   \`\`\`

### Then enter the game loop:
1. **WAIT** for opponent's response (this will block until they respond):
   \`\`\`bash
   agent-relay inbox-poll -n ${playerX} -d ${dataDir} --clear
   \`\`\`

2. **UPDATE** your mental board state with opponent's move

3. **CHECK** for win/draw. If game over, send result and announce:
   \`\`\`bash
   agent-relay inbox-write -t ${playerO} -f ${playerX} -m "GAME OVER: X wins!" -d ${dataDir}
   \`\`\`

4. **MAKE** your next move and send it:
   \`\`\`bash
   agent-relay inbox-write -t ${playerO} -f ${playerX} -m "MOVE: X at position N" -d ${dataDir}
   \`\`\`

5. **REPEAT** from step 1 until game over

## Rules
- Valid moves: positions 1-9 that are empty
- Win: 3 in a row (horizontal, vertical, or diagonal)
- Draw: all 9 positions filled with no winner

## CRITICAL
- NEVER stop mid-game
- ALWAYS use the inbox-poll command to wait (it blocks until opponent responds)
- Keep track of the board state
- Announce result when game ends

## START NOW
Make your FIRST MOVE to position 5, then wait for opponent's response.
`;
}

function instructionsForPlayerO(dataDir: string, playerX: string, playerO: string): string {
  return `# Tic-Tac-Toe Autonomous Game Protocol

You are **${playerO}** (O). ${playerX} plays first, so you WAIT for their move.

## Board Positions
\`\`\`
 1 | 2 | 3
-----------
 4 | 5 | 6
-----------
 7 | 8 | 9
\`\`\`

## Commands Available
You have these \`agent-relay\` commands to communicate:

**Wait for opponent's message (blocking):**
\`\`\`bash
agent-relay inbox-poll -n ${playerO} -d ${dataDir} --clear
\`\`\`

**Send a move to opponent:**
\`\`\`bash
agent-relay inbox-write -t ${playerX} -f ${playerO} -m "MOVE: O at position N" -d ${dataDir}
\`\`\`

## PROTOCOL (follow EXACTLY)

### Since you're O, you go SECOND. Start by waiting:
1. **WAIT** for opponent's first move (this will block until they move):
   \`\`\`bash
   agent-relay inbox-poll -n ${playerO} -d ${dataDir} --clear
   \`\`\`

2. **UPDATE** your mental board state with opponent's move

3. **CHECK** for win/draw. If game over, announce result.

4. **MAKE** your response move and send it:
   \`\`\`bash
   agent-relay inbox-write -t ${playerX} -f ${playerO} -m "MOVE: O at position N" -d ${dataDir}
   \`\`\`

5. **WAIT** for opponent's next move (back to step 1)

## Rules
- Valid moves: positions 1-9 that are empty
- Win: 3 in a row (horizontal, vertical, or diagonal)
- Draw: all 9 positions filled with no winner

## CRITICAL
- NEVER stop mid-game
- ALWAYS use the inbox-poll command to wait (it blocks until opponent responds)
- Keep track of the board state
- Announce result when game ends

## START NOW
Run the inbox-poll command to WAIT for ${playerX}'s first move.
`;
}

export function setupTicTacToe(options: TicTacToeSetupOptions): TicTacToeSetupResult {
  const dataDir = options.dataDir;
  const playerX = options.playerX ?? 'PlayerX';
  const playerO = options.playerO ?? 'PlayerO';

  fs.mkdirSync(path.join(dataDir, playerX), { recursive: true });
  fs.mkdirSync(path.join(dataDir, playerO), { recursive: true });

  // Clear inboxes
  fs.writeFileSync(path.join(dataDir, playerX, 'inbox.md'), '', 'utf-8');
  fs.writeFileSync(path.join(dataDir, playerO, 'inbox.md'), '', 'utf-8');

  const instructionsXPath = path.join(dataDir, playerX, 'GAME_INSTRUCTIONS.md');
  const instructionsOPath = path.join(dataDir, playerO, 'GAME_INSTRUCTIONS.md');

  fs.writeFileSync(instructionsXPath, instructionsForPlayerX(dataDir, playerX, playerO), 'utf-8');
  fs.writeFileSync(instructionsOPath, instructionsForPlayerO(dataDir, playerX, playerO), 'utf-8');

  return { dataDir, playerX, playerO, instructionsXPath, instructionsOPath };
}

