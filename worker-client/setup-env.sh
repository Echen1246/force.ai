#!/bin/bash

# Setup script for Browser Use Worker Client
# This script helps you set up the environment for running the worker

echo "🔧 Browser Use Worker Client Setup"
echo "=================================="

# Check if OpenAI API key is already set
if [ -n "$OPENAI_API_KEY" ]; then
    echo "✅ OPENAI_API_KEY is already set"
else
    echo "❌ OPENAI_API_KEY is not set"
    echo ""
    echo "To set your OpenAI API key, run:"
    echo "export OPENAI_API_KEY=\"your-api-key-here\""
    echo ""
    echo "Or add it to your ~/.bashrc or ~/.zshrc file for permanent setup:"
    echo "echo 'export OPENAI_API_KEY=\"your-api-key-here\"' >> ~/.zshrc"
fi

echo ""
echo "📋 Steps to run the worker:"
echo "1. Set your OpenAI API key (see above)"
echo "2. Install dependencies: npm install"
echo "3. Set up Python environment: npm run setup"
echo "4. Start the worker: npm start"
echo ""
echo "The worker will connect to the admin at ws://localhost:3000" 