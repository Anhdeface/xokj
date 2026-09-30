#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distCli = path.resolve(__dirname, '../dist/cli.js');
const srcCli = path.resolve(__dirname, '../src/cli.ts');

async function main() {
  const cliModulePath = fs.existsSync(distCli) ? distCli : srcCli;
  const { runCli } = await import(cliModulePath);
  await runCli(process.argv);
}

main().catch((err) => {
  console.error(`Fatal CLI error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
