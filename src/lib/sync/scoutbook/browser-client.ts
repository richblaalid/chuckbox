/**
 * Agent Browser Client
 *
 * TypeScript wrapper for the agent-browser CLI tool.
 * Provides a clean interface for browser automation using accessibility snapshots.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentBrowserSnapshot, SnapshotRef } from './types';

const execAsync = promisify(exec);

const SCOUTBOOK_LOGIN_URL = 'https://advancements.scouting.org/';

export class AgentBrowserClient {
  private isOpen = false;

  /**
   * Open browser to a URL
   * @param url URL to navigate to
   * @param headed Whether to show browser window (required for manual login)
   */
  async open(url: string, headed = true): Promise<void> {
    const headedFlag = headed ? '--headed' : '';
    await this.runCommand(`open "${url}" ${headedFlag}`);
    this.isOpen = true;
  }

  /**
   * Open browser to Scoutbook login page
   * Closes any existing browser session first
   */
  async openScoutbookLogin(): Promise<void> {
    // Try to close any existing browser session first
    try {
      await this.runCommand('close');
    } catch {
      // No existing session, that's fine
    }

    // Small delay to ensure clean state
    await this.sleep(500);

    await this.open(SCOUTBOOK_LOGIN_URL, true);
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    try {
      await this.runCommand('close');
      this.isOpen = false;
    } catch {
      // Browser may already be closed
      this.isOpen = false;
    }
  }

  /**
   * Take an accessibility snapshot of the current page
   * @param interactive Only include interactive elements
   */
  async snapshot(interactive = false): Promise<AgentBrowserSnapshot> {
    const flags = interactive ? '-i --json' : '--json';
    const output = await this.runCommand(`snapshot ${flags}`);
    return JSON.parse(output) as AgentBrowserSnapshot;
  }

  /**
   * Click an element by ref
   * @param ref Element ref from snapshot (e.g., "@e1")
   */
  async click(ref: string): Promise<void> {
    await this.runCommand(`click ${ref}`);
  }

  /**
   * Fill a text field by ref
   * @param ref Element ref from snapshot
   * @param value Text to enter
   */
  async fill(ref: string, value: string): Promise<void> {
    await this.runCommand(`fill ${ref} "${value}"`);
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    await this.runCommand(`open "${url}"`);
  }

  /**
   * Go back in browser history
   */
  async back(): Promise<void> {
    await this.runCommand('back');
  }

  /**
   * Press a key
   */
  async press(key: string): Promise<void> {
    await this.runCommand(`press ${key}`);
  }

  /**
   * Take a screenshot
   * @param path Optional path to save screenshot
   * @param fullPage Whether to capture full page
   */
  async screenshot(path?: string, fullPage = false): Promise<string> {
    const flags = fullPage ? '--full' : '';
    const pathArg = path ? `"${path}"` : '';
    return await this.runCommand(`screenshot ${pathArg} ${flags}`);
  }

  /**
   * Find element by text and click it
   */
  async findTextAndClick(text: string): Promise<void> {
    await this.runCommand(`find text "${text}" click`);
  }

  /**
   * Wait for a specific condition by polling snapshots
   * @param predicate Function that returns true when condition is met
   * @param timeout Maximum time to wait (ms)
   * @param pollInterval Time between polls (ms)
   */
  async waitFor(
    predicate: (snapshot: AgentBrowserSnapshot) => boolean,
    timeout = 30000,
    pollInterval = 1000
  ): Promise<AgentBrowserSnapshot> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const snapshot = await this.snapshot(true);

      if (predicate(snapshot)) {
        return snapshot;
      }

      await this.sleep(pollInterval);
    }

    throw new Error(`Timeout waiting for condition after ${timeout}ms`);
  }

  /**
   * Wait for user to complete login
   * Detects login success by absence of login form and presence of navigation menu
   */
  async waitForLogin(timeout = 120000): Promise<AgentBrowserSnapshot> {
    return this.waitFor(
      (snapshot) => {
        const refs = snapshot.data?.refs || {};
        const refValues = Object.values(refs);

        // Check if still on login page
        const hasLoginForm = refValues.some(
          (r: SnapshotRef) =>
            r.name === 'Username (my.scouting)' ||
            (r.name === 'LOGIN' && r.role === 'button')
        );

        if (hasLoginForm) {
          return false; // Still on login page
        }

        // Check for navigation menu (indicates successful login)
        const hasNavMenu = refValues.some(
          (r: SnapshotRef) => r.name === 'Roster' && r.role === 'menuitem'
        );

        return hasNavMenu;
      },
      timeout,
      1000
    );
  }

  /**
   * Dismiss the Scoutbook tour modal if present
   * This modal appears on first login and blocks interaction
   */
  async dismissTourModal(): Promise<boolean> {
    // Try multiple times since the modal may take a moment to appear
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Wait a bit for modal to appear (longer on first attempt)
      await this.sleep(attempt === 1 ? 1000 : 500);

      try {
        const snapshot = await this.snapshot(false); // Get full snapshot, not just interactive
        const refs = snapshot.data?.refs || {};
        const snapshotText = snapshot.data?.snapshot || '';

        // The Scoutbook tour modal buttons have name="[object Object]" due to a bug
        // But the actual button text appears in the snapshot text as: button "[object Object]" [ref=eXX]: Skip
        // Look for the Skip button ref in the snapshot text - must be on same line
        const skipMatch = snapshotText.match(/button "[^"]*" \[ref=(e\d+)\][^\n]*: Skip\b/i);
        if (skipMatch) {
          const skipRef = skipMatch[1];
          await this.click(`@${skipRef}`);
          await this.sleep(500);
          return true;
        }

        // Also check refs directly in case the name is correct
        for (const [key, ref] of Object.entries(refs)) {
          const name = ref.name?.trim();
          if (name && name.toLowerCase() === 'skip') {
            await this.click(`@${key}`);
            await this.sleep(500);
            return true;
          }
        }

        // Check if tour modal text is present but Skip button wasn't found
        if (snapshotText.includes('Welcome to Scoutbook Plus') || snapshotText.includes('begin the tour')) {
          // Look for [object Object] buttons which are the modal buttons
          const objectButtonMatch = snapshotText.match(/button "\[object Object\]" \[ref=(e\d+)\][^\n]*: Skip/i);
          if (objectButtonMatch) {
            await this.click(`@${objectButtonMatch[1]}`);
            await this.sleep(500);
            return true;
          }
        }

      } catch (error) {
        console.warn(`[Browser] Error on attempt ${attempt}:`, error);
      }
    }

    // Last resort: try pressing Escape to close any modal
    await this.press('Escape');
    await this.sleep(300);
    return false;
  }

  /**
   * Check if currently on the roster page
   */
  async isOnRosterPage(): Promise<boolean> {
    const snapshot = await this.snapshot(true);
    const refs = Object.values(snapshot.data?.refs || {});

    return refs.some(
      (r: SnapshotRef) =>
        r.name === 'Roster' && r.role === 'tab'
    );
  }

  /**
   * Navigate to roster page via menu
   */
  async navigateToRoster(): Promise<void> {
    const snapshot = await this.snapshot(true);
    const refs = snapshot.data?.refs || {};

    // Try multiple approaches to find Roster navigation
    // 1. Look for Roster link
    let rosterRef = Object.entries(refs).find(
      ([, r]) => r.name === 'Roster' && r.role === 'link'
    );

    // 2. Look for Roster menuitem
    if (!rosterRef) {
      rosterRef = Object.entries(refs).find(
        ([, r]) => r.name === 'Roster' && r.role === 'menuitem'
      );
    }

    // 3. Look for Roster tab
    if (!rosterRef) {
      rosterRef = Object.entries(refs).find(
        ([, r]) => r.name === 'Roster' && r.role === 'tab'
      );
    }

    // 4. Look for any element named "Roster" that's clickable
    if (!rosterRef) {
      rosterRef = Object.entries(refs).find(
        ([, r]) => r.name === 'Roster'
      );
    }

    if (rosterRef) {
      await this.click(`@${rosterRef[0]}`);
      await this.sleep(1500); // Wait for navigation
    } else {
      // Fallback: try direct navigation to roster URL
      await this.navigate('https://advancements.scouting.org/roster');
      await this.sleep(2000);
    }
  }

  /**
   * Get the current page URL (from snapshot metadata if available)
   */
  async getCurrentUrl(): Promise<string | null> {
    // agent-browser doesn't directly expose URL, but we can infer from page content
    // For now, return null and let callers use snapshot content to determine page
    return null;
  }

  /**
   * Run an agent-browser command
   */
  private async runCommand(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(`agent-browser ${command}`, {
        timeout: 60000, // 1 minute timeout for any command
      });

      if (stderr && !stderr.includes('✓')) {
        console.warn('[agent-browser stderr]:', stderr);
      }

      return stdout.trim();
    } catch (error) {
      const err = error as Error & { stderr?: string };
      throw new Error(
        `agent-browser command failed: ${command}\n${err.message}\n${err.stderr || ''}`
      );
    }
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper to check if a snapshot has a specific element
 */
export function hasElement(
  snapshot: AgentBrowserSnapshot,
  predicate: (ref: SnapshotRef, key: string) => boolean
): boolean {
  const refs = snapshot.data?.refs || {};
  return Object.entries(refs).some(([key, ref]) => predicate(ref, key));
}

/**
 * Helper to find an element ref in a snapshot
 */
export function findElement(
  snapshot: AgentBrowserSnapshot,
  predicate: (ref: SnapshotRef) => boolean
): string | null {
  const refs = snapshot.data?.refs || {};
  const entry = Object.entries(refs).find(([, ref]) => predicate(ref));
  return entry ? `@${entry[0]}` : null;
}

/**
 * Helper to find all elements matching a predicate
 */
export function findAllElements(
  snapshot: AgentBrowserSnapshot,
  predicate: (ref: SnapshotRef) => boolean
): string[] {
  const refs = snapshot.data?.refs || {};
  return Object.entries(refs)
    .filter(([, ref]) => predicate(ref))
    .map(([key]) => `@${key}`);
}
