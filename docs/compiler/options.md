# コンパイラオプションと環境変数

`tsuzuri` のコマンドラインフラグは、サブコマンドごとに受け付ける組み合わせが厳密に定義されています。未知のフラグ、重複指定、または出力形式やターゲットと矛盾する組み合わせを指定した場合は、コード生成や実行に進む前に診断コード `E2000` で停止します。

本章では、`tsuzuri --help` が定義する全フラグと全環境変数を網羅し、最適化・サイズ削減・プロファイル誘導最適化（PGO）・高速デバッグバックエンド・WebAssembly 機能・アロケータ選択・内部コード生成フラグの動作を体系的に解説します。各サブコマンドの基本的な使い方は [CLI とサブコマンド](./cli.md) を参照してください。

## 要点

- 最適化レベルの既定値は `build`・`run`・`script`・`bench` で `-O3`、`test`・`repl`（および `--backend fast` 指定時）で `-O0` です。どの最適化レベルでも精度や意味を変える fast-math は一切有効化されません。
- `--emit` の既定値はネイティブターゲットで `exe`、WebAssembly ターゲット（`wasm32` / `wasm64`）で `wasm` です。
- 複数回の指定が許可されるフラグは `--link`・`-l`・`-L`・`--index`・`--function`・`--takes`・`--include-dir`・`--buffer`・`--consume`・`--nonnull` および異なる機能名を渡す `--wasm-feature` のみで、その他のフラグの重複指定は `E2000`（終了コード `2`）となります。
- 外部ツール（`clang`・`wasm-ld`・`llvm-link`・`dsymutil`・`wasm-opt`）は「対応する `TSUZURI_*` 環境変数 → 配布物の同梱 `bin/` → `PATH`」の優先順で解決されます。環境変数が空文字列に設定されている場合も「設定済み」とみなされ、後続の探索へは進みません。

## 共通フラグとビルドオプション一覧

### 全般・出力・ターゲット選択

| フラグ | 既定値 | 対象コマンドと動作 |
| --- | --- | --- |
| `-h`, `--help` | — | コマンド一覧・オプション・環境変数・対応ターゲットトリプルを標準出力に表示して終了（終了コード `0`） |
| `--version` | — | コンパイラのバージョン（`tsuzuri 0.1.0`）を標準出力に表示して終了 |
| `--` | — | これ以降の引数をすべてオプションではなくファイル・ディレクトリパスとして解釈 |
| `-o PATH`, `--output PATH` | 入力の拡張子を置換したパス | 成果物の出力ファイルパス（`doc` では必須の出力ディレクトリ、`bindgen` では必須の `.tz` ファイル、`test` では `-g` 併用時のランナー出力先）。親ディレクトリは自動作成される |
| `--target native\|wasm32\|wasm64\|TRIPLE` | `native` | コード生成ターゲット。`build`・`test`（全ターゲット）、`run`（ネイティブのみ）、`bench`（ホスト同一ターゲットのみ）で有効。`TRIPLE` には対応 5 環境の 9 種のネイティブトリプルを指定可能（[対応プラットフォームとクロスコンパイル](./platforms.md) 参照） |
| `--emit KIND` | ネイティブは `exe`、WASM は `wasm` | `build` 専用。`exe`・`object`・`llvm`・`header`・`wasm`・`wgsl`・`wgsl-relaxed`・`spirv`・`spirv-relaxed`・`shared`・`bitcode`・`bindings-js`・`bindings-cs`・`bindings-py`・`bindings-cpp` の 15 種から選択 |
| `--subsystem console\|windows` | `[windows]` の設定、未設定時は `console` | Windows ネイティブ実行ファイル（`build --emit exe` および `run`）の PE サブシステム。`windows` はコンソールウィンドウを生成しない。非 Windows ターゲットや `exe` 以外での指定は `E2000` |

### 最適化・コード生成バックエンド・サイズ削減・PGO

