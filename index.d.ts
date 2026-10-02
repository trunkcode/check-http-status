// Type definitions for check-http-status 2.x

declare namespace checkHttpStatus {
  /** `Blocked`: bot protection answered; not counted as broken. */
  type Category = 'OK' | 'Redirect' | 'Not Found' | 'Client Error' | 'Server Error' | 'Error' | 'Blocked' | 'Not checked' | 'Other';

  /** What happened to a URL: crawled, checked, excluded, external, asset, skipped (limit/depth) or blocked by robots.txt. */
  type Scope = 'crawl' | 'list' | 'excluded' | 'external' | 'asset' | 'limit' | 'depth' | 'robots';

  type ExportFormat = 'xlsx' | 'csv' | 'json' | 'html';

  interface ExportOptions {
    /** Report format. Default `xlsx`. */
    format?: ExportFormat;
    /** Full path of the report file. */
    file?: string;
    /** Folder for an auto-named report. */
    location?: string;
  }

  interface RequestOptions {
    /** HTTP Basic auth, only sent to the checked site. */
    auth?: { username?: string; password?: string };
    /** Extra request headers. */
    headers?: Record<string, string>;
    /** Timeout per request in milliseconds. Default 15000. */
    timeout?: number;
    /** User-Agent header (same as the top-level `userAgent`). */
    userAgent?: string;
  }

  interface GoogleServiceAccount {
    type: 'service_account';
    client_email: string;
    private_key: string;
    [key: string]: unknown;
  }

  interface GoogleAuthorizedUser {
    type?: 'authorized_user';
    client_id: string;
    client_secret?: string;
    refresh_token: string;
  }

  interface GoogleDriveOptions {
    /** Existing folder ID. Default: the tool's own folder. */
    folderId?: string;
    /** Name of the folder the tool creates and reuses. */
    folderName?: string;
    /** Convert .xlsx/.csv to Google Sheets. Default true. */
    convert?: boolean;
    /** Anyone with the link can view the uploaded files. */
    public?: boolean;
    /** Service account key or authorized-user credentials. */
    credentials?: GoogleServiceAccount | GoogleAuthorizedUser | string;
    /** Path to a service account key file. */
    keyFile?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    /** Which exported formats to upload. Default: all. */
    formats?: ExportFormat | ExportFormat[];
  }

  interface OneDriveCredentials {
    client_id: string;
    refresh_token: string;
    tenant?: string;
    scope?: string;
    client_secret?: string;
  }

  interface OneDriveOptions {
    /** e.g. "Documents/SEO". Default: the app's own folder. */
    folderPath?: string;
    /** Return "anyone with the link" view links. */
    public?: boolean;
    credentials?: OneDriveCredentials | string;
    clientId?: string;
    refreshToken?: string;
    /** "common" (default), "consumers", "organizations" or a tenant ID. */
    tenant?: string;
    /** Which exported formats to upload. Default: all. */
    formats?: ExportFormat | ExportFormat[];
  }

  interface Config {
    /** Website URL(s) to crawl. */
    crawl?: string | string[];
    /** URLs to check without crawling. */
    urls?: string | string[];
    /** Optional sitemap / sitemap index URLs. */
    sitemaps?: string | string[];
    /** Only crawl matching URLs (substring, `*` or `/regex/`). */
    include?: string | string[];
    /** Don't crawl matching URLs; they're still listed and checked. */
    exclude?: string | string[];
    /** Default 5000. */
    maxPages?: number;
    /** Maximum link depth from the start URL. Default unlimited. */
    maxDepth?: number | null;
    /** Default 10. */
    maxRedirects?: number;
    /** Check external links. Default true. */
    checkExternal?: boolean;
    /** Also check images, scripts and CSS. Default false. */
    checkAssets?: boolean;
    /** Treat subdomains as internal. Default false. */
    subdomains?: boolean;
    /** Strip query strings before comparing URLs. Default false. */
    ignoreQuery?: boolean;
    /** Honour robots.txt and Crawl-delay. Default false. */
    respectRobots?: boolean;
    /** Parallel requests. Default 10. */
    concurrency?: number;
    /** Milliseconds between requests to the same site. Default 0. */
    delay?: number;
    /** Retries for temporary failures. Default 2. */
    retries?: number;
    /** First retry wait in ms, doubled each time. Default 1000. */
    retryDelay?: number;
    /** User-Agent header. */
    userAgent?: string;
    /** Leave 200 OK URLs out of output and reports. */
    skip200?: boolean;
    /** No console output. */
    silent?: boolean;
    /** Reports to write. */
    export?: ExportOptions | ExportOptions[];
    options?: RequestOptions;
    /** Upload reports to Google Drive. */
    googleDrive?: boolean | GoogleDriveOptions;
    /** Upload reports to OneDrive. */
    oneDrive?: boolean | OneDriveOptions;
    /** Stop the crawl; results so far are returned. */
    signal?: AbortSignal;
    /** Called as each URL is checked. */
    onResult?: (result: Result) => void;
    /** Called with progress after each URL. */
    onProgress?: (progress: Progress) => void;
    /**
     * Called once everything up to `maxPages` is checked and more pages are waiting.
     * Resolve `true` to crawl up to `maxPages` more, a number to crawl that many more
     * (`Infinity` for all), or `false` to finish. Asked again each time the new limit is reached.
     */
    onPageLimit?: (progress: PageLimitProgress) => boolean | number | Promise<boolean | number>;
  }

