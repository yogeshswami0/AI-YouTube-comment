# Use a lightweight Node.js image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy the package.json and package-lock.json first to leverage Docker cache
# We take them from the server directory
COPY server/package*.json ./

# Install dependencies
# Using 'npm ci' is generally preferred for CI/containers if package-lock.json exists
RUN npm install

# Copy the rest of the server source code
# This will also copy the .env file if it exists in the server directory
COPY server/ .

# Ensure the .env file is present (as requested, we copy it directly)
# If it was already copied by the previous line, this is redundant but safe
# if it's not in the server folder but in the root, you'd change this.
# Based on exploration, it IS in the server folder.

# THE SERVER RUNS ON PORT 5000
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
