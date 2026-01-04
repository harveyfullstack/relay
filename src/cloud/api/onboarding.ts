/**
 * Onboarding API Routes
 *
 * Handles CLI proxy authentication for Claude Code and other providers.
 * Spawns CLI tools via PTY to get auth URLs, captures tokens.
 *
 * We use node-pty instead of child_process.spawn because:
 * 1. Many CLIs detect if they're in a TTY and behave differently
 * 2. Interactive OAuth flows often require TTY for proper output
 * 3. PTY ensures the CLI outputs auth URLs correctly
 */

import { Router, Request, Response } from 'express';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import crypto from 'crypto';
import { requireAuth } from './auth.js';
import { db } from '../db/index.js';
import { vault } from '../vault/index.js';

export const onboardingRouter = Router();

// All routes require authentication
onboardingRouter.use(requireAuth);

/**
 * Active CLI auth sessions
 * Maps sessionId -> { process, authUrl, status, token }
 */
interface CLIAuthSession {
  userId: string;
  provider: string;
  process?: IPty;
  authUrl?: string;
  callbackUrl?: string;
  status: 'starting' | 'waiting_auth' | 'success' | 'error' | 'timeout';
  token?: string;
  error?: string;
  createdAt: Date;
  output: string; // Accumulated output for debugging
}

const activeSessions = new Map<string, CLIAuthSession>();

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    // Remove sessions older than 10 minutes
    if (now - session.createdAt.getTime() > 10 * 60 * 1000) {
      if (session.process) {
        try {
          session.process.kill();
        } catch {
          // Process may already be dead
        }
      }
      activeSessions.delete(id);
    }
  }
}, 60000);

/**
 * CLI commands and URL patterns for each provider
 *
 * Each CLI tool outputs an OAuth URL when run without credentials.
 * We capture stdout/stderr and extract the URL using a simple https:// pattern.
 *
 * IMPORTANT: These CLIs are interactive - they output the auth URL then wait
 * for the user to complete OAuth in their browser. We capture the URL and
 * display it in a popup for the user.
 */
const CLI_AUTH_CONFIG: Record<string, {
  command: string;
  args: string[];
  urlPattern: RegExp;
  credentialPath?: string;
  displayName: string;
}> = {
  anthropic: {
    // Claude Code CLI - running without args triggers OAuth if not authenticated
    command: 'claude',
    args: [], // No args needed - CLI auto-prompts for auth
    // Generic URL pattern with capture group - Claude outputs auth URL to stdout
    urlPattern: /(https:\/\/[^\s]+)/,
    credentialPath: '~/.claude/credentials.json',
    displayName: 'Claude',
  },
  openai: {
    // Codex CLI - uses 'login' subcommand
    command: 'codex',
    args: ['login'],
    urlPattern: /(https:\/\/[^\s]+)/,
    credentialPath: '~/.codex/credentials.json',
    displayName: 'Codex',
  },
  google: {
    // Gemini CLI
    command: 'gemini',
    args: [],
    urlPattern: /(https:\/\/[^\s]+)/,
    displayName: 'Gemini',
  },
  opencode: {
    // OpenCode CLI
    command: 'opencode',
    args: [],
    urlPattern: /(https:\/\/[^\s]+)/,
    displayName: 'OpenCode',
  },
  droid: {
    // Droid CLI
    command: 'droid',
    args: [],
    urlPattern: /(https:\/\/[^\s]+)/,
    displayName: 'Droid',
  },
};

/**
 * POST /api/onboarding/cli/:provider/start
 * Start CLI-based auth - spawns the CLI and captures auth URL
 */
