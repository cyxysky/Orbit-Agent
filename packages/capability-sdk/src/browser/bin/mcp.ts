#!/usr/bin/env node
import { serveBrowserMcpStdio } from '../mcp.ts';
import { installBrowserSessionShutdownHooks } from '../node/browser-session-lifecycle.ts';

installBrowserSessionShutdownHooks();

serveBrowserMcpStdio({
  sessionOptions: {
    headless: (process.env.HEADLESS_BROWSER ?? process.env.BROWSER_HEADLESS) !== 'false',
    isolated: process.env.BROWSER_MCP_ISOLATED !== 'false',
  },
});
