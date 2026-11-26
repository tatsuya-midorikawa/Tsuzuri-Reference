// Drift checks between the Tsuzuri compiler and Tsuzuri-Reference:
// - `cli`: flags & env vars of `--help` against `docs/compiler/options.md`, and commands against `docs/compiler/cli.md`
// - `codes`: diagnostic codes of `explain --catalog --json` against `docs/compiler/diagnostics.md`
// - `version`: version mentions `Tsuzuri X.Y.Z` against `tsuzuri --version`
// - `std`: public standard-library functions of `tsuzuri doc std` against `docs/stdlib/**`
//
// usage: node scripts/check-cli-docs.mjs [--only cli|codes|version|std]... [--bin PATH] [--tsuzuri-repo PATH]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createContext, defaultCompiler, defaultTsuzuriRepo } from './gen-docs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unique = (values) => [...new Set(values)].sort();

export function extractCli(help) {
    return {
        flags: unique([...help.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)].map((match) => match[1])),
        commands: unique([...help.matchAll(/^ {2,4}tsuzuri (?:\[(build)\]|([a-z][a-z-]*))/gm)].map((match) => match[1] ?? match[2])),
        variables: unique([...help.matchAll(/\bTSUZURI_[A-Z0-9_]+\b/g)].map((match) => match[0])),
    };
}

export const EXEMPT_FLAGS = { '--sysroot': 'a flag of the C compiler named in the TSUZURI_SYSROOT sentence of --help' };

export function checkCli(cli, pages) {
    const messages = [];
    const names = (text, name) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(text);
    for (const flag of cli.flags) {
        if (!(flag in EXEMPT_FLAGS) && !names(pages['docs/compiler/options.md'], flag)) {
            messages.push(`docs/compiler/options.md lacks flag ${flag}`);
        }
    }
    for (const variable of cli.variables) {
        if (!names(pages['docs/compiler/options.md'], variable)) {
            messages.push(`docs/compiler/options.md lacks variable ${variable}`);
        }
    }
    for (const command of cli.commands) {
        if (!new RegExp(`tsuzuri (?:\\[${command}\\]|${command})(?![A-Za-z0-9_-])`).test(pages['docs/compiler/cli.md'])) {
            messages.push(`docs/compiler/cli.md lacks command ${command}`);
        }
    }
    return messages;
}

export function documentedCodes(text) {
    const codes = [];
    let generated = false;
    for (const line of text.split('\n')) {
        if (/^<!-- generated:[^ ]+ -->$/.test(line.trim())) { generated = true; continue; }
        if (/^<!-- \/generated:[^ ]+ -->$/.test(line.trim())) { generated = false; continue; }
        if (generated) continue;
        const row = /^\| (.+?) \|/.exec(line);
        if (!row) continue;
        const range = /`([EW])([0-9]{4})`\s*[–〜~-]\s*`([EW])([0-9]{4})`/.exec(row[1]);
        if (range) {
            for (let n = Number(range[2]); n <= Number(range[4]); n++) {
                codes.push(`${range[1]}${String(n).padStart(4, '0')}`);
            }
        } else {
            codes.push(...[...row[1].matchAll(/`([EW][0-9]{4})`/g)].map((match) => match[1]));
        }
    }
    return unique(codes);
}

export function checkCodes(emitted, pages) {
    const messages = [];
    for (const [page, text] of Object.entries(pages)) {
        const documented = documentedCodes(text);
        for (const code of emitted) if (!documented.includes(code)) messages.push(`${code} is emitted but missing from ${page}`);
        for (const code of documented) if (!emitted.includes(code)) messages.push(`${code} is in ${page} but no source emits it`);
    }
    return messages;
}

const walk = (directory, extension) => readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name), extension) : entry.name.endsWith(extension) ? [join(directory, entry.name)] : []));

export const versionMentions = (text) => [...text.matchAll(/\b[Tt]suzuri v?(\d+\.\d+\.\d+)\b/g)].map((match) => match[1]);

export function checkVersion(versionOutput, mentions) {
    const match = /^tsuzuri (\d+\.\d+\.\d+)$/.exec(versionOutput);
    if (!match) return [`unexpected --version output: '${versionOutput}'`];
    const version = match[1];
    return mentions
        .filter((mention) => mention.version !== version)
        .map((mention) => `${mention.file} says ${mention.version}, compiler is ${version}`);
}