onboardingRouter.post('/cli/:provider/start', async (req: Request, res: Response) => {
  const { provider } = req.params;
  const userId = req.session.userId!;

  const config = CLI_AUTH_CONFIG[provider];
  if (!config) {
    return res.status(400).json({
      error: 'Provider not supported for CLI auth',
      supportedProviders: Object.keys(CLI_AUTH_CONFIG),
    });
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const session: CLIAuthSession = {
    userId,
    provider,
    status: 'starting',
    createdAt: new Date(),
    output: '',
  };
  activeSessions.set(sessionId, session);

  try {
    // Spawn CLI process via PTY for proper TTY emulation
    // This ensures the CLI outputs auth URLs correctly
    const proc = pty.spawn(config.command, config.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: '1', TERM: 'xterm-256color' } as Record<string, string>,
    });

    session.process = proc;

    // Track which prompts we've already responded to
    let respondedDarkMode = false;
    let respondedAuthChoice = false;

    // Capture PTY output for auth URL and handle interactive prompts
    proc.onData((data: string) => {
      session.output += data;

      // Strip ANSI escape codes for pattern matching
      const cleanText = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      const lowerText = cleanText.toLowerCase();

      // Handle Claude's interactive setup prompts
      if (provider === 'anthropic') {
        // Dark mode prompt - just press enter to accept default (or 'n' for no)
        if (!respondedDarkMode && (lowerText.includes('dark mode') || lowerText.includes('dark theme'))) {
          respondedDarkMode = true;
          // Press enter to accept default
          setTimeout(() => proc.write('\r'), 100);
        }

        // Auth method prompt - choose subscription (press enter or '1')
        // Claude asks: "Would you like to use your Claude subscription or an API key?"
        if (!respondedAuthChoice && (
          lowerText.includes('subscription') ||
          lowerText.includes('api key') ||
          lowerText.includes('how would you like to authenticate')
        )) {
          respondedAuthChoice = true;
          // Press enter to select first option (Claude subscription)
          setTimeout(() => proc.write('\r'), 100);
        }
      }

      // Look for auth URL
      const match = cleanText.match(config.urlPattern);
      if (match && match[1]) {
        session.authUrl = match[1];
        session.status = 'waiting_auth';
      }

      // Look for success indicators
      if (lowerText.includes('success') ||
          lowerText.includes('authenticated') ||
          lowerText.includes('logged in')) {
        session.status = 'success';
      }
    });

    proc.onExit(async ({ exitCode }) => {
      if (exitCode === 0 && session.status !== 'error') {
        session.status = 'success';
        // Try to read credentials from file
        await extractCredentials(session, config);
      } else if (session.status === 'starting') {
        session.status = 'error';
        session.error = `CLI exited with code ${exitCode}`;
      }
    });

    // Wait for URL to appear - longer timeout for Claude's multi-step setup
    // Claude asks: dark mode? -> subscription vs API key? -> shows login URL
    const waitTime = provider === 'anthropic' ? 5000 : 2000;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Return session info based on current state
    if (session.status === 'success') {
      // Already authenticated - CLI exited successfully without auth URL
      activeSessions.delete(sessionId);
      res.json({
        sessionId,
        status: 'success',
        alreadyAuthenticated: true,
        message: `Already authenticated with ${config.displayName}`,
      });
    } else if (session.authUrl) {
      res.json({
        sessionId,
        status: 'waiting_auth',
        authUrl: session.authUrl,
        message: 'Open the auth URL to complete login',
      });
    } else if (session.status === 'error') {
      activeSessions.delete(sessionId);
      res.status(500).json({ error: session.error || 'CLI auth failed to start' });
    } else {
      // Still starting, return session ID to poll
      res.json({
        sessionId,
        status: 'starting',
        message: 'Auth session starting, poll for status',
      });
    }
  } catch (error) {
    activeSessions.delete(sessionId);
    console.error(`Error starting CLI auth for ${provider}:`, error);
    res.status(500).json({ error: 'Failed to start CLI authentication' });
  }
});

/**
 * GET /api/onboarding/cli/:provider/status/:sessionId
 * Check status of CLI auth session
 */
onboardingRouter.get('/cli/:provider/status/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const userId = req.session.userId!;

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  if (session.userId !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  res.json({
    status: session.status,
    authUrl: session.authUrl,
    error: session.error,
  });
});

/**
 * POST /api/onboarding/cli/:provider/complete/:sessionId
 * Mark CLI auth as complete and store credentials
 */
onboardingRouter.post('/cli/:provider/complete/:sessionId', async (req: Request, res: Response) => {
  const { provider, sessionId } = req.params;
  const userId = req.session.userId!;
  const { token } = req.body; // Optional: user can paste token directly

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  if (session.userId !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    // If token provided directly, use it
    let accessToken = token || session.token;

    // If no token yet, try to read from credentials file
    if (!accessToken) {
      const config = CLI_AUTH_CONFIG[provider];
      if (config) {
        await extractCredentials(session, config);
        accessToken = session.token;
      }
    }

    if (!accessToken) {
      return res.status(400).json({
        error: 'No token found. Please complete authentication or paste your token.',
      });
    }

    // Store in vault
    await vault.storeCredential({
      userId,
      provider,
      accessToken,
      scopes: getProviderScopes(provider),
    });

    // Clean up session
    if (session.process) {
      try {
        session.process.kill();
      } catch {
        // Process may already be dead
      }
    }
    activeSessions.delete(sessionId);

    res.json({
      success: true,
      message: `${provider} connected successfully`,
    });
  } catch (error) {
    console.error(`Error completing CLI auth for ${provider}:`, error);
    res.status(500).json({ error: 'Failed to complete authentication' });
  }
});

/**
 * POST /api/onboarding/cli/:provider/cancel/:sessionId
 * Cancel a CLI auth session
 */
