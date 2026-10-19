// Shared configuration for MES and CPS backends. Override with environment variables.
var path = require('path');

module.exports = {
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', // XAMPP default: root without password
    database: process.env.DB_NAME || 'smartfarm'
  },
  python: process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
  analyticsDir: path.join(__dirname, '..', 'analytics'),
  tokenSecret: process.env.TOKEN_SECRET || 'smartfarm-offline-secret-change-me',
  tokenHours: 12,
  mesPort: parseInt(process.env.MES_PORT || '4000', 10),
  cpsPort: parseInt(process.env.CPS_PORT || '5000', 10)
};
