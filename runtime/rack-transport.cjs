/*
 * MIT License
 *
 * Copyright (c) 2026 Nick7612
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Node adaptation of Rack's hostserver.cpp, gameclient.cpp, protocol.cpp/.h and
 * docs/PROTOCOL.md, pinned upstream 6383542887caa822296c883e72391adba86ca82c.
 * Uses node:net/EventEmitter instead of Qt sockets/signals. The upstream compact
 * JSON-object + LF framing, TCP port, snapshot/intent fields and ping/pong IDs
 * remain intact: application packets are NEVER wrapped in a LanServer envelope.
 *
 * TableBall deliberately uses app:'tableball', v:2 and a six-character room code
 * INSTEAD OF Omarchy/platform attestation. No attest/hostAttest is manufactured.
 * This fork does not claim wire compatibility with the original Omarchy gate.
 * Room codes are ASCII alphanumeric, case-insensitive (canonical uppercase).
 * Codes gate a local table; plain LAN TCP is not encryption or strong identity.
 *
 * Node-only hardening: numeric RFC1918/127/8 IPv4 only (except wildcard bind),
 * one authenticated guest, eight pending sockets, five-second authentication,
 * strict UTF-8, 16 KiB JSON lines (LF excluded), 64 KiB input/output queues,
 * 64-frame parsing slices, bounded graceful shutdown, safe unobserved errors.
 * State snapshots may be dropped when TCP is backlogged; reliable packets are
 * never silently dropped on queue overflow: that connection is disconnected.
 * Both ends proactively ping every five seconds; a matching pong is required
 * within fifteen seconds. Heartbeats and handshake frames stay internal.
 * There is no discovery, cloud, PeerJS, firewall manipulation or desktop access.
 *
 * API (all classes are EventEmitters):
 *   new RackServer({name='房主', code, rules=1, bind='0.0.0.0', port=46321})
 *     listen() -> Promise<{port, code, addresses:[{name,address}]}>
 *     send(packet) -> boolean; close() -> Promise<void>
 *     events: join({name}), message(packet), leave(reason), error(Error)
 *   new RackClient({address, port=46321, code, name='玩家'})
 *     connect() -> Promise<{t:'welcome',v:2,app:'tableball',player:1,rules,host}>
 *     connected -> boolean; send(packet) -> boolean; close() -> Promise<void>
 *     events: message(packet), leave(reason), error(Error)
 * Close is terminal/idempotent. Leave fires once for an authenticated session,
 * including local close; pending-handshake failures reject connect instead.
 * send returns true if accepted by TCP (not a delivery acknowledgement), false
 * if disconnected, invalid/oversized, or a disposable state frame was dropped.
 */
'use strict';

const net = require('node:net');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { timingSafeEqual } = require('node:crypto');
const { TextDecoder } = require('node:util');

const VERSION = 2;
const APP = 'tableball';
const MAX_LINE = 16384;
const MAX_BUFFER = MAX_LINE * 4;
const MAX_PENDING = 8;
const AUTH_MS = 5000;
const HEARTBEAT_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 15000;
const CLOSE_MS = 250;
const INTERNAL_HANDSHAKE = new Set(['hello', 'welcome']);
const decoder = new TextDecoder('utf-8', { fatal: true });

function isPrivateIPv4(address) {
  if (typeof address !== 'string' || !net.isIPv4(address)) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function localAddresses() {
  const addresses = [];
  const seen = new Set();
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if ((entry.family !== 'IPv4' && entry.family !== 4)
          || !isPrivateIPv4(entry.address) || seen.has(entry.address)) continue;
      seen.add(entry.address);
      addresses.push({ name, address: entry.address });
    }
  }
  if (!addresses.length) addresses.push({ name: 'loopback', address: '127.0.0.1' });
  return addresses.sort((a, b) => Number(a.address.startsWith('127.'))
    - Number(b.address.startsWith('127.')) || a.name.localeCompare(b.name)
    || a.address.localeCompare(b.address));
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  let result = '';
  for (const character of text) {
    if (result.length + character.length > 24) break;
    result += character;
  }
  return result;
}

