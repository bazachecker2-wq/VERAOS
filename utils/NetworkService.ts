
import { NetworkPacket, ConnectedUser } from '../types';

type NetworkCallback = (type: string, data: any) => void;

export class NetworkService {
  private ws: WebSocket | null = null;
  private listeners: NetworkCallback[] = [];
  private userId: string;
  private serverUrl: string = 'ws://localhost:8080';
  private reconnectTimeout: any = null;
  private isExplicitlyClosed: boolean = false;
  private retryCount: number = 0;
  private maxRetries: number = 3;
  
  public connectedUsers: ConnectedUser[] = [];

  constructor(serverUrl?: string) {
    this.userId = `UNIT-${Math.floor(Math.random() * 900) + 100}`;
    if (serverUrl) this.serverUrl = serverUrl;
  }

  public connect() {
    this.isExplicitlyClosed = false;
    
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    // Stop retrying if localhost and max retries reached to avoid console spam
    if (this.serverUrl.includes('localhost') && this.retryCount >= this.maxRetries) {
        this.notify('STATUS', 'АВТОНОМНЫЙ РЕЖИМ');
        return;
    }

    try {
      this.ws = new WebSocket(this.serverUrl);
      
      this.ws.onopen = () => {
        console.log('[NET] Connected');
        this.retryCount = 0; // Reset retries on success
        this.notify('STATUS', 'ПОДКЛЮЧЕНО');
        this.send('HANDSHAKE', { name: this.userId, status: 'online' });
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const packet: NetworkPacket = JSON.parse(event.data);
          this.handlePacket(packet);
        } catch (e) {
          // Silently ignore parse errors
        }
      };

      this.ws.onerror = (e) => {
        // Prevent console error spam by not logging connection refused for localhost
        // The browser will still log net::ERR_CONNECTION_REFUSED, but we avoid adding extra noise
      };

      this.ws.onclose = (e) => {
        if (!this.isExplicitlyClosed) {
            this.notify('STATUS', 'АВТОНОМНЫЙ РЕЖИМ');
            this.scheduleReconnect();
        }
      };

    } catch (e) {
       this.notify('STATUS', 'АВТОНОМНЫЙ РЕЖИМ');
       this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
      if (this.reconnectTimeout) return;
      
      this.retryCount++;
      const delay = Math.min(5000 * this.retryCount, 30000); // Exponential backoff

      this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.connect();
      }, delay);
  }

  public setUrl(url: string) {
      this.serverUrl = url;
      this.retryCount = 0; // Reset retries for new URL
      if (this.ws) {
          this.ws.close();
      } else {
          this.connect();
      }
  }

  public disconnect() {
      this.isExplicitlyClosed = true;
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      if (this.ws) this.ws.close();
  }

  public send(type: 'TELEMETRY' | 'CHAT' | 'HANDSHAKE', payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const packet: NetworkPacket = {
        type,
        userId: this.userId,
        payload,
        timestamp: Date.now()
      };
      try {
        this.ws.send(JSON.stringify(packet));
      } catch (e) {
          // Ignore send errors
      }
    }
  }

  public on(callback: NetworkCallback) {
    this.listeners.push(callback);
  }

  private notify(type: string, data: any) {
    this.listeners.forEach(cb => cb(type, data));
  }

  private handlePacket(packet: NetworkPacket) {
     if (packet.type === 'TELEMETRY') {
         this.notify('OBJECTS', { userId: packet.userId, objects: packet.payload });
     }
     if (packet.type === 'HANDSHAKE') {
         const existing = this.connectedUsers.find(u => u.id === packet.userId);
         if (!existing) {
             this.connectedUsers.push({
                 id: packet.userId,
                 name: packet.payload.name || packet.userId,
                 status: 'online',
                 lastPing: Date.now(),
                 color: this.getUserColor(packet.userId)
             });
             this.notify('USERS', [...this.connectedUsers]);
         }
     }
  }

  private getUserColor(id: string) {
      let hash = 0;
      for (let i = 0; i < id.length; i++) {
          hash = id.charCodeAt(i) + ((hash << 5) - hash);
      }
      const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
      return '#' + '00000'.substring(0, 6 - c.length) + c;
  }

  public getUserId() { return this.userId; }
}
