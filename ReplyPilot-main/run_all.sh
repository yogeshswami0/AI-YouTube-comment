#!/bin/bash

# A unified script to start all 5 ReplyPilot services on both Linux and Windows

# Default ports:
# rag: 8001
# ai-service: 8000
# server: 5000
# client: 5173

# Trap CTRL+C (SIGINT) and kill all background processes
cleanup() {
    echo ""
    echo "Shutting down all services..."
    # The `jobs -p` command lists all PIDs of background jobs started in this shell
    kill $(jobs -p) 2>/dev/null
    wait $(jobs -p) 2>/dev/null
    echo "All services terminated safely."
    exit 0
}

# Register the cleanup function for termination signals
trap cleanup SIGINT SIGTERM

echo "Starting all ReplyPilot services..."
echo "======================================"

# 1. Start Client (Vite) on port 5173
echo "-> Starting Client on port 5173..."
(cd client && PORT=5173 npm run dev) &

# 2. Start Server (Node.js) on port 5000
echo "-> Starting Server on port 5000..."
(cd server && PORT=5000 npm run dev) &

# 3. Start Worker (Node.js)
echo "-> Starting Worker..."
(cd worker && npm run dev) &

# Helper function to activate venv and run uvicorn
start_python_service() {
    local service_dir=$1
    local port=$2
    echo "-> Starting $service_dir on port $port..."
    (
        cd "$service_dir" || exit 1
        
        # Activate virtual environment across different OS
        if [ -f ".venv/Scripts/activate" ]; then
            # Windows / Git Bash
            source .venv/Scripts/activate
        elif [ -f ".venv/bin/activate" ]; then
            # Linux / Mac
            source .venv/bin/activate
        else
            echo "Warning: Virtual environment not found for $service_dir"
        fi
        
        python -m uvicorn app.main:app --host 0.0.0.0 --port "$port"
    ) &
}

# 4. Start AI-Service (Uvicorn) on port 8000
start_python_service "ai-service" 8000

# 5. Start RAG (Uvicorn) on port 8001
start_python_service "rag" 8001

echo "======================================"
echo "All services started in the background!"
echo "Press Ctrl+C to stop all services at once."
wait
