# Eduskript Deployment

This repository uses a Git submodule for deployment configuration.

## 🚀 Quick Deploy

### Option 1: Bootstrap Script (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/marcchehab/eduskript-deployment/main/bootstrap.sh | bash
```

### Option 2: Manual Setup
```bash
# 1. System setup
curl -fsSL https://raw.githubusercontent.com/marcchehab/eduskript-deployment/main/setup-fedora.sh | bash

# 2. Clone deployment config
git clone https://github.com/marcchehab/eduskript-deployment.git /home/fedora/eduskript
cd /home/fedora/eduskript

# 3. Configure environment
cp .env.example .env
nano .env  # Set your GitHub credentials and secrets

# 4. Deploy
./deploy.sh
```

## 🔗 Submodule Commands (For Development)

```bash
# Clone repo with submodules
git clone --recursive https://github.com/marcchehab/eduskript.git

# Add submodule (already done)
git submodule add https://github.com/marcchehab/eduskript-deployment.git deployment

# Update submodule to latest
git submodule update --remote deployment

# Initialize submodules in existing repo
git submodule update --init --recursive
```

## 📁 Repository Structure

```
eduskript/                          # Main application code
├── src/                           # Next.js application
├── prisma/                        # Database schema
├── Dockerfile                     # Application container
├── .github/workflows/docker.yml   # CI/CD pipeline
└── deployment/                    # Git submodule
    ├── docker-compose.yml         # Production stack
    ├── setup-fedora.sh           # VPS setup
    ├── deploy.sh                 # Deployment script
    └── README.md                 # Deployment docs
```

## 🔄 Workflow

1. **Development**: Work in main `eduskript` repository
2. **Deployment changes**: Make changes in `deployment/` submodule
3. **Deploy**: Use scripts in the deployment repository
4. **Updates**: Deployment repository pulls latest app images automatically

## 🌐 Links

- **Main Repository**: https://github.com/marcchehab/eduskript
- **Deployment Repository**: https://github.com/marcchehab/eduskript-deployment
- **Docker Images**: ghcr.io/marcchehab/eduskript