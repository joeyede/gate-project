#To use stuff in deploy

# Create secure directory for environment file
sudo mkdir /etc/gate
sudo chown root:root /etc/gate
sudo chmod 700 /etc/gate

# Copy and secure the environment file
sudo cp gate.env /etc/gate/
sudo chown root:root /etc/gate/gate.env
sudo chmod 600 /etc/gate/gate.env

# Install and start the service
sudo cp gate.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable gate
sudo systemctl start gate