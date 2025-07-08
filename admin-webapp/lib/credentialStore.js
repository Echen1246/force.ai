const fs = require('fs');
const path = require('path');

class CredentialStore {
  constructor() {
    this.dataFile = path.join(__dirname, '../data/credentials.json');
    this.credentials = new Map();
    this.loadCredentials();
  }

  loadCredentials() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = fs.readFileSync(this.dataFile, 'utf8');
        const savedCredentials = JSON.parse(data);
        
        for (const [key, value] of Object.entries(savedCredentials)) {
          this.credentials.set(key, value);
        }
        
        console.log(`📚 Loaded ${this.credentials.size} credentials`);
      } else {
        // Create with some default examples
        this.setDefaultCredentials();
      }
    } catch (error) {
      console.error('❌ Error loading credentials:', error);
      this.setDefaultCredentials();
    }
  }

  setDefaultCredentials() {
    // Set some example credentials for testing
    this.credentials.set('google_username', 'your.email@gmail.com');
    this.credentials.set('google_password', 'your_password_here');
    this.credentials.set('linkedin_username', 'your.email@company.com');
    this.credentials.set('linkedin_password', 'your_linkedin_password');
    this.saveCredentials();
    console.log('📚 Created default credential examples');
  }

  saveCredentials() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dataFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const credentialsObj = {};
      for (const [key, value] of this.credentials.entries()) {
        credentialsObj[key] = value;
      }
      
      fs.writeFileSync(this.dataFile, JSON.stringify(credentialsObj, null, 2));
    } catch (error) {
      console.error('❌ Error saving credentials:', error);
    }
  }

  setCredential(key, value) {
    if (!key || key.trim() === '') {
      throw new Error('Credential key cannot be empty');
    }
    
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
    this.credentials.set(normalizedKey, value);
    this.saveCredentials();
    
    console.log(`🔑 Credential updated: ${normalizedKey}`);
    return normalizedKey;
  }

  getCredential(key) {
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
    return this.credentials.get(normalizedKey);
  }

  removeCredential(key) {
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
    const existed = this.credentials.delete(normalizedKey);
    
    if (existed) {
      this.saveCredentials();
      console.log(`🗑️ Credential removed: ${normalizedKey}`);
    }
    
    return existed;
  }

  getAllCredentials() {
    const credentialsObj = {};
    for (const [key, value] of this.credentials.entries()) {
      credentialsObj[key] = value;
    }
    return credentialsObj;
  }

  getCredentialsForWorker(requestedKeys = []) {
    const result = {};
    
    if (requestedKeys.length === 0) {
      // Return all credentials if no specific keys requested
      return this.getAllCredentials();
    }
    
    for (const key of requestedKeys) {
      const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
      const value = this.credentials.get(normalizedKey);
      if (value !== undefined) {
        result[normalizedKey] = value;
      }
    }
    
    return result;
  }

  searchCredentials(pattern) {
    const results = {};
    const searchPattern = pattern.toLowerCase();
    
    for (const [key, value] of this.credentials.entries()) {
      if (key.includes(searchPattern)) {
        results[key] = value;
      }
    }
    
    return results;
  }

  // Helper method to get credentials in natural language format for display
  getCredentialsDisplay() {
    const display = [];
    
    for (const [key, value] of this.credentials.entries()) {
      // Convert underscore format back to readable format
      const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      display.push({
        key: key,
        displayKey: readableKey,
        value: value,
        // Mask passwords for security
        displayValue: key.includes('password') ? '*'.repeat(value.length) : value
      });
    }
    
    return display;
  }

  // Validate credentials format
  validateCredentials() {
    const issues = [];
    
    for (const [key, value] of this.credentials.entries()) {
      if (!value || value.trim() === '') {
        issues.push(`Empty value for credential: ${key}`);
      }
      
      if (key.includes('email') || key.includes('username')) {
        if (!value.includes('@') && !value.includes('.')) {
          issues.push(`Possibly invalid email/username format: ${key}`);
        }
      }
    }
    
    return issues;
  }

  getCredentialCount() {
    return this.credentials.size;
  }
}

module.exports = CredentialStore; 