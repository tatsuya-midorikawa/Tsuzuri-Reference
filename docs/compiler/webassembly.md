# WebAssembly 出力

`tsuzuri build --target wasm32` および `--target wasm64` は、ブラウザや Node.js、エッジランタイム、WASI ホスト上で動作するスタンドアロンの WebAssembly モジュール（`.wasm`）を生成します。ファイル I/O やネットワークを使わない計算モジュールは外部 import を一切持たず、`WebAssembly.instantiate` だけで即座に実行できます。さらに、`--emit bindings-js` を用いると型検査・バッファ管理・トラップ復旧を備えた JavaScript グルーモジュール（`.mjs`）と TypeScript 型宣言（`.d.mts`）を自動生成できます。

## 要点

- `--target wasm32`（32-bit アドレス空間、最大メモリ `4GiB - 64KiB`）と `--target wasm64`（memory64、最大メモリ `16GiB`）に対応しています（`wasm32-unknown-unknown` / `wasm64-unknown-unknown` も同義の別名として指定可能）。
- `--emit bindings-js`（`--target wasm32` 専用）は `.mjs` と `.d.mts` を出力し、数値範囲検査・UTF-16 / UTF-8 変換・`tsuzuri_alloc` / `tsuzuri_free` の自動管理・トラップ後のインスタンス再生成を担います。
- `--wasm-feature` フラグにより、`simd128`（128-bit SIMD）、`threads`（Web Worker 並列実行）、`tail-call`（定数スタックの相互末尾再帰）、`jspi`（JavaScript Promise Integration と M:1 `tzroutine` スケジューラ）、`webgpu`（WebGPU カーネル実行）、`net`（Node.js TCP/UDP/DNS ソケット）を必要なときだけ明示的に有効化できます。
- 標準入出力や `File`・`Dir`・`Env`・`Time`・`Random`・`Process` を WebAssembly で使用する場合は `--wasm-host wasi`（WASI preview1）を指定します（既定のスタンドアロン出力では `E2000` で静的に拒否されます）。

## スタンドアロン `.wasm` のビルドと直接呼び出し

公開関数 `export def` はネイティブ C ABI と同じく `tz_` 接頭辞でエクスポートされます。同じソースコードはネイティブと WebAssembly で完全に同一の演算結果を返します。

```tsuzuri run=42
export def add :: i64 -> i64 -> i64 = \left right ->
    left + right

add 20 22
```

```sh
tsuzuri build Main.tz --target wasm32 -o math.wasm
```

純粋なスカラー計算のみのモジュールは import オブジェクトなしでそのままインスタンス化できます。

```javascript
import { readFileSync } from "node:fs";

const { instance } = await WebAssembly.instantiate(readFileSync("./math.wasm"));
console.log(instance.exports.tz_add(20n, 22n)); // 42n
```

### Tsuzuri・WebAssembly・JavaScript / TypeScript の型対応

| Tsuzuri の型 | 生の WASM ABI 型 | 生の JS 表現 | `--emit bindings-js` の型 |
| --- | --- | --- | --- |
| `i8` / `i16` / `i32` / `i8u` / `i16u` / `i32u` | `i32` | `Number`（符号なしは `>>> 0`） | `number`（型の範囲外は `RangeError`） |
| `i64` / `i64u` | `i64` | `BigInt`（符号なしは `BigInt.asUintN(64, v)`） | `bigint`（範囲外は `RangeError`、`i64u` 戻り値は非負 `bigint`） |
| `f32` / `f64` | `f32` / `f64` | `Number` | `number` |
| `bool` | `i32` | `Number`（`0` / `1`） | `boolean`（`0` や `1` を渡すと `TypeError`） |
| `unit`（戻り値） | なし | `undefined` | `void` |
| `ref [i64]` / `ref [f64]` / `ref [ubyte]` | `(ptr, i64 len)` | ポインタと長さ | `BigInt64Array` / `Float64Array` / `Uint8Array` または `Borrowed<...>` |
| `ref string` / `ref utf8string` | `(ptr, i64 len)` | UTF-16 単位列 / UTF-8 バイト列 | `string`（`utf8string` は `isWellFormed()` 検査付き） |
| 所有配列・文字列の戻り値 | 先頭 `out` ポインタ（16 バイト記述子） | `{ ptr, len }` を読み出し `tsuzuri_free` | 型付き配列または `string` に複製して即座に解放 |

## 型付き JavaScript / TypeScript バインディング（`--emit bindings-js`）

手動での線形メモリ確保やポインタ計算を省くには、`.wasm` 本体と併せて `--emit bindings-js` でグルーコードを生成します（`-o` の拡張子は `.mjs` とし、同じ場所に `<name>.d.mts` が同時出力されます）。

```sh
tsuzuri build shop --target wasm32 -O3 --trap-info -o shop.wasm
tsuzuri build shop --target wasm32 --emit bindings-js -o shop.mjs
```

生成されたグルーの `load(bytesOrModule, options)` はブラウザと Node.js の双方でそのまま動作します（`node:` 固有モジュールへの依存はありません）。

