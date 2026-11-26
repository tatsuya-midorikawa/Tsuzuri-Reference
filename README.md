# Tsuzuri 言語リファレンス

本リポジトリ（`Tsuzuri-Reference`）は、静的型付け・所有権モデル・関数型構文・LLVM バックエンドを備えたプログラミング言語 **Tsuzuri** の公式日本語リファレンスマニュアルです。

- **対象コンパイラバージョン**: Tsuzuri `0.1.0`
- **最新・既定エディション**: **Edition 2028**（Edition `2026`・`2027`・`2028` に対応）
- **対応プラットフォーム**: Windows x64 / Arm64、Linux x64 / Arm64、macOS Arm64（Apple Silicon のみ）の 5 環境、および WebAssembly（`wasm32` / `wasm64`）
- **総合目次**: **[docs/index.md](./docs/index.md)**（全 9 部・全章のナビゲーションと学習ガイド）
- **コンパイラ本体リポジトリ**: <https://github.com/tatsuya-midorikawa/Tsuzuri>

## Tsuzuri のコード例

本書に掲載されているすべての実行可能な `tsuzuri` コードブロックは、CI および検証スクリプトによって最新の Tsuzuri コンパイラで型検査され、`-O0` と `-O3` の双方で実行結果の一致が確認されています。

```tsuzuri run=120
pure def sum_even_squares :: [i64] -> i64 = \xs ->
    xs
    |> Array.filter (\x -> x % 2 == 0)
    |> Array.map (\x -> x * x)
    |> Array.sum

let items = [1, 2, 3, 4, 5, 6, 7, 8, 9]
sum_even_squares (ref items[1 ..< ^0])
```

## リファレンスの構成（全 9 部）

全章の詳細リンクと目的別ガイドは **[総合目次（`docs/index.md`）](./docs/index.md)** を参照してください。

| 部 | 章カテゴリ | 主な内容と代表ページ |
| --- | --- | --- |
| **第1部** | 言語の概要と設計思想 | [Tsuzuri とは](./docs/overview/introduction.md)・[設計思想とパフォーマンス戦略](./docs/overview/design-philosophy.md)・[他言語との比較](./docs/overview/comparison.md) |
| **第2部** | 字句構造・リテラル・文字列 | [字句構造・キーワード・文区切り](./docs/syntax/lexical-structure.md)・[リテラル](./docs/syntax/literals.md)・[文字列](./docs/syntax/strings.md)・[文字列補間](./docs/syntax/string-interpolation.md) |
| **第3部** | 値・式・関数・制御構造 | [束縛と値](./docs/expressions/bindings-and-values.md)・[演算子](./docs/expressions/operators.md)・[関数定義](./docs/expressions/functions.md)・[契約と属性](./docs/expressions/contracts-and-attributes.md)・[パターンマッチング](./docs/expressions/pattern-matching.md)・[コンピュテーション式](./docs/expressions/computation-expressions.md) |
| **第4部** | 型システム | [型システムの概要](./docs/types/overview.md)・[プリミティブ型](./docs/types/primitive-types.md)・[レコード](./docs/types/records.md)・[判別共用体](./docs/types/unions.md)・[匿名共用体](./docs/types/anonymous-unions.md)・[ジェネリック](./docs/types/generics.md)・[型クラス](./docs/types/type-classes.md) |
| **第5部** | 所有権とメモリ管理 | [所有権とムーブ](./docs/ownership/ownership-and-move.md)・[借用と参照](./docs/ownership/borrowing.md)・[ライフタイムとリージョン](./docs/ownership/lifetimes.md)・[メモリレイアウト](./docs/ownership/memory-layout.md)・[Drop](./docs/ownership/drop.md) |
| **第6部** | モジュール・パッケージ・ドキュメント | [名前空間とモジュール](./docs/modules/namespaces-and-modules.md)・[インポートとアクセス制御](./docs/modules/imports-and-visibility.md)・[パッケージ管理](./docs/modules/packages.md)・[ドキュメントコメント](./docs/modules/doc-comments.md) |
| **第7部** | 並行処理と遅延評価 | [tzroutine による軽量並行処理](./docs/concurrency/tzroutine.md)・[select 式](./docs/concurrency/select.md)・[遅延評価（Lazy）](./docs/concurrency/lazy.md) |
| **第8部** | 標準ライブラリリファレンス | [引数順序規約](./docs/stdlib/conventions.md)・コレクション（[Array](./docs/stdlib/collections/array.md)・[Vec](./docs/stdlib/collections/vec.md)・[Map](./docs/stdlib/collections/map.md)・[HashMap](./docs/stdlib/collections/hashmap.md)）・テキスト（[String](./docs/stdlib/text/string.md)・[Regex](./docs/stdlib/text/regex.md)）・数値/テンソル（[Matrix](./docs/stdlib/numeric/matrix.md)・[Tensor](./docs/stdlib/numeric/tensor.md)）・同期/並列（[Channel](./docs/stdlib/sync/channel.md)・[Parallel](./docs/stdlib/sync/parallel.md)）・システム（[IO](./docs/stdlib/sys/io.md)・[File](./docs/stdlib/sys/file.md)・[Net](./docs/stdlib/sys/net.md)）・[Json](./docs/stdlib/encoding/json.md)・[Test](./docs/stdlib/testing/test.md) ほか全モジュール |
| **第9部** | コンパイラとツールチェーン | [CLI とサブコマンド](./docs/compiler/cli.md)・[オプションと環境変数](./docs/compiler/options.md)・[対応プラットフォーム](./docs/compiler/platforms.md)・[診断とエラーコード](./docs/compiler/diagnostics.md)・[デバッグ](./docs/compiler/debugging.md)・[ネイティブ連携（C ABI）](./docs/compiler/native-interop.md)・[WebAssembly](./docs/compiler/webassembly.md)・[知識グラフ](./docs/compiler/knowledge-graph.md)・[MCP サーバー](./docs/compiler/mcp.md)・[適合性テスト](./docs/compiler/conformance.md)・[安定性ポリシー](./docs/compiler/stability.md) |

