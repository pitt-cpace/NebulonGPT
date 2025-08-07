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
RUN npm run build

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
    HF_HUB_OFFLINE=0 \
    NODE_ENV=production \
    PYTHONUNBUFFERED=1

RUN mkdir -p $HF_HOME

# ----- Better pip caching setup -----
# Copy only requirements first to preserve layer cache
COPY Vosk-Server/websocket/requirements.txt /app/vosk-requirements.txt
COPY Kokoro-TTS-Server/requirements.txt /app/kokoro-requirements.txt

# Install all Python dependencies first (with BuildKit cache mount if available)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --progress-bar on -v -r vosk-requirements.txt && \
    pip install --no-cache-dir --progress-bar on -v -r kokoro-requirements.txt

# ---- Node server install ----
COPY package*.json ./
RUN npm install --production

# ---- Copy application files ----
COPY server.js ./
COPY --from=frontend-build /app/build ./build

# Vosk
COPY Vosk-Server/ /app/vosk-server/
RUN mkdir -p /app/vosk-server/models

# If model already extracted before, skip re-extracting (cache layer)
COPY Vosk-Server/websocket/models/vosk-model-small-en-us-0.15.zip /tmp/model.zip
RUN test -d /app/vosk-server/models/vosk-model-small-en-us-0.15 || ( \
    unzip -o /tmp/model.zip -d /app/vosk-server/models && \
    rm /tmp/model.zip \
)

# Kokoro
COPY Kokoro-TTS-Server/ /app/kokoro-tts/

# Hugging Face model cache (from split archive files)
COPY Kokoro-TTS-Server/huggingface-cache.tar.gz.part* /tmp/
RUN cd /tmp && \
    cat huggingface-cache.tar.gz.part* > huggingface-cache.tar.gz && \
    tar -xzf huggingface-cache.tar.gz && \
    cp -r huggingface-cache/* /app/.cache/huggingface/ && \
    rm -rf /tmp/huggingface-cache* /tmp/huggingface-cache.tar.gz.part*

# Data & nginx
RUN mkdir -p /app/data
COPY nginx.conf /etc/nginx/sites-available/default
COPY start-services.sh /app/start-services.sh
RUN chmod +x /app/start-services.sh

# Expose ports
EXPOSE 3000 2700 2701

# Entrypoint
CMD ["/app/start-services.sh"]
