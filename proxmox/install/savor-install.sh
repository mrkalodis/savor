#!/usr/bin/env bash
# Savor In-Container Installation Script
# Runs inside the created Debian LXC container

set -e

# Sourced function framework
source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

# System preparations
msg_info "Setting default root password"
usermod -U root 2>/dev/null || true
echo "root:recipe" | chpasswd
msg_ok "Root password set to 'recipe'"

# Dependencies
msg_info "Installing required packages"
apt-get install -y curl git build-essential ca-certificates gnupg zstd
msg_ok "Dependencies installed"

# Node.js 20 LTS NodeSource
msg_info "Setting up Node.js 20 LTS Repository"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
msg_ok "Node.js 20 LTS installed"

# Savor Setup
msg_info "Downloading Savor Recipe Manager source code"
git clone https://github.com/mrkalodis/savor.git /opt/savor
cd /opt/savor
msg_ok "Source code downloaded"

msg_info "Installing NPM dependencies"
rm -rf node_modules
npm install --production --no-audit --no-fund
msg_ok "NPM dependencies installed"

msg_info "Creating data directory and configuration"
mkdir -p /opt/savor/data
cp /opt/savor/.env.example /opt/savor/.env
msg_ok "Directories configured"

# Create systemd service
msg_info "Configuring Savor systemd service daemon"
cat <<EOF > /etc/systemd/system/savor.service
[Unit]
Description=Savor Recipe Manager Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/savor
ExecStart=/usr/bin/node /opt/savor/server.js
Restart=on-failure
Environment=NODE_ENV=production PORT=3000 DATA_DIR=/opt/savor/data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now savor
msg_ok "Systemd service configured and started"

# Ollama Setup
msg_info "Installing Ollama and pulling Qwen 2.5 1.5B model"
curl -fsSL https://ollama.com/install.sh | sh
# Start Ollama service daemon explicitly if not already started
systemctl enable --now ollama
# Wait a moment for Ollama API to be ready
sleep 5
# Pull the model
ollama pull qwen2.5:1.5b
msg_ok "Ollama and AI model installed"

# Cleanup
msg_info "Performing package cleanup"
apt-get autoremove -y
apt-get clean
msg_ok "Cleanup complete"
