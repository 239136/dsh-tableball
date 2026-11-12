import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ROOM_ALPHABET, ROOM_LENGTH, randomRoomCode, normalizeRoomCode,
    isValidRoomCode, formatRoomCode, peerIdForRoom,
} from '../js/room.js';

test('random room codes are short and unambiguous', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
        const code = randomRoomCode();
        assert.equal(code.length, ROOM_LENGTH);
        for (const character of code)
            assert.ok(ROOM_ALPHABET.includes(character));
        seen.add(code);
    }
    assert.ok(seen.size > 180, 'codes should be random');
});

test('room codes normalize what people type', () => {
    assert.equal(normalizeRoomCode(' ab-c 23 '), 'ABC23');
    assert.equal(normalizeRoomCode('abcdef'), 'ABCDEF');
    assert.equal(normalizeRoomCode('ABC123'), 'ABC123');
});

test('room codes validate', () => {
    assert.equal(isValidRoomCode('ABC234'), true);
    assert.equal(isValidRoomCode('abc 234'), true);
    assert.equal(isValidRoomCode('ABC23'), false);
    assert.equal(isValidRoomCode('ABC23O'), false); // O is not in the alphabet
    assert.equal(isValidRoomCode(''), false);
});

test('room codes format for display', () => {
    assert.equal(formatRoomCode('ABC234'), 'ABC 234');
    assert.equal(formatRoomCode('abc 234'), 'ABC 234');
    assert.equal(formatRoomCode('AB'), 'AB');
});

test('peer ids are namespaced by room', () => {
    assert.equal(peerIdForRoom('ABC234'), 'rackv1ABC234');
    assert.equal(peerIdForRoom('abc 234'), 'rackv1ABC234');
});
