# 知識グラフのデータ形式

本章では、コンパイラが `target/tz/kg/` に出力する知識グラフ（Knowledge Graph, KG）の各 JSON Lines ファイルの正確なデータ形式とスキーマ不変条件を定義します。知識グラフの運用・CLI 照会コマンドについては [知識グラフ](./knowledge-graph.md) を参照してください。

知識グラフのスキーマ（`manifest.json` の `tz-kg/1`、事実データの `tz-facts/1`）は互換性保証の対象です。既存のフィールド名の削除・改名や意味の変更はスキーマ番号を上げない限り行われません。新しいフィールドや列挙語彙が追加される場合があるため、外部パーサーは未知のキーや未知の語彙を無視するように実装してください（[安定性と互換性ポリシー](./stability.md) 参照）。

## 要点

- データ本体は UTF-8 エンコードの **JSON Lines**（1 行 1 JSON オブジェクト、LF 改行、`:` や `,` の後に余分な空白なし）で構成され、同一ソース・同一コンパイラからは環境によらずバイト単位で決定的に一致します。
- ノード識別子（`id`）はファイルパスや行番号に依存しない名前空間付きの完全修飾名（例: `Acme::Shop::Cart.total`、`test:Acme::Shop::Cart.empty cart`）です。
- `contains` エッジはモジュールを根とし、レコード→フィールド、共用体→ケース、型クラス/インスタンス→メソッドへと伸びる有向森（各非モジュールノードの入次数が厳密に 1）を形成します。
- 事実データ（`facts/*.jsonl`）とレイアウト情報（`layout/*.jsonl`）は LLVM IR を生成せずフロントエンドの型検査・所有権解析結果のみから抽出されます。

## 共通規則と位置情報（`span`）・切り詰め（`truncated`）

- **ソート順と一意性**: `nodes.jsonl`・`tests.jsonl`・`facts/*.jsonl`・`layout/*.jsonl` は `id` の UTF-8 バイト昇順、`edges.jsonl` は `(rel, from, to, span.path, span.start, span.end)` の辞書順で整列され、完全一致する重複行は 1 行に集約されます。対象行が 0 件のファイルは 0 バイト（またはモジュール別ファイルではファイル自体を生成しない）となります。
- **数値と欠損値**: 数値はすべて 0 以上の 10 進整数のみを使用し、存在しないスカラー値は `null`、空リストは `[]` で表します。
- **`span` オブジェクト**: `{"path":"Cart.tz","start":120,"end":130,"line":10,"column":5}` の固定 5 キーです。`path` はプロジェクトルートからの `/` 区切り相対パス、`start` / `end` は UTF-8 バイトオフセット（`end` 排他）、`line` / `column` は `start` の 1 始まり行・Unicode スカラー列番号です。
- **配列の上限と `truncated`**: `facts/*.jsonl` 内の各配列フィールドは 1 キーあたり最大 **100 件**まで格納されます。超過分は切り捨てられ、`truncated` オブジェクトに `{"trap_sites":12}` のように省略件数が記録されます（1 関数の AST 走査上限 1,048,576 ノードを超えた場合は `{"nodes":1}` が記録されます）。

## ノード ID の命名規則

| 宣言の種別 | ID の形式 | 具体例 |
| --- | --- | --- |
| モジュール | `::` 区切りの完全モジュール名 | `Acme::Shop::Cart` |
| トップレベル宣言（`def`・`const`・`extern`・`record`・`union`・`type`・`class`・`extern type`） | `<モジュール ID>.<宣言名>` | `Acme::Shop::Cart.total` |
| アクティブパターン | `<モジュール ID>.(\|Case1\|Case2\|)` | `Main.(|Even|Odd|)` |
| レコードフィールド / 共用体ケース / クラスメソッド | `<親型またはクラスの ID>.<メンバー名>` | `Acme::Shop::Cart.Line.unit_price` |
| 型クラスインスタンス | `instance:<クラス ID><<対象型>>` | `instance:Acme::Traits.Sized<Acme::Shapes.Point>` |
| インスタンスメソッド | `<インスタンス ID>.<メソッド名>` | `instance:Acme::Traits.Sized<Acme::Shapes.Point>.size` |
| テスト / ベンチマーク | `test:<モジュール ID>.<名前>` / `bench:<モジュール ID>.<名前>` | `test:Acme::Shop::Cart.line total` |
| `Main.tz` のトップレベル実行式 | `<モジュール ID>.$entry` | `Acme::Shop::Main.$entry` |
| 標準ライブラリ・組み込み（エッジの `to` のみ） | `<StdModule>.<name>` または組み込み名 | `Array.map`、`Eq`、`sqrt` |

