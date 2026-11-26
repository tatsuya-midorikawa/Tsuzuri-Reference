# 知識グラフ

`tsuzuri check`・`build`・`run`・`test` は、プロジェクトを解析するたびにその構造と意味解析結果を**知識グラフ（Knowledge Graph, KG）**として `<プロジェクトルート>/target/tz/kg/` に自動出力します。知識グラフは宣言を**ノード**、呼び出し・型参照・実装・テスト到達関係を**辺（エッジ）**として表現した決定的なデータベースであり、AI エージェントや開発ツールがソースツリー全体を走査・再解析することなく、最小のトークン予算で正確な構造把握・影響範囲分析・型検索・図表生成を行えるようにします。

各 JSON Lines ファイルの厳密なスキーマ仕様は [知識グラフのデータ形式](./knowledge-graph-format.md)、図表生成の詳細は [図表の自動生成](./diagrams.md) を参照してください。

## 要点

- `Tsuzuri.toml` または `Main.tz` を持つプロジェクトで `check`・`build`・`run`・`test` を実行すると自動的に更新されます（単一ファイルでは `--kg` で有効化、`--no-kg` または `TSUZURI_KG=0` で無効化）。
- ソース・マニフェスト・ロックファイル・コンパイラバイナリに変化がなければ再書き込みは一切行われず、同一入力からはどのマシンでもバイト単位で同一のグラフファイルが生成されます。
- `tsuzuri kg` サブコマンド群により、グラフの構築・整合検証・削除・エクスポートのほか、シンボル詳細・呼び出し元/先・最短経路・型検索・バージョン間影響分析（`impact`）をソースコードを開かずに即座に照会できます。
- `tsuzuri test --affected BASE` と連携することで、コード変更が到達しうるテストケースだけを選別して高速に実行できます。

## ディレクトリ構成とアトミック更新

出力先は `--kg-dir DIR`、環境変数 `TSUZURI_KG_DIR`、既定値 `<ルート>/target/tz/kg` の優先順で決まります。

| パス | 内容 |
| --- | --- |
| `.tsuzuri-kg` | 管理マーカーファイル（生成印・コンパイラスタンプ・発行トークンの 3 行） |
| `manifest.json` | スキーマ（`tz-kg/1`）、コンパイラ版、エディション、完全性フラグ（`complete`）、入力ハッシュ（`source_hash`）、要素数集計、全構成ファイルの SHA-256 一覧 |
| `nodes.jsonl` / `edges.jsonl` | 全宣言ノードと関係エッジ（`contains`・`calls`・`uses_type`・`implements`・`instance_of`・`imports`・`tested_by`） |
| `tests.jsonl` | `test` および `bench` 宣言の一覧（`--index` 番号付き） |
| `facts/<Module>.jsonl` | 関数ごとの推論効果、トラップ・確保・暗黙コピー箇所、所有権イベント、再帰・ループ・並列化情報 |
| `layout/<Module>.jsonl` | レコード・共用体の 64-bit ネイティブサイズ・アライメント範囲・フィールドスロット・ニッチ情報 |
| `diag.jsonl` | 解析時の診断一覧（`check --json` と同一形式、ルートからの相対パス） |
| `brief/L0.md`・`brief/L1/<Module>.md`・`brief/L2/<ID>.md` | トークン予算内に収めた決定的な英語要約カード（プロジェクト全体・モジュール別・宣言別） |
| `views/modules.mmd`・`views/types.mmd`・`views/concurrency.mmd` | 自動生成されたモジュール依存・型関係・並行構造の Mermaid 図 |

