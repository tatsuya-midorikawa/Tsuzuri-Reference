# ZString

`ZString` は、内部に `U+0000` を一切含まず、末尾に NUL コード単位（`U+0000`）が付与されていることが保証された UTF-16 文字列を表す opt-in 標準モジュールです。Win32 のワイド文字 API（`LPCWSTR` / `const wchar_t *`）など、長さを別引数で渡さず NUL 終端の 16 ビットコード単位ポインタを要求するネイティブ C ABI 関数へ、呼び出し時の再確保や一時変換なしで安全に文字列を渡すために用います。

ネイティブ C 関数との境界仕様全般については[ネイティブ連携（C ABI）](../../compiler/native-interop.md)を参照してください。

## 要点

- コンパイル時形式 `ZString.literal "..."` は文字列リテラルを静的な NUL 終端 UTF-16 配列へ展開し、ヒープ確保なしで `ref ZString` を返します。リテラル途中に `\0`（`\u{0}`）が含まれる場合はコンパイルエラー `E1005`（`zstring_literal_interior_nul`）となります。
- 実行時の `string` からは `ZString.of` で `Result<ZString, ZString.Error>` を構築します。途中に `U+0000` が存在する場合は最初のコード単位位置を保持する `ZString.InteriorNul index` が返されます。
- ネイティブの `extern def` 引数では、`ref ZString` が非 `NULL` の `const uint16_t *`、`Maybe<ref ZString>` が `NULL` 許容の `const uint16_t *`（`Maybe.None` が `NULL`）に ABI マッピングされます。
- コンパクト文字列モード（`TSUZURI_STRINGS=compact`）が有効なビルドでも、`ZString` の内部表現は常に 16 ビット幅の NUL 終端バッファであるため、FFI 境界での拡幅コピーは一切発生しません。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、`ZString.of` と `ZString.to_string` はどちらも変換元の文字列参照 1 つを引数に取り、`"hello" |> ZString.of` のようにパイプラインで渡せます。なお `ZString.literal "..."` は文字列リテラルを直接取る特別なコンパイル時構文であり、高階関数へ関数値として渡したりパイプラインの右辺に置いたりはできません。

## 型と公開関数一覧（全 2 関数 + コンパイル時リテラル構文）

### データ型

```text
record ZString                           // 不透明な NUL 終端 UTF-16 文字列（非 Copy）
union Error = InteriorNul of i64         // Eq, Display を実装
```

`ZString` の内部フィールドはモジュール外からは直接構築・参照できません（ユーザーモジュール名としての `ZString` も予約されており、同名定義は `E1011` となります）。

### 公開 API 一覧

| 関数 / 構文 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `ZString.literal` | `string -> ref ZString`（リテラル専用） | 内部 NUL でコンパイル時 `E1005` | $O(1)$ | 静的領域の NUL 終端 UTF-16 データを指す共有参照を返す |
| `ZString.of` | `ref string -> Result<ZString, ZString.Error>` | 内部 NUL で `Error (InteriorNul i)` | $O(n)$ | `text` を検証し、末尾 NUL を付加した所有 `ZString` を構築 |
| `ZString.to_string` | `ref ZString -> string` | なし | $O(n)$ | 末尾 NUL を除いたコード単位列から通常の所有 `string` を生成 |

`InteriorNul` が保持するオフセット `i` は 0 始まりの UTF-16 コード単位位置です（サロゲートペアの絵文字は 2 コード単位として数えられます）。

```tsuzuri run=lit%3DTsuzuri%20dyn%3DHello%2C%20%E4%B8%96%E7%95%8C%20bad_at%3D2
let lit = ZString.literal "Tsuzuri"
let dyn_round = match "Hello, 世界" |> ZString.of with
    | Result.Ok z -> ZString.to_string (ref z)
    | Result.Error _ -> "?"
let bad_at = match "ab\0cd" |> ZString.of with
    | Result.Ok _ -> -1
    | Result.Error (ZString.InteriorNul idx) -> idx
$"lit={ZString.to_string lit} dyn={dyn_round} bad_at={bad_at}"
```

## ネイティブ `extern def` での利用

ネイティブターゲットの `extern def` の仮引数型として `ref ZString` および `Maybe<ref ZString>` を指定できます。所有型の `ZString` をそのまま値渡し・戻り値にすることや、`export def`・WebAssembly ターゲットの `extern` で使用することは許可されません（`E1008`）。

```tsuzuri
extern type copy Hwnd

@trusted
extern "SetWindowTextW" def set_window_text :: Hwnd -> Maybe<ref ZString> -> i32

def clear_title :: Hwnd -> i32
fn clear_title hwnd =
    set_window_text hwnd Maybe.None

def set_static_title :: Hwnd -> i32
fn set_static_title hwnd =
    set_window_text hwnd (Maybe.Some (ZString.literal "Untitled"))

def set_dynamic_title :: Hwnd -> ref string -> Result<i32, ZString.Error>
fn set_dynamic_title hwnd title =
    match ZString.of title with
    | Result.Ok z -> Result.Ok (set_window_text hwnd (Maybe.Some (ref z)))
    | Result.Error err -> Result.Error err
```

`ZString.literal` が返す `ref ZString` はプログラム全体の生存期間を持つ静的データへの参照であるため、関数の戻り値にしたり `Maybe.Some` に包んだりしてもダングリング参照になりません。一方、`ZString.of` で構築した局所変数 `z` を渡す際は、`extern` 呼び出しが完了するまで `z` がスコープ内で生存し、スコープ終了時に自動解放されます。

## 関連項目

- [String](string.md)
- [文字列](../../syntax/strings.md)
- [ネイティブ連携（C ABI）](../../compiler/native-interop.md)
- [Result](../core/result.md)
- [標準ライブラリの設計規約](../conventions.md)
