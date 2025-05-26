# Gate Control Project

This project consists of two main components:
- **gate-remote**: A Raspberry Pi service that controls physical gate operations via GPIO
- **gate-client**: A command-line client to send control commands to the gate service

## Components

### Gate Remote
The remote service runs on a Raspberry Pi and provides HTTP endpoints for controlling various gate functions:
- Full open/close
- Pedestrian access
- Left/right individual gate control

### Gate Client
A CLI tool to securely send commands to the gate remote service.

## Installation

### Gate Remote (Raspberry Pi)
1. Generate API secret:
```bash
cd gate-remote
go run scripts/genkey.go > deploy/gate.env
```

2. Set up SSH access to Raspberry Pi:
```bash
./setup-ssh.ps1
```

3. Deploy to Raspberry Pi:
```bash
make build
make deploy
```

4. Install service on Raspberry Pi:
```bash
sudo mkdir /etc/gate
sudo cp deploy/gate.env /etc/gate/
sudo cp deploy/gate.service /etc/systemd/system/
sudo systemctl enable gate
sudo systemctl start gate
```

### Gate Client (Control Machine)
1. Set required environment variables:
```powershell
cd gate-client
.\scripts\set-env.ps1
```

## Usage

### Using the Client
```bash
# Open gate fully
gate-client --action full

# Open for pedestrian access
gate-client --action pedestrian

# Control individual gates
gate-client --action left
gate-client --action right
```

## Security
The system uses HMAC-based authentication with timestamped requests to prevent replay attacks. All commands require a valid API secret to be configured.

## Development
- Build gate-remote for Windows: `make build-windows`
- Build gate-remote for Raspberry Pi: `make build`
- Client can be built using standard Go tools

## Circuit board
Designed using https://github.com/bancika/diy-layout-creator
File remote-board-layout.diy

## License
[MIT](https://choosealicense.com/licenses/mit/)