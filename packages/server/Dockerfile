# ============================================
# PrivShare Signaling Server Dockerfile
# ============================================
# 
# Zero-Trust Architecture:
# - NO file storage capability
# - NO persistent volume needed
# - Stateless signaling only
# 
# ============================================

# --------------------------------------------
# Stage 1: Build
# --------------------------------------------
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# --------------------------------------------
# Stage 2: Production
# --------------------------------------------
FROM node:20-alpine AS production

# Security: Create non-root user
RUN addgroup -g 1001 -S privshare && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G privshare -g privshare privshare

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Set ownership to non-root user
RUN chown -R privshare:privshare /app

# Switch to non-root user
USER privshare

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV LOG_LEVEL=info

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Labels
LABEL org.opencontainers.image.title="PrivShare Signaling Server"
LABEL org.opencontainers.image.description="Zero-Trust document collaboration signaling server. NO file storage."
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="PrivShare"
LABEL org.opencontainers.image.source="https://github.com/insydr/PrivShare"

# Start server
CMD ["node", "dist/index.js"]
