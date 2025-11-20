#!/bin/bash

# Script to set up a local Postgres instance for testing using Docker

set -e

CONTAINER_NAME="test-postgres"
DB_NAME="testdb"
DB_USER="postgres"
DB_PASSWORD="testpass"
DB_PORT="5432"

echo "🐳 Setting up local Postgres for testing..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "📦 Container '${CONTAINER_NAME}' already exists"
    
    # Check if it's running
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "✅ Container is already running"
    else
        echo "🔄 Starting existing container..."
        docker start ${CONTAINER_NAME}
        sleep 2
    fi
else
    echo "🆕 Creating new Postgres container..."
    docker run --name ${CONTAINER_NAME} \
        -e POSTGRES_PASSWORD=${DB_PASSWORD} \
        -e POSTGRES_DB=${DB_NAME} \
        -p ${DB_PORT}:5432 \
        -d postgres:15
    
    echo "⏳ Waiting for Postgres to be ready..."
    sleep 5
    
    # Wait for Postgres to be ready
    for i in {1..30}; do
        if docker exec ${CONTAINER_NAME} pg_isready -U ${DB_USER} > /dev/null 2>&1; then
            echo "✅ Postgres is ready!"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "❌ Postgres failed to start after 30 seconds"
            exit 1
        fi
        sleep 1
    done
fi

# Get connection string
CONNECTION_STRING="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Postgres is ready for testing!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Connection string:"
echo "  ${CONNECTION_STRING}"
echo ""
echo "To run the test:"
echo "  POSTGRES_URL='${CONNECTION_STRING}' node tests/test-postgres-routing.js"
echo ""
echo "To stop the container:"
echo "  docker stop ${CONTAINER_NAME}"
echo ""
echo "To remove the container:"
echo "  docker rm ${CONTAINER_NAME}"
echo ""

