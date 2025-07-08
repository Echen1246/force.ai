# Browser Use Worker Client

An Electron desktop application that connects to the Browser Use orchestration platform and executes browser automation tasks using the Browser Use Python library.

## Prerequisites

- **Node.js** 16.0.0 or later
- **Python 3.8** or later
- **OpenAI or DeepSeek API Key**

## Quick Setup

1. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

2. **Set up Python environment and Browser Use:**
   ```bash
   npm run setup
   ```

3. **Set your API key:**
   ```bash
   # For OpenAI
   export OPENAI_API_KEY="your-openai-key-here"
   
   # Or for DeepSeek
   export DEEPSEEK_API_KEY="your-deepseek-key-here"
   ```

4. **Start the worker:**
   ```bash
   npm start
   ```

5. **Connect to admin:**
   - Enter the 6-digit token from your admin webapp
   - Worker will automatically register and be ready for tasks

## What the Setup Does

The `npm run setup` command will:
- ✅ Check Python 3 installation
- ✅ Install Browser Use and dependencies (`pip install -r requirements.txt`)
- ✅ Download Chromium browser (~100MB via Playwright)
- ✅ Test Browser Use integration (if API key is set)

## Manual Setup (Alternative)

If the automatic setup fails, you can install manually:

```bash
cd python
python3 -m pip install -r requirements.txt
python3 -m playwright install chromium
```

## Configuration

### API Keys
The worker supports both OpenAI and DeepSeek APIs:
- **OpenAI**: Set `OPENAI_API_KEY` environment variable
- **DeepSeek**: Set `DEEPSEEK_API_KEY` environment variable

### Admin Connection
- Default admin server: `ws://localhost:3000`
- Can be changed in the worker settings panel

## Usage

1. **Start the worker** with `npm start`
2. **Enter admin token** when prompted
3. **Wait for tasks** from the admin interface
4. **Monitor execution** in the worker overlay

The worker will:
- Show a minimal overlay at the top of your screen
- Connect to the admin server automatically
- Execute browser automation tasks using Browser Use
- Stream real-time logs back to the admin
- Handle credential injection for login forms

## Troubleshooting

### Python Issues
```bash
# Check Python version (must be 3.8+)
python3 --version

# Install Python dependencies manually
cd python
python3 -m pip install browser-use playwright openai

# Test Browser Use
python3 browser_use_agent.py --test --api-key YOUR_KEY
```

### API Key Issues
- Make sure your API key is valid and has credits
- Check that the environment variable is set correctly
- Try testing with a simple OpenAI API call

### Connection Issues
- Verify the admin server is running on `localhost:3000`
- Check firewall settings
- Try restarting both admin and worker

### Browser Issues
- Ensure Chromium was downloaded properly: `python3 -m playwright install chromium`
- Check that no other automation tools are conflicting
- Try running with `--headless=false` to see browser actions

## Architecture

```
Worker Client (Electron)
├── Overlay Interface (renderer/)
├── WebSocket Client (lib/adminConnection.js)
├── Browser Use Manager (lib/browserUseManager.js)
└── Python Agent (python/browser_use_agent.py)
    └── Browser Use Library
        └── Chromium Browser
```

## Development

```bash
# Development mode with developer tools
npm run dev

# Build for distribution
npm run build

# Create installer packages
npm run dist
```

## License

MIT 