- **アトミックな置換と読み取り整合性**: 更新時は隣接する一時ディレクトリへ全ファイルを書き出してからディレクトリ単位でアトミックに入れ替えます。読み取り側は `manifest.json` に記載された全ファイルの SHA-256 を照合し、万一読み取り中に別プロセスが更新した場合は最大 3 回まで最初から読み直すため、新旧のグラフが混在することはありません。また、`.tsuzuri-kg` マーカーを持たない既存ディレクトリを誤って上書き・削除することはありません。
- **型エラー時の扱い**: 型検査に失敗したプロジェクトでは古い事実データを残さず、`.tsuzuri-kg`・`manifest.json`（`complete: false`）・`diag.jsonl` のみを記録します。また、`check` 等の自動出力時に書き込み権限不足等で保存できなかった場合も警告 `W2001` を 1 行出すだけで、元のコンパイル結果や終了コードには影響しません。

### 要約カード（Brief Cards）

AI エージェントが段階的にコンテキストを展開できるよう、文字数（Unicode スカラー数）の上限を設けた 3 階層の英語要約カードが生成されます。上限を超える場合は重要度の低い項目から `…N more` に折りたたまれます。

- **L0（`brief/L0.md`、上限 2,400 文字）**: プロジェクト全体の規模、エントリーポイント、モジュール一覧と依存関係、エクスポート関数、テスト数、効果サマリー。
- **L1（`brief/L1/<Module>.md`、上限 1,600 文字）**: 1 モジュール内の型定義、関数一覧（呼び出し元数と効果付き）、型クラスインスタンス、テスト、依存先・被依存元モジュール。
- **L2（`brief/L2/<ID>.md`、上限 700 文字、公開優先で最大 256 件保存）**: 1 宣言のシグネチャ、引数渡しモード、ドキュメント先頭行、効果、トラップ・確保・コピー箇所数、呼び出し関係、関連テスト。

## グラフ管理コマンド（`build` / `verify` / `clean` / `export`）

```sh
tsuzuri kg build [PATH] [--kg-dir DIR] [--force] [--json]
tsuzuri kg build --std [--force] [--json]
tsuzuri kg verify [PATH] [--kg-dir DIR] [--json]
tsuzuri kg clean [PATH] [--kg-dir DIR]
tsuzuri kg clean --std
tsuzuri kg export [PATH] [--kg-dir DIR] (--nodes | --edges | --facts) [--no-refresh]
```

- **`build`**: 知識グラフが未作成または古い場合に解析して書き出します（`--force` で強制再生成、`--std` でビルドキャッシュ内の標準ライブラリ知識グラフを構築）。
- **`verify`**: 入力ソースとの鮮度一致、全ファイルの SHA-256 一致、およびグラフ不変条件（ノード ID の一意性、エッジ始点の存在、`contains` エッジがモジュールを根とする森を成すこと）を検証します。不整合があれば `E2009`（終了コード `1`）を報告します。
- **`clean`**: `.tsuzuri-kg` マーカーを確認したうえで知識グラフディレクトリを安全に削除します（ソースファイルを含むディレクトリは削除せず `E2009` で保護します）。
- **`export`**: `--nodes`・`--edges`・`--facts` のいずれかを指定し、JSON Lines をそのまま標準出力へ書き出します。

## グラフ照会コマンド

照会コマンドは知識グラフ（古い場合は自動更新、`--no-refresh` 指定時は既存のまま参照）から即座に応答を返します。共通オプションとして `[--budget N] [--path PATH] [--kg-dir DIR] [--no-refresh] [--json]` を指定できます。

```sh
tsuzuri kg brief
tsuzuri kg brief --module Cart
tsuzuri kg show Cart.total
tsuzuri kg callers line_total --depth 2
tsuzuri kg callees Cart.total --depth 2
tsuzuri kg uses Line
tsuzuri kg tests-for line_total
tsuzuri kg search "discount" --std
tsuzuri kg path main line_total --rel calls --depth 8
tsuzuri kg find 'ref [Line] -> i64' --limit 10
```

