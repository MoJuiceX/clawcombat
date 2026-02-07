#!/bin/bash
# Run battles for all bots - called by scheduler

set -e

echo "Running battle cycle..."
python /app/scheduler.py
