// Validates Tsuzuri-Reference Markdown pages:
// 1. Final newline and column-0 ```tsuzuri code fences
// 2. Relative file links and `#heading` fragment anchors across `README.md` and `docs/**/*.md`
// 3. `tsuzuri check` on every `tsuzuri` code fence, `tsuzuri run` at `-O0` and `-O3` on `run=` fences,
//    and `tsuzuri test` on fences containing `test "..."`
// 4. Freshness of generated blocks (`scripts/gen-docs.mjs`) when TSUZURI_REPO is available
//
// usage: node scripts/check-docs.mjs [--jobs N] [--bin PATH] [--tsuzuri-repo PATH] [PAGE...]

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PLACEMENTS, checkBlocks, createContext, defaultCompiler, defaultTsuzuriRepo } from './gen-docs.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function collect(directory, out) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collect(path, out);
        else if (extname(path) === '.md') out.push(path);
    }
}

export function headings(source) {
    const found = new Set();
    const duplicates = new Map();
    for (const line of source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').split('\n')) {
        const heading = /^#{1,6} (.+)$/.exec(line);
        if (!heading) continue;
        const base = heading[1].toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '').replace(/ /g, '-');
        const count = duplicates.get(base) ?? 0;
        found.add(count ? `${base}-${count}` : base);
        duplicates.set(base, count + 1);
    }
    return found;
}

let tsuzuriRepo = defaultTsuzuriRepo();
let bin;
let jobs = Math.min(8, Math.max(1, availableParallelism()));
let skipLinks = false;
const requested = [];

for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--jobs' && i + 1 < process.argv.length) jobs = Math.max(1, Number(process.argv[++i]));
    else if (arg === '--bin' && i + 1 < process.argv.length) bin = resolve(process.argv[++i]);
    else if (arg === '--tsuzuri-repo' && i + 1 < process.argv.length) tsuzuriRepo = resolve(process.argv[++i]);
    else if (arg === '--skip-links') skipLinks = true;
    else requested.push(resolve(arg));
}

const compiler = bin ?? defaultCompiler(tsuzuriRepo);
assert.ok(existsSync(compiler), `compiler not found: ${compiler}`);

const temporary = mkdtempSync(join(tmpdir(), 'tsuzuri-ref-docs-'));
const pages = [];
if (existsSync(join(root, 'README.md'))) pages.push(join(root, 'README.md'));
collect(join(root, 'docs'), pages);
pages.sort();

const headingCache = new Map();
const getHeadings = (path) => {
    if (!headingCache.has(path)) headingCache.set(path, headings(readFileSync(path, 'utf8')));
    return headingCache.get(path);
};

let examples = 0;
let executions = 0;
let tests = 0;
let links = 0;

