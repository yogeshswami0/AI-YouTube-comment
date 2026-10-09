# =============================================================================
# worker/Dockerfile
# =============================================================================
FROM node:20-alpine

WORKDIR /app

# Install dependencies (production only)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

CMD ["node", "main.js"]
