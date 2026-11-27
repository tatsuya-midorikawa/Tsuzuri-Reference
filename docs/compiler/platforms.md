# 対応プラットフォームとクロスコンパイル

Tsuzuri コンパイラ本体、公式 CLI 配布アーカイブ、VS Code 拡張機能、およびネイティブコード生成のサポート対象環境は、以下の **5 環境**に厳格に定義されています。これに加えて、環境に依存しない WebAssembly（`wasm32` / `wasm64`）出力をすべての対応ホストから生成できます（WebAssembly の詳細は [WebAssembly 出力](./webassembly.md) を参照）。

| OS | アーキテクチャ | 配布アーカイブ・VSIX 識別子 | 実機検証 CI ランナー |
| --- | --- | --- | --- |
| Windows | x64（x86-64） | `win32-x64` | `windows-2022` |
| Windows | Arm64（AArch64） | `win32-arm64` | `windows-11-arm` |
| Linux | x64（x86-64） | `linux-x64` | `ubuntu-24.04` |
| Linux | Arm64（AArch64） | `linux-arm64` | `ubuntu-24.04-arm` |
| macOS | Arm64（Apple Silicon のみ） | `darwin-arm64` | `macos-15` |

macOS は **Apple Silicon（Arm64）のネイティブ環境のみ**を対象としており、Intel Mac（`x86_64-apple-darwin`）および Rosetta 2 上の x64 実行環境は非対応です。また、32-bit ネイティブ環境、RISC-V、FreeBSD、Android、iOS、ベアメタルターゲットもサポート対象外であり、`--target` に指定すると `E2000` で拒否されます（対応 5 環境以外のホストでコンパイラ自体をソースビルドしようとした場合も Rust のコンパイルエラーで停止します）。

## 要点

- `--target native` はビルドを実行しているホスト環境向けのコードを生成します。他の OS や CPU アーキテクチャ向けにクロスコンパイルする場合は、全 9 種のネイティブターゲットトリプルから指定します。
- 言語の意味論（整数の折り返し、浮動小数点の丸め・NaN・符号付きゼロ、評価順序、トラップ条件、所有権規則）はどのターゲットでも同一です。
- 公式配布アーカイブに同梱されるツールチェーン（`tsuzuri-clang`）を使うと、追加の SDK 導入なしに MSVC 以外の 7 種のネイティブターゲット向け実行ファイルを単体でクロスリンクできます。
- ビルド機で直接実行できないターゲットの `tsuzuri run` および `tsuzuri test` は、環境変数 `TSUZURI_RUNNER` にエミュレータ等（`qemu-aarch64` など）を明示したときのみ実行されます。

## ターゲットの指定とトリプル一覧

`--target native|wasm32|wasm64|TRIPLE` は `build`・`test`（全ターゲット）、`run`（ネイティブターゲットのみ）、`bench`（ビルド機と同一アーキテクチャ・OS のネイティブターゲットのみ）で指定できます。なお、`wasm32-unknown-unknown` と `wasm64-unknown-unknown` はそれぞれ `wasm32` と `wasm64` の別名として受理されます。

```sh
# 同梱ツールチェーンを用いて Arm64 Linux 向けの静的リンク実行ファイルをクロスビルド
tsuzuri build app --target aarch64-unknown-linux-musl -o app-linux-arm64

# Arm64 Windows（MSVC ABI）向けのオブジェクトファイルを生成
tsuzuri build lib --target aarch64-pc-windows-msvc --emit object -o lib.obj
```

Linux では C ライブラリの種類（`gnu` = glibc 動的リンク、`musl` = musl 静的リンク）、Windows ではツールチェーン ABI（`msvc` と `gnu` = MinGW）を区別するため、ネイティブの `TRIPLE` は次の 9 種類が定義されています（大文字・小文字を区別し、`arm64-apple-darwin` のような省略別名は受理しません）。

