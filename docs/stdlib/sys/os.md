# Os

`Os` は、ファイル・ディレクトリ・環境・プロセス・ネットワークなどの OS 境界モジュールが共通して返すエラー型 `Os.Error` / `Os.ErrorKind` と、OS 境界における UTF-8 文字列・バイナリ変換の補助関数を提供する標準モジュールです。`Os` の公開関数自体はすべて副作用を持たない純粋な変換処理であり、パッケージ権限を必要とせず `wasm32` でもそのまま動作します。

## 要点

- OS 操作の失敗は例外やトラップではなく、`Os.Error { kind: ErrorKind, code: i32 }` の値として返されます（標準入出力専用の [`IO.Error`](./io.md) とは別の型です）。
- `code` には POSIX / WASI の `errno` または Windows の Win32 エラーコード（`GetLastError()`）が入り、システムコール発行前に Tsuzuri 側で検出した失敗では `0` になります。
- エラー番号は OS ごとに異なるため、回復分岐には `error.kind`（ネットワーク操作ではさらに [`Net.error_kind`](./net.md)）を用い、人間向けの表示には `Os.message` を使います。
- `Os.encode` と `Os.decode` は孤立サロゲートや不正な UTF-8 を暗黙に置換せず、厳密に `InvalidEncoding` として報告します。

## `Os.Error` と `Os.ErrorKind`

```text
union ErrorKind = NotFound | PermissionDenied | AlreadyExists | InvalidInput | InvalidEncoding | Interrupted | Other
record Error { kind: ErrorKind, code: i32 }
```

`Error` レコードは不透明ではないため、`error.kind` や `error.code` を直接読み取れるほか、テスト用などに `Os.Error { kind: Os.NotFound, code: 2i32 }` を直接構築することも可能です。`ErrorKind` へのケース追加は既存の網羅的 `match` を壊すため、メジャーエディションの境界以外では追加されません。

```tsuzuri run=not%20found%20(os%20error%202)%0Ainvalid%20encoding%0A6%0Ainvalid%20encoding%0Ainvalid%20encoding%0A8%0Aa,b%0Aalready%20exists%20(os%20error%2017)
def main :: unit -> i32 = \() ->
    let missing = Os.Error { kind: Os.NotFound, code: 2i32 }
    do! IO.writeln (Os.message missing)
    let local = Os.Error { kind: Os.InvalidEncoding, code: 0i32 }
    do! IO.writeln (Os.message local)
    let encoded = Os.encode "注文"
    do! IO.writeln (match encoded with
        | Result.Ok text -> $"{(Utf8String.to_bytes text).length}"
        | Result.Error error -> Os.message error)
    let lone_surrogate = Os.encode "\uD800"
    do! IO.writeln (match lone_surrogate with
        | Result.Ok _ -> "unexpected"
        | Result.Error error -> Os.message error)
    let invalid_utf8 = [255ubyte]
    do! IO.writeln (match Os.decode invalid_utf8 with
        | Result.Ok _ -> "unexpected"
        | Result.Error error -> Os.message error)
    let packed = [8ubyte, 0ubyte, 0ubyte, 0ubyte, 0ubyte, 0ubyte, 0ubyte, 0ubyte]
    do! IO.writeln $"{Os.decode_i64 0 packed}"
    let raw_names = [97ubyte, 0ubyte, 98ubyte, 0ubyte]
    do! IO.writeln (match Os.split_names raw_names with
        | Result.Ok items -> String.join "," items
        | Result.Error error -> Os.message error)
    let decoded_status = Os.error_of_status ((3i64 <<< 32) | 17i64)
    do! IO.writeln (Os.message decoded_status)
    0
```

## OS エラー番号と `ErrorKind` の対応

ランタイムはシステムコールの `EINTR` を内部で自動的に再試行するため、現在の標準ライブラリ操作から `Interrupted` が返ることはありません。ただし網羅的な `match` では `Os.Interrupted`（またはワイルドカード `_`）の分岐が必要です。

### POSIX / WASI（`errno`）

| `errno` | `Os.ErrorKind` | `Os.message` のプレフィックス |
| --- | --- | --- |
| `ENOENT`、`ENOTDIR` | `NotFound` | `"not found"` |
| `EACCES`、`EPERM`、`EROFS` | `PermissionDenied` | `"permission denied"` |
| `EEXIST` | `AlreadyExists` | `"already exists"` |
| `EINVAL`、`ENAMETOOLONG`、`EISDIR`、`EBADF`、`EMSGSIZE` など | `InvalidInput` | `"invalid input"` |
| `EILSEQ` | `InvalidEncoding` | `"invalid encoding"` |
| `EINTR`（内部再試行対象） | `Interrupted` | `"interrupted"` |
| 上記以外（`ENOTEMPTY`、`ELOOP`、`ENOSPC`、`EIO`、`ECONNREFUSED` など） | `Other` | `"other"` |

### Windows ネイティブ（Win32 `GetLastError()`）