| フラグ | 既定値 | 対象コマンドと動作 |
| --- | --- | --- |
| `-O0`, `-O1`, `-O2`, `-O3` | `build` / `run` / `script` / `bench` は `-O3`、`test` / `repl` は `-O0` | LLVM 最適化レベル。数値の丸め・NaN・符号付きゼロ・折り返し・トラップの意味を完全に保持 |
| `-Os`, `-Oz` | 未指定時は `-O3` | `build`・`run` 専用。コードサイズを優先する LLVM 最適化（`-Oz` はより強くサイズを縮小） |
| `--cpu generic\|native` | `generic` | `build`・`run`・`repl`・`script` のネイティブコード生成における CPU 命令セット選択。`native` はビルド機の ISA（AVX2 / AVX512-FP16 / SVE 等）を使用する（クロスコンパイル時は使用不可） |
| `--backend llvm\|fast` | `llvm` | `build`・`run`・`test` のコード生成器。`fast` は `-O0` の LLVM IR を Clang を介さずコンパイラ内蔵バックエンド（ネイティブは Cranelift、`wasm32` は直接命令出力）で機械語へ変換（コンパイラビルド時に Cargo の `--features fast-backend` が必要） |
| `--strip` | オフ | `build` のネイティブ `--emit exe` 専用。リンク時にローカルシンボルを除去（`-g` とは併用不可、Windows リンクでは無変更） |
| `--wasm-opt` | オフ | `build --target wasm32 --emit wasm` 専用。リンク後の `.wasm` に Binaryen の `wasm-opt -Oz` を適用（`-g`・`threads`・`wasm64` とは併用不可） |
| `--profile-generate DIR` | オフ | `build`（ネイティブ `exe` / `object`、`wasm32` の `wasm`）および `run`（ネイティブ）で PGO 計装バイナリを生成し、正常終了時に `DIR` 配下へ `.profraw` を出力 |
| `--profile-use PATH` | オフ | `.profdata` ファイルまたは `.profraw` を格納したディレクトリ `PATH` を用いてプロファイル誘導最適化を適用 |

### 診断・警告・エディション・デバッグ・契約検証

| フラグ | 既定値 | 対象コマンドと動作 |
| --- | --- | --- |
| `--json` | オフ | 診断メッセージを標準エラーへ 1 行 1 オブジェクトの JSON Lines で出力（`test`・`bench`・`api-diff`・`audit`・`prove`・`find`・`explain`・`guide`・`fix`・`kg`・`watch` では各コマンドの構造化出力も有効化） |
| `--deny-warnings` | オフ | `check`・`build`・`run`・`test`・`bench`・`doc`・`script`・`audit` で警告が 1 件でもあれば終了コード `1` で停止 |
| `--warn implicit-copy` | オフ | 配列・リスト・非 Copy `dyn` 値の暗黙ディープコピー箇所に警告 `W1006` を報告 |
| `--warn canonical` | オフ | Edition 2026 ソースにおいて Edition 2027 以降で廃止された非正準表記に書き換え修正案付きの警告 `W1007` を報告 |
| `--warn untrusted-extern` | オフ | ルートパッケージで宣言・使用されている `@trusted` 未付与の `extern` 関数に警告 `W1010` を報告 |
| `--edition 2026\|2027\|2028` | 最新版 `2028` | `Tsuzuri.toml` を持たない入力を `check`・`build`・`run`・`test`・`script` で読む際のエディション指定（マニフェストがあるプロジェクトでは `E2000`）。`new`・`guide`・`fix` でも使用 |
| `--report parallel` | オフ | `check` 専用。`Parallel` への置換提案とコールバック純粋性判定を標準出力へ報告（`--contracts prove` とは併用不可） |
| `--contracts off\|check\|test\|prove` | `build` は `off`、`run` / `test` / `script` は `check` | `@requires`・`@ensures` 契約の扱い。`off` は検査省略、`check` は実行時トラップ、`test` はプロパティテスト自動生成（`test` 専用）、`prove` は SMT 証明後に `check` として継続（`check` では `prove` のみ指定可） |
| `--prove-timeout SECONDS` | `10` | `prove` および `--contracts prove` における 1 検証あたりのソルバー制限時間（1〜3,600 秒） |
| `--function NAME` | 全関数 | `prove` および `--contracts prove` で証明対象を `Module.name` に限定（複数回指定可） |
| `-g`, `--debug-info` | オフ | `build`・`run`・`test`（単一 `--index` と `-o` 併用時）でソースレベル DWARF デバッグ情報を生成（Windows MSVC リンカー使用時は CodeView と `.pdb` / natvis も出力） |
| `--debug-output` | オフ | `build`・`run` で WebAssembly モジュールの `Debug.print` / `Debug.trace` 用ホスト import を有効化（ネイティブは常時出力） |
| `--trap-info` | `run` はオン、`build` はオフ | トラップ発生箇所のソース位置保持と `<output>.trap.json` の出力を有効化 |
| `--trap-mode return` | オフ | ネイティブの `object`・`llvm`・`header`・`shared`・`bitcode` および `bindings-cs`・`bindings-py`・`bindings-cpp` で、プロセス終了の代わりにトラップ状態を返す `tsuzuri_try_<name>` を追加 |
| `--overflow-report` | `test` はオン、`build` / `run` はオフ | 範囲証明で非飽和と示せない整数演算の折り返しを実行時に検出・報告 |
| `--allow-overflow` | オフ | `test` 専用（`-g` 除く）。整数折り返しを検出してもテストを失敗にせず警告のみ報告 |

