#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Get it from https://nodejs.org"
    exit 1
fi
if [ ! -d "node_modules" ]; then
    echo "First run: installing dependencies..."
    npm install
fi
node server.js
