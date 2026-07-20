#!/usr/bin/env bash
# Savor LXC Container Creator Script for Proxmox VE
# Sourced from Proxmox Helper Scripts conventions

# Sourced function framework
source <(curl -s https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/build.func)

# App configurations
APP="Savor"
var_tags="recipe;self-hosted"
var_cpu="2"
var_ram="2048"
var_disk="8"
var_os="ubuntu"
var_version="24.04"

header_info

function update_script() {
  header_info
  if [ ! -d /opt/savor ]; then
    msg_error "No Savor installation found at /opt/savor"
    exit 1
  fi
  msg_info "Updating Savor"
  bash /opt/savor/scripts/update.sh
  msg_ok "Updated Savor Successfully"
  exit
}

start_script

# Build container
build_container

# Complete
msg_ok "Savor LXC Container Created successfully."
msg_info "Access Savor at http://${IP}:3000"
