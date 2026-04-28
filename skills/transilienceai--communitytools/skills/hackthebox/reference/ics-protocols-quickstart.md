# ICS / SCADA / OT Protocol Testing Quickstart

HTB ICS challenges run small simulated plants (reactors, water treatment, factories) with one of the standard OT/SCADA protocols. The flag is usually broadcast as part of a "shutdown" / "alarm" / "meltdown" event that the operator triggers by adversely manipulating actuators or violating safety thresholds.

## Protocol identification (ports + DNA)

| Protocol | Port(s) | Library | DNA in source/Dockerfile |
|---------|---------|---------|--------------------------|
| Modbus TCP | 502 | `pymodbus` | `from pymodbus.server.sync import StartTcpServer` |
| Siemens S7 | 102 | `python-snap7` | `import snap7` |
| DNP3 | 20000 | `pydnp3`, `opendnp3` | `from pydnp3 import opendnp3` |
| EtherNet/IP / CIP | 44818 (TCP) + 2222 (UDP) | `cpppo` | `from cpppo.server.enip` |
| OPC-UA | 4840 (typical) | `opcua` (FreeOpcUa) / `asyncua` | `from opcua import Server` / `from asyncua import Server` |
| MQTT | 1883 / 8883 (TLS) | `paho-mqtt` | `from paho.mqtt import client` |
| BACnet | 47808 (UDP) | `bacpypes` | `from bacpypes` |

## Generic attack flow

1. **Read source first**. Identify protocol, security policy, and which variables are *writable from outside*. Almost always one role (Anonymous / public broker / unauth Modbus) has write access to a "safety" register that the simulator's control loop tries to keep stable.
2. **Enumerate writable nodes / coils / topics**. Use the protocol's discovery / browse / SUBSCRIBE feature.
3. **Identify safety thresholds**. The challenge usually models a physical system (temperature, pressure, fluid level) with a control loop that tries to keep readings inside a range. The flag is broadcast when a threshold is breached.
4. **Override the control loop**. Single-shot writes are typically reset within ~1s by the plant model. Need a *sustained write loop* (every 100-500ms) to overpower the controller.
5. **Listen for the flag broadcast**. The flag often appears in a single update message at the moment of the failure event — a parallel listener (Socket.IO, WebSocket, MQTT subscribe, or repeated reads) is required because the broadcast is brief.

## OPC-UA specific gotchas

- Servers often advertise `Basic256Sha256` + `SignAndEncrypt` security policies (looks secure) but accept *any self-signed client cert* (no trust list). Generate a fresh cert with `openssl` or `opcua.crypto.uacrypto.generate_self_signed_cert()` and connect.
- Anonymous identity is frequently allowed *and* given UAL=3 (write) on namespaces it shouldn't have. Browse `Objects` and `WriteValue` on each variable; permission errors come back synchronously.
- `asyncua` and `opcua` both work; `asyncua` is more responsive for the sustained-write loop pattern.

## Modbus specific gotchas

- Holding Registers (function code 03/06/16) and Coils (01/05/15) are usually unauth-writable.
- Some challenges add a *fake* authentication layer in a wrapper protocol — bypass by speaking raw Modbus directly to the underlying port.
- Some sims have multiple slave IDs; enumerate slave_id 1..255 with `read_holding_registers` and pick the one that returns valid data.

## Past solves
- HTB **Dressrosa Reactor** (id=1117, Hard, 60pts) — FreeOpcUa OPC-UA server with empty trust list + Anonymous-write to namespace `main`. Generated self-signed RSA-2048 client cert, browsed `Objects` to enumerate writable safety actuators (control rods, coolant pumps, ECCS, SCRAM), ran sustained 400ms write loop while a parallel WebSocket listener captured the flag broadcast in `reactor_update`. Core temp 325→451°C, pressure 16→22.6 MPa over 30s.

## Anti-patterns
- Don't try to "exploit" the authentication if the source clearly shows Anonymous=write — the lesson is **the policy itself**, not bypass.
- Don't single-shot writes — the simulator will revert them; you need sustained pressure on the actuators.
- Don't ignore parallel broadcast channels (Socket.IO, MQTT, WebSocket); the flag often shows up there, not in the protocol response.
