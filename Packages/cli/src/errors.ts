// Exit codes and the errors that map to them. One table, the same in both modes (docs/cli.md, "Conventions").

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_FOUND = 3;
export const EXIT_LOCKED = 4;

/** Wrong use: an unknown flag, an extra argument, values that contradict each other, a bad config file. Exit 2. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** A failure with its own exit code and the exact text to print on standard error. */
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number = EXIT_FAILED) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}
