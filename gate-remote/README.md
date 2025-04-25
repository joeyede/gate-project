# Gate Remote Control

GPIO-based gate control system for Raspberry Pi using MQTT for communication.

## Setup

1. Configure MQTT credentials:
```bash
# Create and edit environment file with your HiveMQ credentials
cp deploy/gate.env.example deploy/gate.env
nano deploy/gate.env

# Add your credentials:
# MQTT_USERNAME=your_hivemq_username
# MQTT_PASSWORD=your_hivemq_password
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

## MQTT Topics

The service subscribes to:
- `gate/control` - Topic for gate commands

Command format:
```json
{
    "action": "full|pedestrian|right|left"
}
```

## Development

Build for Windows: `make build-windows`
Build for Raspberry Pi: `make build`

## Security
Communication is secured using:
- TLS 1.2+ encryption
- HiveMQ Cloud authentication
- Topic-based access control
