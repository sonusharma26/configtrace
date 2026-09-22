// Compile this fixture separately when validating source-map attribution.
export function configuredEndpoint(): string | undefined {
  return process.env.DATABASE_URL;
}
console.log(configuredEndpoint() ? 'Configured.' : 'Missing.');