export const STD_PAGES = {
    Alloc: 'docs/stdlib/testing/alloc.md',
    Anchor: 'docs/stdlib/memory/anchor.md',
    Arc: 'docs/stdlib/memory/rc.md',
    Arena: 'docs/stdlib/memory/arena.md',
    Array: 'docs/stdlib/collections/array.md',
    Atomic: 'docs/stdlib/sync/atomic.md',
    Bench: 'docs/stdlib/testing/bench.md',
    BigInt: 'docs/stdlib/numeric/bigint.md',
    Cbor: 'docs/stdlib/encoding/cbor.md',
    Channel: 'docs/stdlib/sync/channel.md',
    Char: 'docs/stdlib/text/char.md',
    Complex: 'docs/stdlib/numeric/complex.md',
    Cond: 'docs/stdlib/sync/cond.md',
    Context: 'docs/stdlib/sync/context.md',
    DataChannel: 'docs/stdlib/sync/datachannel.md',
    Debug: 'docs/stdlib/core/debug.md',
    Dir: 'docs/stdlib/sys/dir.md',
    Domain: 'docs/stdlib/core/domain.md',
    Env: 'docs/stdlib/sys/env.md',
    ErrGroup: 'docs/stdlib/sync/errgroup.md',
    Exception: 'docs/stdlib/core/exception.md',
    File: 'docs/stdlib/sys/file.md',
    FnPtr: 'docs/stdlib/memory/fnptr.md',
    Format: 'docs/stdlib/text/format.md',
    Gen: 'docs/stdlib/testing/gen.md',
    Gpu: 'docs/stdlib/numeric/gpu.md',
    HashMap: 'docs/stdlib/collections/hashmap.md',
    HashSet: 'docs/stdlib/collections/hashset.md',
    IO: 'docs/stdlib/sys/io.md',
    Int: 'docs/stdlib/numeric/int.md',
    Json: 'docs/stdlib/encoding/json.md',
    List: 'docs/stdlib/collections/list.md',
    Map: 'docs/stdlib/collections/map.md',
    Math: 'docs/stdlib/numeric/math.md',
    Matrix: 'docs/stdlib/numeric/matrix.md',
    MatrixView: 'docs/stdlib/numeric/matrix-view.md',
    Maybe: 'docs/stdlib/core/maybe.md',
    Monoid: 'docs/stdlib/core/monoid.md',
    Monoids: 'docs/stdlib/core/monoid.md',
    Mutex: 'docs/stdlib/sync/mutex.md',
    Net: 'docs/stdlib/sys/net.md',
    Once: 'docs/stdlib/sync/once.md',
    OnceValue: 'docs/stdlib/sync/once.md',
    Os: 'docs/stdlib/sys/os.md',
    Owned: 'docs/stdlib/memory/owned.md',
    Parallel: 'docs/stdlib/sync/parallel.md',
    Path: 'docs/stdlib/sys/path.md',
    Process: 'docs/stdlib/sys/process.md',
    Random: 'docs/stdlib/sys/random.md',
    Rc: 'docs/stdlib/memory/rc.md',
    ReceiveOnly: 'docs/stdlib/sync/channel.md',
    Regex: 'docs/stdlib/text/regex.md',
    RegexText: 'docs/stdlib/text/regex.md',
    Result: 'docs/stdlib/core/result.md',
    Routine: 'docs/stdlib/sync/routine.md',
    RwMutex: 'docs/stdlib/sync/rwmutex.md',
    Semaphore: 'docs/stdlib/sync/semaphore.md',
    SendOnly: 'docs/stdlib/sync/channel.md',
    Seq: 'docs/stdlib/collections/seq.md',
    Set: 'docs/stdlib/collections/set.md',
    Simd: 'docs/stdlib/numeric/simd.md',
    Slice: 'docs/stdlib/numeric/slice.md',
    String: 'docs/stdlib/text/string.md',
    SyncMap: 'docs/stdlib/sync/syncmap.md',
    Tensor: 'docs/stdlib/numeric/tensor.md',
    Test: 'docs/stdlib/testing/test.md',
    Text: 'docs/stdlib/text/text.md',
    Ticker: 'docs/stdlib/sync/timer.md',
    Time: 'docs/stdlib/sys/time.md',
    Timer: 'docs/stdlib/sync/timer.md',
    Unicode: 'docs/stdlib/text/unicode.md',
    Utf8Char: 'docs/stdlib/text/char.md',
    Utf8String: 'docs/stdlib/text/utf8string.md',
    Vec: 'docs/stdlib/collections/vec.md',
    WaitGroup: 'docs/stdlib/sync/waitgroup.md',
    ZString: 'docs/stdlib/text/zstring.md',
};

