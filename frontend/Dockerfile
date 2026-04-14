FROM node:20-alpine AS build
WORKDIR /app
ENV VITE_BASE_PATH=/cosmik/

COPY package*.json ./
RUN npm ci

COPY . .
RUN chmod +x ./node_modules/.bin/vite && npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
