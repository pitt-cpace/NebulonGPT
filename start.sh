#!/bin/bash

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker first."
    echo "Visit: https://www.docker.com/products/docker-desktop/"
    exit 1
fi

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo "Ollama doesn't seem to be running on port 11434."
    echo "Please start Ollama with 'ollama serve' before running this application."
    exit 1
fi

# Try to use docker compose (newer Docker versions)
if docker compose version &> /dev/null; then
    echo "Starting Nebulon-GPT with docker compose..."
    docker compose up -d
# Fall back to docker-compose if available
elif command -v docker-compose &> /dev/null; then
    echo "Starting Nebulon-GPT with docker-compose..."
    docker-compose up -d
# If neither is available, use plain docker commands
else
    echo "Docker Compose not found. Using plain Docker commands..."
    
    # Build the image
    echo "Building Docker image..."
    docker build -t nebulon-gpt .
    
    # Run the container
    echo "Starting container..."
    docker run -d --name nebulon-gpt \
        -p 3000:80 \
        # --add-host=host.docker.internal:host-gateway \
        -v "$(pwd)/nginx.conf:/etc/nginx/http.d/default.conf" \
        -v nebulon-gpt-data:/app/data \
        -e NODE_ENV=production \
        -e REACT_APP_OLLAMA_API_URL=http://localhost:11434 \
        nebulon-gpt
fi

# Wait for the container to start
sleep 3

# Check if the container is running
if docker ps | grep -q nebulon-gpt; then
    echo "Nebulon-GPT is now running!"
    echo "Open your browser and navigate to: http://localhost:3000"
else
    echo "Failed to start Nebulon-GPT. Please check the logs with 'docker logs nebulon-gpt'."
    exit 1
fi
