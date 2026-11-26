# コンパイラディレクティブと条件分岐の代替

Tsuzuri 0.1.0 には、C/C++ の `#if`・`#ifdef`・`#define`・`#pragma` や F# の `#nowarn` に相当するプリプロセッサ・コンパイラディレクティブは存在しません。唯一の例外はスクリプト実行用のファイル先頭 1 行目の shebang（`#!`）であり、それ以外の位置に `#if true` などを記述すると字句・構文解析で直ちに `E0002` エラーとなります。

```text
./Main.tz:1:1: error[E0002]: expected an expression
  1 | #if true
    | ^
```

本章では、Tsuzuri がプリプロセッサを持たない設計上の理由と、定数定義・算術検査・CPU 命令ディスパッチ・マニフェスト設定・ターゲット切り替え・警告制御をどのように表現するかを解説します。

## 要点

- ソースコードのトークン列をコンパイル前に書き換えるマクロや条件付きコンパイル指令は存在しません。エディタ・LSP・フォーマッター・コンパイラは常に同一の構文木を扱います。
- コンパイル時定数・オーバーフロー検査・CPU 命令セット別の多重実装・C 構造体レイアウトなどは、`@` で始まる**属性（アトリビュート）**や宣言キーワードとして構文の一部で記述します。
- パッケージ構成・依存関係・リンク設定・権限ポリシー・ターゲット既定値は `Tsuzuri.toml` の全 7 セクション（`[package]`・`[dependencies]`・`[wasm]`・`[native]`・`[registry]`・`[capabilities]`・`[windows]`）で宣言的に管理します。
- 特定の警告コードだけをソース行単位で握り潰す `#nowarn` はありません。未使用束縛は `_` 接頭辞で明示し、CI 等で警告をエラー扱いにする場合は `--deny-warnings` を使用します。

## プリプロセッサを排した理由

条件付きコンパイルやテキスト置換マクロは、インクルード順序やビルド時の定義シンボルによって同じ行の構文や型を変化させます。その結果、現在のホスト環境で有効化されていない分岐の型エラーやリファクタリング漏れが見逃されやすくなり、ビルドキャッシュや知識グラフの決定性も損なわれます。

Tsuzuri ではプラットフォーム差や実行環境の違いをソーステキストの切り貼りではなく、次の仕組みで安全に分離します。

1. **ターゲット選択の外部化**: 出力先アーキテクチャや OS はコマンドラインの `--target` で指定し、そのターゲットで利用できないホスト API（既定の `wasm32` におけるファイル I/O など）に到達した場合はコンパイルエラー `E2000` として明確に検出します。
2. **実行時 CPU ディスパッチの宣言化**: 単一バイナリ内で AVX2 や SVE などの高速経路を使い分けたい場合は、ポータブルな実装を保ったまま `@cpu` 属性を関数に付与します。
3. **リンクと外部境界の分離**: OS 固有のネイティブ連携が必要な場合は、パッケージやモジュール境界および `extern` 宣言で明示します。

## ディレクティブを代替するソース上の宣言と属性

属性および契約の詳細仕様は [契約と属性](../expressions/contracts-and-attributes.md) を参照してください。ここでは他言語のプリプロセッサ指令に相当する代表的な機能を示します。

### コンパイル時定数（`const` と `@literal`）

C の `#define` 定数や F# の `[<Literal>]` に相当するコンパイル時定数は、`const` 宣言（または互換属性 `@literal def`）で記述します。型検査を経た定数として評価され、ゼロ除算や循環参照はコンパイル時に `E1026` で検出されます。ループや再帰を伴うコンパイル時計算には `const def` を使用します。

```tsuzuri run=1024
const BlockSize: i64 = 1 <<< 10

const def align_up :: i64 -> i64 -> i64 = \size align ->
    ((size + align - 1) / align) * align

align_up 900 BlockSize
```

`@literal def Answer :: i64 = 42` の形式も `const Answer: i64 = 42` と同等に機能します。

### オーバーフロー検査付き算術（`@checked`）

