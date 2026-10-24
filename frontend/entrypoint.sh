#!/usr/bin/env sh
set -e

# MUST use 'export' so child processes like envsubst can read the value!
export BACKEND_ORIGIN="${BACKEND_ORIGIN:-${BACKEND_URL:-http://mc-admin-backend:8000}}"

# Render nginx config from template into default.conf
envsubst '${BACKEND_ORIGIN}' < /etc/nginx/templates/nginx.conf > /etc/nginx/conf.d/default.conf

# Validate config
nginx -t

# Start nginx
exec nginx -g 'daemon off;'