# Stage 1: Build React app
FROM node:22 AS builder

WORKDIR /app

# Copy root and client package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm install
RUN cd client && npm install

# Copy client source
COPY client/ ./client/

# Build client
# We need to pass the API URL at build time if it's baked in, 
# or use relative paths if Nginx proxies them
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN cd client && npm run build

# Stage 2: Serve with Nginx
FROM nginx:stable-alpine

# Copy built assets
COPY --from=builder /app/client/dist /usr/share/nginx/html

# Copy nginx config
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
