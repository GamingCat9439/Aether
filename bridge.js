'use strict';

// Minimal RFC 6455 WebSocket server used by the Aether bridge.
// It intentionally supports only what the executor bridge needs: text frames,
// fragmentation, ping/pong and close. No external dependencies.

const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 2 * 1024 * 1024;
const MAX_BUFFER = MAX_MESSAGE + 64 * 1024;
const STALE_AFTER = 5 * 60 * 1000;

const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let header;

  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

function clampText(value, max) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, max);
}

function logTime() {
  return Date.now();
}

class BridgeServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = null;
    this.sessions = new Set();
    this.bySocket = new Map();
    this.clients = new Map();
    this.seq = 1;
    this.heartbeat = null;
  }

  get running() {
    return Boolean(this.server);
  }

  get clientCount() {
    return this.clients.size;
  }

  listClients() {
    return [...this.clients.values()].sort((a, b) => a.connectedAt - b.connectedAt);
  }

  async start(port) {
    if (this.server) await this.stop();

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ app: 'aether-bridge', protocol: 1, clients: this.clientCount }));
          return;
        }

        res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
        res.end('Aether bridge. Executor clients connect over WebSocket.');
      });

      server.on('upgrade', (req, socket, head) => this.#upgrade(req, socket, head));

      server.once('error', (error) => {
        this.server = null;
        this.port = null;
        reject(error);
      });

      server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
        this.server = server;
        this.port = server.address().port;
        this.#startHeartbeat();
        resolve(this.port);
      });
    });
  }

  async stop() {
    this.#stopHeartbeat();

    for (const session of [...this.sessions]) {
      this.#sendFrame(session, OP.CLOSE, Buffer.alloc(0));
      session.socket.destroy();
    }

    this.sessions.clear();
    this.bySocket.clear();
    this.clients.clear();

    const server = this.server;
    this.server = null;
    this.port = null;

    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }

  send(ids, code) {
    if (typeof code !== 'string' || !code.length) {
      throw new Error('The script is empty');
    }
    if (code.length > MAX_MESSAGE) {
      throw new Error('Script is too large for the bridge');
    }

    const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null;
    const targets = [...this.bySocket.values()].filter(
      (session) => session.client && (!wanted || wanted.has(session.id)),
    );

    if (!targets.length) {
      throw new Error(wanted ? 'Selected client is not connected' : 'No executor clients connected');
    }

    const payload = JSON.stringify({
      type: 'execute',
      id: `x${this.seq++}`,
      code,
      sentAt: logTime(),
    });

    for (const session of targets) this.#sendText(session, payload);
    return targets.length;
  }

  disconnect(id) {
    const session = [...this.bySocket.values()].find((item) => item.id === id);
    if (!session) return false;
    this.#retire(session);
    return true;
  }

  disconnectAll() {
    for (const session of [...this.bySocket.values()]) this.#retire(session);
  }

  #retire(session) {
    // Deliver the text frame first so the loader can retire itself, then close
    // the socket. Destroying immediately can race the executor's message event.
    this.#sendText(session, JSON.stringify({ type: 'disconnect' }));
    const timer = setTimeout(() => {
      if (!session.alive) return;
      this.#sendFrame(session, OP.CLOSE, Buffer.alloc(0));
      setTimeout(() => session.socket.destroy(), 120).unref?.();
    }, 400);
    timer.unref?.();
  }

  #upgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();

    if (!key || upgrade !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    socket.setNoDelay(true);

    const session = {
      socket,
      id: `c${this.seq++}`,
      client: null,
      connectedAt: logTime(),
      lastSeen: logTime(),
      buffer: Buffer.alloc(0),
      fragments: [],
      fragmentOpcode: null,
      fragmentSize: 0,
      alive: true,
      verified: false,
      verifyTimer: null,
    };

    this.sessions.add(session);
    this.bySocket.set(socket, session);

    socket.on('data', (chunk) => {
      if (!session.alive) return;
      session.lastSeen = logTime();
      session.buffer = Buffer.concat([session.buffer, chunk]);
      if (session.buffer.length > MAX_BUFFER) {
        this.#destroy(session, 1009);
        return;
      }
      this.#drain(session);
    });

    socket.on('error', () => this.#teardown(session));
    socket.on('close', () => this.#teardown(session));
    socket.on('end', () => this.#teardown(session));

    this.#sendText(session, JSON.stringify({ type: 'welcome', protocol: 1, id: session.id }));

    if (head && head.length) {
      session.buffer = Buffer.concat([session.buffer, head]);
      this.#drain(session);
    }
  }

  #drain(session) {
    while (session.alive) {
      const buf = session.buffer;
      if (buf.length < 2) return;

      const first = buf[0];
      const second = buf[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (first & 0x70) {
        this.#destroy(session, 1002);
        return;
      }

      if (length === 126) {
        if (buf.length < 4) return;
        length = buf.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buf.length < 10) return;
        const wide = buf.readBigUInt64BE(2);
        if (wide > BigInt(MAX_MESSAGE)) {
          this.#destroy(session, 1009);
          return;
        }
        length = Number(wide);
        offset = 10;
      }

      if (length > MAX_MESSAGE) {
        this.#destroy(session, 1009);
        return;
      }

      if (masked) {
        if (buf.length < offset + 4) return;
        offset += 4;
      }

      if (buf.length < offset + length) return;

      let payload = Buffer.from(buf.subarray(offset, offset + length));
      if (masked) {
        const maskStart = offset - 4;
        for (let i = 0; i < length; i += 1) {
          payload[i] ^= buf[maskStart + (i & 3)];
        }
      }

      session.buffer = buf.subarray(offset + length);

      if (opcode >= 0x8) {
        if (!fin || length > 125) {
          this.#destroy(session, 1002);
          return;
        }

        if (opcode === OP.CLOSE) {
          this.#sendFrame(session, OP.CLOSE, payload.subarray(0, 2));
          session.socket.end();
          this.#teardown(session);
          return;
        }
        if (opcode === OP.PING) {
          this.#sendFrame(session, OP.PONG, payload);
          continue;
        }
        // Pong and unknown control frames are ignored.
        continue;
      }

      if (opcode === OP.CONT) {
        if (!session.fragmentOpcode) {
          this.#destroy(session, 1002);
          return;
        }
        session.fragments.push(payload);
        session.fragmentSize += payload.length;
        if (session.fragmentSize > MAX_MESSAGE) {
          this.#destroy(session, 1009);
          return;
        }
        if (fin) {
          const full = Buffer.concat(session.fragments);
          const kind = session.fragmentOpcode;
          session.fragments = [];
          session.fragmentOpcode = null;
          session.fragmentSize = 0;
          if (kind === OP.TEXT) this.#onText(session, full.toString('utf8'));
        }
        continue;
      }

      if (opcode === OP.TEXT || opcode === OP.BINARY) {
        if (fin) {
          if (opcode === OP.TEXT) this.#onText(session, payload.toString('utf8'));
        } else {
          session.fragmentOpcode = opcode;
          session.fragments = [payload];
          session.fragmentSize = payload.length;
        }
        continue;
      }

      this.#destroy(session, 1002);
      return;
    }
  }

  #onText(session, text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;

    switch (message.type) {
      case 'hello': {
        const game = clampText(message.game, 80) || 'Unknown game';
        const player = clampText(message.player, 40) || 'Player';
        const meta = {
          id: session.id,
          game,
          placeId: Number(message.placeId) || 0,
          jobId: clampText(message.jobId, 64),
          player,
          displayName: clampText(message.displayName, 40) || player,
          executor: clampText(message.executor, 40) || 'Unknown',
          loader: Number(message.loader) || 1,
          connectedAt: session.connectedAt,
          verified: Boolean(session.verified),
          unresponsive: false,
        };

        const isNew = !session.client;
        session.client = meta;
        this.clients.set(session.id, meta);

        if (isNew) {
          this.emit('log', {
            level: 'system',
            source: game,
            clientId: session.id,
            message: `${player} connected from ${meta.executor}`,
            at: logTime(),
          });

          if (meta.loader < 2) {
            this.emit('log', {
              level: 'warn',
              source: game,
              clientId: session.id,
              message:
                'This client is running an older Aether loader. Re-run the loader from Connection settings.',
              at: logTime(),
            });
          }
        }

        this.emit('clients', this.listClients());

        // Ask for an immediate text pong. The loader answers from its message
        // handler, so this proves the execute channel is wired, not just the socket.
        this.#sendText(session, JSON.stringify({ type: 'ping' }));

        if (!session.verified) {
          if (session.verifyTimer) clearTimeout(session.verifyTimer);
          session.verifyTimer = setTimeout(() => {
            session.verifyTimer = null;
            if (!session.alive || session.verified || !session.client) return;
            session.client.unresponsive = true;
            this.emit('clients', this.listClients());
            this.emit('log', {
              level: 'error',
              source: session.client.game,
              clientId: session.id,
              message:
                'Client connected but is not answering bridge messages. Re-run the loader from Connection settings.',
              at: logTime(),
            });
          }, 10000);
          session.verifyTimer.unref?.();
        }
        break;
      }

      case 'log': {
        if (!session.client) return;
        const level = ['info', 'warn', 'error'].includes(message.level) ? message.level : 'info';
        this.emit('log', {
          level,
          source: session.client.game,
          clientId: session.id,
          message: clampText(message.message, 8000),
          at: logTime(),
        });
        break;
      }

      case 'result': {
        if (!session.client) return;
        const ok = message.ok !== false;
        this.emit('log', {
          level: ok ? 'success' : 'error',
          source: session.client.game,
          clientId: session.id,
          message: clampText(message.message, 8000) || (ok ? 'Finished' : 'Execution failed'),
          at: logTime(),
        });
        break;
      }

      case 'pong': {
        session.lastSeen = logTime();
        const wasVerified = session.verified;
        session.verified = true;
        if (session.client) {
          session.client.verified = true;
          session.client.unresponsive = false;
        }
        if (session.verifyTimer) {
          clearTimeout(session.verifyTimer);
          session.verifyTimer = null;
        }
        if (!wasVerified) this.emit('clients', this.listClients());
        break;
      }

      default:
        break;
    }
  }

  #sendText(session, text) {
    this.#sendFrame(session, OP.TEXT, Buffer.from(text, 'utf8'));
  }

  #sendFrame(session, opcode, payload) {
    if (!session.alive || session.socket.destroyed) return;
    try {
      session.socket.write(encodeFrame(opcode, payload));
    } catch {
      this.#destroy(session, 1011);
    }
  }

  #destroy(session, code) {
    if (!session.alive) return;
    const payload = Buffer.allocUnsafe(2);
    payload.writeUInt16BE(code, 0);
    this.#sendFrame(session, OP.CLOSE, payload);
    session.socket.destroy();
    this.#teardown(session);
  }

  #teardown(session) {
    if (!session.alive) return;
    session.alive = false;
    if (session.verifyTimer) {
      clearTimeout(session.verifyTimer);
      session.verifyTimer = null;
    }
    this.sessions.delete(session);
    this.bySocket.delete(session.socket);

    if (this.clients.has(session.id)) {
      const meta = this.clients.get(session.id);
      this.clients.delete(session.id);
      this.emit('log', {
        level: 'system',
        source: meta.game,
        clientId: session.id,
        message: `${meta.game} disconnected`,
        at: logTime(),
      });
      this.emit('clients', this.listClients());
    }
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      for (const session of [...this.sessions]) {
        if (!session.alive) continue;
        if (now - session.lastSeen > STALE_AFTER) {
          this.#destroy(session, 1000);
          continue;
        }
        this.#sendFrame(session, OP.PING, Buffer.alloc(0));
        if (session.client) {
          this.#sendText(session, JSON.stringify({ type: 'ping' }));
        }
      }
    }, 25000);
    this.heartbeat.unref?.();
  }

  #stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}

module.exports = { BridgeServer };
