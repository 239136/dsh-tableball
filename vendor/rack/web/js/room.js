// Room codes for online play. Codes avoid characters that are easy to
// confuse when read aloud or typed on a phone.

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_LENGTH = 6;

function randomBytes(length) {
    const bytes = new Uint8Array(length);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < length; i += 1)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}

export function randomRoomCode() {
    const bytes = randomBytes(ROOM_LENGTH);
    let code = '';
    for (let i = 0; i < ROOM_LENGTH; i += 1)
        code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
    return code;
}

export function normalizeRoomCode(value) {
    const text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return text.slice(0, ROOM_LENGTH);
}

export function isValidRoomCode(value) {
    const code = normalizeRoomCode(value);
    return code.length === ROOM_LENGTH
        && [...code].every((character) => ROOM_ALPHABET.includes(character));
}

export function formatRoomCode(value) {
    const code = normalizeRoomCode(value);
    return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

// A single peer ID namespace keeps Rack rooms from colliding with other
// PeerJS applications on the public broker.
export function peerIdForRoom(code) {
    return `rackv1${normalizeRoomCode(code)}`;
}
