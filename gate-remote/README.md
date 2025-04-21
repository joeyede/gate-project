# Gate Remote Control

GPIO-based gate control system for Raspberry Pi.

## Setup

1. Generate API secret:
```bash
go run scripts/genkey.go > deploy/gate.env
```

2. Deploy to Raspberry Pi:
```bash
make build
make deploy
```

3. Install service:
```bash
# On Raspberry Pi
sudo mkdir /etc/gate
sudo cp deploy/gate.env /etc/gate/
sudo cp deploy/gate.service /etc/systemd/system/
sudo systemctl enable gate
sudo systemctl start gate
```

## Development

Build for Windows: `make build-windows`
Build for Raspberry Pi: `make build`
