const target = {};
require('dotenv').config({ path: require('node:path').join(__dirname, 'sample.env'), processEnv: target, quiet: true });
void process.env.DATABASE_URL;
console.log(Object.hasOwn(target, 'DATABASE_URL') ? 'Custom object loaded.' : 'Custom object not loaded.');