function roomCode(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]{6}$/i.test(value)) {
    throw new TypeError('A six-character ASCII alphanumeric room code is required.');
  }
  return value.toUpperCase();
}

function portNumber(value, allowZero = false) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) {
    throw new TypeError('Invalid TCP port.');
  }
  return value;
}

function transportError(message, code = 'ERR_RACK_PROTOCOL') {
  return Object.assign(new Error(message), { code });
}

function safeError(owner, error) {
  // EventEmitter's special unhandled 'error' semantics must not crash the app.
  if (owner.listenerCount('error')) owner.emit('error', error);
}

function reasonText(value, fallback) {
  return typeof value === 'string'
    ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 200) || fallback
    : fallback;
}

function encode(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)
      || typeof packet.t !== 'string' || !packet.t.length || packet.t.length > 64) {
    throw transportError('A packet must be a JSON object with a nonempty t field.');
  }
  const json = JSON.stringify(packet);
  // Guard caller-supplied toJSON returning a primitive or injecting a new frame.
  if (typeof json !== 'string' || json[0] !== '{' || json.includes('\n')) {
    throw transportError('A packet must encode as one JSON object.');
  }
  if (Buffer.byteLength(json) > MAX_LINE) {
    throw transportError('Message exceeds the 16 KiB frame limit.', 'ERR_RACK_FRAME_SIZE');
  }
  return Buffer.from(json + '\n');
}

// One bounded stream reader/writer, shared by host and guest. No application queue.
class WirePeer {
  constructor(socket, callbacks) {
    this.socket = socket;
    this.callbacks = callbacks;
    this.authenticated = false;
    this.closing = false;
    this.buffer = Buffer.alloc(0);
    this.reason = 'The peer left the table.';
    this._ping = null;
    this._sequence = 0;
    this._reportedError = false;
    this.closed = new Promise(resolve => { this._resolveClosed = resolve; });
    socket.setNoDelay(true);
    socket.on('data', chunk => this._receive(chunk));
    socket.on('error', error => this.fail(error.message, error.code, true));
    socket.on('end', () => this.shutdown('The peer left the table.'));
    socket.on('close', () => this._closed());
    this._authTimer = setTimeout(() => {
      this.fail('Authentication timed out.', 'ERR_RACK_AUTH_TIMEOUT');
    }, AUTH_MS);
    this._authTimer.unref();
  }

  authenticate() {
    this.authenticated = true;
    clearTimeout(this._authTimer);
    this._heartbeatTimer = setInterval(() => this._tickHeartbeat(), HEARTBEAT_MS);
    this._heartbeatTimer.unref();
  }

  _tickHeartbeat() {
    if (this.closing) return;
    if (this._ping) {
      if (Date.now() - this._ping.sent >= HEARTBEAT_TIMEOUT_MS) {
        this.fail('Heartbeat timed out.', 'ERR_RACK_HEARTBEAT_TIMEOUT');
      }
      return;
    }
    const id = ++this._sequence;
    if (this.send({ t: 'ping', id })) this._ping = { id, sent: Date.now() };
  }

  control(packet) {
    if (packet.t === 'ping') {
      this.send({ t: 'pong', id: packet.id === undefined ? null : packet.id });
      return true;
    }
    if (packet.t === 'pong') {
      if (this._ping && packet.id === this._ping.id) this._ping = null;
      return true;
    }
    if (packet.t === 'leave') {
      this.shutdown(reasonText(packet.reason, 'The peer left the table.'));
      return true;
    }
    return false;
  }

  _receive(chunk) {
    if (this.closing) return;
    if (chunk.length + this.buffer.length > MAX_BUFFER) {
      this.fail('Receive buffer exceeds 64 KiB.', 'ERR_RACK_BUFFER_SIZE');
      return;
    }
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    this._drain();
  }

