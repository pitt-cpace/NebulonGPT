# Multi-stage build for integrated NebulonGPT with Vosk and Kokoro TTS
# Stage 1: Build the React frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app

# Only copy package files for better cache use
COPY package*.json ./

# Install dependencies
RUN npm install

# Now copy rest and build
COPY . .
RUN npm run build && ls -la build/ && echo "Frontend build completed successfully"

# --------------------------------------------
# Stage 2: Final production image
FROM python:3.9-slim AS production

WORKDIR /app

# Install system dependencies (no interactive output)
RUN apt-get update && apt-get install -y \
    wget unzip libatomic1 build-essential \
    git curl nginx \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Set environment early
ENV HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers \
    HF_DATASETS_CACHE=/app/.cache/huggingface/datasets \
    HF_HUB_OFFLINE=1 \
    NODE_ENV=production \
    PYTHONUNBUFFERED=1

RUN mkdir -p $HF_HOME

# ----- Better pip caching setup -----
# Copy only requirements first to preserve layer cache
COPY Vosk-Server/websocket/requirements.txt /app/vosk-requirements.txt
COPY Kokoro-TTS-Server/requirements.txt /app/kokoro-requirements.txt

# Install all Python dependencies first (with BuildKit cache mount if available)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -v -r vosk-requirements.txt && \
    pip install --no-cache-dir -v -r kokoro-requirements.txt

# ---- Node server install ----
COPY package*.json ./
RUN npm install --production

# ---- Copy application files ----
COPY server.js ./

# Copy built frontend files and verify they exist
COPY --from=frontend-build /app/build ./build
RUN ls -la /app/build && echo "Build files copied successfully" || echo "ERROR: Build files not found"

# Vosk
COPY Vosk-Server/ /app/vosk-server/
RUN mkdir -p /app/vosk-server/models


# Kokoro - Copy everything including the zip files
COPY Kokoro-TTS-Server/ /app/kokoro-tts/

# Create Hugging Face cache directory (extraction will happen at runtime)
RUN mkdir -p /app/.cache/huggingface && \
    chown -R root:root /app/.cache && \
    chmod -R 755 /app/.cache

# Data & nginx
RUN mkdir -p /app/data
COPY nginx.conf /etc/nginx/sites-available/default
COPY start-services.sh /app/start-services.sh
RUN tr -d '\r' < /app/start-services.sh > /tmp/start-services-fixed.sh && \
    mv /tmp/start-services-fixed.sh /app/start-services.sh && \
    chmod +x /app/start-services.sh

# Expose ports
EXPOSE 80

# Default port mapping hint for Docker Desktop
LABEL com.docker.desktop.default-port-mapping="3000:80"

# Default volume mapping hint for Docker Desktop
LABEL com.docker.desktop.default-volume-mapping="/app/data"

# Entrypoint
CMD ["/bin/sh", "/app/start-services.sh"]
