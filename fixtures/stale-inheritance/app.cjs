const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, 'sample.env'), quiet: true });
const endpoint = process.env.DATABASE_URL;
console.log(endpoint ? 'Database endpoint configured.' : 'No database endpoint.');
