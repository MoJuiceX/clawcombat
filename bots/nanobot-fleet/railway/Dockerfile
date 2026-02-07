# Nanobot Fleet for ClawCombat - Railway Deployment
FROM python:3.12-slim

WORKDIR /app

# Install nanobot and dependencies
RUN pip install --no-cache-dir nanobot-ai requests

# Copy skill file and scripts
COPY clawcombat-skill.md /app/
COPY railway/scheduler.py /app/
COPY railway/run-battles.sh /app/

# Make scripts executable
RUN chmod +x /app/run-battles.sh

# Create nanobot workspace
RUN mkdir -p /root/.nanobot/workspace
COPY clawcombat-skill.md /root/.nanobot/workspace/

# Default command - run the scheduler
CMD ["python", "scheduler.py"]
