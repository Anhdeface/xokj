import { Command, Option, CommanderError } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePatterns } from './engine/glob.js';
import { scanFiles } from './engine/scanner.js';
import { formatDiagnostics } from './reporter/formatter.js';

import { fileURLToPath } from 'node:url';

function getPackageVersion(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(currentDir, '../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (typeof pkg.version === 'string') {
        return pkg.version;
      }
    }
  } catch {
    // Fallback if bundled or file system access is restricted
  }
  return '0.1.0';
}

export interface RunCliOptions {
  exitOverride?: boolean;
  from?: 'node' | 'user';
}

/**
 * Runs the XoBrow CLI with the provided argv array.
 * Returns the numeric exit code (0, 1, or 2).
 */
export async function runCli(
  argv: string[] = process.argv,
  cliOptions: RunCliOptions = {}
): Promise<number> {
  const binName = path.basename(argv[1] || argv[0] || 'xobrow').replace(/\.[cm]?js$/, '');
  const commandName = binName === 'xb' ? 'xb' : 'xobrow';
  const version = getPackageVersion();

  const program = new Command();
  program
    .name(commandName)
    .description('Uncompromising standalone CLI static analysis and security audit tool for userscripts targeting xokj')
    .version(version, '-v, --version', 'output the version number')
    .helpOption('-h, --help', 'display help for command')
    .exitOverride();

  let finalExitCode = 0;

  program
    .command('check [patterns...]', { isDefault: true })
    .description('Audit userscript files against security, leak, and CDP protocol rules')
    .option('-s, --strict', 'Treat warnings as errors (exits with code 1 if any warnings are detected)', false)
    .addOption(
      new Option('-f, --format <format>', 'Diagnostic reporter format')
        .choices(['stylish', 'json'])
        .default('stylish')
    )
    .option('-q, --quiet', 'Suppress warnings and passing summary messages', false)
    .action(async (patterns: string[], options: { strict: boolean; format: 'stylish' | 'json'; quiet: boolean }) => {
      if (!patterns || patterns.length === 0) {
        console.error(`Error: No input files or patterns specified.\nRun '${commandName} --help' for usage information.`);
        finalExitCode = 2;
        return;
      }

      try {
        // Step 1: Expand patterns into deduplicated absolute paths
        const matchedFiles = resolvePatterns(patterns, { cwd: process.cwd() });
        if (matchedFiles.length === 0) {
          console.error(`Error: No matching files found for: ${patterns.join(', ')}`);
          finalExitCode = 2;
          return;
        }

        // Step 2: Scan files with read-only access
        const summary = await scanFiles(matchedFiles, { strict: options.strict });

        // Step 3: Format diagnostics
        const sourceProvider = (filePath: string) => {
          try {
            return fs.readFileSync(filePath, 'utf-8');
          } catch (err: any) {
            if (err.code === 'EACCES') {
              throw new Error(`Unable to read file: ${filePath} (EACCES: permission denied)`);
            }
            throw new Error(`Unable to read file: ${filePath} (${err.message})`);
          }
        };

        const formatted = formatDiagnostics(summary.results, sourceProvider, {
          format: options.format,
          quiet: options.quiet,
          color: process.stdout.isTTY && !process.env.NO_COLOR
        });

        if (formatted) {
          console.log(formatted);
        }

        finalExitCode = summary.exitCode;
      } catch (err: any) {
        console.error(`Error: ${err.message || String(err)}`);
        finalExitCode = 2;
      }
    });

  try {
    if (cliOptions.from) {
      await program.parseAsync(argv, { from: cliOptions.from });
    } else {
      await program.parseAsync(argv);
    }
  } catch (err: any) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
        if (cliOptions.exitOverride) return 0;
        process.exit(0);
      }
      if (cliOptions.exitOverride) return 2;
      process.exit(2);
    }
    console.error(`Error: ${err.message || String(err)}`);
    if (cliOptions.exitOverride) return 2;
    process.exit(2);
  }

  if (cliOptions.exitOverride) {
    return finalExitCode;
  }
  process.exit(finalExitCode);
}