| `--target` 指定名 | Clang に渡すターゲット | Tier | CI における検証範囲 |
| --- | --- | --- | --- |
| `aarch64-apple-darwin` | `arm64-apple-macosx12.0.0` | Tier 1 | 実機実行（`macos-15`）、クロスリンク検証（Linux ホスト） |
| `aarch64-unknown-linux-gnu` | `aarch64-unknown-linux-gnu` | Tier 1 | 実機実行（`ubuntu-24.04-arm`）、クロスリンク検証（他ホスト） |
| `x86_64-unknown-linux-gnu` | `x86_64-unknown-linux-gnu` | Tier 1 | 実機実行（`ubuntu-24.04`）、クロスリンク検証（他ホスト） |
| `aarch64-pc-windows-msvc` | `aarch64-pc-windows-msvc` | Tier 1 | 実機実行（`windows-11-arm`）、オブジェクト生成検証（macOS / Linux） |
| `x86_64-pc-windows-msvc` | `x86_64-pc-windows-msvc` | Tier 1 | 実機実行（`windows-2022`）、オブジェクト生成検証（macOS / Linux） |
| `aarch64-unknown-linux-musl` | `aarch64-unknown-linux-musl` | Tier 2 | クロスリンク検証、Linux Arm64 実機および Linux x64 上の `qemu-user` 実行 |
| `x86_64-unknown-linux-musl` | `x86_64-unknown-linux-musl` | Tier 2 | クロスリンク検証、Linux x64 実機および Linux Arm64 上の `qemu-user` 実行 |
| `aarch64-pc-windows-gnu` | `aarch64-w64-windows-gnu` | Tier 2 | クロスリンク検証（macOS / Linux）および Windows 同梱 MinGW 実行 |
| `x86_64-pc-windows-gnu` | `x86_64-w64-windows-gnu` | Tier 2 | クロスリンク検証（macOS / Linux）および Windows 同梱 MinGW 実行 |

- **Tier 1**: 対応する実機 CI ランナー上で、`-O0` と `-O3` の双方について `build`・`run`・`test` の全スイートを実行検証しているターゲットです。
- **Tier 2**: クロスビルド・バイナリヘッダー検証および表記載の経路での実行検証を行っているターゲットです。

32-bit ターゲット（`i686-pc-windows-msvc` など）を指定した場合は、ネイティブコード生成が 64-bit ポインタを前提としている旨の理由とともに有効なターゲット一覧を添えて `E2000`（終了コード `2`）を報告します。

## OS ごとの成果物とランタイム仕様の違い

| OS | 対象トリプル | 実行ファイル | オブジェクト | 共有ライブラリ | OS API / `Net` |
| --- | --- | --- | --- | --- | --- |
| macOS Arm64 | `aarch64-apple-darwin` | 拡張子なし | `.o` | `.dylib` | 対応（POSIX） |
| Linux x64 / Arm64 | `*-unknown-linux-gnu` / `*-musl` | 拡張子なし | `.o` | `.so` | 対応（POSIX） |
| Windows x64 / Arm64 | `*-pc-windows-msvc` / `*-gnu` | `.exe` | `.obj` | 未対応（`E2000`） | 対応（Win32 / Winsock2） |

- **tzroutine ランタイム**: 全 9 種のネイティブターゲットで M:N スケジューラが動作します（Windows では Win32 Fiber を用いてコンテキストスイッチを行います）。
- **OS API とエラーコード**: `File`・`Dir`・`Env`・`Time`・`Random`・`Process`・`Net` はすべてのネイティブターゲットで利用できます。`Os.Error.code` は macOS / Linux では POSIX の `errno`、Windows では Win32 エラーコード（または Winsock エラーコード）を保持します。
- **macOS だけの API**: [`MainThread`](../stdlib/sync/mainthread.md)（`post`・`after`・`is_current`）と、メインスレッド専用ハンドル（`extern type main`・`extern class main`）の入口の検査は、macOS（`aarch64-apple-darwin`）でだけビルドできます。他のネイティブターゲットでは `E2002`（`platform_unsupported_api`）、WebAssembly では `E2000`（`wasm_main_thread_unsupported`）になります。
- **デバッグ情報（`-g`）**: Mach-O 実行ファイルの `.dwarf` バンドル生成には `dsymutil`（macOS ホスト）、MSVC 実行ファイルの `.pdb` 生成には MSVC `link.exe`（Windows ホスト）が必要なため、別 OS ホストからのクロスビルドでこれらを要する `-g` を指定すると `E2000` になります（オブジェクトや LLVM IR への DWARF 出力はどのホストからでも可能です）。なお、Windows Arm64 版の VS Code 拡張機能では編集・診断・ビルド・実行・テストがすべて動作しますが、同梱 CodeLLDB が未提供のため IDE 上のソースデバッグのみ対象外です。
- **macOS のアプリケーションバンドル**: macOS のホストでは `--emit app` が、実行ファイル・`Info.plist`・資源を `Name.app` に組み立てて ad-hoc で署名します（[macOS のアプリケーションバンドル](./macos-app-bundle.md)）。バンドルの署名に `codesign` を使うため、ほかの OS のホストでは `E2000` です。Developer ID の署名と公証には未対応で、`embed` した `@rpath` の dylib を読ませるには `--rpath @executable_path/../Frameworks` を指定します。

