/**
 * Tests for spawner state marker parsing
 */

import { describe, it, expect } from 'vitest';
import { parseStateMarkers, parseRelayCommands } from './spawner.js';

describe('parseStateMarkers', () => {
  it('parses JSON decision markers', () => {
    const output = `
Some output
[[DECISION]]{"what":"Use file-based inbox","why":"More reliable than stdin injection"}[[/DECISION]]
More output
`;
    const result = parseStateMarkers(output);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].what).toBe('Use file-based inbox');
    expect(result.decisions[0].why).toBe('More reliable than stdin injection');
  });

  it('parses plain text decision markers', () => {
    const output = `[[DECISION]]Decided to use TypeScript[[/DECISION]]`;
    const result = parseStateMarkers(output);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].what).toBe('Decided to use TypeScript');
    expect(result.decisions[0].why).toBe('');
  });

  it('parses JSON TODO markers', () => {
    const output = `[[TODO]]{"task":"Add unit tests","priority":"high","owner":"BrownMountain"}[[/TODO]]`;
    const result = parseStateMarkers(output);
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].task).toBe('Add unit tests');
    expect(result.todos[0].priority).toBe('high');
    expect(result.todos[0].owner).toBe('BrownMountain');
  });

  it('parses plain text TODO markers with default priority', () => {
    const output = `[[TODO]]Fix the bug[[/TODO]]`;
    const result = parseStateMarkers(output);
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].task).toBe('Fix the bug');
    expect(result.todos[0].priority).toBe('normal');
  });

  it('parses DONE markers', () => {
    const output = `[[DONE]]unit tests[[/DONE]]`;
    const result = parseStateMarkers(output);
    expect(result.dones).toHaveLength(1);
    expect(result.dones[0].taskMatch).toBe('unit tests');
  });

  it('parses multiple markers of different types', () => {
    const output = `
Starting work...
[[DECISION]]{"what":"API design","why":"RESTful is cleaner"}[[/DECISION]]
[[TODO]]{"task":"Write docs","priority":"low"}[[/TODO]]
[[TODO]]{"task":"Add tests","priority":"high"}[[/TODO]]
[[DONE]]initial setup[[/DONE]]
Done!
`;
    const result = parseStateMarkers(output);
    expect(result.decisions).toHaveLength(1);
    expect(result.todos).toHaveLength(2);
    expect(result.dones).toHaveLength(1);
  });

  it('handles malformed JSON gracefully', () => {
    const output = `[[DECISION]]{malformed json}[[/DECISION]]`;
    const result = parseStateMarkers(output);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].what).toBe('{malformed json}');
  });

  it('returns empty arrays when no markers present', () => {
    const output = `Just some regular output without any markers`;
    const result = parseStateMarkers(output);
    expect(result.decisions).toHaveLength(0);
    expect(result.todos).toHaveLength(0);
    expect(result.dones).toHaveLength(0);
  });
});

describe('parseRelayCommands', () => {
  it('parses inline relay commands', () => {
    const output = `
@relay:BlueLake Hello there!
Some other output
@relay:GreenCastle How are you?
`;
    const result = parseRelayCommands(output);
    expect(result).toHaveLength(2);
    expect(result[0].to).toBe('BlueLake');
    expect(result[0].body).toBe('Hello there!');
    expect(result[1].to).toBe('GreenCastle');
    expect(result[1].body).toBe('How are you?');
  });

  it('parses block relay commands', () => {
    const output = `[[RELAY]]{"to":"PurpleStone","type":"message","body":"Structured message"}[[/RELAY]]`;
    const result = parseRelayCommands(output);
    expect(result).toHaveLength(1);
    expect(result[0].to).toBe('PurpleStone');
    expect(result[0].body).toBe('Structured message');
    expect(result[0].kind).toBe('message');
  });

  it('parses mixed inline and block commands', () => {
    const output = `
@relay:Agent1 Quick message
[[RELAY]]{"to":"Agent2","type":"thinking","body":"Some thoughts"}[[/RELAY]]
`;
    const result = parseRelayCommands(output);
    expect(result).toHaveLength(2);
    expect(result[0].to).toBe('Agent1');
    expect(result[1].to).toBe('Agent2');
    expect(result[1].kind).toBe('thinking');
  });
});