### リンク・アロケータ・キャッシュ・WebAssembly

| フラグ | 既定値 | 対象コマンドと動作 |
| --- | --- | --- |
| `--link PATH` | なし | ホスト側のオブジェクトファイルまたは静的ライブラリをリンク（繰り返し可、`[native]` と合算で最大 256 個） |
| `-l NAME` | なし | システムライブラリを名前指定でリンク（例: `-l sqlite3`。繰り返し可） |
| `-L DIR` | なし | `-l` のライブラリ探索ディレクトリを追加（繰り返し可） |
| `--allocator system\|host\|counting\|small` | `system` | ヒープアロケータの選択。`host` はホスト提供関数、`counting` は確保統計計測（`run`・`test` でも指定可）、`small` はネイティブ 64-bit 向けスレッドローカルサイズクラスアロケータ |
| `--freestanding` | オフ | C 標準ライブラリ非依存のネイティブ `object`・`llvm`・`header` 出力（`--allocator host` 必須） |
| `--no-cache` | キャッシュ有効 | `build`・`run`・`script`・`repl` でキャッシュの読み書きと事前ビルド済みランタイムの利用を無効化 |
| `--no-server` | サーバー利用 | `check`・`build` で稼働中の `tsuzuri serve` に委譲せず自プロセスで直接実行 |
| `--wasm-feature NAME` | オフ | `build` 専用。`simd128`・`threads`・`jspi`・`webgpu`・`net`・`tail-call` を個別に有効化（異なる機能名で複数指定可） |
| `--wasm-host wasi` | オフ | `build --target wasm32`（`wasm` / `object`）で標準入出力と OS API を WASI preview1 import へ接続 |
| `--wasm-max-memory SIZE` | `16MiB` | WebAssembly の線形メモリ上限（64 KiB 単位。`wasm32` は最大 `4GiB - 64KiB`、`wasm64` は最大 `16GiB`） |
| `--wasm-stack-size SIZE` | `1MiB` | WebAssembly リンク出力・テスト時のメインスタックサイズ（16 バイト倍数かつ `64KiB` 以上） |

### サブコマンド固有フラグ一覧

テスト・ベンチマーク・パッケージ・知識グラフ・バインディング生成などのサブコマンド専用フラグは次のとおりです。

