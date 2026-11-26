# Env

`Env` は、プロセス起動時のコマンドライン引数・環境変数・カレントディレクトリを読み取る標準モジュールです。3 つの関数はいずれも遅延アクション `IO<Result<'a, Os.Error>>` を返し、実行されるまで OS へ問い合わせません。マルチスレッド実行時の安全性を保つため、環境変数やカレントディレクトリを書き換える関数は提供されていません。

すべての関数にパッケージ権限 `env` が必要です。権限の宣言と検査の詳細は [パッケージ管理](../../modules/packages.md) を参照してください。

## 要点

- `Env.args ()` はプログラム名（`argv[0]`）を除いた引数配列を返します。不正な UTF-8 が含まれる場合は置換せず `InvalidEncoding` エラーを返します。
- `Env.var name` は未設定の環境変数に対してエラーではなく `Ok None` を返し、空の値に設定されている場合は `Ok (Some "")` を返します。
- 空文字列・`=` を含む名前・NUL を含む名前を `Env.var` に渡すと、OS 問い合わせ前に `InvalidInput` となります。
- `Env.current_dir ()` は OS が報告する現在の作業ディレクトリを返します。

## コマンドライン引数・環境変数・作業ディレクトリの取得

`tsuzuri run` は子プロセスへ追加のコマンドライン引数を渡さないため、`tsuzuri run` で実行した際の `Env.args ()` は空配列 `[]` になります。引数を渡して確認する場合は `tsuzuri build` で生成した実行ファイルに直接引数を指定します。

```tsuzuri run=0%0Anone%0Ainvalid%20input%0Ainvalid%20input%0Atrue
def main :: unit -> i32 = \() ->
    let! arguments = Env.args ()
    do! IO.writeln (match arguments with
        | Result.Ok items -> $"{items.length}"
        | Result.Error error -> Os.message error)
    let! unset = Env.var "TSUZURI_REF_UNSET_EXAMPLE_VAR"
    do! IO.writeln (match unset with
        | Result.Ok (Maybe.Some _) -> "some"
        | Result.Ok Maybe.None -> "none"
        | Result.Error error -> Os.message error)
    let! invalid_eq = Env.var "KEY=VALUE"
    do! IO.writeln (match invalid_eq with
        | Result.Ok _ -> "unexpected"
        | Result.Error error -> Os.message error)
    let! invalid_empty = Env.var ""
    do! IO.writeln (match invalid_empty with
        | Result.Ok _ -> "unexpected"
        | Result.Error error -> Os.message error)
    let! cwd = Env.current_dir ()
    do! IO.writeln (match cwd with
        | Result.Ok dir -> $"{dir.length > 0}"
        | Result.Error error -> Os.message error)
    0
```

## `Env.args` と `main` 引数の違い

エントリーポイントを `def main :: [string] -> i32` として定義した場合も、プログラム名を除いたコマンドライン引数配列を受け取れます。`Env.args ()` とは次の 2 点が異なります。

| 観点 | `def main :: [string] -> i32` | `Env.args ()` |
| --- | --- | --- |
| 不正な UTF-8 引数 | Unicode 置換文字 `U+FFFD` に自動置換して渡す | 配列の一部だけを返さず `Error InvalidEncoding` を返す |
| 取得タイミング | `main` 開始時にランタイムが構築して渡す | `IO` アクションを実行した時点で取得（ライブラリ出力や `tsuzuri test` では空配列） |

POSIX 環境では親プロセスが分割した `argv` 配列をそのまま受け取ります。Windows 環境では OS から渡される 1 本のコマンドライン文字列（`GetCommandLineW`）をランタイム側で空白と二重引用符により分割します。

## 環境変数とカレントディレクトリの規則

- **`Env.var name`**:
  - `name` に孤立サロゲートが含まれる場合は `InvalidEncoding`（`code == 0`）、空文字列・`=`・NUL（`\u0000`）が含まれる場合は `InvalidInput`（`code == 0`）を返します。
  - 取得した値が妥当な UTF-8 でない場合も `InvalidEncoding` となります。
  - 環境変数名の大文字・小文字の扱いはホスト OS の規則に従います（POSIX は区別あり、Windows は区別なし）。
  - 子プロセスを起動する [`Process.run`](./process.md) は、現在のプロセスの環境変数とカレントディレクトリをそのまま継承します。
- **`Env.current_dir ()`**:
  - 相対パスで [`File`](./file.md) や [`Dir`](./dir.md) を呼び出した際の起点となる作業ディレクトリ文字列を返します。Windows では `C:\work` のように `\` 区切りで返されます。

## 対応環境

- **ネイティブ（Linux・macOS・Windows）**: 5 環境すべてで動作します。Windows では Win32 API で実装され、`Os.Error.code` は Win32 エラーコードとなります。
- **WebAssembly / WASI**: 既定の `wasm32` ターゲットでは `Env` の関数に到達するビルドが `E2000` で拒否されます。`--wasm-host wasi` 指定時は WASI preview1 の `args_get` / `environ_get` にコンパイルされ、`Env.current_dir ()` は最初の preopen ディレクトリ名を返します（[WebAssembly](../../compiler/webassembly.md)）。

## 引数の順序

`Env` の公開関数はすべて単一引数（`unit` または変数名 `name`）を取るため、複数引数の順序選択はありません（[標準ライブラリの規約](../conventions.md)）。

## 公開 API

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Env.args` | `own unit -> IO<Result<[string], Os.Error>>` | プログラム名を除いたコマンドライン引数配列を取得 |
| `Env.var` | `own string -> IO<Result<Maybe<string>, Os.Error>>` | 環境変数の値を取得（未設定時は `Ok None`） |
| `Env.current_dir` | `own unit -> IO<Result<string, Os.Error>>` | カレントディレクトリのパス文字列を取得 |

## 関連項目

- [IO](./io.md)
- [Os](./os.md)
- [File](./file.md)
- [Dir](./dir.md)
- [Path](./path.md)
- [Process](./process.md)
- [標準ライブラリの規約](../conventions.md)
- [WebAssembly](../../compiler/webassembly.md)
