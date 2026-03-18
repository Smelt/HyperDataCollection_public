#!/bin/bash

# Load environment variables
source .env

echo "Applying account snapshots migration..."

mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < scripts/migrations/003_create_account_snapshots.sql

if [ $? -eq 0 ]; then
    echo "✅ Migration applied successfully"
else
    echo "❌ Migration failed"
    exit 1
fi
