#!/bin/bash

# Test script to check if Ollama API is accessible

echo "Testing connection to Ollama API..."

# Check if curl is installed
if ! command -v curl &> /dev/null; then
    echo "Error: curl is not installed. Please install curl to run this test."
    exit 1
fi

# Test local connection first
echo "Testing direct connection to Ollama API on localhost:11434..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags)

if [ "$RESPONSE" = "200" ]; then
    echo "✅ Success! Ollama API is accessible on localhost:11434"
    echo "Fetching available models:"
    curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | cut -d'"' -f4
else
    echo "❌ Failed to connect to Ollama API on localhost:11434 (HTTP status: $RESPONSE)"
    echo "Please make sure Ollama is running with 'ollama serve'"
    exit 1
fi

# Test Docker connection
echo -e "\nTesting connection from Docker to host.docker.internal:11434..."
echo "This will create a temporary Docker container to test the connection."

docker run --rm --add-host=host.docker.internal:host-gateway alpine:latest sh -c "
    echo 'Testing from inside Docker container...'
    if ! command -v wget &> /dev/null; then
        apk add --no-cache wget
    fi
    
    # Try to connect to host.docker.internal
    if wget -q --spider http://host.docker.internal:11434/api/tags; then
        echo '✅ Success! host.docker.internal:11434 is accessible from Docker'
        echo 'Fetching available models from Docker:'
        wget -q -O - http://host.docker.internal:11434/api/tags
    else
        echo '❌ Failed to connect to host.docker.internal:11434 from Docker'
        echo 'This indicates a Docker networking issue.'
        echo 'For Linux users: Make sure you are using the correct host IP instead of host.docker.internal'
        
        # Try to ping to see if host is reachable
        echo 'Attempting to ping host.docker.internal...'
        ping -c 3 host.docker.internal
    fi
"

echo -e "\nIf both tests passed, the Nebulon-GPT should be able to connect to the Ollama API."
echo "If the Docker test failed but the local test passed, there's a networking issue between Docker and the host."
echo "In that case, try modifying nginx.conf to use your actual host IP address instead of host.docker.internal."
