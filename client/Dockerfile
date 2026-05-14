# Stage 1: Build React app
FROM node:22 AS builder

WORKDIR /app/client

# Copy package files
COPY client/package.json ./

# Fresh install — avoids cross-platform optional dependency issues with rolldown
RUN npm install

# Copy source
COPY client/ .

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npx tsc -b
RUN npx vite build

# Stage 2: Serve with Nginx
FROM nginx:stable-alpine

COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
