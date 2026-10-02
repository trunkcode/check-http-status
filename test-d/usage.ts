// Compiled with `npm run test:types` to check index.d.ts. Never executed.
import checkHttpStatus = require('..');
import { findConfig, loadConfig, recheck, renderHtml, writeReport } from '..';

async function main(): Promise<void> {
  const controller = new AbortController();

  const report: checkHttpStatus.Report = await checkHttpStatus({
    crawl: 'https://www.example.com',
    exclude: ['/docs'],
    maxDepth: null,
    respectRobots: true,
    delay: 500,
    userAgent: 'AuditBot/1.0',
    export: [{ format: 'xlsx', file: 'report.xlsx' }, { format: 'html', location: './reports' }],
    options: { auth: { username: 'u', password: 'p' }, headers: { 'Accept-Language': 'en' }, timeout: 10000 },
    googleDrive: { public: true, convert: false },
    oneDrive: { folderPath: 'Documents/SEO', tenant: 'consumers' },
    signal: controller.signal,
    onResult: (result) => {
      const status: number | null = result.status;
      const pages: string[] = result.foundOn.map((source) => source.page);
      void status;
      void pages;
    },
    onProgress: (progress) => {
      const state: 'idle' | 'running' | 'done' | 'stopped' = progress.state;
      void state;
    },
    onPageLimit: async (progress) => progress.waitingPages > 100 ? 1000 : true
  });

  const notFound = report.results.filter((result) => result.category === 'Not Found');
  const firstUpload = report.uploads?.[0]?.url;
  const issues: number = report.summary.issues;
  void notFound;
  void firstUpload;
  void issues;

  const updated = await recheck(report, ['https://www.example.com/old'], { retries: 1 });
  await writeReport(updated, 'report.csv', 'csv');
  const html: string = renderHtml(updated, { title: 'Report' });
  const file: string | null = findConfig();
  const config = loadConfig('check-http-status.config.json');
  const fails: boolean | undefined = config.fail;
  void html;
  void file;
  void fails;

  // Same function via the named export.
  await checkHttpStatus.checkHttpStatus({ urls: 'https://example.com' });

  // @ts-expect-error unknown export format
  await checkHttpStatus({ crawl: 'https://example.com', export: { format: 'pdf' } });

  // @ts-expect-error misspelled option
  await checkHttpStatus({ crawl: 'https://example.com', excludes: ['/docs'] });

  // @ts-expect-error category is a fixed set of strings
  const category: checkHttpStatus.Category = 'Broken';
  void category;
}

void main;
