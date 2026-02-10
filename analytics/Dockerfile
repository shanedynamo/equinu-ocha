FROM apache/superset:3.1.0

USER root

# Install Python dependencies for Superset + dashboard init script
RUN pip install --no-cache-dir psycopg2-binary redis requests

# Copy Superset configuration
COPY superset_config.py /app/pythonpath/superset_config.py

# Copy dashboard initialization script
COPY init-dashboards.py /app/init-dashboards.py

USER superset

EXPOSE 8088