  _drain() {
    if (this.closing) return;
    let count = 0;
    while (count++ < 64 && !this.closing) {
      const newline = this.buffer.indexOf(10);
      if (newline < 0) break;
      if (newline > MAX_LINE) {
        this.fail('Message exceeds the 16 KiB frame limit.', 'ERR_RACK_FRAME_SIZE');
        return;
      }
      const bytes = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      let packet;
      try {
        const line = decoder.decode(bytes);
        if (!line.trim()) continue; // Upstream tolerates empty/whitespace lines.
        packet = JSON.parse(line);
        if (!packet || typeof packet !== 'object' || Array.isArray(packet)
            || typeof packet.t !== 'string' || !packet.t.length || packet.t.length > 64) {
          throw new Error('Not a protocol object.');
        }
      } catch {
        this.fail('Malformed message.', 'ERR_RACK_MALFORMED');
        return;
      }
      this.callbacks.packet(packet);
    }
    if (this.closing) return;
    const newline = this.buffer.indexOf(10);
    if ((newline < 0 && this.buffer.length > MAX_LINE) || newline > MAX_LINE) {
      this.fail('Message exceeds the 16 KiB frame limit.', 'ERR_RACK_FRAME_SIZE');
    } else if (newline >= 0) {
      // Pause the stream and yield: a 64 KiB batch cannot monopolize parsing.
      this.socket.pause();
      this._parseImmediate = setImmediate(() => {
        this._parseImmediate = null;
        this._drain();
        if (!this.closing && !this._parseImmediate) this.socket.resume();
      });
    }
  }

  send(packet) {
    if (this.closing || this.socket.destroyed || !this.socket.writable) return false;
    let frame;
    try {
      frame = encode(packet);
    } catch (error) {
      this.callbacks.error(error);
      return false;
    }
    const queued = this.socket.writableLength;
    if (packet.t === 'state' && (this.socket.writableNeedDrain || queued >= MAX_LINE
        || queued + frame.length > MAX_BUFFER)) return false;
    if (queued + frame.length > MAX_BUFFER) {
      this.fail('Reliable TCP backlog exceeds 64 KiB.', 'ERR_RACK_BACKLOG', true);
      return false;
    }
    try {
      // A false write() means accepted-but-backpressured, not a lost control.
      this.socket.write(frame);
      return true;
    } catch (error) {
      this.fail(error.message, error.code, true);
      return false;
    }
  }

  fail(reason, code, abort = false) {
    if (this.closing) return;
    const error = transportError(reason, code);
    if (!this._reportedError) {
      this._reportedError = true;
      this.callbacks.error(error);
    }
    this.shutdown(reason, this.callbacks.rejectFailures ? { t: 'reject', reason } : null, abort);
  }

  shutdown(reason, packet = null, abort = false) {
    if (this.closing) return this.closed;
    this.closing = true;
    this.reason = reason;
    this._clearWork();
    if (abort || this.socket.destroyed) {
      this.socket.destroy();
      return this.closed;
    }
    let frame;
    try { if (packet) frame = encode(packet); } catch { /* Closing must not throw. */ }
    if (frame && this.socket.writableLength + frame.length > MAX_BUFFER) {
      this.socket.destroy();
      return this.closed;
    }
    try { this.socket.end(frame); } catch { this.socket.destroy(); }
    this._closeTimer = setTimeout(() => this.socket.destroy(), CLOSE_MS);
    this._closeTimer.unref();
    return this.closed;
  }

  _clearWork() {
    clearTimeout(this._authTimer);
    clearInterval(this._heartbeatTimer);
    clearImmediate(this._parseImmediate);
    this._parseImmediate = null;
    this.buffer = Buffer.alloc(0);
    this._ping = null;
  }

  _closed() {
    this.closing = true;
    this._clearWork();
    clearTimeout(this._closeTimer);
    this._resolveClosed();
    this.callbacks.closed(this.reason);
  }
}

class RackServer extends EventEmitter {
  constructor({ name = '房主', code, rules = 1, bind = '0.0.0.0', port = 46321 } = {}) {
    super();
    this.name = cleanName(name) || '房主';
    this.code = roomCode(code);
    if (rules !== 0 && rules !== 1) throw new TypeError('Rules must be 0 (8-ball) or 1 (9-ball).');
    if (bind !== '0.0.0.0' && !isPrivateIPv4(bind)) {
      throw new TypeError('Bind must be a private/loopback numeric IPv4 or 0.0.0.0.');
    }
    this.rules = rules;
    this.bind = bind;
    this.port = portNumber(port, true);
    this._pending = new Set();
    this._peers = new Set();
    this._guest = null;
    this._closed = false;
    this._server = net.createServer(socket => this._accept(socket));
    // The kernel backlog and accepted socket count are bounded independently.
    this._server.maxConnections = MAX_PENDING + 1;
    this._server.on('error', error => safeError(this, error));
  }

