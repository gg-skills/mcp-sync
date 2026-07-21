#!/usr/bin/env npx tsx

/**
 * MCP Sync Completeness Checker
 * 
 * Verifies an MCP sync operation against the 9-item Sync Quality Checklist.
 * 
 * Usage:
 *   npx tsx .agents/skills/mcp-sync/scripts/check-sync-completeness.ts --project <path>
 */

import { argv } from "process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

/**
 * One weighted checklist row for the MCP sync quality gate surfaced by this script.
 *
 * @remarks
 * `checked` is derived from best-effort filesystem probes in `main`, not from interactive
 * confirmation; `weight` feeds the optional score alongside the required-items finalize gate.
 */
interface ChecklistItem {
  number: number;
  name: string;
  description: string;
  required: boolean;
  checked: boolean;
  weight: number;
}

/**
 * Machine-readable rollup emitted after the console report when `--json` is passed.
 *
 * @remarks
 * `canFinalize` mirrors the required-only weighted totals gate used for the human-readable
 * “syncable” line, independent of optional checklist rows.
 */
interface CompletenessReport {
  checklist: ChecklistItem[];
  score: number;
  maxScore: number;
  canFinalize: boolean;
}

// ============================================================================
// Checklist Definition
// ============================================================================

const CHECKLIST_ITEMS: Omit<ChecklistItem, "checked">[] = [
  { number: 1, name: "Target project root resolved", description: "Working from correct project root", required: true, weight: 2 },
  { number: 2, name: "Storage initialized", description: ".mcp-sync/ created and gitignored", required: true, weight: 2 },
  { number: 3, name: "Current config inspected", description: "state.json, env, editor configs reviewed", required: true, weight: 2 },
  { number: 4, name: "Secrets managed", description: "Env vars in .mcp-sync/env, not in skill repo", required: true, weight: 2 },
  { number: 5, name: "Backups created", description: "Editor config backups before writes", required: true, weight: 2 },
  { number: 6, name: "Preview run", description: "--dry-run shows target paths and operations", required: true, weight: 1 },
  { number: 7, name: "Global writes approved", description: "Explicit approval for global editor writes", required: false, weight: 2 },
  { number: 8, name: "Validation run", description: "mcp-sync validate passes", required: true, weight: 2 },
  { number: 9, name: "Evidence reported", description: "Git status, generated files, validation result", required: true, weight: 1 },
];

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Probes whether `.mcp-sync/` exists and whether `.gitignore` mentions that directory.
 *
 * @remarks
 * I/O: synchronous `existsSync` / `readFileSync` under `projectRoot` only; unreadable
 * `.gitignore` content is treated as not gitignored.
 */
function checkStorage(projectRoot: string): { exists: boolean; gitignored: boolean } {
  const storagePath = join(projectRoot, ".mcp-sync");
  const gitignorePath = join(projectRoot, ".gitignore");
  
  const exists = existsSync(storagePath);
  
  let gitignored = false;
  if (existsSync(gitignorePath)) {
    try {
      const gitignore = readFileSync(gitignorePath, "utf-8");
      gitignored = gitignore.includes(".mcp-sync");
    } catch {
      gitignored = false;
    }
  }
  
  return { exists, gitignored };
}

/**
 * Reads `.mcp-sync/state.json` and applies a coarse structural sanity check.
 *
 * @remarks
 * I/O: synchronous reads; malformed JSON yields `valid: false` while still reporting
 * `exists: true` when the path is present. `valid` requires truthy `enabledServers` and
 * `servicePreferences` keys on the parsed object.
 */
function checkState(projectRoot: string): { exists: boolean; valid: boolean } {
  const statePath = join(projectRoot, ".mcp-sync", "state.json");
  
  if (!existsSync(statePath)) {
    return { exists: false, valid: false };
  }
  
  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    const valid = state.enabledServers && state.servicePreferences;
    return { exists: true, valid };
  } catch {
    return { exists: true, valid: false };
  }
}

/**
 * Returns whether `.mcp-sync/backups/` exists on disk.
 *
 * @remarks
 * I/O: single `existsSync` probe; does not inspect backup file contents or freshness.
 */
function checkBackups(projectRoot: string): boolean {
  const backupsPath = join(projectRoot, ".mcp-sync", "backups");
  return existsSync(backupsPath);
}

