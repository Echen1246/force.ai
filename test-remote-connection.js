#!/usr/bin/env node

/**
 * Test script to verify remote worker connections
 * Run this on any device/network to test connectivity
 */

const WebSocket = require('ws');

const PRODUCTION_URL = 'wss://cautious-jail-production.up.railway.app';
const LOCAL_URL = 'ws://localhost:3000';

class ConnectionTest {
  constructor() {
    this.testResults = {
      production: { success: false, error: null },
      local: { success: false, error: null }
    };
  }

  async testConnection(url, label) {
    console.log(`\n🧪 Testing ${label} connection to: ${url}`);
    
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      let connected = false;
      
      const timeout = setTimeout(() => {
        if (!connected) {
          ws.close();
          console.log(`❌ ${label}: Connection timeout (10s)`);
          resolve({ success: false, error: 'Connection timeout' });
        }
      }, 10000);
      
      ws.on('open', () => {
        connected = true;
        clearTimeout(timeout);
        console.log(`✅ ${label}: Connected successfully!`);
        
        // Send test message
        ws.send(JSON.stringify({
          type: 'CONNECTION_TEST',
          timestamp: Date.now(),
          userAgent: 'RemoteConnectionTest/1.0'
        }));
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log(`📨 ${label}: Received message type: ${message.type}`);
          ws.close(1000, 'Test complete');
          resolve({ success: true, message: message });
        } catch (error) {
          console.log(`⚠️ ${label}: Received non-JSON message`);
        }
      });
      
      ws.on('close', (code, reason) => {
        if (connected) {
          console.log(`📡 ${label}: Connection closed (${code})`);
          if (!timeout._destroyed) {
            clearTimeout(timeout);
            resolve({ success: true });
          }
        }
      });
      
      ws.on('error', (error) => {
        connected = false;
        clearTimeout(timeout);
        console.log(`❌ ${label}: Connection failed - ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  async runTests() {
    console.log('🚀 Browser Use Remote Connection Test');
    console.log('=====================================');
    
    // Test production deployment
    this.testResults.production = await this.testConnection(PRODUCTION_URL, 'PRODUCTION');
    
    // Test local development server (if running)
    this.testResults.local = await this.testConnection(LOCAL_URL, 'LOCAL');
    
    this.printResults();
  }

  printResults() {
    console.log('\n📊 TEST RESULTS SUMMARY');
    console.log('=======================');
    
    if (this.testResults.production.success) {
      console.log('✅ PRODUCTION: Remote workers can connect globally');
      console.log(`   🌐 URL: ${PRODUCTION_URL}`);
      console.log('   📱 Workers on different devices/networks will work');
    } else {
      console.log('❌ PRODUCTION: Remote connection failed');
      console.log(`   🔧 Error: ${this.testResults.production.error}`);
      console.log('   🚨 Workers on other devices cannot connect');
    }
    
    if (this.testResults.local.success) {
      console.log('✅ LOCAL: Development server is running');
      console.log(`   🏠 URL: ${LOCAL_URL}`);
    } else {
      console.log('⚠️ LOCAL: Development server not running (expected)');
    }
    
    console.log('\n🎯 NEXT STEPS:');
    if (this.testResults.production.success) {
      console.log('1. ✅ Deploy admin webapp - DONE');
      console.log('2. ✅ Update worker client URLs - DONE');
      console.log('3. 📦 Package worker app for distribution');
      console.log('4. 🧪 Test from different devices/networks');
      console.log('5. 🔑 Implement secure connection codes');
    } else {
      console.log('1. 🔧 Fix production deployment issues');
      console.log('2. 🔍 Check Railway logs for errors');
      console.log('3. 🌐 Verify domain and SSL certificate');
    }
  }
}

// Network diagnostics
async function checkNetworkInfo() {
  console.log('\n🌐 NETWORK DIAGNOSTICS');
  console.log('======================');
  
  try {
    // Get public IP
    const fetch = require('node-fetch');
    const ipResponse = await fetch('https://api.ipify.org?format=json');
    const ipData = await ipResponse.json();
    console.log(`📍 Your public IP: ${ipData.ip}`);
  } catch (error) {
    console.log('⚠️ Could not determine public IP');
  }
  
  console.log(`💻 Platform: ${process.platform}`);
  console.log(`🏗️ Node.js: ${process.version}`);
  console.log(`📁 Working directory: ${process.cwd()}`);
}

// Run the tests
async function main() {
  await checkNetworkInfo();
  
  const test = new ConnectionTest();
  await test.runTests();
}

// Handle different execution contexts
if (require.main === module) {
  // Check if WebSocket module is available
  try {
    require('ws');
  } catch (error) {
    console.log('❌ WebSocket module not found. Please run: npm install ws node-fetch');
    process.exit(1);
  }
  
  main().catch(console.error);
} else {
  module.exports = ConnectionTest;
} 