```javascript
import { readFile } from "node:fs/promises";
import { load, TsuzuriTrap } from "./shop.mjs";

const { sites } = JSON.parse(await readFile("./shop.wasm.trap.json", "utf8"));
const api = await load(await readFile("./shop.wasm"), {
  imports: { "Main.tax_rate": () => 10n },
  sites,
});

// 通常の呼び出し（引数は自動コピーされ、所有戻り値も JS 側へ複製後に即解放される）
console.log(api.exports.shout("tea"));

// 大規模配列を余分なコピーなしで書き込んで渡す withBorrowed
const scaled = api.withBorrowed("f64", 3, (buf) => {
  buf.view().set([1.5, 2.0, 3.5]);
  return api.exports.scale(buf, 2.0);
});
console.log(scaled);
```

- **トラップ時の安全なインスタンス再生成**: Tsuzuri はトラップ時にスタックアンワインドを行わないため、一度 `RuntimeError` を起こしたインスタンスのヒープやシャドウスタックは再利用できません。グルーはトラップを捕捉すると `{ reason, site, kind, path, line, column }` を持つ `TsuzuriTrap` 例外を送出して古いインスタンスを破棄し、次回の呼び出し時に新しいインスタンスを再生成します（Chrome メインスレッドで 8 MB 超のモジュールを扱う場合のみ同期再生成が制限されるため、`await api.ready()` を呼んで非同期に再生成します）。
- **グルーを使わない生 ABI 呼び出し時の注意**: 直接 `WebAssembly.instantiate` を使うホストでは、呼び出しのたびに線形メモリが拡張（`memory.grow`）される可能性があるため、`DataView` や `TypedArray` ビューは毎回 `instance.exports.memory.buffer` から取り直してください。所有戻り値の 16 バイト記述子（オフセット 0 が `u32` ポインタ、オフセット 8 が `i64` 長さ）と要素バッファの双方は `tsuzuri_free` で解放し、トラップ発生後はインスタンスを破棄します（リポジトリの `src/runtime/trap-boundary.mjs` の `createBoundary` でも同等の管理が可能です）。

## 線形メモリ・スタック・サイズ最適化

- **メモリとスタックの調整**: 既定の最大線形メモリは `16MiB`、メインスタックは `1MiB` です。CLI の `--wasm-max-memory 64MiB`・`--wasm-stack-size 2MiB`、または `Tsuzuri.toml` の `[wasm]` セクション（`max-memory` / `stack-size`）で変更できます（サイズは `KiB` / `MiB` / `GiB` またはバイト数で指定し、メモリ上限はスタックサイズ + `64KiB` 以上かつ `64KiB` ページ境界である必要があります）。
- **モジュールサイズの縮小**: 整数のみを表示・パースするプログラムでは浮動小数点ランタイムテーブルが自動的に省かれます。さらに小さくするには `-Oz` を指定し、Binaryen 導入済みの環境では `--wasm-opt` を併用します。
- **高速デバッグビルドと PGO**: 開発中の `-O0` ビルドを高速化する `--backend fast`、および `<name>.wasm.profile.mjs` の `writeProfile(instance)` を用いたプロファイル誘導最適化（`--profile-generate` / `--profile-use`）にも対応しています（[コンパイラオプションと環境変数](./options.md) 参照）。

## `--wasm-feature` による拡張機能

WebAssembly のオプション機能は、実行エンジンの互換性を損なわないようすべてオプトイン方式（`--wasm-feature <name>`）になっています。

### 1. `simd128`（128-bit SIMD）

`wasm32` / `wasm64` のコード生成で WebAssembly 128-bit SIMD 命令を許可します。`Simd` モジュールのベクトル演算、配列の自動ベクトル化、および UTF-8 / UTF-16 / コンパクト文字列の高速走査カーネルが有効になります。外部 import は増えません。

### 2. `tail-call`（保証された末尾呼び出し）

同一再帰グループ内の相互末尾呼び出しを WebAssembly の `return_call` 命令へ出力します（Node.js 20 以降および現行モダンブラウザで動作）。`-O0` でも相互再帰がコールスタックを消費せず、`RangeError: Maximum call stack size exceeded` を回避できます。

### 3. `threads`（Web Worker / 共有メモリ並列処理）

`wasm32` モジュールにおいて共有線形メモリ（`SharedArrayBuffer`）と WebAssembly アトミック命令を有効化し、`Parallel.*`・`Atomic`・`Mutex`・`DataChannel` を複数の Worker スレッド上で並列実行します（`tzroutine`・`Channel`・WASI・`--allocator host` とは排他です）。

`.wasm` と `--emit bindings-js` の両方に `--wasm-feature threads` を付けてビルドすると、ブラウザ向けの Worker プール管理グルーが出力されます。

```sh
tsuzuri build shop --target wasm32 --wasm-feature threads -O3 -o shop.wasm
tsuzuri build shop --target wasm32 --wasm-feature threads --emit bindings-js -o shop.mjs
```