同一モジュール内に同名の `test` や `bench` が複数ある場合は、ソース出現順に 2 件目以降へ `#2`・`#3` が付与されます。

## 各 JSON Lines ファイルのスキーマ

### 1. `nodes.jsonl`（宣言ノード）

| キー（出現順） | 型 | 説明 |
| --- | --- | --- |
| `id` | 文字列 | 上記規則に従う一意なノード ID |
| `kind` | 文字列 | `"module"`・`"def"`・`"const"`・`"record"`・`"union"`・`"case"`・`"field"`・`"class"`・`"method"`・`"instance"`・`"alias"`・`"test"`・`"bench"`・`"extern"`・`"handle"`（`extern type`）のいずれか |
| `module` | 文字列 | 所属モジュールの ID |
| `name` | 文字列 | 短い宣言名（テストはテスト名文字列、インスタンスは `"Class<Type>"`） |
| `signature` | 文字列 | `tsuzuri doc` と同一形式で整形された宣言シグネチャ |
| `params` | 配列 | 仮引数ごとの `{"name","type","conv"}`。`conv` は解決後の実効渡し規約 `"own"`・`"ref"`・`"ref_mut"`・`"copy"` のいずれか |
| `result` | 文字列 \| `null` | 戻り値型（フィールド・ケース・定数・型エイリアスはその値型、モジュール等は `null`） |
| `public` | 真偽値 | モジュール外へ公開されているか |
| `export` | 真偽値 | ホスト ABI 向けに `export` されているか |
| `pure` | 真偽値 | `pure def` として宣言されているか |
| `doc` | 文字列 \| `null` | `///` ドキュメントコメント本文 |
| `deprecated` | 文字列 \| `null` | `@deprecated` タグの案内文字列 |
| `origin` | 文字列 | `"project"`、`"dependency:<パッケージ名>"`、または標準ライブラリ KG の `"std"` |
| `span` | オブジェクト | 宣言名のソース位置（モジュール先頭は `0..0`、`$entry` は式全体） |

### 2. `edges.jsonl`（関係エッジ）

各行は `{"rel","from","to","args","span"}`（`args` は `rel == "calls"` のとき実引数ごとの `conv` 配列、関数値としての参照のみなら `[]`、他の `rel` では省略または `null`）で構成されます。

| `rel` の値 | 始点 `from` | 終点 `to` | 意味 |
| --- | --- | --- | --- |
| `"contains"` | モジュール・`record`・`union`・`class`・`instance` | 子宣言ノード | 親子包含関係（モジュールを根とする森を構成） |
| `"calls"` | 関数・メソッド・テスト・`$entry` | 呼び出し先（プロジェクト内ノード・標準ライブラリ関数・組み込み関数・クラスメソッド） | 直接の関数呼び出しまたは関数値の参照 |
| `"uses_type"` | 最も内側の囲み宣言 | `record`・`union`・`class`・`handle` | 型シグネチャ・構築式・型注釈・インスタンス頭部での型参照 |
| `"implements"` | 対象型 | 型クラス | `instance` 宣言または `deriving` による型クラス実装関係 |
| `"instance_of"` | `instance` ノード | 型クラス | インスタンスノードから対象型クラスへの紐付け |
| `"imports"` | モジュール | `using` 対象の名前空間文字列 | `using` 宣言による名前空間インポート |
| `"tested_by"` | 到達される関数ノード | `test` ノード | テストから呼び出し深さ 8 段以内で到達する被テスト関係（1 テスト最大 200 件） |

### 3. `tests.jsonl`（テスト・ベンチマーク索引）

各行は `{"id","kind","module","name","index","span"}` を持ちます。`kind` は `"test"` または `"bench"`、`index` は `tsuzuri test --index N` や `tsuzuri bench --index N` にそのまま渡せる 0 始まりの通し番号です。

