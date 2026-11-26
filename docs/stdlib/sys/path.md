# Path

`Path` は、パス文字列の連結や親ディレクトリ・ファイル名・拡張子の抽出を行う純粋関数の標準モジュールです。OS のシステムコールやファイルシステムを一切参照しないため、`IO` アクションやパッケージ権限を必要とせず、既定の `wasm32` を含むすべてのターゲットで同一の結果を返します。

## 要点

- すべての関数が副作用を持たない純粋な文字列操作であり、引数を共有借用（`ref string`）で受け取って新しい所有文字列を返します。
- パス区切り文字として認識されるのはスラッシュ `/` のみです（バックスラッシュ `\` は通常の文字として扱われます）。
- `.` や `..` の正規化、およびシンボリックリンクの解決は行いません。
- `Path.join` は右辺が `/` で始まる絶対パスであっても左辺を破棄せず連結します（ディレクトリトラバーサルを防ぐサンドボックス機構ではありません）。

## パスの連結と分解

引数はすべて `ref string` のため、同じ変数をムーブさせずに何度でも渡せます。

```tsuzuri run=notes/2026%0Anotes/2026%0A2026%0Anotes//etc%0ASome%20/usr%0ANone%0ASome%20report.txt%0ANone%0ASome%20gz%0ANone%0ASome%20%0ASome%20C:\dir\note.txt
def show :: own Maybe<string> -> string
fn show item =
    match item with
    | Maybe.Some text -> $"Some {text}"
    | Maybe.None -> "None"

def main :: unit -> i32 = \() ->
    let base = "notes"
    do! IO.writeln (Path.join base "2026")
    do! IO.writeln (Path.join "notes/" "2026")
    do! IO.writeln (Path.join "" "2026")
    do! IO.writeln (Path.join base "/etc")
    do! IO.writeln (show (Path.parent "/usr/bin/"))
    do! IO.writeln (show (Path.parent "/"))
    do! IO.writeln (show (Path.file_name "docs/report.txt"))
    do! IO.writeln (show (Path.file_name "docs/.."))
    do! IO.writeln (show (Path.extension "backup.tar.gz"))
    do! IO.writeln (show (Path.extension ".bashrc"))
    do! IO.writeln (show (Path.extension "archive."))
    do! IO.writeln (show (Path.file_name "C:\\dir\\note.txt"))
    0
```

## 区切り文字と境界条件の規則

- **`Path.join left right`**:
  - `left` が空文字列 `""` のときは `right` の複製を返します。
  - `left` の末尾が `/` のときは余分な `/` を足さず `left + right`、そうでなければ `left + "/" + right` を返します。
  - `right` が `"/etc"` や `"../secret"` であってもそのまま連結されます。パスの安全性検査には使用しないでください。
- **`Path.parent path`**:
  - 単独の `"/"` を除き、末尾の連続する `/` を取り除いたうえで最後の `/` より前の部分を返します（親がルートになる `"/a"` の親は `Some "/"` です）。
  - `""`、`"/"`、および `/` を含まない `"a"` に対しては `None` を返します。
- **`Path.file_name path`**:
  - 末尾の `/` を取り除いた後の最後のセグメントを返します。
  - `""`、`"/"`、および最後のセグメントが `"."` または `".."` の場合（`"a/.."` など）はファイル名が存在しないため `None` を返します。
- **`Path.extension path`**:
  - `Path.file_name path` が `Some name` を返し、かつ `name` の先頭文字より後ろ（インデックス `1` 以上）に `.` が含まれる場合、最後の `.` より後ろの部分文字列を返します。
  - `".bashrc"` のように先頭の `.` のみを持つ隠しファイル名は `None`、`"archive."` のように末尾が `.` で終わる名前は空文字列 `Some ""` を返します。

| 入力パス | `Path.parent` | `Path.file_name` | `Path.extension` |
| --- | --- | --- | --- |
| `"a/b/c"` | `Some "a/b"` | `Some "c"` | `None` |
| `"/a"` | `Some "/"` | `Some "a"` | `None` |
| `"a/b/"` | `Some "a"` | `Some "b"` | `None` |
| `"a"` | `None` | `Some "a"` | `None` |
| `"/"`、`""` | `None` | `None` | `None` |
| `"."`、`".."` | `None` | `None` | `None` |
| `"a/.."` | `Some "a"` | `None` | `None` |
| `"backup.tar.gz"` | `None` | `Some "backup.tar.gz"` | `Some "gz"` |
| `".bashrc"` | `None` | `Some ".bashrc"` | `None` |
| `"archive."` | `None` | `Some "archive."` | `Some ""` |
| `"a/b.d/c"` | `Some "a/b.d"` | `Some "c"` | `None` |
| `"C:\dir\note.txt"` | `None` | `Some "C:\dir\note.txt"` | `Some "txt"` |

> **Windows パスに関する注意**: Windows の [`File`](./file.md) や [`Dir`](./dir.md) は `/` 区切りのパスもそのまま受け付けますが、[`Env.current_dir`](./env.md) などが返す OS 由来のパス文字列には `\` が使われます。`Path` はプラットフォームによらず決定論的に動作するため `\` を区切り文字として解釈しません。

## 引数の順序

標準ライブラリの設計規約（[標準ライブラリの規約](../conventions.md)）に従い、分解関数（`parent`・`file_name`・`extension`）は対象のパス文字列を最後の引数に取ります。`Path.join left right` は 2 つのパスを対象として左から右へ連結します。

## 公開 API

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Path.join` | `ref string -> ref string -> string` | 2 つのパス文字列を `/` で連結 |
| `Path.parent` | `ref string -> Maybe<string>` | 末尾セグメントを除いた親パスを取得 |
| `Path.file_name` | `ref string -> Maybe<string>` | 末尾のファイル名またはディレクトリ名を取得（`""`・`"/"`・`"."`・`".."` は `None`） |
| `Path.extension` | `ref string -> Maybe<string>` | ファイル名の最後の `.` より後ろの拡張子を取得 |

## 関連項目

- [File](./file.md)
- [Dir](./dir.md)
- [Env](./env.md)
- [Os](./os.md)
- [Maybe](../core/maybe.md)
- [標準ライブラリの規約](../conventions.md)
