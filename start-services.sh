#!/bin/sh

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Starting NebulonGPT services..."

# Create necessary directories
mkdir -p /app/data
mkdir -p /app/nebulon-gpt-data

# Set proper permissions
chown -R nginx:nginx /app/data
chown -R nginx:nginx /app/nebulon-gpt-data

# Start Node.js server in the background
log "Starting Node.js server on port 3001..."
node server.js &
NODE_PID=$!

# Wait a moment for Node.js to start
sleep 2

# Check if Node.js server started successfully
if kill -0 $NODE_PID 2>/dev/null; then
    log "Node.js server started successfully (PID: $NODE_PID)"
else
    log "ERROR: Failed to start Node.js server"
    exit 1
fi

# Start Nginx in the foreground to keep the container running
log "Starting Nginx web server..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Function to handle shutdown gracefully
shutdown() {
    log "Shutting down services..."
    kill $NODE_PID 2>/dev/null
    kill $NGINX_PID 2>/dev/null
    exit 0
}

# Set up signal handlers
trap shutdown SIGTERM SIGINT

# Wait for Nginx to finish (keeps container running)
wait $NGINX_PID
