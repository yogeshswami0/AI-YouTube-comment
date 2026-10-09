# =============================================================================
# server/Dockerfile
# =============================================================================
FROM node:20-alpine

WORKDIR /app

# Install dependencies (production only — skip devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