export const stdPage = (module) => STD_PAGES[module] ?? null;

export function checkStd(modules, readPage) {
    const messages = [];
    for (const [module, entries] of Object.entries(modules)) {
        if (entries.length === 0) continue;
        const page = stdPage(module);
        const text = page ? readPage(page) : null;
        if (text === null) {
            messages.push(`${module} has ${entries.length} public functions but no page in STD_PAGES`);
            continue;
        }
        for (const { name } of entries) {
            if (!text.includes(`\`${name}\``) && !new RegExp(`(?<![A-Za-z0-9_])${module}\\.${name}(?![A-Za-z0-9_])`).test(text)) {
                messages.push(`${module}.${name} is not mentioned in ${page}`);
            }
        }
    }
    return messages;
}

export const CHECKS = ['cli', 'codes', 'version', 'std'];

export function runChecks(context, compiler, names) {
    const read = (path) => readFileSync(resolve(context.root, path), 'utf8');
    const run = (args) => spawnSync(compiler, args, { cwd: context.root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return CHECKS.filter((name) => names.includes(name)).map((name) => {
        if (name === 'cli') {
            const help = run(['--help']);
            if (help.status !== 0) throw new Error(`${compiler} --help failed: ${help.stderr}`);
            const cli = extractCli(help.stdout);
            return {
                name,
                summary: `${cli.flags.length} flags, ${cli.commands.length} commands, ${cli.variables.length} variables`,
                messages: checkCli(cli, {
                    'docs/compiler/options.md': read('docs/compiler/options.md'),
                    'docs/compiler/cli.md': read('docs/compiler/cli.md'),
                }),
            };
        }
        if (name === 'codes') {
            const emitted = unique(context.catalog().map((line) => JSON.parse(line).code));
            return {
                name,
                summary: `${emitted.length} codes`,
                messages: checkCodes(emitted, { 'docs/compiler/diagnostics.md': read('docs/compiler/diagnostics.md') }),
            };
        }
        if (name === 'version') {
            const versionOut = run(['--version']).stdout.trim();
            const files = ['README.md', ...walk(resolve(context.root, 'docs'), '.md').map((file) => relative(context.root, file))];
            const mentions = files.flatMap((file) => versionMentions(read(file)).map((found) => ({ file, version: found })));
            return {
                name,
                summary: `${versionOut} (${mentions.length} mentions)`,
                messages: checkVersion(versionOut, mentions),
            };
        }
        const modules = context.std();
        const readPage = (page) => (existsSync(resolve(context.root, page)) ? read(page) : null);
        const functions = Object.values(modules).reduce((sum, entries) => sum + entries.length, 0);
        return {
            name,
            summary: `${functions} public functions in ${Object.values(modules).filter((entries) => entries.length > 0).length} modules`,
            messages: checkStd(modules, readPage),
        };
    });
}

const USAGE = 'usage: node scripts/check-cli-docs.mjs [--only cli|codes|version|std]... [--bin PATH] [--tsuzuri-repo PATH]';

export function main(argv) {
    const only = [];
    let tsuzuriRepo = defaultTsuzuriRepo();
    let bin;
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--only' && index + 1 < argv.length) only.push(argv[++index]);
        else if (argv[index] === '--bin' && index + 1 < argv.length) bin = resolve(argv[++index]);
        else if (argv[index] === '--tsuzuri-repo' && index + 1 < argv.length) tsuzuriRepo = resolve(argv[++index]);
        else {
            console.error(`check-cli-docs: unknown option '${argv[index]}'\n${USAGE}`);
            return 2;
        }
    }
    const unknown = only.find((name) => !CHECKS.includes(name));
    if (unknown !== undefined) {
        console.error(`check-cli-docs: unknown check '${unknown}'\n${USAGE}`);
        return 2;
    }
    const compiler = bin ?? defaultCompiler(tsuzuriRepo);
    if (!existsSync(compiler)) {
        console.error(`check-cli-docs: compiler not found: ${compiler}`);
        return 2;
    }
    const results = runChecks(createContext({ root, compiler, tsuzuriRepo }), compiler, only.length > 0 ? only : CHECKS);
    let failed = 0;
    for (const { name, summary, messages } of results) {
        if (messages.length === 0) console.log(`ok ${name}: ${summary}`);
        else {
            failed += 1;
            console.error(`FAIL ${name}: ${summary} (${messages.length} drift)`);
            for (const message of messages) console.error(`  ${message}`);
        }
    }
    console.log(`check-cli-docs: ${results.length} checks, ${failed} failed`);
    return failed > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
