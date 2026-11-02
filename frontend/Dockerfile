# Build stage
FROM node:22-alpine AS build

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Final nginx stage
FROM nginx:alpine

# Copy built files from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Serve index.html for app routes so refreshing or opening e.g. /overview directly works
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The container just serves static files; API routing is handled by the main Nginx
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]