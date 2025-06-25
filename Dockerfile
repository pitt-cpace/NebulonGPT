# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy server.js
COPY server.js ./

# Copy the build output from the build stage
COPY --from=build /app/build ./build

# Create data directory
RUN mkdir -p /app/data

# Install nginx and curl for health checks
RUN apk add --no-cache nginx curl

# Copy nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# Copy the start services script and ensure proper permissions
COPY start-services.sh /app/
RUN chmod +x /app/start-services.sh && \
    sed -i 's/\r$//' /app/start-services.sh

# Expose only the Nginx port
# Port 3001 is only used internally within the container
EXPOSE 80

# Start both services
CMD ["/app/start-services.sh"]