  interface FoundOn {
    /** Page, sitemap or redirecting URL. */
    page: string;
    /** Link text(s) used on that page. */
    anchors: string[];
    /** Times the link appears on that page. */
    count: number;
    kind: 'link' | 'redirect' | 'sitemap' | 'seed';
  }

  interface RedirectHop {
    url: string;
    status: number | null;
  }

  interface Result {
    url: string;
    status: number | null;
    statusText: string;
    category: Category;
    /** Timeout, DNS or connection error. */
    error: string;
    type: 'internal' | 'external';
    linkType: 'page' | 'asset';
    scope: Scope;
    redirectTo: string;
    redirectChain: RedirectHop[];
    redirectCount: number;
    finalUrl: string;
    finalStatus: number | null;
    /** e.g. "Cloudflare" when bot protection answered. */
    botProtection: string;
    /** e.g. "Redirect loop" or "Stopped after 10 redirects". */
    note: string;
    foundOn: FoundOn[];
    title: string;
    contentType: string;
    responseTime: number | null;
    depth: number;
    crawled: boolean;
    inSitemap: boolean;
    /** In the sitemap but not linked. */
    orphan: boolean;
    /** Set by `recheck()`. */
    rechecked?: boolean;
  }

  interface Progress {
    state: 'idle' | 'running' | 'done' | 'stopped';
    mode: 'crawl' | 'list';
    discovered: number;
    pagesCrawled: number;
    checked: number;
    queued: number;
    active: number;
    counts: Partial<Record<Category, number>>;
    startedAt: number | null;
    finishedAt: number | null;
    elapsed: number;
    pageLimitReached: boolean;
  }

  interface PageLimitProgress extends Progress {
    /** Pages found after `maxPages` was reached. */
    waitingPages: number;
  }

  interface Summary extends Progress {
    crawl: string[];
    sitemaps: string[];
    include: string[];
    exclude: string[];
    issues: number;
    orphans: number;
    robotsBlocked: number;
    recheckedAt?: number;
  }

  interface Upload {
    service: 'googleDrive' | 'oneDrive';
    /** Local file that was uploaded. */
    file: string;
    id: string;
    name: string;
    /** Link to the uploaded file. */
    url: string;
    public: boolean;
    mimeType?: string;
  }

  interface Report {
    summary: Summary;
    results: Result[];
    /** When a cloud upload was requested. */
    uploads?: Upload[];
    /** Set when an upload failed. */
    uploadError?: string;
  }

  interface RecheckConfig extends Pick<Config, 'options' | 'userAgent' | 'retries' | 'delay' | 'maxRedirects' | 'signal' | 'onResult'> {}

  /** Crawl a website and/or check a list of URLs. */
  function checkHttpStatus(config: Config): Promise<Report>;

  /** Re-check URLs of a report; found-on pages are kept. */
  function recheck(report: Report, urls: string | string[], config?: RecheckConfig): Promise<Report>;

  /** Write a report to a file. */
  function writeReport(report: Report, file: string, format: ExportFormat, options?: { skip200?: boolean }): Promise<void>;

  /** Render a report as a self-contained interactive HTML page. */
  function renderHtml(report: Report, options?: { title?: string }): string;

  /** Load a config file; paths are relative to it. */
  function loadConfig(file: string): Config & { fail?: boolean };

  /** Find check-http-status.config.json in a folder. */
  function findConfig(dir?: string): string | null;
}

declare function checkHttpStatus(config: checkHttpStatus.Config): Promise<checkHttpStatus.Report>;

export = checkHttpStatus;
