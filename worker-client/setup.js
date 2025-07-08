#!/usr/bin/env node
/**
 * Setup script for Browser Use Worker Client
 * Handles Python environment setup and dependency installation
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class WorkerSetup {
  constructor() {
    this.pythonPath = path.join(__dirname, 'python');
    this.requirementsPath = path.join(this.pythonPath, 'requirements.txt');
  }

  log(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : '✅';
    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  async checkPython() {
    this.log('Checking Python installation...');
    
    return new Promise((resolve, reject) => {
      const python = spawn('python3', ['--version'], { stdio: 'pipe' });
      
      let output = '';
      python.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      python.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      python.on('close', (code) => {
        if (code === 0) {
          const version = output.trim();
          this.log(`Found ${version}`);
          resolve(version);
        } else {
          reject(new Error('Python 3 not found. Please install Python 3.8 or later.'));
        }
      });
      
      python.on('error', (error) => {
        if (error.code === 'ENOENT') {
          reject(new Error('Python 3 not found. Please install Python 3.8 or later.'));
        } else {
          reject(error);
        }
      });
    });
  }

  async createVirtualEnv() {
    const venvPath = path.join(this.pythonPath, 'venv');
    
    this.log('Creating Python virtual environment...');
    
    return new Promise((resolve, reject) => {
      const venv = spawn('python3', ['-m', 'venv', 'venv'], {
        stdio: 'pipe',
        cwd: this.pythonPath
      });
      
      let output = '';
      let errorOutput = '';
      
      venv.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      venv.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      venv.on('close', (code) => {
        if (code === 0) {
          this.log('Virtual environment created successfully');
          this.venvPath = venvPath;
          resolve();
        } else {
          this.log(`Virtual environment creation failed with code ${code}`, 'error');
          this.log(`Error output: ${errorOutput}`, 'error');
          reject(new Error('Failed to create virtual environment'));
        }
      });
      
      venv.on('error', (error) => {
        reject(new Error(`Failed to create virtual environment: ${error.message}`));
      });
    });
  }

  async installDependencies() {
    this.log('Installing Python dependencies...');
    this.log('This may take a few minutes...');
    
    // Get platform-specific pip path
    const isWindows = os.platform() === 'win32';
    const pipPath = isWindows 
      ? path.join(this.venvPath, 'Scripts', 'pip')
      : path.join(this.venvPath, 'bin', 'pip');
    
    return new Promise((resolve, reject) => {
      const pip = spawn(pipPath, ['install', '-r', this.requirementsPath], {
        stdio: 'pipe',
        cwd: this.pythonPath
      });
      
      let output = '';
      let errorOutput = '';
      
      pip.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        // Show progress for long installations
        if (text.includes('Collecting') || text.includes('Installing')) {
          process.stdout.write('.');
        }
      });
      
      pip.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      pip.on('close', (code) => {
        console.log(''); // New line after progress dots
        
        if (code === 0) {
          this.log('Python dependencies installed successfully');
          resolve();
        } else {
          this.log(`Pip installation failed with code ${code}`, 'error');
          this.log(`Error output: ${errorOutput}`, 'error');
          reject(new Error('Failed to install Python dependencies'));
        }
      });
      
      pip.on('error', (error) => {
        console.log(''); // New line after progress dots
        reject(new Error(`Failed to run pip: ${error.message}`));
      });
    });
  }

  async installPlaywright() {
    this.log('Installing Playwright browsers...');
    this.log('This will download Chromium (~100MB)...');
    
    // Get platform-specific python path  
    const isWindows = os.platform() === 'win32';
    const pythonPath = isWindows 
      ? path.join(this.venvPath, 'Scripts', 'python')
      : path.join(this.venvPath, 'bin', 'python');
    
    return new Promise((resolve, reject) => {
      const playwright = spawn(pythonPath, ['-m', 'playwright', 'install', 'chromium'], {
        stdio: 'pipe',
        cwd: this.pythonPath
      });
      
      let output = '';
      let errorOutput = '';
      
      playwright.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        // Show download progress
        if (text.includes('Downloading') || text.includes('%')) {
          process.stdout.write('.');
        }
      });
      
      playwright.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      playwright.on('close', (code) => {
        console.log(''); // New line after progress dots
        
        if (code === 0) {
          this.log('Playwright browsers installed successfully');
          resolve();
        } else {
          this.log(`Playwright installation failed with code ${code}`, 'error');
          this.log(`Error output: ${errorOutput}`, 'error');
          reject(new Error('Failed to install Playwright browsers'));
        }
      });
      
      playwright.on('error', (error) => {
        console.log(''); // New line after progress dots
        reject(new Error(`Failed to run Playwright install: ${error.message}`));
      });
    });
  }

  async testBrowserUse(apiKey) {
    this.log('Testing Browser Use installation...');
    
    const scriptPath = path.join(this.pythonPath, 'browser_use_agent.py');
    
    // Get platform-specific python path
    const isWindows = os.platform() === 'win32';
    const pythonPath = isWindows 
      ? path.join(this.venvPath, 'Scripts', 'python')
      : path.join(this.venvPath, 'bin', 'python');
    
    return new Promise((resolve, reject) => {
      const test = spawn(pythonPath, [scriptPath, '--test', '--api-key', apiKey], {
        stdio: 'pipe',
        cwd: this.pythonPath,
        env: {
          ...process.env,
          OPENAI_API_KEY: apiKey
        }
      });
      
      let output = '';
      let errorOutput = '';
      
      test.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      test.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      test.on('close', (code) => {
        if (code === 0 && output.includes('SUCCESS')) {
          this.log('Browser Use test passed!');
          resolve();
        } else {
          const error = errorOutput || output || 'Browser Use test failed';
          this.log(`Browser Use test failed: ${error}`, 'error');
          reject(new Error(error));
        }
      });
      
      test.on('error', (error) => {
        reject(new Error(`Failed to run Browser Use test: ${error.message}`));
      });
    });
  }

  getSystemInfo() {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cwd: process.cwd()
    };
  }

  async run() {
    console.log('🚀 Browser Use Worker Client Setup');
    console.log('=====================================');
    
    const sysInfo = this.getSystemInfo();
    this.log(`Platform: ${sysInfo.platform} ${sysInfo.arch}`);
    this.log(`Node.js: ${sysInfo.nodeVersion}`);
    
    try {
      // Step 1: Check Python
      await this.checkPython();
      
      // Step 2: Create virtual environment
      await this.createVirtualEnv();
      
      // Step 3: Install Python dependencies
      await this.installDependencies();
      
      // Step 4: Install Playwright
      await this.installPlaywright();
      
      // Step 5: Test with API key if provided
      const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
      if (apiKey) {
        await this.testBrowserUse(apiKey);
      } else {
        this.log('No API key found in environment variables', 'warning');
        this.log('Set OPENAI_API_KEY or DEEPSEEK_API_KEY to test Browser Use', 'warning');
      }
      
      console.log('\n🎉 Setup completed successfully!');
      console.log('\nNext steps:');
      console.log('1. Set your API key: export OPENAI_API_KEY="your-key-here"');
      console.log('2. Start the worker: npm start');
      console.log('3. Enter the admin token when prompted');
      
    } catch (error) {
      console.log('\n❌ Setup failed!');
      console.log(`Error: ${error.message}`);
      console.log('\nTroubleshooting:');
      console.log('1. Make sure Python 3.8+ is installed');
      console.log('2. Check your internet connection');
      console.log('3. Try running with admin/sudo if permission errors occur');
      process.exit(1);
    }
  }
}

// CLI handling
if (require.main === module) {
  const setup = new WorkerSetup();
  setup.run().catch(console.error);
}

module.exports = WorkerSetup; 