| サブコマンド | フラグ | 意味 |
| --- | --- | --- |
| `test` / `bench` | `--list` | テストやベンチマークを実行せず番号・モジュール・名前を一覧表示 |
| `test` / `bench` | `--filter TEXT` | `モジュール.名前` に `TEXT` を含む項目のみを実行 |
| `test` / `bench` | `--index N` | `--list` の番号 `N` のみを実行（複数指定可。`test -g -o PATH` では単一指定） |
| `test` | `--coverage PATH` | 成功したネイティブテストの行・関数カバレッジを LCOV 形式で `PATH` に出力 |
| `test` | `--seed N` | プロパティテスト（`Gen.for_all`）の 64-bit 乱数シードを指定 |
| `test` | `--affected BASE` | `BASE` からの変更が影響するテストのみを知識グラフで選別して実行 |
| `test` | `--doc` | ソース内の `test` 宣言ではなく `///` 内のドキュメントコード例を検証 |
| `bench` | `--samples N` | 計測標本数を指定（1〜1,000、既定 `11`） |
| `bench` | `--allocs` | 時間計測後に counting 実行器で 1 反復あたりの確保回数とバイト数を計測 |
| `fmt` | `--check` | ファイルを書き換えず未整形ファイルの有無を検査（差分があれば終了コード `1`） |
| `new` | `--namespace NAME` | 生成する `Tsuzuri.toml` と `Main.tz` の名前空間を指定 |
| `new` | `--no-agent-files` | `AGENTS.md` と `llms.txt` の生成を省略 |
| `repl` | `--timeout SECONDS` | 1 評価あたりの実行時間上限（0 は無制限、既定 `10`、最大 `3600`） |
| `serve` | `--idle-timeout SECONDS` | 無通信時にサーバーを自動停止する秒数（1〜86,400、既定 `1800`） |
| `serve` | `--status` / `--stop` | 指定ディレクトリの常駐ビルドサーバーの状態 JSON 取得、または停止要求 |
| `publish` | `--git URL`, `--rev COMMIT` | 公開対象の Git リポジトリ URL と 40 桁コミットハッシュを指定 |
| `api-diff` | `--effective` | 依存解決・型検査を行いエイリアス展開後・引数規約補完後の実効 API を比較 |
| `find` / `kg find` | `--project DIR` | 標準ライブラリに加えて `DIR` のプロジェクト宣言も検索（`find` 専用） |
| `find` / `kg find` | `--module NAME`, `--limit N` | 対象モジュール名の絞り込みと表示上限（1〜100、既定 `20`） |
| `find` / `kg find` | `--result TYPE`, `--takes TYPE` | 戻り値型（1 回）および引数に含まれる型（複数回可）による検索 |
| `explain` | `--catalog` | 登録されている全診断 `kind` の一覧を出力 |
| `guide` | `--level 0\|1`, `--topic NAME`, `--list` | AI ガイドの詳細度、単一トピック抽出、トピック一覧表示 |
| `guide` | `--agents [DIR]`, `--llms-txt [DIR]` | `DIR` のマニフェストから `AGENTS.md` / `llms.txt` 相当の本文を標準出力へ生成 |
| `fix` | `--applicability certain\|likely\|maybe` | 自動適用する修正案の確度閾値（既定 `certain`、`maybe` は `--dry-run` 必須） |
| `fix` | `--dry-run` | ファイルを書き換えず統一差分（unified diff）または計画のみを出力 |
| `fix` | `--from YEAR` | `--edition YEAR` によるエディション移行時の移行元エディションを指定 |
| `bindgen` | `--include-dir DIR` | Clang のヘッダー探索パスを追加（繰り返し可） |
| `bindgen` | `--buffer F:P:L` | C 関数 `F` のポインタ引数 `P` と直後の長さ引数 `L` を `ref [T]` に統合（繰り返し可） |
| `bindgen` | `--consume F:P` | C 関数 `F` の不透明ハンドル引数 `P` を借用ではなく所有権ムーブに変更（繰り返し可） |
| `bindgen` | `--nonnull F:T` | C 関数 `F` の引数または `return` を `Maybe` ではなく非 Null 型として生成（繰り返し可） |
| `mcp` | `--root DIR`, `--kg-dir DIR` | MCP サーバーのプロジェクトルートと知識グラフ読み込み先ディレクトリを指定 |
| `check` / `build` / `run` / `test` | `--kg`, `--no-kg`, `--kg-dir DIR` | 単一ファイルでの知識グラフ強制出力、出力抑止、出力先ディレクトリの変更 |
| `kg` サブコマンド | `--force`, `--std`, `--nodes`, `--edges`, `--facts`, `--no-refresh`, `--path PATH`, `--budget N`, `--depth N`, `--rel R`, `--git REV`, `--from PATH`, `--to PATH`, `--format mermaid\|dot`, `--max-nodes N` | 知識グラフの再構築・標準ライブラリ対象指定・エクスポート種別・自動更新抑止・照会予算・探索深さ・辺種別・影響比較元と先・図表形式と最大ノード数（詳細は [知識グラフ](./knowledge-graph.md)・[図表の自動生成](./diagrams.md) 参照） |

## 出力種別（`--emit`）と最適化の詳細

### `--emit` の 15 種別と制約

