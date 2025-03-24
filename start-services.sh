#!/bin/sh
# Start Node.js server in the background
node server.js &

# Start Nginx in the foreground to keep the container running
nginx -g 'daemon off;'