  async listen() {
    if (this._closed) throw transportError('Server is closed.', 'ERR_RACK_CLOSED');
    if (!this._listenPromise) {
      this._listenPromise = new Promise((resolve, reject) => {
        const failed = error => {
          this._server.removeListener('listening', listening);
          reject(error);
        };
        const listening = () => {
          this._server.removeListener('error', failed);
          if (this._closed) {
            reject(transportError('Server is closed.', 'ERR_RACK_CLOSED'));
            return;
          }
          this.port = this._server.address().port;
          let addresses = localAddresses();
          if (this.bind !== '0.0.0.0') {
            addresses = addresses.filter(entry => entry.address === this.bind);
            if (!addresses.length) addresses = [{ name: 'bind', address: this.bind }];
          }
          resolve({ port: this.port, code: this.code, addresses });
        };
        this._server.once('error', failed);
        this._server.once('listening', listening);
        try {
          this._server.listen({ host: this.bind, port: this.port, backlog: MAX_PENDING });
        } catch (error) {
          this._server.removeListener('error', failed);
          failed(error);
          safeError(this, error);
        }
      });
    }
    return this._listenPromise;
  }

  _accept(socket) {
    const peer = new WirePeer(socket, {
      rejectFailures: true,
      packet: packet => this._packet(peer, packet),
      error: error => safeError(this, error),
      closed: reason => {
        this._pending.delete(peer);
        this._peers.delete(peer);
        if (this._guest === peer) {
          this._guest = null;
          this.emit('leave', reason);
        }
      }
    });
    this._peers.add(peer);
    if (this._closed) { peer.shutdown('Server is closed.', null, true); return; }
    if (!isPrivateIPv4(socket.remoteAddress)) {
      peer.fail('Only private/loopback numeric IPv4 peers are allowed.', 'ERR_RACK_ADDRESS');
    } else if (this._guest) {
      peer.shutdown('This table is full.', { t: 'reject', reason: 'This table is full.' });
    } else if (this._pending.size >= MAX_PENDING) {
      peer.shutdown('Too many pending connections.', { t: 'reject', reason: 'Too many pending connections.' });
    } else {
      this._pending.add(peer);
    }
  }

  _packet(peer, packet) {
    if (!peer.authenticated) {
      if (packet.t !== 'hello' || packet.v !== VERSION) {
        peer.fail('This table speaks a different TableBall protocol.', 'ERR_RACK_VERSION');
        return;
      }
      if (packet.app !== APP) {
        peer.fail('This is not a TableBall application handshake.', 'ERR_RACK_APP');
        return;
      }
      let code;
      try { code = roomCode(packet.code); } catch { /* Rejected below. */ }
      if (!code || !timingSafeEqual(Buffer.from(code), Buffer.from(this.code))) {
        peer.fail('Room code does not match.', 'ERR_RACK_AUTH');
        return;
      }
      const name = cleanName(packet.name);
      if (!name) { peer.fail('A player name is required.', 'ERR_RACK_NAME'); return; }
      if (this._guest) { peer.fail('This table is full.', 'ERR_RACK_FULL'); return; }
      this._pending.delete(peer);
      this._guest = peer; // Claim the single slot before another hello can run.
      if (!peer.send({ t: 'welcome', v: VERSION, app: APP, player: 1, rules: this.rules, host: this.name })) return;
      peer.authenticate();
      this.emit('join', { name });
      return;
    }
    if (INTERNAL_HANDSHAKE.has(packet.t)) {
      peer.fail('Unexpected duplicate handshake.', 'ERR_RACK_PROTOCOL');
    } else if (!peer.control(packet)) {
      this.emit('message', packet);
    }
  }

  send(packet) {
    return !!(this._guest && this._guest.authenticated && this._guest.send(packet));
  }