| サブコマンド | 出力内容 |
| --- | --- |
| `brief [ID \| --project \| --module M]` | L0（プロジェクト）・L1（モジュール）・L2（宣言）の英語要約カードを表示 |
| `show ID` | 単一宣言の種別・可視性・位置・シグネチャ・引数モード・効果・計装箇所数・呼び出し元/先・関連テストを表示 |
| `callers ID` / `callees ID` | `calls` エッジを幅優先探索（`--depth` は 1〜8、既定 `1`）し、呼び出し元または呼び出し先を列挙 |
| `uses TYPE` | 指定した型を参照・実装・インスタンス化する宣言一覧を表示 |
| `tests-for ID` | 指定した宣言に到達するテスト（`tested_by` エッジ）を列挙 |
| `search TEXT [--std]` | 名前・ID・シグネチャ・ドキュメント先頭行に対する部分一致検索（`--std` で標準ライブラリも対象） |
| `path FROM TO` | 2 つのシンボル間の最短エッジ列を探索（`--rel` でエッジ種別をカンマ区切り指定、既定は `calls`、深さ既定 `8`・最大 `16`） |
| `find TYPE` / `find --result T [--takes U]...` | 型シグネチャによる単一化検索（`exact`・`borrow`・`partial` の 3 段階で表示。`tsuzuri find --project .` と同一エンジン） |

### シンボル ID の短縮解決規則

照会コマンドや `kg diagram` に渡す `ID` は、`Acme::Shop::Cart.total` のような完全修飾名だけでなく、`Cart.total` や `total` のように短縮形で指定できます。コンパイラは次の優先順で検索し、最初に見つかった段階で確定します。

1. 完全一致
2. `::` または `.` の直後に続く末尾一致（例: `total`、`Cart.total`）
3. 大文字・小文字を区別しない完全一致
4. 大文字・小文字を区別しない末尾一致
5. 前方一致
6. 大文字・小文字を区別しない前方一致

同一段階で複数のシンボルが一致した場合は曖昧エラー `E2000`（`kg_ambiguous_id`、候補を最大 10 件提示）、どの段階でも見つからない場合はプロジェクト外（標準ライブラリの知識グラフ）を探し、そこにもなければ綴りの近い候補を添えた `E2000`（`kg_unknown_id`）を返します。

## 変更影響分析（`kg impact`）と影響テスト実行（`test --affected`）

`tsuzuri kg impact` は、ベース版（Git コミットまたはディレクトリ）とヘッド版（作業ツリーまたは別ディレクトリ）の 2 つの知識グラフを比較し、公開 API の変更・関数効果の増減・警告の変化、およびその変更に到達しうるテスト一覧を出力します（差分の有無にかかわらず正常時の終了コードは `0`）。

```sh
tsuzuri kg impact --git HEAD~1
tsuzuri kg impact --from ../app-v1 --to . --json
```

- **変更分類**: `tsuzuri api-diff` と共通の `breaking` / `non-breaking` 分類に加え、公開関数への新たな副作用の追加（到達する関数数・テスト数付きで `breaking` 報告）、非公開宣言の効果・計装箇所・再帰の変化や新規警告を `info` として報告します。
- **到達テストの特定と `tsuzuri test --affected BASE`**: ソースハッシュが変化したモジュール内の宣言・削除された宣言・変更された型クラスメソッドから `calls` エッジを逆方向に最大 8 段辿り、影響を受けるテストを抽出します。`tsuzuri test . --affected HEAD~1` を実行すると、この抽出されたテストのみを走らせます（コンパイラ版の変更、`Tsuzuri.toml` や依存の変更、標準型クラスインスタンスの変更、または深さ 8 を超える呼び出し連鎖がある場合は、安全側に倒して理由を表示のうえ全テストを実行します）。

## 関連項目

- [知識グラフのデータ形式](./knowledge-graph-format.md)
- [図表の自動生成](./diagrams.md)
- [MCP サーバー](./mcp.md)
- [CLI とサブコマンド](./cli.md)
- [コンパイラオプションと環境変数](./options.md)
- [安定性と互換性ポリシー](./stability.md)
