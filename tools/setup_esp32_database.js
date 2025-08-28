#!/usr/bin/env node

/**
 * Cross-Platform ESP32 Database Setup Script
 * Works on Windows, macOS, and Linux
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Determine database path based on OS
function getDatabasePath() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Windows: Check for WIN_DATA_ROOT or use local data directory
    const winDataRoot = process.env.WIN_DATA_ROOT;
    if (winDataRoot && fs.existsSync(winDataRoot)) {
      return path.join(winDataRoot, 'gmgmt.sqlite');
    }
    // Fallback to local data directory
    return path.join(__dirname, '..', 'data', 'gmgmt.sqlite');
  } else {
    // Unix-like systems (macOS, Linux)
    return path.join(__dirname, '..', 'data', 'gmgmt.sqlite');
  }
}

// Get SQL file path
function getSQLFilePath() {
  return path.join(__dirname, 'setup_esp32_devices.sql');
}

// Cross-platform SQLite execution
async function executeSQLFile() {
  const { execSync } = require('child_process');
  const platform = os.platform();
  
  const dbPath = getDatabasePath();
  const sqlPath = getSQLFilePath();
  
  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`📁 Created data directory: ${dataDir}`);
  }
  
  // Check if SQL file exists
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`SQL file not found: ${sqlPath}`);
  }
  
  console.log(`🗄️  Database path: ${dbPath}`);
  console.log(`📄 SQL file path: ${sqlPath}`);
  
  try {
    if (platform === 'win32') {
      // Windows: Try different SQLite installation methods
      await executeWindowsSQLite(dbPath, sqlPath);
    } else {
      // Unix-like systems
      await executeUnixSQLite(dbPath, sqlPath);
    }
    
    console.log('✅ ESP32 device tables created successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    
    // Fallback: Use Node.js SQLite library
    console.log('🔄 Attempting fallback method with better-sqlite3...');
    return await fallbackSQLiteExecution(dbPath, sqlPath);
  }
}

// Windows SQLite execution
async function executeWindowsSQLite(dbPath, sqlPath) {
  const { execSync } = require('child_process');
  
  // Try different Windows SQLite command variations
  const sqliteCommands = [
    'sqlite3',           // If installed globally
    'sqlite3.exe',       // Windows executable
    'sqlite',            // Alternative name
    'wsl sqlite3'        // WSL fallback
  ];
  
  for (const cmd of sqliteCommands) {
    try {
      const command = `${cmd} "${dbPath}" < "${sqlPath}"`;
      console.log(`🔧 Trying command: ${command}`);
      
      execSync(command, { 
        stdio: 'inherit', 
        windowsHide: true,
        timeout: 30000 
      });
      return; // Success
      
    } catch (error) {
      console.log(`⚠️  Command failed: ${cmd}`);
      continue; // Try next command
    }
  }
  
  throw new Error('SQLite not found. Please install SQLite or use npm run esp32:setup:fallback');
}

// Unix SQLite execution
async function executeUnixSQLite(dbPath, sqlPath) {
  const { execSync } = require('child_process');
  
  const command = `sqlite3 "${dbPath}" < "${sqlPath}"`;
  console.log(`🔧 Executing: ${command}`);
  
  execSync(command, { 
    stdio: 'inherit',
    timeout: 30000 
  });
}

// Fallback method using better-sqlite3
async function fallbackSQLiteExecution(dbPath, sqlPath) {
  try {
    // Try to require better-sqlite3
    const Database = require('better-sqlite3');
    
    console.log('📚 Using better-sqlite3 for database setup');
    
    // Read SQL file
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split into individual statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    // Open database
    const db = new Database(dbPath);
    
    // Execute each statement
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          db.exec(statement + ';');
          console.log(`✅ Executed: ${statement.substring(0, 50)}...`);
        } catch (error) {
          // Ignore "table already exists" errors
          if (!error.message.includes('already exists')) {
            console.warn(`⚠️  Warning: ${error.message}`);
          }
        }
      }
    }
    
    db.close();
    console.log('✅ ESP32 device tables created using better-sqlite3');
    return true;
    
  } catch (error) {
    console.error('❌ Fallback method failed:', error.message);
    console.log('');
    console.log('🔧 Manual setup required:');
    console.log('1. Install SQLite3 command line tool');
    console.log('2. Run: npm run esp32:setup:manual');
    console.log('3. Or install better-sqlite3: npm install better-sqlite3');
    return false;
  }
}

// Check system requirements
function checkSystemRequirements() {
  const platform = os.platform();
  console.log(`🖥️  Platform: ${platform}`);
  console.log(`🏗️  Architecture: ${os.arch()}`);
  console.log(`📂 Working directory: ${process.cwd()}`);
  
  // Check Node.js version
  const nodeVersion = process.version;
  console.log(`🟢 Node.js version: ${nodeVersion}`);
  
  if (platform === 'win32') {
    console.log('🪟 Windows detected - using Windows-compatible methods');
    
    // Check if WSL is available
    try {
      const { execSync } = require('child_process');
      execSync('wsl --version', { stdio: 'ignore' });
      console.log('🐧 WSL detected - WSL SQLite available as fallback');
    } catch (error) {
      console.log('📝 WSL not detected');
    }
  }
  
  return true;
}

// Main execution
async function main() {
  console.log('🚀 ESP32 Database Setup');
  console.log('========================');
  
  try {
    checkSystemRequirements();
    console.log('');
    
    await executeSQLFile();
    
    console.log('');
    console.log('🎉 Setup completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Start the biometric service: npm run start:with-biometric');
    console.log('2. Test ESP32 integration: npm run esp32:test');
    console.log('3. View deployment guide: ESP32_DEPLOYMENT_GUIDE.md');
    
    process.exit(0);
    
  } catch (error) {
    console.error('');
    console.error('❌ Setup failed:', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('• Install SQLite: https://sqlite.org/download.html');
    console.error('• For Windows: Download sqlite-tools and add to PATH');
    console.error('• Alternative: npm install better-sqlite3');
    console.error('• Manual setup: npm run esp32:setup:manual');
    
    process.exit(1);
  }
}

// Handle command line execution
if (require.main === module) {
  main();
}

module.exports = {
  getDatabasePath,
  getSQLFilePath,
  executeSQLFile,
  checkSystemRequirements
};
