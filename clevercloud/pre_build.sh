#!/bin/bash

# CleverCloud pre-build hook for Eduskript

set -e

echo "🚀 Starting pre-build setup..."

# Installing pnpm
if ! command -v pnpm &> /dev/null; then
    echo "🔧 Installing pnpm..."
    corepack enable pnpm
else
    echo "✅ pnpm is already installed"
fi