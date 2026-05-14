# Stage 1: Build React app
FROM node:22 AS builder

WORKDIR /app/client

# Copy package files
COPY client/package.json client/package-lock.json ./

# Install with npm install (not npm ci) to correctly resolve platform-specific
# native bindings (e.g. rolldown) regardless of what OS generated the lock file
RUN npm install

# Copy source
COPY client/ .

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# tsc -b (build mode) requires composite:true in referenced tsconfigs — use
# direct project type-check instead, which works without composite
RUN npx tsc -p tsconfig.app.json --noEmit
RUN npx vite build

# Stage 2: Serve with Nginx
FROM nginx:stable-alpine

COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