- **`exe` / `wasm`**: ネイティブ実行ファイル（`--target native` または `TRIPLE`）および WebAssembly モジュール（`wasm32` / `wasm64`）。逆の組み合わせは `E2000` で拒否されます。
- **`object` / `llvm` / `header`**: C/C++ ホスト等とリンクするオブジェクトファイル（`.o` / `.obj`）、LLVM IR テキスト（`.ll`）、および `export def` の C プロトタイプ宣言ヘッダー（`.h`）です。
- **`shared` / `bindings-cs` / `bindings-py` / `bindings-cpp`**: ネイティブ共有ライブラリ（macOS は `.dylib`、Linux は `.so`、Windows は未対応で `E2000`）と、それを呼び出す C#（`.cs`）・Python `ctypes`（`.py`）・C++20（`.hpp`）の型付きバインディングを生成します（[ネイティブ連携と C ABI](./native-interop.md) 参照）。
- **`bindings-js`**: `--target wasm32` 専用の JavaScript モジュール（`<name>.mjs`）および TypeScript 型宣言（`<name>.d.mts`）を生成します（[WebAssembly 出力](./webassembly.md) 参照）。
- **`bitcode`**: ホスト側の C/C++ コードと同一バージョンの Clang で `-flto=thin` リンクし、小さな公開関数を呼び出し元へインライン化するための ThinLTO ビットコード（`.bc`）を出力します（Windows と `wasm64` を除くネイティブおよび `wasm32` に対応）。
- **`wgsl` / `wgsl-relaxed` / `spirv` / `spirv-relaxed`**: 単一の `export` カーネル関数から WebGPU 用 WGSL シェーダーまたは Vulkan 用 SPIR-V バイナリを生成します（実験的機能。`-O`・`--target`・`--cpu`・`-g` 等とは併用不可）。

### 最適化レベルとサイズ削減

どの最適化レベル（`-O0`〜`-O3`、`-Os`、`-Oz`）を選んでも、整数の折り返し・丸め・NaN・符号付きゼロ・トラップ発生条件は厳密に一致します。

```tsuzuri run=42
def affine :: i64 -> i64 -> i64 -> i64 = \a x b ->
    a * x + b

affine 4 9 6
```

成果物サイズを小さくしたい場合は次のオプションを組み合わせます。

1. **`-Os` / `-Oz`（`build`・`run`）**: Clang バックエンドにサイズ優先最適化を指示し、ネイティブのクロージャ呼び出しアダプターに付与される強制インライン属性（`alwaysinline`）を解除して LLVM のサイズ判断に委ねます。
2. **`--strip`（ネイティブ `--emit exe` の `build`）**: リンカーに `-Wl,-x` を渡してローカルシンボルを除去します。グローバルシンボルや `--trap-info` の位置表、macOS のコード署名は維持されます（`-g` とは併用不可）。
3. **`--wasm-opt`（`--target wasm32 --emit wasm` の `build`）**: リンク済み `.wasm` に対して Binaryen の `wasm-opt -Oz` を実行します。Binaryen は同梱されないため、明示指定時に見つからない場合や失敗した場合は無言でスキップせず `E2002` で停止します。

### プロファイル誘導最適化（PGO）

`--profile-generate DIR` と `--profile-use PATH` を使うと、実ワークロードの分岐頻度に基づいた最適化を行えます（macOS / Linux ホストのネイティブ `exe`・`object` および `wasm32` の `wasm` が対象。同梱ランチャー `tsuzuri-clang` ではなく LLVM の `clang` を `TSUZURI_CLANG` に指定する必要があります）。

```sh
tsuzuri build app -o app.gen --profile-generate target/prof
./app.gen
tsuzuri build app -o app --profile-use target/prof
```

- `target/prof` ディレクトリを `--profile-use` に渡すと、Clang と同一ツールチェーンの `llvm-profdata`（または `TSUZURI_LLVM_PROFDATA`）で `.profraw` 群を決定的にマージしてから最適化し、マージ結果の内容もビルドキャッシュキーに含めます。
- 訓練時と使用時は同じコンパイラ・同じソース・同じ Clang・同じビルドオプションを揃えます。関数構造が変化してプロファイルと一致しない関数がある場合は警告 `W2001` で通知し、当該関数のみプロファイルなしで最適化します。
- `wasm32` モジュールではファイル出力ランタイムを持たないため、`--profile-generate DIR` が `<output>.profile.mjs` を隣に生成します。Node.js ホストでワークロード実行後に `writeProfile(instance)` を呼ぶと `.profraw` が書き出されます。
- カウンター更新は非アトミック（`-fprofile-update=single` 相当）であるため、マルチスレッド実行時はカウントが少なく記録される場合があります（`--wasm-feature threads` とは併用不可）。ワークロードによってはコード配置の変化で逆に遅くなる場合もあるため、導入時は必ず実測で前後を比較してください。