try {
    assert.ok(!requested.length || requested.every((path) => pages.includes(path)), 'Requested page not found');
    const tasks = [];

    for (const page of pages) {
        if (requested.length && !requested.includes(page)) continue;
        const source = readFileSync(page, 'utf8');
        const label = relative(root, page);
        assert.ok(source.endsWith('\n'), `${label}: missing final newline`);
        assert.ok(!/^[ \t]+```tsuzuri/m.test(source), `${label}: an indented tsuzuri code fence is not checked; start it at column 1`);
        const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
        if (!skipLinks) {
            for (const match of prose.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
                const target = match[1];
                if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
                const [path, fragment] = target.split('#');
                const destination = path ? resolve(dirname(page), decodeURIComponent(path)) : page;
                assert.ok(existsSync(destination), `${label}: missing link ${target}`);
                if (fragment && extname(destination) === '.md') {
                    assert.ok(getHeadings(destination).has(decodeURIComponent(fragment)), `${label}: missing heading ${target}`);
                }
                links += 1;
            }
        }
        if (existsSync(join(dirname(page), '.tsuzuri-docs'))) continue;

        const projects = new Map();
        let block = 0;
        for (const match of source.matchAll(/^```tsuzuri(?: ([^\n]+))?\n([\s\S]*?)^```\s*$/gm)) {
            block += 1;
            const options = Object.fromEntries((match[1] ?? '').split(/\s+/).filter(Boolean).map((option) => {
                const separator = option.indexOf('=');
                assert.ok(separator > 0, `${label}: invalid example option ${option}`);
                return [option.slice(0, separator), option.slice(separator + 1)];
            }));
            assert.ok(Object.keys(options).every((key) => ['project', 'file', 'run'].includes(key)), `${label}: unknown example option`);
            const key = options.project ?? `block-${block}`;
            const project = projects.get(key) ?? { files: new Map(), expected: undefined };
            const file = options.file ?? 'Main.tz';
            assert.ok(!file.includes('..') && !file.startsWith(sep) && ['.tz', '.tt', '.tc'].includes(extname(file)), `${label}: invalid example file`);
            assert.ok(!project.files.has(file), `${label}: duplicate example file ${file}`);
            project.files.set(file, match[2]);
            if (options.run !== undefined) project.expected = decodeURIComponent(options.run);
            projects.set(key, project);
        }

        for (const [key, project] of projects) {
            tasks.push({ label, key, project });
        }
    }

    let cursor = 0;
    const workerCount = Math.min(jobs, Math.max(1, tasks.length));
    await Promise.all(Array.from({ length: workerCount }, async (_, workerId) => {
        const cacheDir = join(temporary, `cache-${workerId}`);
        mkdirSync(cacheDir, { recursive: true });
        while (cursor < tasks.length) {
            const current = tasks[cursor++];
            const { label, key, project } = current;
            const directory = mkdtempSync(join(temporary, 'example-'));
            for (const [file, content] of project.files) {
                const path = join(directory, file);
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, content);
            }
            const context = `${label} (${key})`;
            const invoke = async (args) => {
                try {
                    const { stdout } = await execFileAsync(compiler, args, {
                        encoding: 'utf8',
                        maxBuffer: 4 * 1024 * 1024,
                        env: { ...process.env, TSUZURI_KG: '0', TSUZURI_CACHE_DIR: cacheDir },
                    });
                    return stdout;
                } catch (error) {
                    throw new Error(`${context}: ${error.stderr ?? error.message}`, { cause: error });
                }
            };
            const input = join(directory, project.files.has('Main.tz') ? 'Main.tz' : project.files.keys().next().value);
            await invoke(['check', input]);
            examples += 1;
            if (project.expected !== undefined) {
                for (const optimization of ['-O0', '-O3']) {
                    const out = await invoke(['run', directory, optimization]);
                    assert.equal(out.trim(), project.expected, `${context} ${optimization}`);
                    executions += 1;
                }
            }
            if ([...project.files.values()].some((content) => /^test\s+"/m.test(content))) {
                await invoke(['test', directory]);
                tests += 1;
            }
        }
    }));

    let checkedBlocks = 0;
    const relevantPlacements = requested.length
        ? PLACEMENTS.filter((p) => requested.includes(resolve(root, p.file)))
        : PLACEMENTS;
    if (relevantPlacements.length > 0 && existsSync(join(tsuzuriRepo, 'std'))) {
        const blocks = checkBlocks(createContext({ root, compiler, tsuzuriRepo }), {
            files: requested.length ? requested : undefined,
        });
        assert.equal(blocks.stale.length, 0, `${blocks.stale.join('\n')}\nrun 'node scripts/gen-docs.mjs' to update`);
        checkedBlocks = blocks.checked;
    }

    console.log(`Docs: ${requested.length || pages.length} pages, ${links} links, ${examples} checked examples, ${executions} native runs (O0/O3), ${tests} test projects, ${checkedBlocks} generated blocks.`);
} finally {
    rmSync(temporary, { recursive: true, force: true });
}
