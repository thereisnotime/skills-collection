# Purple Lab Dockerfile
# Build: docker compose -f docker-compose.purple-lab.yml build
# Run:   docker compose -f docker-compose.purple-lab.yml up

# --- Stage 1: Build frontend ---
FROM node:20-alpine AS frontend-build

WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig*.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src/ ./src/
RUN npm run build

# --- Stage 2: Production image ---
FROM python:3.12-slim

LABEL maintainer="Lokesh Mure"
LABEL description="Purple Lab - Replit-like web UI for Loki Mode"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash -u 1000 purplelab

WORKDIR /opt/purple-lab

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python backend
COPY server.py auth.py models.py ./

# Copy built frontend from stage 1
COPY --from=frontend-build /build/dist/ ./dist/

# Copy loki CLI and supporting files from parent context (if needed at runtime)
# For standalone mode, the server works without loki CLI

# Set ownership
RUN chown -R purplelab:purplelab /opt/purple-lab

# Create project data directory
RUN mkdir -p /projects && chown purplelab:purplelab /projects

EXPOSE 57375

USER purplelab

CMD ["python3", "server.py"]

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:57375/health || exit 1