### 高速デバッグバックエンド（`--backend fast`）

`--backend fast` は、開発中の編集・ビルド・テストサイクルの待ち時間を短縮するため、`-O0` の LLVM IR を外部の Clang に渡さずコンパイラ内部で直接オブジェクトへ変換するバックエンドです（コンパイラ自体を `cargo build --release --features fast-backend` でビルドした macOS Arm64 / Linux x64・Arm64 バイナリで利用可能）。

- **対応範囲**: 最適化レベルは `-O0` のみ。ターゲットはホスト機の `native`（`--emit exe|object`、`run`、`test`）および `wasm32`（`build` の `--emit wasm|object`）です。
- **セマンティクスとデバッグ情報**: フロントエンドおよび LLVM IR 生成段階は既定の `llvm` バックエンドと完全に共通であるため、数値演算・所有権・Drop 順序・トラップ報告は一致します。ネイティブで `-g` を併用すると関数名とソース行番号の DWARF が出力され、ブレークポイント設定やバックトレース表示が可能です（ローカル変数や型の DWARF が必要な場合は `--backend llvm` を使用します）。
- **末尾呼び出し**: ネイティブの内部リンケージ関数間における保証された相互末尾呼び出し（`musttail`）は Cranelift の `return_call` へ翻訳され、`-O0` でもスタックを消費しません。

### アロケータ選択と `--freestanding`

`--allocator` は生成コードのヒープ管理方式を切り替えます。

- **`system`（既定）**: ネイティブでは C 標準ライブラリの `malloc` / `free` / `realloc`、WebAssembly では組み込み線形メモリアロケータを使用します。
- **`host`**: ホスト側が定義する `tsuzuri_host_alloc`・`tsuzuri_host_free`・`tsuzuri_host_realloc`（WebAssembly では `tsuzuri_heap` モジュールの import）を呼び出します。`--emit exe`・`shared`・`--trap-mode return`・`--wasm-feature threads` とは併用できません。
- **`counting`**: 確保回数・解放回数・現在バイト数・ピークバイト数を記録し、標準モジュール `Alloc` や C ABI の `tsuzuri_alloc_stats` から参照できるようにします（`test` では `Alloc` を使うテストで自動有効化されます）。
- **`small`**: ネイティブ 64-bit ターゲット（`build` 専用）において、512 バイト以下の小規模確保を 16 バイト刻み・32 区分のスレッドローカルサイズクラスから高速に割り当て、それを超えるブロックのみ `malloc` に委譲します。

`--freestanding` は C 標準ライブラリを必要としない組み込み・カーネル・ホスト統合向けのネイティブ `object`・`llvm`・`header` 出力モードです。`--allocator host` の併用が必須であり、標準入出力・OS API・`Net`・tzroutine・`Parallel`・`Debug` に到達するコードは `E2000` で拒否されます。

## 環境変数リファレンス

### `tsuzuri --help` が定義する 16 の環境変数

コンパイラが直接参照するツールチェーン・並列度・知識グラフ・内部コード生成の環境変数は次の 16 個です。