## 本体リポジトリとの関係

- **コンパイラ・標準ライブラリ・言語仕様の実装元**: [`tatsuya-midorikawa/Tsuzuri`](https://github.com/tatsuya-midorikawa/Tsuzuri)
- 本リポジトリはユーザー向けの体系的な言語リファレンス・標準ライブラリ API リファレンス・ツールチェーンガイドを提供します。診断カタログ（`diagnostic-kinds`）、コレクション計算量テーブル（`complexity:*`）、CLI フラグ・環境変数・公開標準関数の網羅性は、本体リポジトリのコンパイラバイナリと標準ライブラリソースから機械的に照合・検証されます。

## ドキュメントの自動生成と検証方法

ドキュメントを編集した際は、Node.js（20 以降）および Tsuzuri コンパイラバイナリを用いて以下の 3 つの検証スクリプトを実行します（環境変数 `TSUZURI_BIN` と `TSUZURI_REPO` を省略した場合は、`../Tsuzuri` または `.tsuzuri-src` 配下が自動参照されます）。

### 1. 自動生成ブロックの更新・整合確認（`scripts/gen-docs.mjs`）

`<!-- generated:... -->` マーカーで囲まれた診断 `kind` 表およびコレクション計算量表をコンパイラと `std/` から生成・検査します。

```sh
# すべての自動生成ブロックを最新化する
TSUZURI_BIN=../Tsuzuri/target/debug/tsuzuri \
TSUZURI_REPO=../Tsuzuri \
node scripts/gen-docs.mjs

# 差分（古い生成ブロック）がないか検査のみ行う（CI 用）
node scripts/gen-docs.mjs --check
```

### 2. CLI・診断コード・バージョン・標準関数ドリフト検査（`scripts/check-cli-docs.mjs`）

`tsuzuri --help` の全サブコマンド・フラグ・環境変数、`tsuzuri explain --catalog --json` の全診断コード、`tsuzuri --version` のバージョン表記、および `std/` の全公開関数がリファレンス内に漏れなく記載されているかを検査します。

```sh
TSUZURI_BIN=../Tsuzuri/target/debug/tsuzuri \
TSUZURI_REPO=../Tsuzuri \
node scripts/check-cli-docs.mjs
```

`--only cli`・`--only codes`・`--only version`・`--only std` を指定して対象チェックを絞ることもできます。

### 3. リンク・見出しアンカー・全コード例の実行検証（`scripts/check-docs.mjs`）

相対ファイルリンクと見出しアンカーの存在確認、および全ページ内の ```` ```tsuzuri ```` コードブロックに対する `tsuzuri check`、`run=` 付き例のネイティブ `-O0` / `-O3` 実行照合、`test` ブロックの `tsuzuri test` 実行を行います。

```sh
# リポジトリ全体を検証する
TSUZURI_BIN=../Tsuzuri/target/debug/tsuzuri \
TSUZURI_REPO=../Tsuzuri \
node scripts/check-docs.mjs

# 編集した特定のページのみを高速に検証する
node scripts/check-docs.mjs docs/compiler/cli.md docs/compiler/options.md
```

## ライセンス

リポジトリルートの [LICENSE](./LICENSE) を参照してください。