## クロスコンパイルとリンク手順

ネイティブ実行ファイルをリンクするには、対象ターゲット用の C ヘッダー、C 標準ライブラリ、およびリンカーが必要です。公式配布アーカイブの同梱ツールチェーンを使う方法と、システムの Clang に `TSUZURI_SYSROOT` を渡す方法の 2 通りがあります。

### 1. 公式配布物の同梱ツールチェーンを使う場合

配布アーカイブ内の `tsuzuri-clang` ランチャーは Zig（Windows Arm64 配布物では LLVM-MinGW）を内包しており、MSVC ターゲット（`*-pc-windows-msvc`）を除く **7 種のネイティブターゲット**を追加設定なしでクロスリンクできます。

- Linux ホストでの `--target native` は移植性の高い musl 静的リンク実行ファイルを生成します。glibc 動的リンクが必要な場合は `--target x86_64-unknown-linux-gnu` または `aarch64-unknown-linux-gnu` を明示します。
- Windows 以外のホストで同梱ツールチェーンに対して `*-pc-windows-msvc` のリンクを要求すると、`*-pc-windows-gnu` の利用を案内する `E2002` エラーになります。
- 同梱ツールチェーンは独自の C ライブラリを備えているため、`TSUZURI_SYSROOT` を同時に設定すると `E2002` で拒否されます。

### 2. システムの Clang と `TSUZURI_SYSROOT` を使う場合

外部の LLVM Clang（`TSUZURI_CLANG`）を用いて別ターゲット向けにビルドする場合は、対象ターゲットのヘッダーとライブラリを含む sysroot ディレクトリを `TSUZURI_SYSROOT` に設定します。

```sh
export TSUZURI_CLANG=/usr/lib/llvm-21/bin/clang
export TSUZURI_SYSROOT=/opt/sysroots/aarch64-linux-gnu
tsuzuri build app --target aarch64-unknown-linux-gnu -o app-linux-arm64
```

- Linux および MinGW ターゲットでは Clang に `--sysroot=DIR`、macOS ターゲットでは `-isysroot DIR` が渡されます。また、ホストと異なるターゲットのリンクには自動的に `-fuse-ld=lld` が付与されるため LLD が必要です。
- MSVC ターゲット（`*-pc-windows-msvc`）は Developer PowerShell の環境変数 `INCLUDE` と `LIB` から Windows SDK と CRT を参照するため、`TSUZURI_SYSROOT` を指定すると `E2000` になります。
- ビルドキャッシュは `--target` 名と `TSUZURI_SYSROOT` の値を区別して管理するため、ターゲットを切り替えても誤ったキャッシュ成果物が返ることはありません。

## 他ターゲット向けバイナリの実行（`TSUZURI_RUNNER`）

ビルド機と OS または CPU アーキテクチャが異なるターゲットを `tsuzuri run` や `tsuzuri test` に指定した場合、コンパイラは勝手なエミュレータ探索やダウンロードを行いません。環境変数 `TSUZURI_RUNNER` に実行コマンドを設定したときのみ、そのコマンドの末尾に生成バイナリのパスを添えて起動します。

```sh
TSUZURI_RUNNER="qemu-aarch64 -L /usr/aarch64-linux-gnu" \
  tsuzuri test app --target aarch64-unknown-linux-gnu
```

- `TSUZURI_RUNNER` の値は空白文字で単純分割されます（シェル展開や引用符解釈は行わないため、空白を含むパスが必要な場合はラッパースクリプトを使用します）。
- `TSUZURI_RUNNER` が未設定のまま異種ターゲットで `run`・`test` を呼ぶと `E2000`、指定したランナーが起動できない場合は `E2001` となります。
- `tsuzuri bench`、`tsuzuri test --coverage`、`tsuzuri test -g` は実機での計測・計装・デバッグを前提とするため、`TSUZURI_RUNNER` があっても異種ターゲットでは `E2000` で拒否されます。

## ターゲットごとに切り替わるコード生成仕様

言語仕様上の意味は不変ですが、ターゲットに応じて以下の低レベル表現が切り替わります。