| 環境変数 | 既定値 | 役割と解決規則 |
| --- | --- | --- |
| `TSUZURI_THREADS` | 利用可能コア数（最大 `8`） | コンパイラ自身の構文解析・型検査・所有権検査の並列スレッド数上限（`1`〜`32` の整数）。`1` でシングルスレッド実行。範囲外や非整数は `E2000`（終了コード `2`）。出力や診断順序はスレッド数に依存しない |
| `TSUZURI_CLANG` | `clang`（配布物は `tsuzuri-clang`） | ネイティブコンパイル・リンク、WASM オブジェクト生成、`bindgen` のヘッダー解析に使用する Clang（LLVM 17 以降） |
| `TSUZURI_WASM_LD` | `wasm-ld` | WebAssembly モジュールのリンクに使用する LLD |
| `TSUZURI_LLVM_LINK` | `llvm-link` | macOS の C ランタイム込みデバッグオブジェクトおよび `--emit bitcode` の IR 結合に使用する `llvm-link`（`bitcode` では Clang と同一ディレクトリも探索） |
| `TSUZURI_DSYMUTIL` | `dsymutil` | macOS の `-g` ビルドで `<output>.dwarf` を生成するデバッグシンボルリンカー |
| `TSUZURI_WASM_OPT` | `wasm-opt` | `--wasm-opt` 指定時に起動する Binaryen の実行ファイルパス（この変数を設定しただけでは実行されない） |
| `TSUZURI_LLVM_PROFDATA` | Clang の隣または同一ツールチェーン内（`PATH` 非探索） | `--profile-use` にディレクトリを渡した際に `.profraw` をマージする `llvm-profdata` |
| `TSUZURI_LINKER` | 未設定 / `default` | ネイティブ実行ファイル・共有ライブラリの最終リンカー選択。`lld` を指定すると Clang に `-fuse-ld=lld` を渡す（Windows ターゲットおよび Mach-O の `-Os` / `-Oz` とは併用不可） |
| `TSUZURI_SYSROOT` | 未設定 | `--target TRIPLE` でクロスビルドする際の C ヘッダー・ライブラリ sysroot ディレクトリ（Clang に `--sysroot`、Apple ターゲットでは `-isysroot` として渡される。`--target native`・WASM・MSVC・同梱ツールチェーンでは使用しない） |
| `TSUZURI_RUNNER` | 未設定 | ホスト機で直接実行できない `--target TRIPLE` のバイナリを `run`・`test` で起動するエミュレータコマンド（例: `qemu-aarch64 -L /usr/aarch64-linux-gnu`。空白区切りで分割） |
| `TSUZURI_SERVER_DIR` | OS 既定のユーザー専用ディレクトリ | `tsuzuri serve` が Unix ドメインソケットを配置する絶対パス（権限 `0700`）。空文字列を設定するとビルドサーバー利用を無効化 |
| `TSUZURI_KG` | 未設定（プロジェクトで有効） | `0` で知識グラフの自動出力を抑止、`1` で単一ファイル入力時も出力（`--kg` / `--no-kg` フラグが優先。それ以外の値は `E2000`） |
| `TSUZURI_KG_DIR` | `<ルート>/target/tz/kg` | 知識グラフの出力・照会先ディレクトリ（`--kg-dir` が優先。`tsuzuri mcp` は参照しない） |
| `TSUZURI_SMT` | `z3`、なければ `cvc5` | `tsuzuri prove` および `--contracts prove` が起動する SMT ソルバーのコマンドまたはパス |
| `TSUZURI_RANGE_FLAGS` | `off` | 整数の範囲証明に基づくコード生成フラグ（`off`・`proven`・`audit`）。ビルドキャッシュキーに含まれる（下記参照） |
| `TSUZURI_STRINGS` | `utf16` | `string` 型の内部メモリ表現フラグ（`utf16`・`compact`）。ビルドキャッシュキーに含まれる（下記参照） |

### キャッシュ・計測・デバッグ・実行時向けの補助環境変数

上記のほか、キャッシュ制御・コンパイル計測・生成バイナリの実行時挙動を制御する以下の環境変数が用意されています。

| 環境変数 | 参照主体 | 役割 |
| --- | --- | --- |
| `TSUZURI_CACHE_DIR` | コンパイラ | ビルド・フロントエンドキャッシュのルートディレクトリ。空文字列を設定すると全キャッシュを無効化 |
| `TSUZURI_CODEGEN_UNITS` | コンパイラ | `-O0` ビルドの IR 分割モード。`single`（既定・分割なし）、`auto`（IR が 16 MB 以上の対象ビルドのみ分割）、`split`（対象ビルドを常時モジュール単位に分割して `units/` にキャッシュ）。不正値は `E2000` |
| `TSUZURI_NMEDIT` / `TSUZURI_OBJCOPY` | コンパイラ | `TSUZURI_CODEGEN_UNITS` 分割時の `--emit object` で hidden シンボルを局所化するツール（macOS は `nmedit`、Linux は `llvm-objcopy` / `objcopy`） |
| `TSUZURI_TIME_PASSES` | コンパイラ | `1` のときのみ、終了時に標準エラー末尾へ各フェーズの経過時間（ミリ秒）を 1 行の JSON（`{"time_passes":1,"phases":[...],"total_ms":...}`）で出力 |
| `TSUZURI_LLVM_SYMBOLIZER` | `tsuzuri run` | トラップ時のコールスタックアドレスを Tsuzuri 関数名と行番号へ解決する `llvm-symbolizer` のパス |
| `TSUZURI_TRAP_REPORT` | 生成バイナリ（`--trap-info`） | 空でないファイルパスが設定されていると、トラップ発生時に `tz-trap/1 ...` 形式のスタックトレース行を追記 |
| `TSUZURI_MAXPROCS` | 生成バイナリ（ネイティブ） | tzroutine スケジューラおよび `Parallel.*` が使用する論理プロセッサ数 `P` を指定 |
| `TSUZURI_CPU_FORCE` | 生成バイナリ（`@cpu` 使用時） | 実行時 CPU ディスパッチの選択版をテスト用に固定（`baseline`・`sse4.2`・`avx2`・`avx512`・`sve`・`sve2`） |
| `TSUZURI_WEBGPU_LIBRARY` / `TSUZURI_VULKAN_LIBRARY` | 生成バイナリ（`Gpu` 使用時） | 実行時に動的ロードする `wgpu-native` または Vulkan ローダーライブラリの絶対パス（空文字列で該当バックエンドを無効化） |
| `TSUZURI_GPU_DEBUG` / `TSUZURI_GPU_AUTO_MIN_WORK` | 生成バイナリ（`Gpu` 使用時） | GPU デバイス選択・ディスパッチの標準エラーログ出力、および `Gpu.Auto` が Vulkan を選ぶ最小仕事量閾値の上書き |

