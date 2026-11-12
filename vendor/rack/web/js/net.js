// Online rooms over WebRTC. PeerJS supplies the tiny signalling step through
// its public broker; once the two browsers meet, all game traffic is direct.
// The host owns the table and streams snapshots, so both players see the same
// shot. No account, no server to deploy, and nothing to install.

import { peerIdForRoom } from './room.js';

const PROTOCOL = 1;
const CONNECT_TIMEOUT = 20000;

function friendlyError(type) {
    switch (type) {
        case 'peer-unavailable':
            return 'That room was not found. Check the code and try again.';
        case 'unavailable-id':
            return 'That room code is already in use.';
        case 'network':
        case 'socket-error':
        case 'socket-closed':
        case 'server-error':
            return 'Could not reach the room service. Check your connection and try again.';
        case 'browser-incompatible':
            return 'This browser cannot do WebRTC. Try Chrome, Edge, Firefox, or Safari.';
        case 'ssl-unavailable':
            return 'Online rooms need a secure HTTPS page.';
        default:
            return 'The room connection failed. Please try again.';
    }
}

export class OnlineSession {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.role = null;
        this.code = '';
        this.name = '';
        this.rules = 0;
        this.connected = false;
        this.closed = false;
        this.helloSent = false;
        this.guestName = '';
        this.lastStateAt = 0;
        this.timeout = null;
        this.handlers = {
            status: () => {},
            error: () => {},
            roomTaken: () => {},
            roomNotFound: () => {},
            hello: () => {},
            welcome: () => {},
            state: () => {},
            shot: () => {},
            place: () => {},
            rematch: () => {},
            left: () => {},
        };
    }

    host({ code, name, rules }) {
        this.role = 'host';
        this.code = code;
        this.name = name;
        this.rules = rules;
        this._createPeer(peerIdForRoom(code));
        this.handlers.status('hosting');
    }

    join({ code, name }) {
        this.role = 'guest';
        this.code = code;
        this.name = name;
        this._createPeer(undefined);
        this.handlers.status('joining');
        this.timeout = setTimeout(() => {
            if (!this.connected && !this.closed) {
                this.handlers.error('That room did not answer. Check the code and try again.');
                this.close(false);
            }
        }, CONNECT_TIMEOUT);
    }

    _createPeer(id) {
        if (typeof window === 'undefined' || typeof window.Peer !== 'function') {
            this.handlers.error('Online play needs an internet connection the first time it loads.');
            return;
        }

        this.peer = new window.Peer(id, { debug: 0 });

        this.peer.on('open', () => {
            if (this.role === 'guest') {
                const conn = this.peer.connect(peerIdForRoom(this.code), {
                    reliable: true,
                    serialization: 'json',
                });
                this._attach(conn);
            }
        });

        this.peer.on('connection', (conn) => {
            if (this.role !== 'host' || this.conn)
                return;
            this._attach(conn);
        });

        this.peer.on('error', (error) => {
            if (this.closed)
                return;
            const type = error && error.type;
            if (type === 'unavailable-id' && this.role === 'host') {
                this.handlers.roomTaken();
                return;
            }
            if (type === 'peer-unavailable' && this.role === 'guest') {
                this.handlers.roomNotFound();
                this.close(false);
                return;
            }
            this.handlers.error(friendlyError(type));
        });

        this.peer.on('disconnected', () => {
            if (!this.closed)
                this.peer.reconnect();
        });
    }

    _attach(conn) {
        if (!conn || this.conn === conn)
            return;
        if (this.conn) {
            conn.close();
            return;
        }

        this.conn = conn;

        const opened = () => {
            if (this.closed)
                return;
            this.connected = true;
            clearTimeout(this.timeout);
            this.handlers.status('connected');
            if (this.role === 'guest' && !this.helloSent) {
                this.helloSent = true;
                this._send({ t: 'hello', v: PROTOCOL, name: this.name });
            }
        };

        if (conn.open)
            opened();
        else
            conn.on('open', opened);

        conn.on('data', (data) => this._receive(data));
        conn.on('close', () => {
            if (!this.closed) {
                this.closed = true;
                this.connected = false;
                this.handlers.left();
            }
        });
        conn.on('error', () => {
            if (!this.closed)
                this.handlers.error('The room connection was interrupted.');
        });
    }

    async _receive(data) {
        let message = data;
        try {
            if (typeof data === 'string')
                message = JSON.parse(data);
            else if (data instanceof ArrayBuffer)
                message = JSON.parse(new TextDecoder().decode(data));
            else if (typeof Blob !== 'undefined' && data instanceof Blob)
                message = JSON.parse(await data.text());
        } catch {
            return;
        }

        if (!message || message.v !== PROTOCOL)
            return;

        switch (message.t) {
            case 'hello':
                if (this.role !== 'host')
                    return;
                this.guestName = String(message.name || 'Player 2').slice(0, 20);
                this.handlers.hello(this.guestName);
                break;
            case 'welcome':
            case 'state':
                if (this.role !== 'guest' || !message.snapshot)
                    return;
                if (message.t === 'welcome')
                    this.handlers.welcome(message.snapshot);
                else
                    this.handlers.state(message.snapshot);
                break;
            case 'shot':
                if (this.role !== 'host')
                    return;
                if (Number.isFinite(message.angle) && Number.isFinite(message.power))
                    this.handlers.shot(message.angle, message.power);
                break;
            case 'place':
                if (this.role !== 'host')
                    return;
                if (Number.isFinite(message.x) && Number.isFinite(message.y))
                    this.handlers.place(message.x, message.y);
                break;
            case 'rematch':
                if (this.role === 'host')
                    this.handlers.rematch();
                break;
            case 'bye':
                if (!this.closed) {
                    this.closed = true;
                    this.connected = false;
                    this._destroy();
                    this.handlers.left();
                }
                break;
            default:
                break;
        }
    }

    _send(message) {
        if (!this.conn || !this.connected || this.closed)
            return false;
        try {
            this.conn.send(JSON.stringify({ v: PROTOCOL, ...message }));
            return true;
        } catch {
            return false;
        }
    }

    sendWelcome(snapshot) {
        return this._send({ t: 'welcome', snapshot });
    }

    sendState(snapshot, force = false) {
        if (this.role !== 'host')
            return false;
        const now = performance.now();
        if (!force && now - this.lastStateAt < 33)
            return false;
        this.lastStateAt = now;
        return this._send({ t: 'state', snapshot });
    }

    sendShot(angle, power) {
        return this._send({ t: 'shot', angle, power });
    }

    sendPlace(x, y) {
        return this._send({ t: 'place', x, y });
    }

    requestRematch() {
        return this._send({ t: 'rematch' });
    }

    close(notify = true) {
        if (this.closed) {
            this._destroy();
            return;
        }
        clearTimeout(this.timeout);
        // Say goodbye before marking the session closed, because _send
        // refuses to write once the session is shutting down.
        if (notify && this.conn && this.connected) {
            try {
                this.conn.send(JSON.stringify({ v: PROTOCOL, t: 'bye' }));
            } catch {
                // The other side may already be gone.
            }
        }
        this.closed = true;
        this.connected = false;
        this._destroy();
    }

    _destroy() {
        clearTimeout(this.timeout);
        try {
            if (this.conn)
                this.conn.close();
        } catch {
            // The data channel may already be gone.
        }
        try {
            if (this.peer)
                this.peer.destroy();
        } catch {
            // PeerJS tears down sockets asynchronously.
        }
        this.conn = null;
        this.peer = null;
    }
}
