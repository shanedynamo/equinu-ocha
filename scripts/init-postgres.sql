-- Create a separate database for Superset metadata.
-- Runs automatically on first PostgreSQL container start via
-- /docker-entrypoint-initdb.d/ mount in docker-compose.yml.
SELECT 'CREATE DATABASE superset_metadata OWNER dynamo'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'superset_metadata')\gexec
