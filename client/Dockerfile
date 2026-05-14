# Stage 1: Build React app
FROM node:24 AS builder

WORKDIR /app/client

# Copy only package.json — no lock file so npm resolves native bindings
# (e.g. rolldown) fresh for the Linux platform instead of using Windows-generated locks
COPY client/package.json ./

RUN npm install

# Copy source
COPY client/ .

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npx vite build

# Stage 2: Serve with Nginx
FROM nginx:stable-alpine

COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
