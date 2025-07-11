const EventEmitter = require('events');
const { spawn } = require('child_process');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config({ path: path.join(__dirname, '../.env') });

class BrowserUseManager extends EventEmitter {
  constructor() {
    super();
    this.isReady = false;
    this.currentTask = null;
    this.pythonProcess = null;
    this.apiKey = null;
    this.model = 'gpt-4o';
    
    // Set up Python virtual environment paths
    this.setupPythonPaths();
    
    // Load API key from environment or config
    this.loadConfiguration();
  }

  setupPythonPaths() {
    const os = require('os');
    const pythonDir = path.join(__dirname, '../python');
    const venvDir = path.join(pythonDir, 'venv');
    
    // Get platform-specific python executable path
    const isWindows = os.platform() === 'win32';
    this.pythonExecutable = isWindows 
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');
      
    // Check if virtual environment exists
    const fs = require('fs');
    if (!fs.existsSync(this.pythonExecutable)) {
      this.pythonExecutable = 'python3';
      this.emit('log', 'Virtual environment not found, using system Python. Run "npm run setup" to create virtual environment.', 'warning');
    } else {
      this.emit('log', 'Using Python virtual environment for Browser Use');
    }
  }

  loadConfiguration() {
    // Load API key from environment variable - set this in your shell or .env file
    this.apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
    
    // For development, you can also set it directly here (but don't commit to Git):
    // this.apiKey = 'your-api-key-here';
    
    if (!this.apiKey) {
      this.emit('log', 'Warning: No API key configured. Set OPENAI_API_KEY environment variable.', 'warning');
      this.emit('log', 'For development: export OPENAI_API_KEY="your-key-here"', 'info');
    } else {
      this.emit('log', 'API key configured successfully');
    }
  }

  classifyTask(task) {
    /**
     * Classify task to determine if it needs browser automation or can use direct AI
     */
    const taskLower = task.toLowerCase();
    
    // Tasks that definitely need browser automation
    const webActionKeywords = [
      'click', 'fill', 'form', 'login', 'navigate', 'screenshot', 'scroll',
      'download', 'upload', 'button', 'link', 'menu', 'select', 'type',
      'submit', 'sign in', 'sign up', 'enter', 'input', 'website', 'page',
      'browser', 'open', 'close', 'tab', 'window'
    ];
    
    // Tasks that can be done via direct AI
    const researchKeywords = [
      'research', 'analyze', 'summarize', 'compare', 'evaluate', 'find information',
      'tell me about', 'what is', 'explain', 'describe', 'overview', 'report',
      'equity research', 'financial analysis', 'company analysis', 'market research',
      'study', 'investigate', 'examine', 'review', 'assess', 'calculate'
    ];
    
    // Check for web actions first (higher priority)
    if (webActionKeywords.some(keyword => taskLower.includes(keyword))) {
      return 'BROWSER_ACTION';
    }
    
    // Check for research tasks
    if (researchKeywords.some(keyword => taskLower.includes(keyword))) {
      return 'AI_RESEARCH';
    }
    
    // Default to browser action for safety
    return 'BROWSER_ACTION';
  }

