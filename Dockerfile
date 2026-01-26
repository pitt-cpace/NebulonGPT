# Multi-stage build for NebulonGPT with Unified FastAPI Backend
# Stage 1: Build the React frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app

# Install build dependencies for npm packages (including Canvas dependencies)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    pkgconfig

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
    git curl nginx pkg-config gettext-base \
    && rm -rf /var/lib/apt/lists/*

# Set environment early
ENV HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers \
    HF_DATASETS_CACHE=/app/.cache/huggingface/datasets \
    HF_HUB_OFFLINE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

RUN mkdir -p $HF_HOME

# Copy and install Python requirements
COPY backend/requirements.txt /app/backend/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -v -r /app/backend/requirements.txt

# Copy backend application code
COPY backend/ /app/backend/

# Copy built frontend files and verify they exist
COPY --from=frontend-build /app/build ./build
RUN ls -la /app/build && echo "Build files copied successfully" || echo "ERROR: Build files not found"

# Remove default nginx site to avoid conflict with our custom config
RUN rm -f /etc/nginx/sites-enabled/default

# Copy nginx config template
COPY nginx.conf.template /etc/nginx/templates/nginx.conf.template

# Copy Vosk models (for extraction at runtime)
COPY backend/models/vosk /app/vosk-models-source/
RUN mkdir -p /app/vosk-server/models

# Copy Kokoro TTS cache (for extraction at runtime)
COPY backend/models/kokoro/huggingface-cache.zip.* /app/kokoro-cache/

# Create Hugging Face cache directory (extraction will happen at runtime)
RUN mkdir -p /app/.cache/huggingface && \
    chown -R root:root /app/.cache && \
    chmod -R 755 /app/.cache

# Create data directory
RUN mkdir -p /app/data

# Copy and prepare startup script
COPY start-services.sh /app/start-services.sh
RUN tr -d '\r' < /app/start-services.sh > /tmp/start-services-fixed.sh && \
    mv /tmp/start-services-fixed.sh /app/start-services.sh && \
    chmod +x /app/start-services.sh

# Copy SSL certificates
COPY Certification/ /app/Certification/

# Expose ports
EXPOSE 80 443

# Default port mapping hint for Docker Desktop
LABEL com.docker.desktop.default-port-mapping="3000:80"

# Default volume mapping hint for Docker Desktop
LABEL com.docker.desktop.default-volume-mapping="/app/data"

# Entrypoint
CMD ["/bin/sh", "/app/start-services.sh"]