### 4. `facts/<Module>.jsonl`（関数の意味・所有権事実）

関数本体を持つノード（`def`・`extern`・`test`・`bench`・`instance` の `method`・`$entry`）ごとに 1 行出力されます。ジェネリック関数ではすべての単相化実体から得られた事実が集約されます。

| キー | 内容 |
| --- | --- |
| `id` | 対象ノード ID |
| `effects` | 到達しうる効果名のソート済み配列（`"atomic"`・`"debug"`・`"extern"`・`"gpu"`・`"io"`・`"net"`・`"os"`・`"rc"`・`"task"`・`"user_drop"`） |
| `effect_sites` | 効果発生箇所と最短呼び出し経路 `{"effect","span","via"}` の配列 |
| `effects_complete` | 効果要約が全間接呼び出しまで網羅しているかを表す真偽値（現在は `false`） |
| `copy_sites` | 配列・リスト等の暗黙ディープコピー箇所 `{"span","type","kind","cost"}`（`W1006` と同一箇所） |
| `alloc_sites` | 明示的ヒープ確保箇所 `{"span","kind"}`（`"new_array"`・`"new_list"`・`"new_literal"`） |
| `alloc_complete` | 全確保箇所を網羅しているかを表す真偽値（現在は `false`） |
| `trap_sites` | トラップ候補箇所 `{"span","kind","proven"}`（`kind` は `"assert"`・`"unreachable"`・`"integer_division_by_zero"`・`"integer_division_overflow"`・`"bounds_check"`・`"range_step_zero"`・`"overflow"`。定数等で不発生が証明された箇所は `proven: true`） |
| `ownership` | 変数ごとの所有権イベント `{"var","event","to","span"}`（`event` は `"move"`・`"borrow"`・`"borrow_mut"`・`"reborrow"`・`"drop"`・`"copy"`） |
| `recursion` | 再帰形態（`"none"`・`"self"`・`"self_tail"`・`"mutual"`） |
| `loops` | ループ構文一覧 `{"kind","span"}`（`"while"`・`"for_range"`・`"for_each"`） |
| `specializations` | ジェネリック関数の単相化実体数 |
| `parallel` | `check --report parallel` と同等の並列化提案・純粋性判定 `{"call","kind","parallel_safe","reason","span"}` |
| `truncated` | 上限 100 件を超過して切り詰めた配列キーと超過件数のマップ |

### 5. `layout/<Module>.jsonl`（型のメモリレイアウト）

プロジェクト内で使用された具体型ごとの `record` および `union` について、64-bit ネイティブ環境におけるサイズとアライメントの下限・上限を 1 行ずつ記録します。

| キー | 内容 |
| --- | --- |
| `id`・`kind`・`type` | 型ノード ID（型引数付き）、`"record"` または `"union"`、型の表示文字列 |
| `size`・`align` | `[min_bytes, max_bytes]` 形式の 2 要素配列 |
| `fields`・`reordered` | レコード専用。宣言順の `{"name","type","slot"}` 配列と、アライメント最適化によるフィールド並べ替え有無 |
| `layout`・`tag_bytes`・`niche`・`cases` | 共用体専用。表現方式（`"enum"`・`"common"`・`"general"`・`"niche"`・`"node"`）、タグバイト数、ニッチ種別（`"negative_length"`・`"null_pointer"`・`"null_descriptor"` または `null`）、各ケースの `{"name","payload"}` |
| `drop_flag` | カスタム `Drop` 用の生存フラグを持つかを表す真偽値 |

## 解析範囲の既知の制限

- `uses_type` エッジはシグネチャ・構築式・型注釈・インスタンス頭部に現れる具体型・型クラスを記録し、透明な型エイリアスの使用箇所や制約節のクラス名は含みません。
- `ownership` イベントはジェネリック関数のテンプレート本体から 1 回収集され、内側のラムダ式本体のイベントは含まれません。
- `effects` は関数値（クロージャや `dyn`）を介した動的呼び出し先までは追跡しません。

## 関連項目

- [知識グラフ](./knowledge-graph.md)
- [図表の自動生成](./diagrams.md)
- [MCP サーバー](./mcp.md)
- [メモリレイアウトとスタック・ヒープ](../ownership/memory-layout.md)
- [安定性と互換性ポリシー](./stability.md)