  async executeAIResearch(task, credentials = {}) {
    /**
     * Execute research task using direct OpenAI API
     */
    try {
      this.emit('log', `🧠 Executing AI research: ${task}`);
      
      if (!this.apiKey) {
        throw new Error('No OpenAI API key configured for AI research');
      }

      // Import OpenAI dynamically
      let openai;
      try {
        const { Configuration, OpenAIApi } = require('openai');
        const configuration = new Configuration({
          apiKey: this.apiKey,
        });
        openai = new OpenAIApi(configuration);
      } catch (importError) {
        // Fallback to newer OpenAI SDK
        try {
          const OpenAI = require('openai');
          openai = new OpenAI({
            apiKey: this.apiKey,
          });
        } catch (fallbackError) {
          throw new Error('OpenAI package not installed. Run: npm install openai');
        }
      }

      // Enhanced research prompt
      const systemPrompt = "You are a professional research assistant. Provide comprehensive, accurate, and well-structured information.";
      
      const userPrompt = `
Please provide detailed research on the following request:

${task}

Structure your response with:
1. **Executive Summary**
2. **Key Findings**
3. **Detailed Analysis**
4. **Important Considerations**
5. **Conclusion**

${credentials && Object.keys(credentials).length > 0 ? 
  `\nAvailable context/credentials: ${Object.keys(credentials).join(', ')}` : 
  ''
}

Be thorough, factual, and actionable.
`;

      this.emit('log', 'Calling OpenAI API...');
      
      let response;
      try {
        // Try new OpenAI SDK format first
        response = await openai.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 2500,
          temperature: 0.7
        });
        
        return response.choices[0].message.content.trim();
        
      } catch (newSDKError) {
        // Fallback to old SDK format
        response = await openai.createChatCompletion({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 2500,
          temperature: 0.7
        });
        
        return response.data.choices[0].message.content.trim();
      }
      
    } catch (error) {
      this.emit('log', `❌ AI research failed: ${error.message}`, 'error');
      throw error;
    }
  }

  async initialize() {
    if (this.isReady) return;

    this.emit('log', 'Initializing Browser Use manager...');
    
    try {
      // Test if Browser Use is available and working
      await this.testBrowserUse();
      
      this.isReady = true;
      this.emit('status-change', 'ready');
      this.emit('log', 'Browser Use manager ready');
    } catch (error) {
      this.emit('status-change', 'error');
      this.emit('log', `Browser Use initialization failed: ${error.message}`, 'error');
      throw error;
    }
  }

  async testBrowserUse() {
    if (!this.apiKey) {
      this.emit('log', 'Skipping Browser Use test - no API key configured', 'warning');
      return;
    }

    const pythonScript = path.join(__dirname, '../python/browser_use_agent.py');
    
    this.emit('log', 'Testing Browser Use installation...');

    return new Promise((resolve, reject) => {
      const testProcess = spawn(this.pythonExecutable, [
        pythonScript,
        '--test',
        '--api-key', this.apiKey
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '../python'),
        env: {
          ...process.env,
          OPENAI_API_KEY: this.apiKey
        }
      });

      let output = '';
      let errorOutput = '';

      testProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      testProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      testProcess.on('close', (code) => {
        if (code === 0 && output.includes('SUCCESS')) {
          this.emit('log', 'Browser Use test passed successfully');
          resolve();
        } else {
          const error = errorOutput || output || 'Browser Use test failed';
          this.emit('log', `Browser Use test failed: ${error}`, 'error');
          reject(new Error(error));
        }
      });

      testProcess.on('error', (error) => {
        if (error.code === 'ENOENT') {
          reject(new Error('Python3 not found. Please install Python 3.'));
        } else {
          reject(new Error(`Failed to run Browser Use test: ${error.message}`));
        }
      });

      // Timeout for test
      setTimeout(() => {
        testProcess.kill();
        reject(new Error('Browser Use test timed out'));
      }, 30000); // 30 seconds
    });
  }

  async executeTask(task) {
    if (!this.isReady) {
      await this.initialize();
    }

    if (!this.apiKey) {
      throw new Error('No API key configured. Please set OPENAI_API_KEY or DEEPSEEK_API_KEY environment variable.');
    }

    this.currentTask = task;
    this.emit('status-change', 'executing');
    this.emit('log', `🚀 Starting task: ${task.task}`);

    try {
      // Step 1: Classify the task
      const taskType = this.classifyTask(task.task);
      this.emit('log', `📊 Task classified as: ${taskType}`);

      let result;
      
      if (taskType === 'AI_RESEARCH') {
        // Step 2a: Execute via direct AI research
        this.emit('log', '🧠 Executing via AI research (fast path)');
        result = await this.executeAIResearch(task.task, task.credentials);
        
      } else {
        // Step 2b: Execute via browser automation
        this.emit('log', '🌐 Executing via browser automation');
        result = await this.executeBrowserUseTask(task);
      }
      
      this.currentTask = null;
      this.emit('status-change', 'ready');
      this.emit('log', `✅ Task completed successfully`);
      
      return result;
      
    } catch (error) {
      this.currentTask = null;
      this.emit('status-change', 'error');
      this.emit('log', `❌ Task failed: ${error.message}`, 'error');
      throw error;
    }
  }

  async simulateTaskExecution(task) {
    // Simulate different types of tasks for testing
    const steps = [
      'Analyzing task requirements...',
      'Setting up browser environment...',
      'Navigating to target website...',
      'Performing requested actions...',
      'Collecting results...',
      'Cleaning up...'
    ];

    for (let i = 0; i < steps.length; i++) {
      this.emit('log', `Step ${i + 1}/${steps.length}: ${steps[i]}`);
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      // Simulate occasional warnings
      if (Math.random() < 0.2) {
        this.emit('log', 'Warning: Retrying action due to page load delay...', 'warning');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Simulate task results
    const results = [
      'Successfully filled out contact form',
      'Data extracted from 15 product listings', 
      'Email sent to 3 recipients',
      'Form submitted and confirmation received',
      'Screenshots captured of target pages'
    ];

    return results[Math.floor(Math.random() * results.length)];
  }

  async executeBrowserUseTask(task) {
    const pythonScript = path.join(__dirname, '../python/browser_use_agent.py');
    
    // Prepare arguments for Python script
    const args = [
      pythonScript,
      '--task', task.task,
      '--api-key', this.apiKey,
      '--model', this.model
    ];

    // Add credentials if provided
    if (task.credentials && Object.keys(task.credentials).length > 0) {
      args.push('--credentials', JSON.stringify(task.credentials));
    }

    this.emit('log', 'Launching Browser Use Python agent...');

    return new Promise((resolve, reject) => {
      this.pythonProcess = spawn(this.pythonExecutable, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '../python'),
        env: {
          ...process.env,
          OPENAI_API_KEY: this.apiKey,
          PYTHONPATH: path.join(__dirname, '../python')
        }
      });

      let resultOutput = '';
      let hasResult = false;

      // Handle Python process stdout
      this.pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        const lines = output.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('BROWSERUSE_LOG:')) {
            // Parse and emit Browser Use logs
            try {
              const logData = JSON.parse(line.substring('BROWSERUSE_LOG:'.length));
              this.emit('log', logData.message, logData.level);
            } catch (e) {
              this.emit('log', line, 'info');
            }
          } else if (line.startsWith('TASK_RESULT:')) {
            // Capture task result
            resultOutput = line.substring('TASK_RESULT:'.length);
            hasResult = true;
          } else if (line.startsWith('FATAL_ERROR:')) {
            // Handle fatal errors
            const error = line.substring('FATAL_ERROR:'.length);
            reject(new Error(error));
            return;
          } else if (line.trim()) {
            // Regular output
            this.emit('log', line, 'info');
          }
        }
      });

      // Handle Python process stderr
      this.pythonProcess.stderr.on('data', (data) => {
        const error = data.toString().trim();
        if (error) {
          this.emit('log', `Python Error: ${error}`, 'error');
        }
      });

      // Handle process completion
      this.pythonProcess.on('close', (code) => {
        this.pythonProcess = null;
        
        if (code === 0) {
          if (hasResult) {
            resolve(resultOutput);
          } else {
            resolve('Task completed successfully (no specific result returned)');
          }
        } else {
          reject(new Error(`Browser Use agent exited with code ${code}`));
        }
      });

      // Handle process errors
      this.pythonProcess.on('error', (error) => {
        this.pythonProcess = null;
        if (error.code === 'ENOENT') {
          reject(new Error('Python3 not found. Please install Python 3 and ensure it\'s in your PATH.'));
        } else {
          reject(new Error(`Failed to start Python process: ${error.message}`));
        }
      });

      // Set a timeout for very long-running tasks
      const timeout = setTimeout(() => {
        if (this.pythonProcess) {
          this.pythonProcess.kill();
          reject(new Error('Task timed out after 5 minutes'));
        }
      }, 5 * 60 * 1000); // 5 minutes

      // Clear timeout when process completes
      this.pythonProcess.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  async spawnBrowserUseProcess(task, credentials) {
    // Future implementation for Phase 2
    const pythonScript = path.join(__dirname, '../python/browser_use_agent.py');
    
    const args = [
      pythonScript,
      '--task', JSON.stringify(task),
      '--credentials', JSON.stringify(credentials)
    ];

    this.pythonProcess = spawn('python3', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '../python')
    });

    // Handle Python process output
    this.pythonProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        this.emit('log', output);
      }
    });

    this.pythonProcess.stderr.on('data', (data) => {
      const error = data.toString().trim();
      if (error) {
        this.emit('log', error, 'error');
      }
    });

    return new Promise((resolve, reject) => {
      this.pythonProcess.on('close', (code) => {
        if (code === 0) {
          resolve('Task completed successfully');
        } else {
          reject(new Error(`Python process exited with code ${code}`));
        }
      });

      this.pythonProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  getCurrentTask() {
    return this.currentTask;
  }

  isExecuting() {
    return this.currentTask !== null;
  }

  getStatus() {
    if (!this.isReady) return 'initializing';
    if (this.currentTask) return 'executing';
    return 'ready';
  }

  cleanup() {
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
    this.currentTask = null;
    this.isReady = false;
  }
}

module.exports = BrowserUseManager; 