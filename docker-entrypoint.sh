#!/bin/sh
set -e

# Create / upgrade the SQLite database before the server starts.
echo "Applying database migrations ($DATABASE_URL)..."
cd /app/migrate
node node_modules/prisma/build/index.js migrate deploy

cd /app
exec "$@"
