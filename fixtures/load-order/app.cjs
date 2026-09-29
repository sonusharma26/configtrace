const dotenv = require('dotenv');
const path = require('node:path');
const first = path.join(__dirname, 'first.env');
const second = path.join(__dirname, 'second.env');
dotenv.config({ path: [first, second], quiet: true });
void process.env.CONFIGTRACE_FIXTURE;
dotenv.config({ path: second, override: true, quiet: true });
void process.env.CONFIGTRACE_FIXTURE;
console.log('Two loader phases completed.');