ファイル全体やブロック全体の算術モードをプラグマで暗黙に切り替えるのではなく、オーバーフローを例外として捕捉したい文の直前に `@checked` を付与します。`@checked` を付けた文の評価中に整数の `+`・`-`・`*`・`**`・単項 `-` がオーバーフローすると、モジュロ折り返しの代わりに `OverflowException` が送出され、同一関数内の `try ... with` で安全に捕捉できます。

```tsuzuri run=overflow
def safe_mul :: i64 -> i64 -> Result<i64, Exception> = \a b ->
    try @checked a * b with | err -> err

match safe_mul 9223372036854775807 2 with
| Ok v -> $"{v}"
| Error _ -> "overflow"
```

### CPU 命令セット別の関数ディスパッチ（`@cpu`）

C/C++ で `#ifdef __AVX2__` のように書き分ける CPU 特化コードは、トップレベル `def` の直前に `@cpu [...]` を付与して宣言します。指定可能な命令セット名は `"sse4.2"`・`"avx2"`・`"avx512"`・`"sve"`・`"sve2"` です（未知の名前・重複・空配列は `E0002`）。

```tsuzuri run=55
@cpu ["avx2", "sve"]
def sum_slice :: ref [i64] -> i64 = \xs ->
    let mut acc = 0i64
    for x in xs do
        acc = acc + x
    acc

let data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
sum_slice (ref data)
```

Linux x64 ターゲットでは `sse4.2`・`avx2`・`avx512`、Linux Arm64 ターゲットでは `sve`・`sve2` の特化バイナリコードがポータブル版と併せて生成され、プロセス起動時の CPU 機能判定によって対応する最新命令セットの実装が自動選択されます。その他のターゲットや WebAssembly ではポータブル版のみが生成されますが、計算結果・丸め・NaN・トラップの意味はどの経路でも完全に一致します。テスト時に特定のバリアントを強制したい場合は実行時環境変数 `TSUZURI_CPU_FORCE` を使用します。

### その他の主な属性

| 属性 | 付与対象 | 役割 |
| --- | --- | --- |
| `@requires` / `@ensures` | 関数本体の先頭 | 事前条件・事後条件の契約記述（`run`・`test` での実行時検査および `prove` での SMT 証明） |
| `@no_alloc` / `@no_copy` / `@no_trap` / `@terminates` | トップレベル `def` | 関数の効果上限の静的表明（違反時は `E1031`、コード生成自体は変化しない） |
| `@trusted [pure no_alloc ...]` | `extern def` / `extern type` | 人間が契約を確認した外部宣言の記録と効果解析への性質付与 |
| `@c_layout` / `@c_layout(pack = N)` | `record` | C 構造体とバイト単位で一致するフィールド配置・パディングを指定（`N` は `1`・`2`・`4`・`8`・`16`） |
| `@count(pos, kind)` | `extern def` | `pos` 番目のスライス・文字列引数の長さ引数の整数幅（`i32`・`i32u`・`i64`・`i64u`）または省略（`none`）を指定 |
| `@json "name"` | `record` フィールド / `union` ケース | `Encode` / `Decode` 自動導出時の JSON キー名・タグ名をカスタマイズ |
| `@alias name` | `.tc` ビルダーファイル | コンピュテーション式ビルダーの小文字別名を定義 |

## `Tsuzuri.toml` によるプロジェクト設定

ビルド設定のプロジェクト既定値や依存関係は、ルートの `Tsuzuri.toml` に記述します。パーサーは先頭の必須セクション `[package]` に続き、任意の `[dependencies]`・`[wasm]`・`[native]`・`[registry]`・`[capabilities]`・`[windows]` をそれぞれ高々 1 回受け付けます。未知のセクション・キーや重複セクションは `E0002` になります（`#` は TOML の行コメントです）。

```toml
[package]
name = "shop"
version = "0.1.0"
edition = "2028"
namespace = "Acme::Shop"

[dependencies]
pricing = { path = "../pricing" }
geo = { git = "https://example.org/geo.git", rev = "0123456789abcdef0123456789abcdef01234567", capabilities = ["stdio"] }
decimal-kit = { version = "1.2.0" }

[registry]
index = "https://example.org/tsuzuri-index.git"

[wasm]
max-memory = "64MiB"
stack-size = "1MiB"

[native]
link = ["vendor/host.o"]
libraries = ["sqlite3"]
search = ["vendor"]

[capabilities]
allow = ["ffi", "fs", "stdio"]

[windows]
subsystem = "console"
```

