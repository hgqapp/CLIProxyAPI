#!/usr/bin/env node
/**
 * Push local commits to github.com/hgqapp/CLIProxyAPI main via the GitHub REST API.
 *
 * Use when direct `git push` to github.com is blocked by the network (gh api still works).
 * Replays every local commit not yet on the fork (rev-list fork/main..HEAD) as real
 * commits on top of the fork's current main, preserving messages and file states.
 *
 * Usage:
 *   node scripts/push-fork.js            # push commits, fast-forward fork main
 *   node scripts/push-fork.js v8.0.10-1  # also move/create the given tag on HEAD
 *   node scripts/push-fork.js --force    # allow rewriting fork main (after a rebase)
 *
 * Requires: gh CLI authenticated (gh auth login), cwd = repo root or pass repo path.
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..');
const API = 'repos/hgqapp/CLIProxyAPI';

function git(args) {
  return execSync(`git ${args}`, { cwd: REPO_DIR, encoding: 'utf8', maxBuffer: 1e8 }).trim();
}

function gh(endpoint, method, input) {
  const args = ['gh', 'api', endpoint];
  if (method && method !== 'GET') args.push('-X', method);
  if (input !== undefined) args.push('--input', '-');
  const out = execSync(args.join(' '), {
    cwd: REPO_DIR,
    input: input !== undefined ? JSON.stringify(input) : undefined,
    encoding: 'utf8',
    maxBuffer: 1e8,
  });
  return out.trim() ? JSON.parse(out) : {};
}

function main() {
  const force = process.argv.includes('--force');
  const tag = process.argv.slice(1).find((a) => !a.startsWith('--') && !a.endsWith('push-fork.js') && a !== 'node');

  const ref = gh(`${API}/git/ref/heads/main`);
  const baseSha = ref.object.sha;
  const headSha = git('rev-parse HEAD');

  if (baseSha === headSha) {
    console.log('fork main already at HEAD, nothing to push');
    return;
  }

  // The fork's commits may have been created by this script (same content, different sha
  // than local). Align by tree hash: find a local commit whose tree matches fork main's tree.
  let baseIsAncestor = true;
  try {
    execSync(`git merge-base --is-ancestor ${baseSha} HEAD`, { cwd: REPO_DIR, stdio: 'ignore' });
  } catch {
    baseIsAncestor = false;
  }

  let range;
  let parentSha;
  if (baseIsAncestor) {
    range = `${baseSha}..HEAD`;
    parentSha = baseSha;
  } else {
    const forkTree = gh(`${API}/git/commits/${baseSha}`).tree.sha;
    const localMatch = git(`log --format="%H %T" -200 HEAD`)
      .split('\n')
      .find((l) => l.endsWith(` ${forkTree}`));
    if (localMatch) {
      // The fork already has this content under its own sha; replay on top of it.
      parentSha = baseSha;
      range = `${localMatch.split(' ')[0]}..HEAD`;
      console.log(`aligned fork main (tree ${forkTree.slice(0, 9)}) with local ${localMatch.split(' ')[0].slice(0, 9)}`);
    } else if (force) {
      // Rebuild the full fork tail on top of upstream/main (fork was created from it,
      // so all upstream objects exist remotely).
      parentSha = git('rev-parse upstream/main');
      range = `${parentSha}..HEAD`;
    } else {
      console.error(`fork main (${baseSha.slice(0, 9)}) shares no tree with local HEAD.`);
      console.error('If you intend to rewrite the fork anyway, rerun with --force.');
      process.exit(1);
    }
  }
  const commits = git(`rev-list --reverse ${range}`).split('\n').filter(Boolean);
  if (commits.length) {
    for (const c of commits) {
    const parent = git(`rev-parse ${c}~1`); // NB: not ^ — cmd.exe eats the caret
    const files = git(`diff --name-only ${parent} ${c}`).split('\n').map((s) => s.trim()).filter(Boolean);
    const parentCommit = gh(`${API}/git/commits/${parentSha}`);
    const entries = [];
    for (const f of files) {
      // Normalize CRLF -> LF so blobs match the repo's stored content (core.autocrlf
      // checks out CRLF on Windows but the object database is LF); otherwise trees
      // never align with locally created commits.
      const content = fs.readFileSync(path.join(REPO_DIR, f), 'utf8').replace(/\r\n/g, '\n');
      const blob = gh(`${API}/git/blobs`, 'POST', { content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' });
      entries.push({ path: f.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = gh(`${API}/git/trees`, 'POST', entries.length ? { base_tree: parentCommit.tree.sha, tree: entries } : { tree: [] });
    const message = git(`log -1 --format=%B ${c}`);
    const created = gh(`${API}/git/commits`, 'POST', { message, tree: tree.sha, parents: [parentSha] });
    parentSha = created.sha;
    console.log(`replayed ${c.slice(0, 9)} -> ${created.sha.slice(0, 9)} (${message.split('\n')[0].slice(0, 60)})`);
    }
  }

  gh(`${API}/git/refs/heads/main`, 'PATCH', { sha: parentSha, force });
  console.log(`main -> ${parentSha.slice(0, 9)} https://github.com/hgqapp/CLIProxyAPI/commit/${parentSha}`);

  if (tag) {
    try {
      gh(`${API}/git/refs/tags/${tag}`, 'PATCH', { sha: parentSha, force: true });
    } catch {
      gh(`${API}/git/refs`, 'POST', { ref: `refs/tags/${tag}`, sha: parentSha });
    }
    console.log(`tag ${tag} -> ${parentSha.slice(0, 9)}`);
  }
}

main();
