#!/bin/bash
# ------------------------------------------------------------------
# Ubuntu 22.04/24.04 Setup Script for Ryugan AI Trading App 
# ------------------------------------------------------------------

echo "Updating system..."
sudo apt update && sudo apt upgrade -y

echo "Installing prerequisites (Python, Git, Nginx, PostgreSQL)..."
sudo apt install -y python3-pip python3-venv git nginx postgresql postgresql-contrib

echo "Setting up PostgreSQL Database..."
# Change these securely later or define via environment variables
DB_NAME="trading_app"
DB_USER="trading_user"
DB_PASS="secure_password_here"

sudo -u postgres psql -c "CREATE DATABASE $DB_NAME;"
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

# Optional: Ensure public schema permissions for the user
sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;"

echo "Setting up Python Virtual Environment..."
# Assuming we are in the cloned project directory
python3 -m venv venv
source venv/bin/activate

echo "Installing backend requirements..."
pip install -r backend/requirements.txt

echo "====================================================="
echo "Setup complete! Next Steps:"
echo "1. Configure your backend/.env file with the new DATABASE_URL."
echo "   Example: DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
echo "2. Setup a systemd service for Uvicorn (FastAPI)."
echo "3. Configure Nginx as a reverse proxy."
echo "====================================================="
