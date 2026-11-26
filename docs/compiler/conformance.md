# 仕様規則体系と適合性テスト

Tsuzuri 本体リポジトリ（`tatsuya-midorikawa/Tsuzuri`）では、言語仕様とコンパイラ・ツールチェーンの振る舞いがドキュメントの記述と乖離しないよう、検証可能なすべての規範的仕様に一意の**規則 ID（`AREA-NNN`）**を割り当て、対応する**適合性テストスイート（Conformance Suite）**で継続的に検証しています。

本章では、全 15 領域の仕様規則体系、規則テーブルの構造、適合性テストの記述形式、および本体リポジトリにおける検証コマンドの仕組みを解説します。

## 要点

- 仕様規則は `LEX`・`SYN`・`TYP`・`OWN`・`EVL`・`NUM`・`STR`・`CTL`・`MOD`・`TSK`・`DIA`・`CLI`・`ABI`・`STD`・`EDN` の **15 領域**に分類され、`OWN-012` のような安定した ID を持ちます。
- 一度発行された規則 ID は決して別の意味に再利用されません。仕様変更（新エディションでの規則変更など）により意味が変わる場合は旧 ID を `retired` とし、新しい連番を採番します（[安定性と互換性ポリシー](./stability.md) 参照）。
- 本体リポジトリの `spec/rules/<AREA>.md` が各規則の規範文・仕様書リンク・テスト一覧を一元管理し、`tests/conformance/<AREA>/` 配下のテストプログラムがネイティブ（`-O0` / `-O3`）や WebAssembly（`wasm32`）での一致を実機検証します。
- 実行検証は `node scripts/conformance.mjs`、規則表・テスト・仕様書マーカー間の静的整合性検査とカバレッジ集計は `node scripts/check-spec.mjs` で行います。

## 全 15 領域の分類

`spec/rules/<AREA>.md` および `tests/conformance/<AREA>/` は以下の 15 領域で構成されています。

| 領域コード | 対象分野 | 主な検証対象 |
| --- | --- | --- |
| `LEX` | 字句構造 | トークン分割、予約語、コメントと入れ子、数値・文字・文字列リテラル字句、エスケープシーケンス |
| `SYN` | 構文解析 | 宣言・式・型・パターンの文法、演算子優先順位と結合性、オフサイドルールとインデント、属性配置 |
| `TYP` | 型システム | プリミティブ型、タプル・レコード・共用体・匿名共用体、型推論、ジェネリック、高階型（HKT）、型クラスと制約 |
| `OWN` | 所有権と借用 | ムーブセマンティクス、`Copy` 判定、共有借用 `ref` と排他借用 `ref mut`、リージョン生存期間、`Drop` 実行順序 |
| `EVL` | 評価順序 | 引数・タプル・レコード構築・演算子・パイプライン・代入における左から右への厳格な評価順序と短絡評価 |
| `NUM` | 数値演算 | 整数のモジュロ折り返し、`@checked` 例外、シフト幅マスク、IEEE 754 丸め・NaN・符号付きゼロ、型キャスト、10 進浮動小数点 |
| `STR` | 文字列とテキスト | UTF-16 `string` と UTF-8 `utf8string` のコード単位・長さ・比較・スライス・文字列補間と書式指定 |
| `CTL` | 制御構造 | `if`・`match`（網羅性とガード）・アクティブパターン・`for` / `while`・`break` / `continue`・コンピュテーション式・`try` |
| `MOD` | モジュールとパッケージ | 1 ファイル 1 モジュール規則、`namespace` と `using`、`private` 可視性、`Tsuzuri.toml` と依存解決 |
| `TSK` | 並行処理 | `tzroutine` の起動と完了待機、`Send` / `Sync` 境界、`Routine.scope`、`Channel`・`select`・`Parallel`・同期プリミティブ |
| `DIA` | 診断システム | 診断コード、1 始まり行・列と UTF-8 バイトスパン、`--json` 出力スキーマ、段階的ゲート、重複排除 |
| `CLI` | CLI とツールチェーン | サブコマンド動作、終了コード（`0` / `1` / `2`）、`fmt`・`fix`・`doc`・`api-diff`・`audit` 等の入出力規約 |
| `ABI` | 公開 ABI とホスト連携 | `export def` の `tz_` シンボル、生成 C ヘッダーと多重インクルード保護、`extern`・`extern type`・`@c_layout`・バッファ解放規約 |
| `STD` | 標準ライブラリ | 引数順序規約（対象が末尾）、主要コレクション・数値・テキスト・I/O モジュールの境界条件とトラップ仕様 |
| `EDN` | エディション制度 | `edition`（`2026` / `2027` / `2028`）の既定値、予約語管理、エディション固有の引数規約・範囲構文・移行規則 |

