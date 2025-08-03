# Eduskript VPS Deployment

This directory contains all the necessary files to deploy Eduskript on a VPS using Docker.

## 🚀 Quick Setup

### 1. Prepare Your VPS (Fedora Linux)

Run the setup script on your clean Fedora VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/your-username/eduskript/main/deployment/setup-fedora.sh | bash
```

Or manually:

```bash
wget https://raw.githubusercontent.com/your-username/eduskript/main/deployment/setup-fedora.sh
chmod +x setup-fedora.sh
./setup-fedora.sh
```

### 2. Configure Environment

```bash
cd /opt/eduskript
cp .env.example .env
nano .env  # Edit with your settings
```

Required environment variables:
- `GITHUB_REPOSITORY`: Your GitHub repository (e.g., `username/eduskript`)
- `GITHUB_ACTOR`: Your GitHub username
- `GITHUB_TOKEN`: GitHub Personal Access Token with `packages:read` scope
- `NEXTAUTH_SECRET`: Strong random secret for authentication
- `NEXTAUTH_URL`: Your domain URL (e.g., `https://yourdomain.com`)

### 3. Start Services

```bash
docker-compose up -d
```

### 4. Configure Nginx Proxy Manager

1. Open `http://your-server-ip:81` in your browser
2. Login with default credentials:
   - Email: `admin@example.com`
   - Password: `changeme`
3. **Change the password immediately!**
4. Add a new Proxy Host:
   - Domain: `yourdomain.com`
   - Forward Hostname: `eduskript`
   - Forward Port: `3000`
   - Enable SSL with Let's Encrypt

## 📁 File Structure

```
deployment/
├── docker-compose.yml      # Main Docker Compose configuration
├── .env.example           # Environment variables template
├── setup-fedora.sh        # VPS setup script for Fedora
├── README.md             # This file
└── nginx/               # Nginx Proxy Manager data (created automatically)
    ├── data/
    └── letsencrypt/
```

## 🔧 Architecture

```
Internet → Nginx Proxy Manager → Eduskript App
                ↓
          Let's Encrypt SSL
                ↓
           Custom Domains
```

### Services:

1. **nginx** (Nginx Proxy Manager): Handles SSL, custom domains, and reverse proxy
2. **eduskript**: Your Next.js application with SQLite database
3. **watchtower**: Automatically updates Docker images from GHCR

## 🔄 Updates

Watchtower automatically checks for new images every 5 minutes and updates them. You can also manually update:

```bash
docker-compose pull
docker-compose up -d
```

## 📊 Monitoring

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f eduskript
docker-compose logs -f nginx
```

### Check Status
```bash
docker-compose ps
```

## 🔒 Security

### Essential Security Steps:
1. Change Nginx Proxy Manager default password
2. Set strong `NEXTAUTH_SECRET` in `.env`
3. Configure firewall (done by setup script)
4. Regular system updates: `sudo dnf update`
5. Monitor logs for suspicious activity

### Firewall Ports:
- `80/tcp`: HTTP
- `443/tcp`: HTTPS  
- `81/tcp`: Nginx Proxy Manager admin panel

## 🗄️ Database & Backups

### SQLite Database Location
The SQLite database is stored in `./data/database.db`

### Backup Commands
```bash
# Create backup
cp ./data/database.db ./data/database-backup-$(date +%Y%m%d).db

# Automated backup script
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/eduskript/backups"
mkdir -p $BACKUP_DIR
cp /opt/eduskript/data/database.db $BACKUP_DIR/database-$(date +%Y%m%d-%H%M%S).db
# Keep only last 30 days
find $BACKUP_DIR -name "database-*.db" -mtime +30 -delete
EOF
chmod +x backup.sh

# Add to crontab for daily backups
echo "0 2 * * * /opt/eduskript/backup.sh" | crontab -
```

## 🌐 Custom Domains

### Adding Custom Domains

1. In Nginx Proxy Manager admin panel:
   - Add new Proxy Host
   - Domain: `customdomain.com`
   - Forward to: `eduskript:3000`
   - Enable SSL

2. Customer needs to point their domain to your VPS IP:
   - A record: `customdomain.com` → `your-vps-ip`
   - Optional CNAME: `www.customdomain.com` → `customdomain.com`

### Wildcard SSL (Optional)
For handling multiple subdomains, you can set up wildcard SSL certificates in Nginx Proxy Manager.

## 🐳 Docker Management

### Useful Commands
```bash
# View running containers
docker ps

# Restart specific service
docker-compose restart eduskript

# Update and restart
docker-compose pull && docker-compose up -d

# View resource usage
docker stats

# Clean up unused images/containers
docker system prune -f
```

## 🚨 Troubleshooting

### Common Issues

1. **Permission denied for docker commands**
   - Log out and back in after initial setup
   - Or use: `newgrp docker`

2. **Port 81 not accessible**
   - Check firewall: `sudo firewall-cmd --list-ports`
   - Verify container is running: `docker-compose ps`

3. **SSL certificate issues**
   - Ensure domain points to your VPS IP
   - Check Nginx Proxy Manager logs: `docker-compose logs nginx`

4. **App not accessible through proxy**
   - Verify internal networking: `docker network ls`
   - Check app logs: `docker-compose logs eduskript`

5. **Database connection issues**
   - Ensure data directory has correct permissions
   - Check SQLite file exists: `ls -la ./data/`

### Log Locations
- Application logs: `docker-compose logs eduskript`
- Nginx logs: `docker-compose logs nginx`  
- System logs: `journalctl -u eduskript.service`

## 📧 Support

For issues with this deployment setup, check:
1. Docker logs for error messages
2. Nginx Proxy Manager documentation
3. Eduskript application logs
4. GitHub Issues for known problems

## 🔗 Links

- [Docker Documentation](https://docs.docker.com/)
- [Nginx Proxy Manager](https://nginxproxymanager.com/guide/)
- [Let's Encrypt](https://letsencrypt.org/)
- [Watchtower](https://containrrr.dev/watchtower/)