| Win32 エラー定数 | `Os.ErrorKind` |
| --- | --- |
| `ERROR_FILE_NOT_FOUND` (2)、`ERROR_PATH_NOT_FOUND` (3) | `NotFound` |
| `ERROR_ACCESS_DENIED` (5)、`ERROR_SHARING_VIOLATION` (32) | `PermissionDenied` |
| `ERROR_FILE_EXISTS` (80)、`ERROR_ALREADY_EXISTS` (183) | `AlreadyExists` |
| `ERROR_INVALID_PARAMETER` (87)、`ERROR_INVALID_NAME` (123)、`ERROR_FILENAME_EXCED_RANGE` (206)、`ERROR_DIRECTORY` (267) | `InvalidInput` |
| `ERROR_NO_UNICODE_TRANSLATION` (1113) | `InvalidEncoding` |
| 上記以外（`ERROR_DIR_NOT_EMPTY` (145) など） | `Other` |

## 文字コード変換とランタイム境界ヘルパー

Tsuzuri 内の `string` は UTF-16 コード単位列であり、OS との境界では厳密な UTF-8（Windows カーネル境界では厳密な UTF-16）へ変換されます。

- **`Os.encode text`**: `string` が整形式（孤立サロゲートを含まない）であれば `Ok utf8string` を返し、孤立サロゲートを含めば `Error { kind: InvalidEncoding, code: 0 }` を返します。
- **`Os.decode bytes`**: `[ubyte]` が妥当な UTF-8 であれば `Ok string` を返し、不正なバイト列であれば置換せずに `Error { kind: InvalidEncoding, code: 0 }` を返します。
- **`Os.split_names bytes`**: 各要素が NUL（`0ubyte`）で終端されたバイト列（[`Dir.list`](./dir.md) や [`Env.args`](./env.md) の内部形式）を `[string]` に分割します。1 要素でも不正な UTF-8 があれば全体が `InvalidEncoding` となります。
- **`Os.decode_i64 offset bytes`**: `bytes` の `offset` から 8 バイトをリトルエンディアンの `i64` として読み取ります。
- **`Os.error_of_status status`**: ランタイム内部のステータスワード `(kind <<< 32) | code`（`kind` は宣言順 1〜6、その他は `Other`）を `Os.Error` に変換します。

## WebAssembly とターゲット環境

- **`Os` モジュール単体**: すべて純粋なメモリ上の処理であるため、既定の `wasm32` を含む全ターゲットで利用できます。
- **OS 機能を呼ぶ他モジュール**: [`File`](./file.md)・[`Dir`](./dir.md)・[`Env`](./env.md)・[`Time`](./time.md)（`IO` 系）・[`Random.bytes`](./random.md)・[`Process`](./process.md) に到達するコードは、既定の `wasm32` では `E2000` で拒否され、`--wasm-host wasi` 指定時に WASI preview1 へコンパイルされます（[`Process.run`](./process.md) は WASI 実行時に `Other` エラー、[`Net`](./net.md) ソケットは `--wasm-feature jspi --wasm-feature net` で Node.js 向けに動作します）。

## 引数の順序

標準ライブラリの設計規約（[標準ライブラリの規約](../conventions.md)）に従い、2 引数を取る `Os.decode_i64 offset bytes` は読み取り対象のバイト配列 `bytes` を最後の引数に取ります。他の 5 関数はすべて単一引数です。

## 公開 API

### 型定義

```text
union ErrorKind = NotFound | PermissionDenied | AlreadyExists | InvalidInput | InvalidEncoding | Interrupted | Other
record Error { kind: ErrorKind, code: i32 }
```

### 関数（6 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Os.message` | `ref Os.Error -> string` | `"not found (os error 2)"` 形式の説明文字列を生成（`code == 0` 時は種類のみ） |
| `Os.encode` | `ref string -> Result<utf8string, Os.Error>` | 整形式の `string` を `utf8string` へ変換（孤立サロゲートは `InvalidEncoding`） |
| `Os.decode` | `own [ubyte] -> Result<string, Os.Error>` | UTF-8 バイト配列を `string` へ変換（不正 UTF-8 は `InvalidEncoding`） |
| `Os.error_of_status` | `own i64 -> Os.Error` | ランタイムの状態ワード `(kind <<< 32) \| code` を `Os.Error` に復元 |
| `Os.split_names` | `ref [ubyte] -> Result<[string], Os.Error>` | NUL 終端された UTF-8 文字列列を `[string]` に分割 |
| `Os.decode_i64` | `own i64 -> ref [ubyte] -> i64` | `offset` 位置から 8 バイトをリトルエンディアンの `i64` として読み取る |

## 関連項目

- [IO](./io.md)
- [File](./file.md)
- [Dir](./dir.md)
- [Env](./env.md)
- [Process](./process.md)
- [Net](./net.md)
- [Result](../core/result.md)
- [標準ライブラリの規約](../conventions.md)
- [プラットフォームとクロスコンパイル](../../compiler/platforms.md)
- [WebAssembly](../../compiler/webassembly.md)