## 規則表（`spec/rules/<AREA>.md`）の形式

各領域の規則ファイルは `| ID | Rule | Doc | Tests | Status |` の 5 列からなるテーブルを保持します。

| 列名 | 記述規則 |
| --- | --- |
| `ID` | `<AREA>-<3桁連番>`（`001` から昇順、欠番や再利用は禁止） |
| `Rule` | RFC 2119 スタイルの助動詞（`MUST`・`MUST NOT`・`MAY` のいずれか。曖昧な `SHOULD` は使用禁止）を含む 240 文字以内の完結した英語 1 文。特定エディション限定の規則は `In edition 2028, ...` のようにエディション明示で開始する |
| `Doc` | 本体リポジトリ内の仕様書（`docs/language.md` 等）における該当箇所へのリンク |
| `Tests` | その規則を検証する適合性テスト名の一覧（`check-spec.mjs --write` が自動更新） |
| `Status` | `active`（現行有効）または `retired`（廃止済み履歴） |

## 適合性テストの記述形式

各テストは本体リポジトリの `tests/conformance/<AREA>/<ID>-<slug>.tz`（複数ファイル構成の場合は同名ディレクトリ内の `Main.tz`）として配置され、ファイル末尾のコメントディレクティブで検証対象の規則 ID と期待結果を宣言します。

```text
let first = "data"
let second = first
first.length

// rule: OWN-001
// expect: check-error E1012 line=3
```

### 主な期待結果ディレクティブ（`// expect:`）

| ディレクティブ | 合格条件 |
| --- | --- |
| `check-ok` | `tsuzuri check` がエラーなしで完了すること |
| `check-error CODE [line=N [column=N]] [file=NAME] [kind=K] [message "TEXT"]` | `tsuzuri check` が終了コード `1` となり、先頭エラーが指定のコード・位置・`kind`・部分メッセージに一致すること |
| `check-warning CODE ...` | `tsuzuri check` が終了コード `0` となり、指定の警告を含むこと |
| `stdout "TEXT"` | ネイティブの `-O0` と `-O3` の双方で `tsuzuri run` の標準出力が `TEXT` と完全に一致すること |
| `trap kind=K [line=N] [stdout "TEXT"]` | `-O0` と `-O3` の双方で実行時トラップが発生し、指定のトラップ種別・行番号が報告されること |
| `tests-pass N` | ネイティブおよび `wasm32` の `-O0` / `-O3` において `tsuzuri test --json` が `N` 件合格・失敗 0 件となること |

CLI サブコマンド自体の終了コードや生成ファイルを検証する場合は `// cli: <引数>` を記述し、`exit N`・`stdout-has`・`stderr-has`・`file-has`・`deterministic`（同一入力からのバイト一致検証）を組み合わせて検証します。また、`// edition: 2026` で単一ファイルテストのエディションを指定したり、`// targets: native` で対象ターゲットを限定したりできます。

## 検証コマンドの実行方法

Tsuzuri 本体リポジトリのルートで以下のスクリプトを実行することで、適合性テストの実行と仕様整合性の検証を行えます（領域別の最新カバレッジ集計表は本体リポジトリの `spec/README.md` で自動管理されています）。

```sh
# 全 15 領域の適合性テストを実行
node scripts/conformance.mjs target/release/tsuzuri

# 特定の規則 ID または領域に絞って高速実行
node scripts/conformance.mjs target/debug/tsuzuri --rule OWN-001 --targets native
node scripts/conformance.mjs target/debug/tsuzuri --area EDN

# 規則表・テストファイル・仕様書マーカーの相互整合性とカバレッジを検査（コンパイラバイナリ不要）
node scripts/check-spec.mjs
node scripts/check-spec.mjs --coverage
```

`conformance.mjs` は全件合格で終了コード `0`、テスト失敗があれば `1`、ディレクティブ構文誤りや対象テスト不在時は `2` を返します。

## 関連項目

- [安定性と互換性ポリシー](./stability.md)
- [診断メッセージとエラーコード](./diagnostics.md)
- [CLI とサブコマンド](./cli.md)
