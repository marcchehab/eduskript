#!/bin/bash

# Eduskript VPS Setup Script for Fedora Linux
# This script installs Docker, sets up the application, and configures the environment

set -e  # Exit on any error

echo "🚀 Starting Eduskript VPS Setup on Fedora..."

# Update system
echo "📦 Updating system packages..."
sudo dnf update -y

# Install Docker
echo "🐳 Installing Docker..."
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
echo "▶️ Starting Docker service..."
sudo systemctl start docker
sudo systemctl enable docker

# Add current user to docker group
echo "👤 Adding user to docker group..."
sudo usermod -aG docker $USER

# Install Docker Compose (standalone)
echo "🛠️ Installing Docker Compose..."
DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d'"' -f4)
sudo curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install git if not present
echo "📂 Installing Git..."
sudo dnf install -y git

# Install other useful tools
echo "🔧 Installing additional tools..."
sudo dnf install -y curl wget nano htop

# Create application directory
echo "📁 Creating application directory..."
sudo mkdir -p /opt/eduskript
sudo chown $USER:$USER /opt/eduskript
cd /opt/eduskript

# Clone deployment configuration (if this becomes a separate repo)
# For now, we'll create the structure manually
echo "📋 Setting up deployment structure..."
mkdir -p nginx/data nginx/letsencrypt data uploads

# Set proper permissions
echo "🔐 Setting permissions..."
chmod 755 nginx data uploads
chmod 750 nginx/letsencrypt

# Configure firewall
echo "🔥 Configuring firewall..."
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --permanent --add-port=81/tcp  # Nginx Proxy Manager admin
sudo firewall-cmd --reload

# Enable log rotation for Docker
echo "📊 Setting up log rotation..."
sudo tee /etc/logrotate.d/docker > /dev/null <<EOF
/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    size=1M
    missingok
    delaycompress
    copytruncate
}
EOF

# Create systemd service for auto-start
echo "🔄 Creating systemd service..."
sudo tee /etc/systemd/system/eduskript.service > /dev/null <<EOF
[Unit]
Description=Eduskript Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/eduskript
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable eduskript.service

echo "✨ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Log out and log back in to apply docker group membership"
echo "2. Copy your deployment files to /opt/eduskript/"
echo "3. Create and configure your .env file"
echo "4. Run: docker-compose up -d"
echo "5. Access Nginx Proxy Manager at http://your-server-ip:81"
echo "   Default login: admin@example.com / changeme"
echo ""
echo "🎯 Useful commands:"
echo "  - Check logs: docker-compose logs -f"
echo "  - Restart services: sudo systemctl restart eduskript"
echo "  - Update containers: docker-compose pull && docker-compose up -d"
echo ""
echo "🚨 Security reminders:"
echo "  - Change default Nginx Proxy Manager credentials immediately"
echo "  - Configure SSL certificates for your domains"
echo "  - Set strong passwords in your .env file"
echo "  - Consider setting up automated backups for /opt/eduskript/data/"