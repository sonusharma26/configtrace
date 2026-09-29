const value = process.env.CONFIGTRACE_FIXTURE;
console.log(JSON.stringify({ present: value !== undefined }));
