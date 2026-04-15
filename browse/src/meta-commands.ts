/**
 * Meta commands — tabs, server control, screenshots, chain, diff, snapshot
 */

import type { BrowserManager } from './browser-manager';
import { handleSnapshot } from './snapshot';
import { getCleanText } from './read-commands';
import { READ_COMMANDS, WRITE_COMMANDS, META_COMMANDS, PAGE_CONTENT_COMMANDS, wrapUntrustedContent } from './commands';
import { validateNavigationUrl } from './url-validation';
import { checkScope, type TokenInfo } from './token-registry';
import { validateOutputPath, escapeRegExp } from './path-security';
// Re-export for backward compatibility (tests import from meta-commands)
export { validateOutputPath, escapeRegExp } from './path-security';
import * as Diff from 'diff';
import * as fs from 'fs';
import * as path from 'path';
import { TEMP_DIR } from './platform';

/** Tokenize a pipe segment respecting double-quoted strings. */
function tokenizePipeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ' ' && !inQuote) {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Options passed from handleCommandInternal for chain routing */
export interface MetaCommandOpts {
  chainDepth?: number;
  /** Callback to route subcommands through the full security pipeline (handleCommandInternal) */
  executeCommand?: (body: { command: string; args?: string[]; tabId?: number }, tokenInfo?: TokenInfo | null) => Promise<{ status: number; result: string; json?: boolean }>;
}

export async function handleMetaCommand(
  command: string,
  args: string[],
  bm: BrowserManager,
  shutdown: () => Promise<void> | void,
  tokenInfo?: TokenInfo | null,
  opts?: MetaCommandOpts,
): Promise<string> {
  // Per-tab operations use the active session; global operations use bm directly
  const session = bm.getActiveSession();

  switch (command) {
    // ─── Tabs ──────────────────────────────────────────
    case 'tabs': {
      const tabs = await bm.getTabListWithTitles();
      return tabs.map(t =>
        `${t.active ? '→ ' : '  '}[${t.id}] ${t.title || '(untitled)'} — ${t.url}`
      ).join('\n');
    }

    case 'tab': {
      const id = parseInt(args[0], 10);
      if (isNaN(id)) throw new Error('Usage: browse tab <id>');
      bm.switchTab(id);
      return `Switched to tab ${id}`;
    }

    case 'newtab': {
      const url = args[0];
      const id = await bm.newTab(url);
      return `Opened tab ${id}${url ? ` → ${url}` : ''}`;
    }

    case 'closetab': {
      const id = args[0] ? parseInt(args[0], 10) : undefined;
      await bm.closeTab(id);
      return `Closed tab${id ? ` ${id}` : ''}`;
    }

    // ─── Server Control ────────────────────────────────
    case 'status': {
      const page = bm.getPage();
      const tabs = bm.getTabCount();
      const mode = bm.getConnectionMode();
      return [
        `Status: healthy`,
        `Mode: ${mode}`,
        `URL: ${page.url()}`,
        `Tabs: ${tabs}`,
        `PID: ${process.pid}`,
      ].join('\n');
    }

    case 'url': {
      return bm.getCurrentUrl();
    }

    case 'stop': {
      await shutdown();
      return 'Server stopped';
    }

    case 'restart': {
      // Signal that we want a restart — the CLI will detect exit and restart
      console.log('[browse] Restart requested. Exiting for CLI to restart.');
      await shutdown();
      return 'Restarting...';
    }

    // ─── Visual ────────────────────────────────────────
    case 'screenshot': {
      // Parse priority: flags (--viewport, --clip, --base64) → selector (@ref, CSS) → output path
      const page = bm.getPage();
      let outputPath = `${TEMP_DIR}/browse-screenshot.png`;
      let clipRect: { x: number; y: number; width: number; height: number } | undefined;
      let targetSelector: string | undefined;
      let viewportOnly = false;
      let base64Mode = false;

      const remaining: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--viewport') {
          viewportOnly = true;
        } else if (args[i] === '--base64') {
          base64Mode = true;
        } else if (args[i] === '--clip') {
          const coords = args[++i];
          if (!coords) throw new Error('Usage: screenshot --clip x,y,w,h [path]');
          const parts = coords.split(',').map(Number);
          if (parts.length !== 4 || parts.some(isNaN))
            throw new Error('Usage: screenshot --clip x,y,width,height — all must be numbers');
          clipRect = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
        } else if (args[i].startsWith('--')) {
          throw new Error(`Unknown screenshot flag: ${args[i]}`);
        } else {
          remaining.push(args[i]);
        }
      }

      // Separate target (selector/@ref) from output path
      for (const arg of remaining) {
        // File paths containing / and ending with an image/pdf extension are never CSS selectors
        const isFilePath = arg.includes('/') && /\.(png|jpe?g|webp|pdf)$/i.test(arg);
        if (isFilePath) {
          outputPath = arg;
        } else if (arg.startsWith('@e') || arg.startsWith('@c') || arg.startsWith('.') || arg.startsWith('#') || arg.includes('[')) {
          targetSelector = arg;
        } else {
          outputPath = arg;
        }
      }

      validateOutputPath(outputPath);

      if (clipRect && targetSelector) {
        throw new Error('Cannot use --clip with a selector/ref — choose one');
      }
      if (viewportOnly && clipRect) {
        throw new Error('Cannot use --viewport with --clip — choose one');
      }

      // --base64 mode: capture to buffer instead of disk
      if (base64Mode) {
        let buffer: Buffer;
        if (targetSelector) {
          const resolved = await bm.resolveRef(targetSelector);
          const locator = 'locator' in resolved ? resolved.locator : page.locator(resolved.selector);
          buffer = await locator.screenshot({ timeout: 5000 });
        } else if (clipRect) {
          buffer = await page.screenshot({ clip: clipRect });
        } else {
          buffer = await page.screenshot({ fullPage: !viewportOnly });
        }
        if (buffer.length > 10 * 1024 * 1024) {
          throw new Error('Screenshot too large for --base64 (>10MB). Use disk path instead.');
        }
        return `data:image/png;base64,${buffer.toString('base64')}`;
      }

      if (targetSelector) {
        const resolved = await bm.resolveRef(targetSelector);
        const locator = 'locator' in resolved ? resolved.locator : page.locator(resolved.selector);
        await locator.screenshot({ path: outputPath, timeout: 5000 });
        return `Screenshot saved (element): ${outputPath}`;
      }

      if (clipRect) {
        await page.screenshot({ path: outputPath, clip: clipRect });
        return `Screenshot saved (clip ${clipRect.x},${clipRect.y},${clipRect.width},${clipRect.height}): ${outputPath}`;
      }

      await page.screenshot({ path: outputPath, fullPage: !viewportOnly });
      return `Screenshot saved${viewportOnly ? ' (viewport)' : ''}: ${outputPath}`;
    }

    case 'pdf': {
      const page = bm.getPage();
      const pdfPath = args[0] || `${TEMP_DIR}/browse-page.pdf`;
      validateOutputPath(pdfPath);
      await page.pdf({ path: pdfPath, format: 'A4' });
      return `PDF saved: ${pdfPath}`;
    }

    case 'responsive': {
      const page = bm.getPage();
      const prefix = args[0] || `${TEMP_DIR}/browse-responsive`;
      validateOutputPath(prefix);
      const viewports = [
        { name: 'mobile', width: 375, height: 812 },
        { name: 'tablet', width: 768, height: 1024 },
        { name: 'desktop', width: 1280, height: 720 },
      ];
      const originalViewport = page.viewportSize();
      const results: string[] = [];

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const screenshotPath = `${prefix}-${vp.name}.png`;
        validateOutputPath(screenshotPath);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        results.push(`${vp.name} (${vp.width}x${vp.height}): ${screenshotPath}`);
      }

      // Restore original viewport
      if (originalViewport) {
        await page.setViewportSize(originalViewport);
      }

      return results.join('\n');
    }

    // ─── Chain ─────────────────────────────────────────
    case 'chain': {
      // Read JSON array from args[0] (if provided) or expect it was passed as body
      const jsonStr = args[0];
      if (!jsonStr) throw new Error(
        'Usage: echo \'[["goto","url"],["text"]]\' | browse chain\n' +
        '   or: browse chain \'goto url | click @e5 | snapshot -ic\''
      );

      let commands: string[][];
      try {
        commands = JSON.parse(jsonStr);
        if (!Array.isArray(commands)) throw new Error('not array');
      } catch (err: any) {
        // Fallback: pipe-delimited format "goto url | click @e5 | snapshot -ic"
        if (!(err instanceof SyntaxError) && err?.message !== 'not array') throw err;
        commands = jsonStr.split(' | ')
          .filter(seg => seg.trim().length > 0)
          .map(seg => tokenizePipeSegment(seg.trim()));
      }

      // Pre-validate ALL subcommands against the token's scope before executing any.
      // This prevents partial execution where some subcommands succeed before a
      // scope violation is hit, leaving the browser in an inconsistent state.
      if (tokenInfo && tokenInfo.clientId !== 'root') {
        for (const cmd of commands) {
          const [name] = cmd;
          if (!checkScope(tokenInfo, name)) {
            throw new Error(
              `Chain rejected: subcommand "${name}" not allowed by your token scope (${tokenInfo.scopes.join(', ')}). ` +
              `All subcommands must be within scope.`
            );
          }
        }
      }

      // Route each subcommand through handleCommandInternal for full security:
      // scope, domain, tab ownership, content wrapping — all enforced per subcommand.
      // Chain-specific options: skip rate check (chain = 1 request), skip activity
      // events (chain emits 1 event), increment chain depth (recursion guard).
      const executeCmd = opts?.executeCommand;
      const results: string[] = [];
      let lastWasWrite = false;

      if (executeCmd) {
        // Full security pipeline via handleCommandInternal
        for (const cmd of commands) {
          const [name, ...cmdArgs] = cmd;
          const cr = await executeCmd(
            { command: name, args: cmdArgs },
            tokenInfo,
          );
          if (cr.status === 200) {
            results.push(`[${name}] ${cr.result}`);
          } else {
            // Parse error from JSON result
            let errMsg = cr.result;
            try { errMsg = JSON.parse(cr.result).error || cr.result; } catch (err: any) { if (!(err instanceof SyntaxError)) throw err; }
            results.push(`[${name}] ERROR: ${errMsg}`);
          }
          lastWasWrite = WRITE_COMMANDS.has(name);
        }
      } else {
        // Fallback: direct dispatch (CLI mode, no server context)
        const { handleReadCommand } = await import('./read-commands');
        const { handleWriteCommand } = await import('./write-commands');

        for (const cmd of commands) {
          const [name, ...cmdArgs] = cmd;
          try {
            let result: string;
            if (WRITE_COMMANDS.has(name)) {
              if (bm.isWatching()) {
                result = 'BLOCKED: write commands disabled in watch mode';
              } else {
                result = await handleWriteCommand(name, cmdArgs, session, bm);
              }
              lastWasWrite = true;
            } else if (READ_COMMANDS.has(name)) {
              result = await handleReadCommand(name, cmdArgs, session);
              if (PAGE_CONTENT_COMMANDS.has(name)) {
                result = wrapUntrustedContent(result, bm.getCurrentUrl());
              }
              lastWasWrite = false;
            } else if (META_COMMANDS.has(name)) {
              result = await handleMetaCommand(name, cmdArgs, bm, shutdown, tokenInfo, opts);
              lastWasWrite = false;
            } else {
              throw new Error(`Unknown command: ${name}`);
            }
            results.push(`[${name}] ${result}`);
          } catch (err: any) {
            results.push(`[${name}] ERROR: ${err.message}`);
          }
        }
      }

      // Wait for network to settle after write commands before returning
      if (lastWasWrite) {
        await bm.getPage().waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
      }

      return results.join('\n\n');
    }

    // ─── Diff ──────────────────────────────────────────
    case 'diff': {
      const [url1, url2] = args;
      if (!url1 || !url2) throw new Error('Usage: browse diff <url1> <url2>');

      const page = bm.getPage();
      await validateNavigationUrl(url1);
      await page.goto(url1, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const text1 = await getCleanText(page);

      await validateNavigationUrl(url2);
      await page.goto(url2, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const text2 = await getCleanText(page);

      const changes = Diff.diffLines(text1, text2);
      const output: string[] = [`--- ${url1}`, `+++ ${url2}`, ''];

      for (const part of changes) {
        const prefix = part.added ? '+' : part.removed ? '-' : ' ';
        const lines = part.value.split('\n').filter(l => l.length > 0);
        for (const line of lines) {
          output.push(`${prefix} ${line}`);
        }
      }

      return wrapUntrustedContent(output.join('\n'), `diff: ${url1} vs ${url2}`);
    }

    // ─── Snapshot ─────────────────────────────────────
    case 'snapshot': {
      const isScoped = tokenInfo && tokenInfo.clientId !== 'root';
      const snapshotResult = await handleSnapshot(args, session, {
        splitForScoped: !!isScoped,
      });
      // Scoped tokens get split format (refs outside envelope); root gets basic wrapping
      if (isScoped) {
        return snapshotResult; // already has envelope from split format
      }
      return wrapUntrustedContent(snapshotResult, bm.getCurrentUrl());
    }

    // ─── Handoff ────────────────────────────────────
    case 'handoff': {
      const message = args.join(' ') || 'User takeover requested';
      return await bm.handoff(message);
    }

    case 'resume': {
      bm.resume();
      // Re-snapshot to capture current page state after human interaction
      const isScoped2 = tokenInfo && tokenInfo.clientId !== 'root';
      const snapshot = await handleSnapshot(['-i'], session, { splitForScoped: !!isScoped2 });
      if (isScoped2) {
        return `RESUMED\n${snapshot}`;
      }
      return `RESUMED\n${wrapUntrustedContent(snapshot, bm.getCurrentUrl())}`;
    }

    // ─── UX Audit ─────────────────────────────────────
    case 'ux-audit': {
      const page = bm.getPage();

      // Extract page structure for UX behavioral analysis
      // Agent interprets the data and applies Krug's 6 usability tests
      // Uses textContent (not innerText) to avoid layout computation on large DOMs
      const data = await page.evaluate(() => {
        const HEADING_CAP = 50;
        const INTERACTIVE_CAP = 200;
        const TEXT_BLOCK_CAP = 50;

        // Site ID: logo or brand element
        const logoEl = document.querySelector('[class*="logo"], [id*="logo"], header img, [aria-label*="home"], a[href="/"]');
        const siteId = logoEl ? {
          found: true,
          text: (logoEl.textContent || '').trim().slice(0, 100),
          tag: logoEl.tagName,
          alt: (logoEl as HTMLImageElement).alt || null,
        } : { found: false, text: null, tag: null, alt: null };

        // Page name: main heading
        const h1 = document.querySelector('h1');
        const pageName = h1 ? {
          found: true,
          text: h1.textContent?.trim().slice(0, 200) || '',
        } : { found: false, text: null };

        // Navigation: primary nav elements
        const navEls = document.querySelectorAll('nav, [role="navigation"]');
        const navItems: Array<{ text: string; links: number }> = [];
        navEls.forEach((nav, i) => {
          if (i >= 5) return;
          const links = nav.querySelectorAll('a');
          navItems.push({
            text: (nav.getAttribute('aria-label') || `nav-${i}`).slice(0, 50),
            links: links.length,
          });
        });

        // "You are here" indicator: current/active nav items
        // Scoped to nav containers to avoid false positives from animation classes
        const activeNavItems = document.querySelectorAll('nav [aria-current], nav .active, nav .current, [role="navigation"] [aria-current], [role="navigation"] .active, [role="navigation"] .current');
        const youAreHere = Array.from(activeNavItems).slice(0, 5).map(el => ({
          text: (el.textContent || '').trim().slice(0, 50),
          tag: el.tagName,
        }));

        // Search: search box presence
        const searchEl = document.querySelector('input[type="search"], [role="search"], input[name*="search"], input[placeholder*="search" i], input[aria-label*="search" i]');
        const search = { found: !!searchEl };

        // Breadcrumbs
        const breadcrumbEl = document.querySelector('[aria-label*="breadcrumb" i], .breadcrumb, .breadcrumbs, [class*="breadcrumb"]');
        const breadcrumbs = breadcrumbEl ? {
          found: true,
          items: Array.from(breadcrumbEl.querySelectorAll('a, span, li')).slice(0, 10).map(el => (el.textContent || '').trim().slice(0, 30)),
        } : { found: false, items: [] };

        // Headings: heading hierarchy
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, HEADING_CAP).map(h => ({
          tag: h.tagName,
          text: (h.textContent || '').trim().slice(0, 80),
          size: getComputedStyle(h).fontSize,
        }));

        // Interactive elements: buttons, links, inputs
        const interactiveEls = Array.from(document.querySelectorAll('a, button, input, select, textarea, [role="button"], [tabindex]')).slice(0, INTERACTIVE_CAP);
        const interactive = interactiveEls.map(el => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            text: (el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 50),
            type: (el as HTMLInputElement).type || null,
            role: el.getAttribute('role'),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            visible: rect.width > 0 && rect.height > 0,
          };
        }).filter(el => el.visible);

        // Text blocks: paragraphs and large text areas
        const textBlocks = Array.from(document.querySelectorAll('p, [class*="description"], [class*="intro"], [class*="welcome"], [class*="hero"] p, main p')).slice(0, TEXT_BLOCK_CAP).map(el => ({
          text: (el.textContent || '').trim().slice(0, 200),
          wordCount: (el.textContent || '').trim().split(/\s+/).filter(Boolean).length,
        }));

        // Total visible text word count (textContent avoids layout computation)
        const bodyText = (document.body?.textContent || '').trim();
        const totalWords = bodyText.split(/\s+/).filter(Boolean).length;

        return {
          url: window.location.href,
          title: document.title,
          siteId,
          pageName,
          navigation: navItems,
          youAreHere,
          search,
          breadcrumbs,
          headings,
          interactive,
          textBlocks,
          totalWords,
        };
      });

      return JSON.stringify(data, null, 2);
    }

    default:
      throw new Error(`Unknown meta command: ${command}`);
  }
}
