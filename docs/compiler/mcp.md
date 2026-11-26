# MCP サーバー

`tsuzuri mcp` は、AI コーディングエージェント向けに [Model Context Protocol](https://modelcontextprotocol.io/)（MCP）を提供する標準入出力（stdio）サーバーです。1 行 1 メッセージの JSON-RPC 2.0 を介して、プロジェクトの型検査診断、言語ガイド、診断コード解説、[知識グラフ](./knowledge-graph.md)照会、型シグネチャ検索、バージョン間影響分析、自動修正プラン、および[図表生成](./diagrams.md)を型付きの読み取り専用ツール・リソースとして公開します。

## 要点

- **完全な読み取り専用設計**: すべてのツールに `readOnlyHint: true` が付与されており、ファイルの書き込み・変更、子プロセスの起動、外部ネットワーク通信を一切行いません。`tz_fix_plan` も統一差分（unified diff）と編集スパンを返すのみで、ソースは書き換えません。
- **厳格なルート境界保護**: ツールに渡されるすべてのパスは `--root` ディレクトリ配下の相対パスに制限され、`..` による親ディレクトリ参照、絶対パス、シンボリックリンク経由のアクセスはすべて拒否されます。
- **インメモリの知識グラフ補完**: `target/tz/kg/` に最新かつ整合性検証済みの知識グラフが存在すればそれを読み込み、存在しない場合や古い場合もディスクへ書き込まずメモリ上でオンデマンド構築して応答します。

## 起動オプションと各クライアントへの登録

```sh
tsuzuri mcp [--root DIR] [--kg-dir DIR]
```

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `--root DIR` | カレントディレクトリ | MCP サーバーが参照を許可するプロジェクトルートディレクトリ |
| `--kg-dir DIR` | `<ルート>/target/tz/kg` | 既存の知識グラフを読み取るディレクトリ（読み取り専用。環境変数 `TSUZURI_KG_DIR` は参照しない） |

上記以外のオプションは `E2000`（終了コード `2`）、指定された `--root` が有効なディレクトリでない場合や入出力障害時は標準エラーへ `E2010` を出して終了コード `1` で終了します。標準出力には JSON-RPC メッセージ以外は一切出力されません。

主要な MCP 対応クライアントでの設定方法は次のとおりです。

- **VS Code（`.vscode/mcp.json`）**:

```json
{
  "servers": {
    "tsuzuri": {
      "type": "stdio",
      "command": "tsuzuri",
      "args": ["mcp", "--root", "${workspaceFolder}"]
    }
  }
}
```

- **ワークスペース共有 `.mcp.json` / Cursor（`.cursor/mcp.json`）**:

```json
{
  "mcpServers": {
    "tsuzuri": {
      "command": "tsuzuri",
      "args": ["mcp"]
    }
  }
}
```

- **CLI エージェント登録コマンド**:

```sh
claude mcp add --transport stdio tsuzuri -- tsuzuri mcp
copilot mcp add tsuzuri -- tsuzuri mcp
```

## 提供される全 12 ツール

各ツールは人間・LLM 向けの整形済みテキスト（`content[0].text`）と、`outputSchema` に準拠した機械可読な構造化データ（`structuredContent`）の双方を返します。シンボル `id` には `kg show` と同じく短縮名を使用できます。

| ツール名 | 必須引数（括弧内は任意引数） | 返却内容 | 対応する CLI コマンド |
| --- | --- | --- | --- |
| `tz_check` | なし（`path`, `warnings`, `implicit_copy`） | 型検査・所有権検査の診断配列とエラー・警告件数 | `tsuzuri check --json` |
| `tz_guide` | なし（`topic`, `module`） | コンパイラ内蔵の英語言語ガイド（省略時は L0 カード、`"list"` でトピック一覧、エディションはルートの `Tsuzuri.toml` に追従） | `tsuzuri guide` |
| `tz_explain` | `query` | 診断 `kind` またはエラーコードの原因解説と修正例 | `tsuzuri explain` |
| `tz_symbol` | `id` | 単一シンボルのシグネチャ、引数渡しモード、推論効果、計装箇所、呼び出し関係、関連テスト | `tsuzuri kg show` |
| `tz_brief` | なし（`id`, `budget`） | L0（プロジェクト）・L1（モジュール）・L2（宣言）の要約カード | `tsuzuri kg brief` |
| `tz_search` | `query`（`kind`, `limit`） | 名前・シグネチャ・ドキュメント先頭行の部分一致検索結果 | `tsuzuri kg search` |
| `tz_callers` | `id`（`relation`, `depth`, `limit`） | 関数の呼び出し元（`calls`）または型の参照・実装箇所（`uses_type`） | `tsuzuri kg callers` / `uses` |
| `tz_path` | `from`, `to`（`relations`, `depth`） | 2 つの宣言を結ぶ最短エッジ経路 | `tsuzuri kg path` |
| `tz_find` | `query`（`limit`） | 型シグネチャによる標準ライブラリ・プロジェクト横断検索 | `tsuzuri kg find` |
| `tz_impact` | `old`（`new`） | ルート配下の 2 ディレクトリ間の API・効果差分と影響テスト一覧 | `tsuzuri kg impact` |
| `tz_fix_plan` | なし（`path`, `applicability`） | 自動適用可能な修正案の一覧と統一差分（ファイルへの書き込みは行わない） | `tsuzuri fix --dry-run` |
| `tz_diagram` | `kind`（`id`, `depth`, `max_nodes`, `format`） | モジュール・型・呼び出し・所有権・並行・配置・状態遷移の 7 種の図表 | `tsuzuri kg diagram` |

引数のバリデーション失敗、存在しないシンボル ID の指定、対象プロジェクトの型エラーなどのドメインエラーは、プロトコルレベルの失敗ではなく `isError: true` を持つツール結果として詳細な理由文とともに返却されるため、エージェント自身が内容を読んで自律的にクエリやコードを修正できます（未知のツール名や不正な `params` 構造のみ JSON-RPC の `-32602` エラーとなります）。

## MCP リソース（Resources）

`resources/read` を通じて以下の Markdown リソース（`text/markdown`）を取得できます。

| URI パターン | 内容 |
| --- | --- |
| `tz://guide/L0` | 言語仕様・所有権・頻出の落とし穴の凝縮カード |
| `tz://guide/L1` | 全 4 章からなる完全版英語ガイド |
| `tz://kg/brief/L0` | プロジェクト全体の L0 要約カード |
| `tz://kg/brief/{id}` | モジュールまたは宣言の要約カード（`{id}` はパーセントエンコードした ID、最大 512 文字） |
| `tz://explain/{kind}` | 診断コードまたは `kind` の解説ページ（最大 64 文字） |

## プロトコル仕様・資源上限・セキュリティ

- **対応プロトコル版**: MCP `2025-06-18` を標準実装とし、旧版 `2025-03-26` や `2024-11-05` を要求するクライアントにはそれぞれの仕様に合わせたフィールド構成で応答します。JSON-RPC バッチリクエスト（配列送信）は `-32600` で拒否します。
- **直列実行と応答キャッシュ**: ツール呼び出しは到着順に 1 件ずつ処理されますが、`ping`・`initialize`・`tools/list` には処理中でも即座に応答し、`notifications/cancelled` でキャンセルされた要求の応答送出は抑止します。直近 8 件の応答は参照ソースのハッシュが変化しない限り決定的に再利用されます。
- **メッセージ・応答サイズ上限**: 入力 1 行あたり最大 4 MiB（超過時は `-32600`）、JSON ネスト深さ 128（超過時は `-32700`）、保留リクエスト数 64（超過時は `-32000`）、応答テキスト最大 200,000 文字（超過時は `truncated: true` を付与して切り詰め）、`structuredContent` 最大 400,000 バイトです。
- **信頼境界に関する注意**: サーバー自身はコードを実行せず絶対パスも漏洩しませんが、信頼できない第三者のリポジトリを開く際は、ソース内のコメントや識別子に含まれる文字列がプロンプトインジェクションとして解釈されないようクライアント側の権限設定を適切に構成してください。

## トラブルシューティング

| 事象 | 原因と対処 |
| --- | --- |
| 起動直後に `error[E2010]: project root '...' is not a directory` で終了する | クライアント設定の `--root` に実在するプロジェクトディレクトリのパスを指定しているか確認してください |
| `tz_symbol` や `tz_diagram` が `the project does not type-check` を返す | 型エラーがある状態では知識グラフが生成されません。先に `tz_check` を呼んでコンパイルエラーを解消してください |
| 起動時に `E2000`（`TSUZURI_THREADS`）で終了する | 環境変数 `TSUZURI_THREADS` に `1`〜`32` の範囲外の値が設定されています。値を修正するか環境変数を解除してください |

## 関連項目

- [CLI とサブコマンド](./cli.md)
- [知識グラフ](./knowledge-graph.md)
- [知識グラフのデータ形式](./knowledge-graph-format.md)
- [図表の自動生成](./diagrams.md)
- [診断メッセージとエラーコード](./diagnostics.md)
- [安定性と互換性ポリシー](./stability.md)