- **シンボル可視性と ABI**: Windows ターゲットでは `export def` に `dllexport` が付与され、C 構造体や呼び出し規約も対象 OS（System V AMD64 / AAPCS64 / Windows x64 / Windows Arm64）に従います。
- **構造体の値渡し（`@c_layout`）**: `extern def` の `ref` のない `@c_layout` レコードは、9 種のネイティブターゲットすべてで C の ABI どおりに受け渡します（Windows x64 は大きさで整数レジスターか複写へのポインター、AArch64 は HFA・整数レジスター・`x8`、System V x86-64 は 8 バイトごとの分類）。`wasm32`・`wasm64` では `E1008`（`abi_native_only`）です。
- **`@cpu` マルチバージョニング**: Linux x64 では `sse4.2`・`avx2`・`avx512`、Linux Arm64 では `sve`・`sve2` の各バリアントを生成し、それ以外のターゲットでは基準のポータブル実装のみを生成します。
- **`Math.fma`（融合積和演算）**: Arm64 ネイティブではハードウェア FMA 命令に下げ、x64 ネイティブおよび WebAssembly では単一丸めを厳密に満たすソフトウェアルーチンを呼び出します（得られるビット列は全環境で同一です）。
- **`--cpu native` の制約**: ビルド機自身の CPU 命令セットを検出して特化するオプションであるため、クロスコンパイル時（ホストと異なる `--target TRIPLE` 指定時）に併用すると `E2000` になります。クロスコンパイル時は既定の `--cpu generic` を使用します。

## 現時点のプラットフォーム別制限事項

- **Objective-C 連携は Apple のターゲットだけ**: `extern class`・`ObjC`・メッセージ送信（[Objective-C 連携](./objective-c.md)）は、宣言と `tsuzuri check` はどのホストでも通りますが、`build` で到達すると Apple でないネイティブのターゲットでは `E1008`（`abi_apple_only`）、WebAssembly では `E1008`（`abi_native_only`）になります。
- **`--emit app` は macOS のホストと Apple のターゲットだけ**: それ以外のホスト・ターゲットでは `E2000`（`option_unsupported_platform`）です。Intel Mac 向けの Universal 2 のバンドルは作れません。
- **Windows ターゲットの未対応出力**: `--emit shared`（DLL 直接出力）、`--emit bitcode`（ThinLTO ビットコード出力）、プロファイル誘導最適化（`--profile-generate` / `--profile-use`）、高速デバッグバックエンド（`--backend fast`）、常駐ビルドサーバー（`tsuzuri serve`）、および純粋計算トラップ隔離領域 `Domain.run` は現在 macOS / Linux のみ対応しており、Windows では `E2000`（`Domain.run` は `E1038`）となります。
- **ランタイム埋め込みオブジェクトの制限**: Windows COFF の `--emit object` で tzroutine・OS API・標準入出力・`Net` などの C ランタイムを含むオブジェクトを生成しようとした場合、および同梱ツールチェーンで C ランタイムを含む Mach-O の `--emit object` を生成しようとした場合は `E2002` となります（実行ファイル `--emit exe` の直接リンク、または C ランタイム不要の純粋計算オブジェクトは問題なく生成できます）。
- **Windows のトラップ出力先**: Windows の `--trap-info` 報告は CRT のファイル記述子 2 ではなく Win32 の `STD_ERROR_HANDLE` へ直接書き込まれ、ハンドルが無効な場合はデバッガー向けの `OutputDebugStringW` へ送出されます。
- **macOS のトラップ・ランタイム報告の出力先**: macOS の実行ファイル（`--emit exe`・`tsuzuri run`）は、標準エラーが閉じているか `/dev/null` のとき（Finder・Dock・`open`・launchd から起動したとき）に限り、トラップの報告・tzroutine ランタイムの報告・スタックのあふれを unified logging（subsystem `dev.tsuzuri.runtime`）へ送ります。`/usr/bin/log show --predicate 'subsystem == "dev.tsuzuri.runtime"'` か Console.app で読めます。トラップの位置の行は、これまでと同じく `--trap-info` のときだけ出ます。端末・パイプ・ファイルへの出力は変わらず、`--emit object` と `--emit shared` の出力は送りません（[Finder から起動したアプリの報告](./debugging.md#finder-から起動したアプリの報告)）。

## 関連項目

- [CLI とサブコマンド](./cli.md)
- [コンパイラオプションと環境変数](./options.md)
- [診断メッセージとエラーコード](./diagnostics.md)
- [デバッグ](./debugging.md)
- [ネイティブ連携と C ABI](./native-interop.md)
- [WebAssembly 出力](./webassembly.md)