- ブラウザページには `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` ヘッダー（Cross-Origin Isolation）が必須です。非分離ページでは暗黙の逐次フォールバックを行わず明確に `Error` を送出します。
- UI メインスレッドでの `atomic.wait` 禁止制約を守るため、グルーは調整役 Worker 1 つと補助 Worker `workers` 個を起動し、すべてのエクスポート関数は `Promise` を返します。使い終えたら `await api.close()` でプールを終了します。

### 4. `jspi`（JavaScript Promise Integration と `tzroutine`）

`--wasm-feature jspi` を `.wasm` と `--emit bindings-js` の両方に指定すると、すべてのエクスポート関数が `WebAssembly.promising` でラップされて `Promise<T>` を返すようになり、非同期ホスト待機中に WebAssembly スタックだけを安全に中断（サスペンド）して JavaScript イベントループへ制御を返せます（Node.js 24 以降などの JSPI 対応エンジンが必要）。

`tzroutine { ... }`・`Routine.scope`・`Channel`・`select`・`WaitGroup`・`ErrGroup`・`Context`・タイマーを起動するプログラムを WebAssembly で動かす場合も、この `--wasm-feature jspi` グルーを使用します。

- 各 tzroutine にはヒープから 64 KiB の専用線形メモリスタックが割り当てられ、JavaScript の単一スレッド上で協調的（M:1）に多重スケジューリングされます（多くの tzroutine を同時起動する場合は `--wasm-max-memory` を増やします）。
- すべての tzroutine が待機状態に入りタイマーもソケット待機も存在しない場合は、`RuntimeError("all tzroutines are asleep - deadlock!")` で即座にデッドロックを報告します。

### 5. `net`（Node.js 向けソケット通信）

`--wasm-feature jspi --wasm-feature net` を `.wasm` と `--emit bindings-js` の双方に指定すると、標準モジュール `Net` の TCP / UDP ソケットおよび DNS 名前解決が Node.js の `node:net`・`node:dgram`・`node:dns` を介して動作します。待機を伴う送受信・接続操作は JSPI でスタックを中断し、エラーコードやタイムアウト規約もネイティブ実装と揃えられています（ブラウザ環境には生の TCP / UDP ソケットが存在しないため Node.js 専用です）。

### 6. `webgpu`（WebGPU コンピュート実行）

`--wasm-feature webgpu` を指定すると、`Gpu.request Gpu.WebGpu` を使用するモジュールに `tsuzuri_gpu.open` と `tsuzuri_gpu.run` の 2 つの JSPI import が追加されます。ホスト側では `src/runtime/webgpu.mjs` の `createGpuImports(navigator.gpu, () => instance.exports.memory)` を渡してインスタンス化します（WebAssembly 環境では `Gpu.Vulkan` は常に `Unavailable`、`Gpu.Auto` は CPU 参照実装を選択します）。

## WASI ターゲット（`--wasm-host wasi`）

コマンドラインツールやバッチ処理を WASI ランタイム（Wasmtime、Node.js WASI 等）で動かしたい場合は、`--target wasm32 --wasm-host wasi` を指定します。

```sh
tsuzuri build cli-app --target wasm32 --wasm-host wasi -o cli-app.wasm
```

標準入出力（`IO`）および `File`・`Dir`・`Env`・`Time`・`Random`・`Process` が WASI preview1 のシステムコール import へ接続されます（WASI preview1 にはソケット接続・バインド API が含まれないため、`Net` ソケットは引き続き `E2000` で拒否されます）。

## ホスト関数のインポートと診断サイドテーブル

- **`extern` の import 名規約**: リンク名なしの `extern def tax_rate :: unit -> i64` はモジュール `"tsuzuri"`・名前 `"Main.tax_rate"`、1 文字列の `extern "sqrt" def ...` はモジュール `"tsuzuri"`・名前 `"sqrt"`、2 文字列の `extern "env" "host_now" def ...` はモジュール `"env"`・名前 `"host_now"` として import されます。
- **ネイティブ専用の連携は到達すると `E1008`**: Objective-C のクラス・`ObjC`・メッセージ送信（[Objective-C 連携](./objective-c.md)）と、`@c_layout` レコードの C 構造体としての値渡しは、WebAssembly のビルドで到達すると `E1008`（`abi_native_only`）になります。宣言だけなら出力は変わりません。
- **`.trap.json` と `.overflow.json`**: `--trap-info` 指定時は `tsuzuri_trap_site` グローバル/関数と `<output>.trap.json` が生成され、`--overflow-report` 指定時は外部 import を増やさずに `tsuzuri_overflow_count()`・`tsuzuri_overflow_hit(i)` の 2 関数と `<output>.overflow.json` が生成されます。

## 関連項目

- [CLI とサブコマンド](./cli.md)
- [コンパイラオプションと環境変数](./options.md)
- [対応プラットフォームとクロスコンパイル](./platforms.md)
- [ネイティブ連携と C ABI](./native-interop.md)
- [デバッグ](./debugging.md)
- [tzroutine による軽量並行処理](../concurrency/tzroutine.md)
- [Net](../stdlib/sys/net.md)
- [Gpu](../stdlib/numeric/gpu.md)
