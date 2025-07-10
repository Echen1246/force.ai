#!/usr/bin/env python3
"""
Browser Use Agent - Python wrapper for Browser Use automation
Handles task execution, credential injection, and logging
"""

import os
import sys
import json
import argparse
import asyncio
import traceback
from datetime import datetime
from typing import Dict, Any, Optional

# Add current directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from browser_use import Agent
    from browser_use.llm import ChatOpenAI
    import os
except ImportError as e:
    print(f"ERROR: Missing required packages. Please install with: pip install -r requirements.txt")
    print(f"Import error: {e}")
    sys.exit(1)

class BrowserUseAgent:
    def __init__(self, api_key: str, model: str = "gpt-4o"):
        """Initialize the Browser Use agent with API configuration."""
        self.api_key = api_key
        
        # Set OpenAI API key in environment
        os.environ['OPENAI_API_KEY'] = api_key
        self.model_name = model
        self.log("info", "Using OpenAI API")
        
        # Create LLM instance using browser-use's own wrapper
        self.llm = ChatOpenAI(model=self.model_name)
        
        self.log("info", f"Browser Use Agent initialized with model: {self.model_name}")

    def log(self, level: str, message: str):
        """Send log messages to stdout for Node.js to capture."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = {
            "timestamp": timestamp,
            "level": level,
            "message": message
        }
        print(f"BROWSERUSE_LOG:{json.dumps(log_entry)}")
        sys.stdout.flush()

    async def create_agent(self, task: str) -> Agent:
        """Create a Browser Use agent with the given task."""
        try:
            self.log("info", "Creating Browser Use agent...")
            
            # Create agent with task and LLM - browser-use handles the browser automatically
            agent = Agent(
                task=task,
                llm=self.llm
            )
            
            self.log("info", "Browser Use agent created successfully")
            return agent
            
        except Exception as e:
            self.log("error", f"Failed to create agent: {str(e)}")
            raise

    def format_credentials(self, credentials: Dict[str, str]) -> str:
        """Format credentials for inclusion in task context."""
        try:
            if not credentials:
                return ""
                
            self.log("info", f"Formatting {len(credentials)} credentials")
            
            credential_context = ""
            for key, value in credentials.items():
                # Convert credential keys to readable format
                readable_key = key.replace('_', ' ').title()
                credential_context += f"{readable_key}: {value}\n"
            
            return credential_context.strip()
            
        except Exception as e:
            self.log("error", f"Failed to format credentials: {str(e)}")
            return ""

    def format_result(self, result) -> str:
        """Format Browser Use result into readable output."""
        try:
            if result is None:
                return "Task completed successfully (no specific result returned)"
            
            # If result is a string, return it as-is
            if isinstance(result, str):
                return result.strip()
            
            # If result has a text or message attribute
            if hasattr(result, 'text') and result.text:
                return result.text.strip()
            if hasattr(result, 'message') and result.message:
                return result.message.strip()
            
            # If result is a dict-like object
            if hasattr(result, '__dict__'):
                result_dict = result.__dict__
                
                # Look for common Browser Use result fields
                if 'text' in result_dict and result_dict['text']:
                    return result_dict['text'].strip()
                if 'content' in result_dict and result_dict['content']:
                    return result_dict['content'].strip()
                if 'result' in result_dict and result_dict['result']:
                    return str(result_dict['result']).strip()
            
            # If result is a list, format as numbered list
            if isinstance(result, list):
                if len(result) == 0:
                    return "Task completed - no items found"
                elif len(result) == 1:
                    return f"Found: {str(result[0]).strip()}"
                else:
                    formatted_items = []
                    for i, item in enumerate(result[:10], 1):  # Limit to first 10 items
                        formatted_items.append(f"{i}. {str(item).strip()}")
                    result_text = "Found the following:\n" + "\n".join(formatted_items)
                    if len(result) > 10:
                        result_text += f"\n... and {len(result) - 10} more items"
                    return result_text
            
            # If result is a dict, format key-value pairs
            if isinstance(result, dict):
                if len(result) == 0:
                    return "Task completed - no data found"
                
                formatted_pairs = []
                for key, value in list(result.items())[:10]:  # Limit to first 10 pairs
                    formatted_pairs.append(f"• {key}: {str(value).strip()}")
                result_text = "Found the following information:\n" + "\n".join(formatted_pairs)
                if len(result) > 10:
                    result_text += f"\n... and {len(result) - 10} more items"
                return result_text
            
            # For any other type, convert to string but clean it up
            result_str = str(result).strip()
            
            # Remove common unwanted patterns
            if result_str.startswith("Agent(") and result_str.endswith(")"):
                return "Task completed successfully"
            
            # If it's too long, truncate it
            if len(result_str) > 500:
                result_str = result_str[:500] + "... (truncated)"
            
            return result_str if result_str else "Task completed successfully"
            
        except Exception as e:
            self.log("error", f"Failed to format result: {str(e)}")
            return f"Task completed, but result formatting failed: {str(result)[:200]}"

    async def execute_task(self, task: str, credentials: Dict[str, str] = None) -> str:
        """Execute a browser automation task using Browser Use."""
        try:
            self.log("info", f"Starting task execution: {task}")
            
            # Inject credentials into task if provided
            if credentials:
                credential_context = self.format_credentials(credentials)
                task_with_credentials = f"{task}\n\nAvailable credentials:\n{credential_context}"
                self.log("info", f"Using {len(credentials)} credentials for task")
            else:
                task_with_credentials = task
            
            # Create and run agent - browser-use handles everything automatically
            agent = await self.create_agent(task_with_credentials)
            
            self.log("info", "Executing browser automation...")
            
            # Execute the task
            result = await agent.run()
            
            # Format the result properly
            formatted_result = self.format_result(result)
            
            self.log("info", f"Task execution completed successfully")
            return formatted_result
            
        except Exception as e:
            error_msg = f"Task execution failed: {str(e)}"
            self.log("error", error_msg)
            self.log("error", f"Traceback: {traceback.format_exc()}")
            raise Exception(error_msg)

    async def test_connection(self) -> bool:
        """Test if Browser Use can be initialized properly."""
        try:
            self.log("info", "Testing Browser Use connection...")
            
            # Test simple agent creation - this validates LLM and browser setup
            test_agent = Agent(
                task="test connection - just verify setup",
                llm=self.llm
            )
            
            self.log("info", "Browser Use connection test successful")
            return True
            
        except Exception as e:
            self.log("error", f"Browser Use connection test failed: {str(e)}")
            return False

async def main():
    """Main entry point for the Browser Use agent."""
    parser = argparse.ArgumentParser(description="Browser Use Agent")
    parser.add_argument("--task", help="Task description to execute")
    parser.add_argument("--credentials", help="JSON string of credentials")
    parser.add_argument("--api-key", required=True, help="OpenAI API key")
    parser.add_argument("--model", default="gpt-4o", help="LLM model to use")
    parser.add_argument("--test", action="store_true", help="Test connection only")
    
    args = parser.parse_args()
    
    # Parse credentials if provided
    credentials = {}
    if args.credentials:
        try:
            credentials = json.loads(args.credentials)
        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid credentials JSON: {e}")
            sys.exit(1)
    
    # Initialize agent
    agent = BrowserUseAgent(api_key=args.api_key, model=args.model)
    
    try:
        if args.test:
            # Test mode
            success = await agent.test_connection()
            if success:
                print("SUCCESS: Browser Use is working correctly")
                sys.exit(0)
            else:
                print("ERROR: Browser Use test failed")
                sys.exit(1)
        else:
            # Execute task mode - task is required
            if not args.task:
                print("ERROR: --task is required when not in test mode")
                sys.exit(1)
            result = await agent.execute_task(args.task, credentials)
            print(f"TASK_RESULT:{result}")
            
    except Exception as e:
        print(f"FATAL_ERROR:{str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main()) 