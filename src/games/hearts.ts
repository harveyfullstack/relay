/**
 * Hearts Game Plugin
 * Proof-of-concept game coordinator for agent-relay.
 */

import { RelayClient } from '../wrapper/client.js';
import type { SendPayload } from '../protocol/types.js';

// Card types
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface GameState {
  phase: 'waiting' | 'passing' | 'playing' | 'finished';
  players: string[];
  hands: Map<string, Card[]>;
  currentTrick: { player: string; card: Card }[];
  trickLeader: string;
  currentPlayer: string;
  scores: Map<string, number>;
  roundScores: Map<string, number>;
  heartsBroken: boolean;
  tricksWon: Map<string, Card[][]>;
}

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export class HeartsGame {
  private client: RelayClient;
  private state: GameState;
  private turnTimeout: NodeJS.Timeout | null = null;
  private turnTimeoutMs: number;

  constructor(
    players: string[],
    options: { socketPath?: string; turnTimeoutMs?: number } = {}
  ) {
    if (players.length !== 4) {
      throw new Error('Hearts requires exactly 4 players');
    }

    this.turnTimeoutMs = options.turnTimeoutMs ?? 60000;

    this.client = new RelayClient({
      agentName: 'hearts-coordinator',
      socketPath: options.socketPath,
    });

    this.state = {
      phase: 'waiting',
      players,
      hands: new Map(),
      currentTrick: [],
      trickLeader: '',
      currentPlayer: '',
      scores: new Map(players.map((p) => [p, 0])),
      roundScores: new Map(players.map((p) => [p, 0])),
      heartsBroken: false,
      tricksWon: new Map(players.map((p) => [p, []])),
    };

    this.client.onMessage = (from, payload) => {
      this.handlePlayerMessage(from, payload);
    };
  }

  /**
   * Start the game.
   */
  async start(): Promise<void> {
    await this.client.connect();
    this.client.subscribe('hearts');

    console.log('[hearts] Game starting with players:', this.state.players.join(', '));

    // Deal cards
    this.dealCards();
    this.state.phase = 'playing';

    // Find player with 2 of clubs
    const firstPlayer = this.findPlayerWith2OfClubs();
    this.state.trickLeader = firstPlayer;
    this.state.currentPlayer = firstPlayer;

    // Notify all players
    this.broadcastGameState();
    this.promptCurrentPlayer();
  }

  /**
   * Stop the game.
   */
  stop(): void {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
    }
    this.client.disconnect();
  }

  /**
   * Deal cards to all players.
   */
  private dealCards(): void {
    const deck = this.createShuffledDeck();

    for (let i = 0; i < this.state.players.length; i++) {
      const hand = deck.slice(i * 13, (i + 1) * 13);
      this.state.hands.set(this.state.players[i], hand);
    }
  }

  /**
   * Create and shuffle a standard deck.
   */
  private createShuffledDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }

    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }

  /**
   * Find player with 2 of clubs.
   */
  private findPlayerWith2OfClubs(): string {
    for (const [player, hand] of this.state.hands) {
      if (hand.some((c) => c.suit === 'clubs' && c.rank === '2')) {
        return player;
      }
    }
    return this.state.players[0];
  }

  /**
   * Handle a message from a player.
   */
  private handlePlayerMessage(from: string, payload: SendPayload): void {
    if (this.state.phase !== 'playing') return;

    try {
      const action = payload.data as { action: string; card?: Card };

      if (action?.action === 'play_card' && action.card) {
        this.handlePlayCard(from, action.card);
      }
    } catch (err) {
      console.error('[hearts] Invalid player message:', err);
    }
  }

  /**
   * Handle a player playing a card.
   */
  private handlePlayCard(player: string, card: Card): void {
    // Validate it's this player's turn
    if (player !== this.state.currentPlayer) {
      this.sendToPlayer(player, 'error', "It's not your turn");
      return;
    }

    // Validate player has the card
    const hand = this.state.hands.get(player);
    if (!hand) return;

    const cardIndex = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
    if (cardIndex === -1) {
      this.sendToPlayer(player, 'error', "You don't have that card");
      return;
    }

    // Validate the play is legal
    if (!this.isLegalPlay(player, card)) {
      this.sendToPlayer(player, 'error', 'Illegal play');
      return;
    }

    // Clear turn timeout
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }

    // Remove card from hand
    hand.splice(cardIndex, 1);

    // Add to current trick
    this.state.currentTrick.push({ player, card });

    // Check if hearts broken
    if (card.suit === 'hearts' && !this.state.heartsBroken) {
      this.state.heartsBroken = true;
      this.broadcast(`Hearts have been broken by ${player}!`);
    }

    // Broadcast the play
    this.broadcast(`${player} played ${this.formatCard(card)}`);

    // Check if trick is complete
    if (this.state.currentTrick.length === 4) {
      this.completeTrick();
    } else {
      // Next player
      this.advancePlayer();
      this.promptCurrentPlayer();
    }
  }

  /**
   * Check if a play is legal.
   */
  private isLegalPlay(player: string, card: Card): boolean {
    const hand = this.state.hands.get(player);
    if (!hand) return false;

    // First trick: must play 2 of clubs
    if (this.state.currentTrick.length === 0 && this.state.tricksWon.get(player)?.length === 0) {
      const allTricksEmpty = Array.from(this.state.tricksWon.values()).every((t) => t.length === 0);
      if (allTricksEmpty) {
        return card.suit === 'clubs' && card.rank === '2';
      }
    }

    // Must follow suit if possible
    if (this.state.currentTrick.length > 0) {
      const leadSuit = this.state.currentTrick[0].card.suit;
      const hasSuit = hand.some((c) => c.suit === leadSuit);

      if (hasSuit && card.suit !== leadSuit) {
        return false;
      }
    }

    // Can't lead hearts unless broken (or only hearts in hand)
    if (this.state.currentTrick.length === 0 && card.suit === 'hearts' && !this.state.heartsBroken) {
      const hasNonHearts = hand.some((c) => c.suit !== 'hearts');
      if (hasNonHearts) {
        return false;
      }
    }

    return true;
  }

  /**
   * Complete the current trick.
   */
  private completeTrick(): void {
    const leadSuit = this.state.currentTrick[0].card.suit;

    // Find winner (highest card of lead suit)
    let winner = this.state.currentTrick[0];
    for (const play of this.state.currentTrick.slice(1)) {
      if (play.card.suit === leadSuit && this.rankValue(play.card.rank) > this.rankValue(winner.card.rank)) {
        winner = play;
      }
    }

    // Calculate points
    let points = 0;
    for (const play of this.state.currentTrick) {
      if (play.card.suit === 'hearts') {
        points += 1;
      } else if (play.card.suit === 'spades' && play.card.rank === 'Q') {
        points += 13;
      }
    }

    // Award trick to winner
    const tricks = this.state.tricksWon.get(winner.player)!;
    tricks.push(this.state.currentTrick.map((p) => p.card));

    const currentScore = this.state.roundScores.get(winner.player) ?? 0;
    this.state.roundScores.set(winner.player, currentScore + points);

    this.broadcast(`${winner.player} wins the trick (+${points} points)`);

    // Clear trick
    this.state.currentTrick = [];
    this.state.trickLeader = winner.player;
    this.state.currentPlayer = winner.player;

    // Check if round is over
    const totalCards = Array.from(this.state.hands.values()).reduce((sum, h) => sum + h.length, 0);
    if (totalCards === 0) {
      this.completeRound();
    } else {
      this.promptCurrentPlayer();
    }
  }

  /**
   * Complete the round.
   */
  private completeRound(): void {
    // Check for "shooting the moon"
    for (const [player, roundScore] of this.state.roundScores) {
      if (roundScore === 26) {
        // Shot the moon!
        this.broadcast(`${player} shot the moon! All other players get 26 points!`);
        for (const p of this.state.players) {
          if (p !== player) {
            const current = this.state.scores.get(p) ?? 0;
            this.state.scores.set(p, current + 26);
          }
        }
        this.state.roundScores.set(player, 0);
        break;
      }
    }

    // Add round scores to total
    for (const [player, roundScore] of this.state.roundScores) {
      const current = this.state.scores.get(player) ?? 0;
      this.state.scores.set(player, current + roundScore);
    }

    // Display scores
    this.broadcastScores();

    // Check for game over (100 points)
    const maxScore = Math.max(...Array.from(this.state.scores.values()));
    if (maxScore >= 100) {
      this.endGame();
    } else {
      // Start new round
      this.startNewRound();
    }
  }

  /**
   * Start a new round.
   */
  private startNewRound(): void {
    this.state.roundScores = new Map(this.state.players.map((p) => [p, 0]));
    this.state.heartsBroken = false;
    this.state.tricksWon = new Map(this.state.players.map((p) => [p, []]));

    this.dealCards();

    const firstPlayer = this.findPlayerWith2OfClubs();
    this.state.trickLeader = firstPlayer;
    this.state.currentPlayer = firstPlayer;

    this.broadcast('New round starting!');
    this.broadcastGameState();
    this.promptCurrentPlayer();
  }

  /**
   * End the game.
   */
  private endGame(): void {
    this.state.phase = 'finished';

    // Find winner (lowest score)
    let winner = this.state.players[0];
    let lowestScore = this.state.scores.get(winner) ?? 0;

    for (const player of this.state.players) {
      const score = this.state.scores.get(player) ?? 0;
      if (score < lowestScore) {
        lowestScore = score;
        winner = player;
      }
    }

    this.broadcast(`Game over! ${winner} wins with ${lowestScore} points!`);
    this.broadcastScores();

    this.stop();
  }

  /**
   * Advance to the next player.
   */
  private advancePlayer(): void {
    const currentIndex = this.state.players.indexOf(this.state.currentPlayer);
    const nextIndex = (currentIndex + 1) % 4;
    this.state.currentPlayer = this.state.players[nextIndex];
  }

  /**
   * Prompt the current player to play.
   */
  private promptCurrentPlayer(): void {
    const hand = this.state.hands.get(this.state.currentPlayer);
    const validPlays = hand?.filter((c) => this.isLegalPlay(this.state.currentPlayer, c)) ?? [];

    this.sendToPlayer(this.state.currentPlayer, 'your_turn', '', {
      hand: hand?.map(this.formatCard),
      valid_plays: validPlays.map(this.formatCard),
      current_trick: this.state.currentTrick.map((p) => ({
        player: p.player,
        card: this.formatCard(p.card),
      })),
      hearts_broken: this.state.heartsBroken,
    });

    // Set turn timeout
    this.turnTimeout = setTimeout(() => {
      this.handleTurnTimeout();
    }, this.turnTimeoutMs);
  }

  /**
   * Handle turn timeout.
   */
  private handleTurnTimeout(): void {
    const player = this.state.currentPlayer;
    const hand = this.state.hands.get(player);

    // Auto-play first valid card
    const validPlays = hand?.filter((c) => this.isLegalPlay(player, c)) ?? [];
    if (validPlays.length > 0) {
      this.broadcast(`${player} timed out, auto-playing`);
      this.handlePlayCard(player, validPlays[0]);
    }
  }

  /**
   * Get rank value for comparison.
   */
  private rankValue(rank: Rank): number {
    return RANKS.indexOf(rank);
  }

  /**
   * Format a card for display.
   */
  private formatCard(card: Card): string {
    const suitSymbol = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }[card.suit];
    return `${card.rank}${suitSymbol}`;
  }

  /**
   * Broadcast game state to all players.
   */
  private broadcastGameState(): void {
    for (const player of this.state.players) {
      const hand = this.state.hands.get(player);
      this.sendToPlayer(player, 'game_state', '', {
        phase: this.state.phase,
        your_hand: hand?.map(this.formatCard),
        players: this.state.players,
        current_player: this.state.currentPlayer,
        hearts_broken: this.state.heartsBroken,
        scores: Object.fromEntries(this.state.scores),
      });
    }
  }

  /**
   * Broadcast scores to all players.
   */
  private broadcastScores(): void {
    const scoreText = this.state.players
      .map((p) => `${p}: ${this.state.scores.get(p)}`)
      .join(', ');
    this.broadcast(`Scores: ${scoreText}`);
  }

  /**
   * Send a message to a specific player.
   */
  private sendToPlayer(player: string, kind: string, body: string, data?: Record<string, unknown>): void {
    this.client.sendMessage(player, body, 'state', { kind, ...data });
  }

  /**
   * Broadcast a message to all players.
   */
  private broadcast(message: string): void {
    console.log(`[hearts] ${message}`);
    this.client.broadcast(message, 'message');
  }
}