onboardingRouter.post('/cli/:provider/cancel/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const userId = req.session.userId!;

  const session = activeSessions.get(sessionId);
  if (session?.userId === userId) {
    if (session.process) {
      try {
        session.process.kill();
      } catch {
        // Process may already be dead
      }
    }
    activeSessions.delete(sessionId);
  }

  res.json({ success: true });
});

/**
 * POST /api/onboarding/token/:provider
 * Directly store a token (for manual paste flow)
 */
onboardingRouter.post('/token/:provider', async (req: Request, res: Response) => {
  const { provider } = req.params;
  const userId = req.session.userId!;
  const { token, email } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    // Validate token by making a test API call
    const isValid = await validateProviderToken(provider, token);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    // Store in vault
    await vault.storeCredential({
      userId,
      provider,
      accessToken: token,
      scopes: getProviderScopes(provider),
      providerAccountEmail: email,
    });

    res.json({
      success: true,
      message: `${provider} connected successfully`,
    });
  } catch (error) {
    console.error(`Error storing token for ${provider}:`, error);
    res.status(500).json({ error: 'Failed to store token' });
  }
});

/**
 * GET /api/onboarding/status
 * Get overall onboarding status
 */
onboardingRouter.get('/status', async (req: Request, res: Response) => {
  const userId = req.session.userId!;

  try {
    const [user, credentials, repositories] = await Promise.all([
      db.users.findById(userId),
      db.credentials.findByUserId(userId),
      db.repositories.findByUserId(userId),
    ]);

    const connectedProviders = credentials.map(c => c.provider);
    const hasAIProvider = connectedProviders.some(p =>
      ['anthropic', 'openai', 'google'].includes(p)
    );

    res.json({
      steps: {
        github: { complete: connectedProviders.includes('github') },
        aiProvider: {
          complete: hasAIProvider,
          connected: connectedProviders.filter(p => p !== 'github'),
        },
        repository: {
          complete: repositories.length > 0,
          count: repositories.length,
        },
      },
      onboardingComplete: user?.onboardingCompletedAt != null,
      canCreateWorkspace: hasAIProvider && repositories.length > 0,
    });
  } catch (error) {
    console.error('Error getting onboarding status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * POST /api/onboarding/complete
 * Mark onboarding as complete
 */
onboardingRouter.post('/complete', async (req: Request, res: Response) => {
  const userId = req.session.userId!;

  try {
    await db.users.completeOnboarding(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

/**
 * Helper: Extract credentials from CLI credential file
 */
async function extractCredentials(
  session: CLIAuthSession,
  config: typeof CLI_AUTH_CONFIG[string]
): Promise<void> {
  if (!config.credentialPath) return;

  try {
    const fs = await import('fs/promises');
    const os = await import('os');
    const credPath = config.credentialPath.replace('~', os.homedir());
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);

    // Extract token based on provider structure
    if (session.provider === 'anthropic') {
      // Claude stores: { "oauth_token": "...", ... } or { "api_key": "..." }
      session.token = creds.oauth_token || creds.access_token || creds.api_key;
    } else if (session.provider === 'openai') {
      // Codex might store: { "token": "..." } or { "api_key": "..." }
      session.token = creds.token || creds.access_token || creds.api_key;
    }
  } catch (error) {
    // Credentials file doesn't exist or isn't readable yet
    console.log(`Could not read credentials file: ${error}`);
  }
}

/**
 * Helper: Get default scopes for a provider
 */
function getProviderScopes(provider: string): string[] {
  const scopes: Record<string, string[]> = {
    anthropic: ['claude-code:execute', 'user:read'],
    openai: ['codex:execute', 'chat:write'],
    google: ['generative-language'],
    github: ['read:user', 'user:email', 'repo'],
  };
  return scopes[provider] || [];
}

/**
 * Helper: Validate a provider token by making a test API call
 */
async function validateProviderToken(provider: string, token: string): Promise<boolean> {
  try {
    const endpoints: Record<string, { url: string; headers: Record<string, string> }> = {
      anthropic: {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key': token,
          'anthropic-version': '2023-06-01',
        },
      },
      openai: {
        url: 'https://api.openai.com/v1/models',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      google: {
        url: 'https://generativelanguage.googleapis.com/v1/models',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    };

    const config = endpoints[provider];
    if (!config) return true; // Unknown provider, assume valid

    const response = await fetch(config.url, {
      method: provider === 'anthropic' ? 'POST' : 'GET',
      headers: config.headers,
      ...(provider === 'anthropic' && {
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        }),
      }),
    });

    // 401/403 means invalid token, anything else (including rate limits) means valid
    return response.status !== 401 && response.status !== 403;
  } catch (error) {
    console.error(`Error validating ${provider} token:`, error);
    return false;
  }
}