  close() {
    if (this._closePromise) return this._closePromise;
    this._closed = true;
    const peers = [...this._peers].map(peer => peer.shutdown('Host closed the table.',
      peer.authenticated ? { t: 'leave', reason: 'Host closed the table.' } : null));
    this._closePromise = (async () => {
      if (this._listenPromise) await this._listenPromise.catch(() => {});
      const stopped = new Promise(resolve => {
        if (this._server.listening) this._server.close(resolve);
        else resolve();
      });
      await Promise.all([...peers, stopped]);
    })();
    return this._closePromise;
  }
}

class RackClient extends EventEmitter {
  constructor({ address, port = 46321, code, name = '玩家' } = {}) {
    super();
    this.address = address;
    this.port = portNumber(port);
    this.code = roomCode(code);
    this.name = cleanName(name) || '玩家';
    this._peer = null;
    this._closed = false;
  }

  get connected() {
    return !!(this._peer && this._peer.authenticated && !this._peer.closing
      && !this._peer.socket.destroyed);
  }

  async connect() {
    if (this._closed) throw transportError('Client is closed.', 'ERR_RACK_CLOSED');
    if (this._connectPromise) return this._connectPromise;
    // Validate BEFORE net.connect: no DNS resolution, IPv6 or public connection.
    if (!isPrivateIPv4(this.address)) {
      const error = transportError('Address must be a private/loopback numeric IPv4.', 'ERR_RACK_ADDRESS');
      safeError(this, error);
      throw error;
    }
    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const failConnect = error => { if (!settled) { settled = true; reject(error); } };
      const socket = new net.Socket();
      const peer = new WirePeer(socket, {
        packet: packet => {
          if (!peer.authenticated) {
            if (packet.t === 'reject') {
              peer.fail(reasonText(packet.reason, 'The host refused the connection.'), 'ERR_RACK_REJECTED');
              return;
            }
            if (packet.t !== 'welcome' || packet.v !== VERSION || packet.app !== APP
                || packet.player !== 1 || (packet.rules !== 0 && packet.rules !== 1)
                || !cleanName(packet.host)) {
              peer.fail('Invalid TableBall welcome handshake.', 'ERR_RACK_HANDSHAKE');
              return;
            }
            peer.authenticate();
            this._welcome = { t: 'welcome', v: VERSION, app: APP, player: 1,
              rules: packet.rules, host: cleanName(packet.host) };
            settled = true;
            resolve(this._welcome);
          } else if (INTERNAL_HANDSHAKE.has(packet.t)) {
            peer.fail('Unexpected duplicate handshake.', 'ERR_RACK_PROTOCOL');
          } else if (packet.t === 'reject') {
            peer.fail(reasonText(packet.reason, 'The host refused the connection.'), 'ERR_RACK_REJECTED');
          } else if (!peer.control(packet)) {
            this.emit('message', packet);
          }
        },
        error: error => {
          failConnect(error);
          safeError(this, error);
        },
        closed: reason => {
          this._closed = true; // A disconnected instance must not return a stale welcome.
          failConnect(transportError(reason, 'ERR_RACK_CLOSED'));
          if (peer.authenticated) this.emit('leave', reason);
        }
      });
      this._peer = peer;
      socket.once('connect', () => {
        if (!peer.closing) peer.send({ t: 'hello', v: VERSION, app: APP, name: this.name, code: this.code });
      });
      try { socket.connect({ host: this.address, port: this.port, family: 4 }); }
      catch (error) { peer.fail(error.message, error.code, true); }
    });
    return this._connectPromise;
  }

  send(packet) {
    return this.connected ? this._peer.send(packet) : false;
  }

  close() {
    if (this._closePromise) return this._closePromise;
    this._closed = true;
    this._closePromise = this._peer
      ? this._peer.shutdown('Guest left the table.',
        this._peer.authenticated ? { t: 'leave', reason: 'Guest left the table.' } : null)
      : Promise.resolve();
    return this._closePromise;
  }
}

module.exports = { RackServer, RackClient, VERSION, MAX_LINE, isPrivateIPv4, localAddresses };
