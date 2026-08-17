import { DEFAULT_LOG_UNITS } from './config.js';

export function buildJournalctlArgs(opts: {
  units?: string[];
  lines?: number;
  since?: string;
  follow?: boolean;
  output?: 'json' | 'json-pretty' | 'short';
}) {
  const args: string[] = [];
  const units = opts.units && opts.units.length ? opts.units : DEFAULT_LOG_UNITS;
  for (const u of units) {
    args.push('-u', u);
  }
  if (opts.lines != null) {
    args.push('-n', String(opts.lines));
  }
  if (opts.since) {
    args.push('--since', opts.since);
  }
  if (opts.follow) {
    args.push('-f');
  }
  args.push('-o', opts.output ?? 'json');
  return args;
}

export { DEFAULT_LOG_UNITS };
