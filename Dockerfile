# Multi-stage build for integrated NebulonGPT with Vosk and Kokoro TTS
# Stage 1: Build the React frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Final production image with Python 3.9-slim (matching Vosk and Kokoro requirements)
FROM python:3.9-slim AS production

# Install system dependencies for all services
RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    libatomic1 \
    build-essential \
    git \
    curl \
    nginx \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js on the Python base image
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

WORKDIR /app

# Copy Node.js dependencies and server
COPY package*.json ./
RUN npm install --production
COPY server.js ./

# Copy the built frontend from the first stage
COPY --from=frontend-build /app/build ./build

# Set Hugging Face cache directory for Kokoro
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers
ENV HF_DATASETS_CACHE=/app/.cache/huggingface/datasets
ENV HF_HUB_OFFLINE=0
RUN mkdir -p /app/.cache/huggingface

# Copy and install Vosk requirements
COPY Vosk-Server/websocket/requirements.txt /app/vosk-requirements.txt
RUN pip install --no-cache-dir -r vosk-requirements.txt

# Copy and install Kokoro requirements
COPY Kokoro-TTS-Server/requirements.txt /app/kokoro-requirements.txt
RUN pip install --no-cache-dir -r kokoro-requirements.txt

# Download spaCy English model for Kokoro
RUN python -m spacy download en_core_web_sm || echo "SpaCy model download failed, continuing..."

# Copy Vosk server files
COPY Vosk-Server/ /app/vosk-server/
RUN mkdir -p /app/vosk-server/models

# Copy and extract Vosk model
COPY Vosk-Server/websocket/models/vosk-model-small-en-us-0.15.zip /tmp/vosk-model-small-en-us-0.15.zip
RUN cd /app/vosk-server/models && \
    unzip -o /tmp/vosk-model-small-en-us-0.15.zip && \
    rm /tmp/vosk-model-small-en-us-0.15.zip && \
    echo "Vosk model extracted successfully"

# Copy Kokoro TTS server files
COPY Kokoro-TTS-Server/ /app/kokoro-tts/

# Pre-download Kokoro models
COPY preload_kokoro_models.py /tmp/preload_kokoro_models.py
RUN python /tmp/preload_kokoro_models.py && rm /tmp/preload_kokoro_models.py

# Create necessary directories
RUN mkdir -p /app/data

# Copy nginx configuration
COPY nginx.conf /etc/nginx/sites-available/default

# Copy the startup script
COPY start-services.sh /app/start-services.sh
RUN chmod +x /app/start-services.sh

# Set environment variables
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers
ENV HF_DATASETS_CACHE=/app/.cache/huggingface/datasets
ENV HF_HUB_OFFLINE=0

# Expose ports for all services
EXPOSE 3000 2700 2701

# Use the startup script
CMD ["/app/start-services.sh"]