### 整数範囲証明フラグ（`TSUZURI_RANGE_FLAGS`）

Tsuzuri の通常の整数演算（`+`・`-`・`*`）は常に型のビット幅でモジュロ折り返しを行いますが、`TSUZURI_RANGE_FLAGS` を設定すると、コンパイラの区間解析が「オーバーフローしない」と静的に証明できた命令に対して LLVM IR の `nsw` / `nuw` フラグを付与できます。

| 設定値 | 生成される LLVM IR | 用途 |
| --- | --- | --- |
| `off`（既定・空文字列も同一） | `nsw` / `nuw` フラグを付与しない | 通常のビルド |
| `proven` | 区間解析で非オーバーフローが証明された `+`・`-`・`*` および `for` ループ増分にのみ `nsw` / `nuw` を付与 | LLVM のループ最適化やアドレス計算最適化へのヒント提供 |
| `audit` | `nsw` / `nuw` は付与せず、`proven` が証明対象とした演算が万一オーバーフローした際に即座にトラップする検証命令を挿入 | コンパイラの範囲証明器の健全性監査テスト用 |

計算結果・診断・終了コードはどの値でも変化しません。上記以外の文字列を指定するとコード生成コマンドで `E2000` になります。

### コンパクト文字列設定（`TSUZURI_STRINGS`）

`TSUZURI_STRINGS` は、`string` 型の内部メモリ表現を選択します。どちらのモードでも、ECMA-262 準拠のコード単位列としての長さ・添字・比較順序・ハッシュ値・標準出力・ホストとの公開 C / WebAssembly ABI（常に UTF-16）は完全に同一です。

| 設定値 | 内部メモリ表現 | 特徴と用途 |
| --- | --- | --- |
| `utf16`（既定・空文字列も同一） | すべての `string` を 1 コード単位 2 バイトの UTF-16 として保持 | ホスト境界での変換コストがゼロであり、ランタイムサイズも最小となる標準構成 |
| `compact` | 全コード単位が `0xFF` 以下（ASCII および Latin-1）の文字列を 1 単位 1 バイトで保持し、`0x0100` 以上を含む文字列のみ UTF-16 で保持 | ASCII / Latin-1 中心の大量テキスト処理においてヒープ使用量を約半分に削減（ネイティブおよび `--wasm-feature simd128` では 128-bit SIMD カーネルを使用） |

`compact` モードでは長さワードの bit 62 を Latin-1 識別ビットとして使用するため、`Maybe<string>` が空を表す負の長さニッチ（bit 63）とも競合しません。一方、ホスト ABI 境界で短い文字列を頻繁に入出力するプログラムでは UTF-16 への拡張コストが生じるため、既定値は `utf16` となっています。

## 関連項目

- [CLI とサブコマンド](./cli.md)
- [コンパイラディレクティブと条件分岐の代替](./directives.md)
- [対応プラットフォームとクロスコンパイル](./platforms.md)
- [診断メッセージとエラーコード](./diagnostics.md)
- [デバッグ](./debugging.md)
- [ネイティブ連携と C ABI](./native-interop.md)
- [WebAssembly 出力](./webassembly.md)
