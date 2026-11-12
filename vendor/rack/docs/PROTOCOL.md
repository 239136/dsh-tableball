# Network protocol

Rack is host-authoritative. The host runs the physics and rules; guests send
intent and render the snapshots they receive. Everything is newline-delimited
JSON over TCP.

| Purpose | Transport | Port |
| --- | --- | --- |
| Match traffic | TCP | 46321 |
| LAN discovery | UDP broadcast | 46322 |

Both ports are fixed so that a direct address is just `host` or
`host:46321`. A host listens on all interfaces; a guest connects to one.

## Attestation

The Omarchy gate is part of the handshake, not a separate service. Every
player sends the same object in `hello` and receives the host's in `welcome`:

```json
{
  "id": "omarchy",
  "version": "4.5.0",
  "build": "4.5.0",
  "hyprland": true,
  "hyprlandVersion": "0.56.2",
  "hash": "64 lowercase hex characters",
  "ok": true
}
```

`hash` is a SHA-256 over the local `/etc/os-release`, the Omarchy version
file, and the literal `rack-omarchy-v1`. A host checks that the guest reports
`id == "omarchy"`, a non-empty version, `hyprland == true`, and a well-formed
hash. This is a community gate, not tamper-proof DRM: the source is open, so
a determined user can fake the fields. It keeps normal tables honest.

## Lines

Every message is one compact JSON object followed by `\n`. A line may not
exceed 16 KiB; a peer that sends more is disconnected. Unknown `t` values are
ignored, which leaves room for future message types.

The first line from a guest **must** be `hello`. Anything else, or a
mismatched version, is rejected.

### Guest to host

```json
{"t":"hello","v":1,"name":"Nick","attest":{...}}
{"t":"ready","ready":true}
{"t":"shoot","angle":0.42,"power":0.75}
{"t":"place","x":1.5,"y":0.8}
{"t":"aim","angle":0.42}
{"t":"chat","text":"nice shot"}
{"t":"rematch"}
{"t":"ping","id":7}
{"t":"leave"}
```

- `shoot` uses radians for `angle` and `0..1` for `power`.
- `place` uses table coordinates in metres (see `physics.h`).
- `aim` is a live preview of the guest's cue direction so the host can draw
  the remote cue. It is not authoritative and fades after inactivity.
- `chat` text is truncated to 400 characters.

### Host to guest

```json
{"t":"welcome","v":1,"player":1,"rules":0,"host":"Nick","hostAttest":{...}}
{"t":"reject","reason":"This table is full."}
{"t":"lobby","players":[...],"rules":0}
{"t":"start","snapshot":{...}}
{"t":"state","snapshot":{...}}
{"t":"shot","by":1,"angle":0.42,"power":0.75}
{"t":"aim","from":0,"angle":0.42}
{"t":"chat","from":0,"name":"Nick","text":"nice shot"}
{"t":"rematch","from":1}
{"t":"pong","id":7}
```

`welcome` assigns the guest player index `1` and reports the host's rules
choice. `lobby` carries:

```json
[
  {"name":"Nick","host":true,"you":false,"ready":true,"omarchy":"4.5.0"},
  {"name":"Sam","host":false,"you":true,"ready":true,"omarchy":"4.5.0"}
]
```

`start` is sent once when the host begins the match. `state` is sent after any
frame in which the table changed. The snapshot is the entire visible state, so
a guest never needs to simulate physics or reconcile deltas:

```json
{
  "rules": 0,
  "phase": 0,
  "current": 0,
  "group0": 0,
  "group1": 0,
  "winner": -1,
  "message": "Nick breaks.",
  "remaining0": 7,
  "remaining1": 7,
  "target": -1,
  "breaking": true,
  "names": ["Nick", "Sam"],
  "balls": [
    {"i":0,"x":0.635,"y":0.635,"a":true},
    {"i":1,"x":1.905,"y":0.635,"a":true}
  ],
  "cue": [0.635, 0.635]
}
```

- `phase`: `0` aiming, `1` rolling, `2` ball in hand, `3` finished.
- `rules`: `0` 8-ball, `1` 9-ball.
- `i`: ball id; `0` is the cue ball, `8` and `9` are the money balls.
- `a`: whether the ball is still on the table.
- `cue`: the ball-in-hand ghost position.

The host's `shot`/`aim`/`chat`/`rematch` broadcasts include their own `from` /
`by` as `0`; the guest's outbound copies do not need the field. `pong` echoes
the guest's `id` so keep-alive logic can match replies.

## Discovery

A host broadcasts this datagram every two seconds to
`255.255.255.255:46322` and to each interface's broadcast address:

```json
{"rack":1,"name":"Nick","port":46321,"rules":0,"status":"open"}
```

A guest listens on `46322` and adds any entry whose `rack` is `1` and whose
sender is not itself. Entries disappear after roughly six seconds without an
announcement. `status` is `open`, `in a match`, or `full`, which the Join
screen shows as the table's availability.

Discovery is best-effort. Networks that block broadcast still work by typing
`host` or `host:port` into the direct address field; the TCP protocol is
identical.

## Versioning

`Protocol::Version` is `1`. Both sides send it in the handshake and a host
rejects a different version with
`{"t":"reject","reason":"This table speaks a different Rack protocol."}`.
Any incompatible change to a field's meaning must bump the constant.
