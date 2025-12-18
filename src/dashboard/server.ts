import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AgentStatus {
  name: string;
  role: string;
  cli: string;
  messageCount: number;
  status?: string;
  lastActive?: string;
}

interface Message {
  from: string;
  to: string;
  content: string;
  timestamp: string;
  id: string; // unique-ish id
}

export function startDashboard(port: number, dataDir: string): Promise<void> {
  console.log('Starting dashboard...');
  console.log('__dirname:', __dirname);
  const publicDir = path.join(__dirname, 'public');
  console.log('Public dir:', publicDir);

  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Serve static files from public directory
  app.use(express.static(publicDir));
  app.use(express.json());

  const getTeamData = () => {
    const teamPath = path.join(dataDir, 'team.json');
    if (!fs.existsSync(teamPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(teamPath, 'utf-8'));
    } catch (e) {
      console.error('Failed to read team.json', e);
      return null;
    }
  };

  const parseInbox = (agentName: string): Message[] => {
    const inboxPath = path.join(dataDir, agentName, 'inbox.md');
    if (!fs.existsSync(inboxPath)) return [];
    
    try {
      const content = fs.readFileSync(inboxPath, 'utf-8');
      const messages: Message[] = [];
      
      // Split by "## Message from "
      const parts = content.split('## Message from ');
      
      parts.forEach((part, index) => {
        if (!part.trim()) return;
        
        const firstLineEnd = part.indexOf('\n');
        if (firstLineEnd === -1) return;
        
        const header = part.substring(0, firstLineEnd).trim(); // "Sender | Timestamp" or just "Sender"
        let body = part.substring(firstLineEnd).trim();
        
        // Handle potential " | " in header
        let sender = header;
        let timestamp = new Date().toISOString();
        
        if (header.includes('|')) {
          const split = header.split('|');
          sender = split[0].trim();
          timestamp = split.slice(1).join('|').trim();
        }

        messages.push({
          from: sender,
          to: agentName,
          content: body,
          timestamp: timestamp,
          id: `${agentName}-${index}-${Date.now()}`
        });
      });
      return messages;
    } catch (e) {
      console.error(`Failed to read inbox for ${agentName}`, e);
      return [];
    }
  };

  const getAllData = () => {
    const team = getTeamData();
    if (!team) return { agents: [], messages: [], activity: [] };

    const agentsMap = new Map<string, AgentStatus>();
    let allMessages: Message[] = [];

    // Initialize agents from config
    team.agents.forEach((a: any) => {
      agentsMap.set(a.name, {
        name: a.name,
        role: a.role,
        cli: a.cli,
        messageCount: 0,
        status: 'Idle'
      });
    });

    // Collect messages
    team.agents.forEach((a: any) => {
      const msgs = parseInbox(a.name);
      
      // Update inbox count
      const agent = agentsMap.get(a.name);
      if (agent) {
        agent.messageCount = msgs.length;
      }

      allMessages = [...allMessages, ...msgs];
    });

    // Sort by timestamp
    allMessages.sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    // Derive status from messages sent BY agents
    // We scan all messages; if M is from A, we check if it is a STATUS message
    allMessages.forEach(m => {
      const agent = agentsMap.get(m.from);
      if (agent) {
        agent.lastActive = m.timestamp;
        if (m.content.startsWith('STATUS:')) {
          agent.status = m.content.substring(7).trim(); // remove "STATUS:"
        }
      }
    });

    return {
      agents: Array.from(agentsMap.values()),
      messages: allMessages,
      activity: allMessages // For now, activity log is just the message log
    };
  };

  const broadcastData = () => {
    const data = getAllData();
    const payload = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  app.get('/api/data', (req, res) => {
    res.json(getAllData());
  });

  // Watch for changes
  let fsWait: NodeJS.Timeout | null = null;
  try {
    if (fs.existsSync(dataDir)) {
        console.log(`Watching ${dataDir} for changes...`);
        fs.watch(dataDir, { recursive: true }, (eventType, filename) => {
            if (filename && (filename.endsWith('inbox.md') || filename.endsWith('team.json'))) {
                // Debounce
                if (fsWait) return;
                fsWait = setTimeout(() => {
                    fsWait = null;
                    broadcastData();
                }, 100);
            }
        });
    } else {
        console.warn(`Data directory ${dataDir} does not exist yet.`);
    }
  } catch (e) {
    console.error('Watch failed:', e);
  }

  return new Promise((resolve, reject) => {
      try {
        server.listen(port, () => {
            console.log(`Dashboard running at http://localhost:${port}`);
            console.log(`Monitoring: ${dataDir}`);
            // We do NOT resolve here to keep the process alive
            // But we must resolve if the user sends SIGINT? 
            // The main process handles SIGINT.
        });
        
        server.on('error', (err) => {
            console.error('Server error:', err);
            reject(err);
        });
      } catch (e) {
          reject(e);
      }
  });
}