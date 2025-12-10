#!/bin/bash

echo "🚀 Starting build process..."

# Build Docker images
echo "🐳 Building Docker images..."
docker-compose build

echo "✅ Build complete! You can now run 'docker-compose up -d' to start the application." 