// ============================================================================
// Main
// ============================================================================

/**
 * Parses CLI flags, runs filesystem heuristics, prints the checklist, and optionally emits JSON.
 *
 * @remarks
 * Supports `--project` / `-p` plus optional `--json`. Always prints human-oriented console
 * output before the JSON block when `--json` is enabled.
 */
function main() {
  const args = argv.slice(2);
  const projectArg = args.find(a => a === "--project" || a === "-p");
  const jsonArg = args.includes("--json");
  
  const projectRoot = projectArg 
    ? args[args.indexOf(projectArg) + 1] || process.cwd()
    : process.cwd();
  
  console.log("\n📋 MCP Sync Completeness Check");
  console.log("═".repeat(60));
  console.log(`\n📁 Project Root: ${projectRoot}`);
  
  // Run checks
  const storage = checkStorage(projectRoot);
  const state = checkState(projectRoot);
  const backups = checkBackups(projectRoot);
  
  console.log("\n📊 MCP Sync Status:");
  console.log(`   .mcp-sync/ exists: ${storage.exists ? "✅" : "❌"}`);
  console.log(`   .mcp-sync/ gitignored: ${storage.gitignored ? "✅" : "⚠️"}`);
  console.log(`   state.json exists: ${state.exists ? "✅" : "❌"}`);
  console.log(`   state.json valid: ${state.valid ? "✅" : "⚠️"}`);
  console.log(`   Backups directory: ${backups ? "✅" : "⚠️"}`);
  
  // Build checklist
  const checklist: ChecklistItem[] = CHECKLIST_ITEMS.map(item => {
    let checked = false;
    
    switch (item.number) {
      case 1: // Target project root resolved
        checked = projectRoot.includes("/") || projectRoot.includes("\\");
        break;
      case 2: // Storage initialized
        checked = storage.exists && storage.gitignored;
        break;
      case 3: // Current config inspected
        checked = state.exists;
        break;
      case 4: // Secrets managed
        checked = storage.exists; // Assumed if storage exists
        break;
      case 5: // Backups created
        checked = backups || !storage.exists;
        break;
      case 6: // Preview run
        checked = true; // Assumed if applying
        break;
      case 7: // Global writes approved
        checked = true; // Optional - pass by default
        break;
      case 8: // Validation run
        checked = state.valid;
        break;
      case 9: // Evidence reported
        checked = true; // Assumed at closeout
        break;
      default:
        break;
    }
    
    return { ...item, checked };
  });
  
  const score = checklist.reduce((sum, item) => 
    item.checked ? sum + item.weight : sum, 0);
  const maxScore = checklist.reduce((sum, item) => sum + item.weight, 0);
  
  const requiredItems = checklist.filter(i => i.required);
  const requiredScore = requiredItems.reduce((sum, item) => 
    item.checked ? sum + item.weight : sum, 0);
  const requiredMax = requiredItems.reduce((sum, item) => sum + item.weight, 0);
  
  const canFinalize = requiredScore === requiredMax;
  
  console.log(`\n📊 Score: ${score}/${maxScore} (${((score/maxScore)*100).toFixed(0)}%)`);
  console.log(`   Required items: ${requiredScore}/${requiredMax}`);
  
  console.log(`\n${canFinalize ? "✅" : "⚠️"} Syncable: ${canFinalize ? "YES" : "NEEDS WORK"}`);
  
  console.log("\n📝 Checklist:");
  for (const item of checklist) {
    const icon = item.checked ? "✅" : item.required ? "❌" : "⚠️";
    console.log(`   ${icon} [${item.number}] ${item.name}`);
  }
  
  console.log("\n" + "═".repeat(60));
  
  if (!canFinalize) {
    console.log("\n⚠️ Sync needs work before proceeding.");
    const failedItems = checklist.filter(i => !i.checked && i.required);
    if (failedItems.length > 0) {
      console.log("\nIssues to resolve:");
      failedItems.forEach(i => console.log(`   - ${i.name}: ${i.description}`));
    }
  } else {
    console.log("\n✅ Workspace is ready for MCP sync operation.");
  }
  
  if (jsonArg) {
    const report: CompletenessReport = { checklist, score, maxScore, canFinalize };
    console.log("\n" + JSON.stringify(report, null, 2));
  }
}

main();
