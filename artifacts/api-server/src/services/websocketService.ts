import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface WSClient {
  ws: WebSocket;
  isAlive: boolean;
  subscribedChannels: Set<string>;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WSClient> = new Set();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastIntervals: ReturnType<typeof setInterval>[] = [];
  private lastBroadcastData: Map<string, string> = new Map();

  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const client: WSClient = { ws, isAlive: true, subscribedChannels: new Set(['live-events', 'recent-bets', 'odds-updates', 'event-counts', 'p2p-updates', 'p2p-match-notification']) };
      this.clients.add(client);
      console.log(`[WS] Client connected (${this.clients.size} total)`);

      ws.on('pong', () => { client.isAlive = true; });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'subscribe' && msg.channel) {
            client.subscribedChannels.add(msg.channel);
          } else if (msg.type === 'unsubscribe' && msg.channel) {
            client.subscribedChannels.delete(msg.channel);
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          }
        } catch {}
      });

      ws.on('close', () => {
        this.clients.delete(client);
        console.log(`[WS] Client disconnected (${this.clients.size} total)`);
      });

      ws.on('error', () => {
        this.clients.delete(client);
      });

      ws.send(JSON.stringify({ type: 'connected', ts: Date.now(), message: 'SuiBets real-time feed' }));
    });

    this.pingInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          return;
        }
        client.isAlive = false;
        try { client.ws.ping(); } catch {}
      });
    }, 30000);

    console.log('[WS] WebSocket server attached on /ws path');
  }

  broadcast(channel: string, data: any) {
    if (this.clients.size === 0) return;

    const payload = JSON.stringify({ type: channel, data, ts: Date.now() });

    const lastData = this.lastBroadcastData.get(channel);
    if (lastData === payload) return;
    this.lastBroadcastData.set(channel, payload);

    let sent = 0;
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN && client.subscribedChannels.has(channel)) {
        try {
          client.ws.send(payload);
          sent++;
        } catch {}
      }
    });

    if (sent > 0) {
      console.log(`[WS] Broadcast '${channel}' to ${sent} client(s)`);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  shutdown() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.broadcastIntervals.forEach(i => clearInterval(i));
    this.clients.forEach(c => c.ws.terminate());
    this.clients.clear();
    this.wss?.close();
  }
}

export const wsService = new WebSocketService();