| セクション | 指定可能なキー | 役割 |
| --- | --- | --- |
| `[package]` | `name`（必須）、`version`（必須）、`edition`、`namespace` | パッケージ名、バージョン、エディション（`"2026"`・`"2027"`・`"2028"`、省略時は `"2026"`）、既定名前空間 |
| `[dependencies]` | `<パッケージ名> = { ... }` | ローカル相対パス依存（`path`、任意の `native = true`）、コミット固定 Git 依存（`git` + `rev`）、レジストリ依存（`version`）。各依存に許可権限 `capabilities = [...]` を併記可能（最大 1,024 個） |
| `[registry]` | `index`（必須）、`rev`（任意） | レジストリ依存を解決する Git インデックスリポジトリの URL（[パッケージ管理](../modules/packages.md) 参照） |
| `[wasm]` | `max-memory`、`stack-size` | WebAssembly のメモリ上限とスタックサイズの既定値（CLI フラグ指定時は CLI 側が優先） |
| `[native]` | `link`、`libraries`、`search` | ネイティブ実行ファイル・共有ライブラリにリンクする相対オブジェクトパス、ライブラリ名、探索パス |
| `[capabilities]` | `allow` | ルートパッケージが使用を許可する権限名の配列（9 種の権限語彙から指定。省略時は権限検査を行わない） |
| `[windows]` | `subsystem` | Windows 実行ファイルの既定 PE サブシステム（`"console"` または `"windows"`。非 Windows ビルドでは無視） |

## 警告の制御方法

Tsuzuri には特定の警告コードを行単位・ファイル単位で無効化する `#nowarn` や `#[allow(...)]` はありません。警告はそれぞれ原因に即したコード修正で解消します。

- **未使用の変数・引数（`W1001`）**: 意図的に使用しない束縛は `_` または `_unused` のようにアンダースコアで始めます（`tsuzuri fix` でも自動付与できます）。
- **オプトイン警告の有効化**: 配列やリストの暗黙コピー（`W1006`）は `--warn implicit-copy`、`@trusted` 未付与の `extern` 使用（`W1010`）は `--warn untrusted-extern`、Edition 2026 ソース内の旧表記（`W1007`）は `--warn canonical` を指定したときのみ報告されます。
- **警告のエラー化（`--deny-warnings`）**: CI などで警告を 1 件も許容したくない場合は `--deny-warnings` を渡します。警告が出た時点でコード生成や実行を行わずに終了コード `1` で停止します。なお、コンパイラのバージョンアップや依存先の `@deprecated` 追加によって新たな警告が増える可能性があるため、警告の有無自体はエディション互換性保証の対象外です（[安定性と互換性ポリシー](./stability.md) 参照）。

## 他言語との対応比較

| 目的 | C / C++ | C# / F# | Tsuzuri 0.1.0 |
| --- | --- | --- | --- |
| ターゲット別のビルド切り替え | `#if` / `#ifdef` | `#if` シンボル分岐 | CLI の `--target` 指定とターゲット非対応 API の静的エラー検出 |
| コンパイル時定数 | `#define` / `constexpr` | `const` / `[<Literal>]` | `const` 宣言、`const def`、`@literal` |
| 整数オーバーフローの例外化 | コンパイラ拡張組み込み関数 | `checked { ... }` / `Checked.(+)` | 文単位の `@checked` 属性と `Int.checked_*` |
| CPU 命令セット別の高速実装 | `#ifdef __AVX2__` と intrinsics | `System.Runtime.Intrinsics` の実行時分岐 | `@cpu [...]` 属性による自動マルチバージョニング |
| 警告の抑制と厳格化 | `#pragma clang diagnostic` | `#nowarn` / `-warnaserror` | `_` 接頭辞による未使用明示と `--deny-warnings` |

## 関連項目

- [CLI とサブコマンド](./cli.md)
- [コンパイラオプションと環境変数](./options.md)
- [契約と属性](../expressions/contracts-and-attributes.md)
- [診断メッセージとエラーコード](./diagnostics.md)
- [パッケージ管理](../modules/packages.md)
- [安定性と互換性ポリシー](./stability.md)
