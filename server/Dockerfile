# Use Node.js 22 LTS
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies for building (prisma)
RUN apt-get update && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy root package files
COPY package*.json ./
COPY server/package*.json ./server/

# Install dependencies
RUN npm install
RUN cd server && npm install

# Copy source and prisma
COPY server/ ./server/

# Generate Prisma client
RUN cd server && npx prisma generate

# Build the server (assuming a build script exists or we just use ts-node in production)
# For a production container, we should ideally transpile to JS
RUN cd server && npx tsc

# --- Production Image ---
FROM node:22-slim

WORKDIR /app

# Install production dependencies: FFmpeg, Python (for Audible), and wget to fetch 'tone'
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    wget \
    tar \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Install Audible library for Python scripts and audible-cli
RUN pip3 install audible audible-cli --break-system-packages

# Install 'tone' linux-x64 binary
RUN wget https://github.com/sandreas/tone/releases/download/v0.2.5/tone-0.2.5-linux-x64.tar.gz \
    && tar -xzf tone-0.2.5-linux-x64.tar.gz \
    && find . -maxdepth 1 -type f -executable -name "tone*" -exec mv {} /usr/local/bin/tone \; \
    && rm -f tone*.tar.gz

# Copy built assets and production node_modules from builder
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./package.json
COPY --from=builder /app/server/prisma ./prisma
COPY --from=builder /app/server/scripts ./scripts

# Environment variable for tone path (Linux location)
ENV TONE_PATH=/usr/local/bin/tone
ENV PORT=4000
ENV NODE_ENV=production

EXPOSE 4000

# Run migrations and start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
