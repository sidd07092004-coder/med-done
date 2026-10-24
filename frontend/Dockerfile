# Multi-stage build for frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS production
# gettext provides envsubst, used by entrypoint.sh to render nginx.conf
RUN apk add --no-cache gettext
RUN mkdir -p /etc/nginx/templates /etc/nginx/conf.d
COPY nginx.conf /etc/nginx/templates/nginx.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
