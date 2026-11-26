# Anchor

`Anchor<'a>` は、環境を捕捉できない C コールバック（[FnPtr](./fnptr.md) や `extern` 関数の静的コールバック引数）から、Tsuzuri 側のアプリケーション状態 `'a` へ型安全・メモリ安全にアクセスするための世代付きアンカーです。

状態をランタイムのスロットテーブルに登録して非ゼロの `i64` トークンを発行し、C 側の `void*` や `intptr_t`（Win32 の `GWLP_USERDATA` 等）を経由してコールバックへ受け渡します。`Anchor` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- `Anchor.create value` は `value` を現在の OS スレッドに紐づいたスロットテーブルへ格納し、生存期間を管理する所有ハンドル `Anchor<'a>` を返す。`Anchor<'a>` が `Drop` されるとスロットは即座に無効化され、世代番号により同じトークンが再利用されることはない。
- `Anchor.token (ref anchor)` は C の userdata にそのまま格納できる非ゼロの `i64` トークンを返す。
- コールバック内では `Anchor.read` で共有借用 `ref 'a` を読み取り、`Anchor.update` で状態 `'a` を新しい値に置き換える。
- 解放済みトークン、型不一致、別 OS スレッドからのアクセス、更新中の再入競合はいずれも未定義動作ではなく、`Result.Error`（`Anchor.Error`）として安全に返される。
- `Anchor<'a>` 自体は作成した OS スレッドに拘束され、`Copy`・`Capture`・`Send`・`Sync` のいずれも満たさない。一方、`Anchor.token` が返す `i64` は通常の整数値として自由に受け渡せる。

## 基本的な使い方

`Anchor.create` が返す `Anchor<'a>` をイベントループやスコープが生存する間保持し、C コールバック側には `Anchor.token` で取り出した `i64` トークンを渡します。`Anchor<'a>` がスコープを抜けて `Drop` された後は、残存するトークンを使ったアクセスは `Anchor.Error.Stale` となります。

```tsuzuri run=clicks%3D2%20after_drop%3Dstale%20anchor%20token
record UiState { clicks: i64 }

def handle_click :: i64 -> Result<unit, Anchor.Error> = \tok ->
    tok |> Anchor.update (\(state: UiState) -> UiState { clicks: state.clicks + 1 })

def run_window_loop :: unit -> (i64 * i64) = \() ->
    let anchor = Anchor.create (UiState { clicks: 0 })
    let tok = Anchor.token (ref anchor)
    let _ = handle_click tok
    let _ = handle_click tok
    let count =
        match tok |> Anchor.read (\(state: ref UiState) -> state.clicks) with
        | Result.Ok n -> n
        | Result.Error _ -> -1
    (count, tok)

def main :: unit -> i32 = \() ->
    let (count, stale_tok) = run_window_loop ()
    let after =
        match stale_tok |> Anchor.read (\(state: ref UiState) -> state.clicks) with
        | Result.Ok n -> $"{n}"
        | Result.Error err -> $"{err}"
    do! IO.writeln $"clicks={count} after_drop={after}"
    0
```

`i64` トークン自体は状態の型情報を持たないため、`Anchor.read` や `Anchor.update` に渡すラムダ引数や関数シグネチャで期待する状態の型（`\(state: ref UiState) -> ...` など）を明示します。実行時にアンカー登録時の型と一致しない型が指定された場合は `Result.Error Anchor.WrongType` が返ります。

## 借用・再入・OS スレッド拘束の規則

### 再入検査と `Anchor.Error`

同一トークンに対する共有読み取り（`Anchor.read` の中での入れ子の `Anchor.read`）は許可されます。一方、状態の一貫性を壊す以下の再入は実行時に検出され、`Result.Error Anchor.Busy` を返します。

- `Anchor.update` のコールバック実行中に、同一トークンに対して `Anchor.read` または `Anchor.update` を呼んだ場合
- `Anchor.read` のコールバック実行中に、同一トークンに対して `Anchor.update` を呼んだ場合

```tsuzuri run=nested_read%3D20%20reentrant_update%3Danchor%20value%20is%20already%20borrowed%20wrong_type%3Danchor%20token%20has%20a%20different%20value%20type
let anchor = Anchor.create 10i64
let tok = Anchor.token (ref anchor)

let nested_read =
    match tok |> Anchor.read (\(outer: ref i64) ->
        match tok |> Anchor.read (\(inner: ref i64) -> deref outer + deref inner) with
        | Result.Ok sum -> sum
        | Result.Error _ -> -1) with
    | Result.Ok sum -> sum
    | Result.Error _ -> -1

let reentrant_update =
    match tok |> Anchor.read (\(_outer: ref i64) ->
        match tok |> Anchor.update (\(x: i64) -> x + 1) with
        | Result.Ok _ -> "ok"
        | Result.Error err -> $"{err}") with
    | Result.Ok msg -> msg
    | Result.Error err -> $"{err}"

let wrong_type =
    match tok |> Anchor.read (\(s: ref string) -> s.length) with
    | Result.Ok n -> $"{n}"
    | Result.Error err -> $"{err}"

$"nested_read={nested_read} reentrant_update={reentrant_update} wrong_type={wrong_type}"
```

| エラーケース | `Display` 出力文字列 | 発生条件 |
| --- | --- | --- |
| `Anchor.Stale` | `stale anchor token` | トークンが `0`・未割り当て、または対応する `Anchor<'a>` がすでに `Drop` 済み |
| `Anchor.WrongType` | `anchor token has a different value type` | `Anchor.create` 時の型 `'a` と異なる型として `read` / `update` を呼び出した |
| `Anchor.WrongThread` | `anchor token belongs to another thread` | `Anchor.create` を実行した OS スレッドとは異なる OS スレッドから呼び出した |
| `Anchor.Busy` | `anchor value is already borrowed` | `update` 中の再入アクセス、または `read` 中の `update` 呼び出し |

### コンパイル時の借用検査と `tzroutine` 内でのスレッド固定

- **借用の持ち出し禁止**: `Anchor.read` のコールバックが受け取る `ref 'a` はその呼び出しの間だけ有効です。コールバックの戻り値にその借用を含めると `E1013` になります。
- **格納値の所有要件**: `Anchor.create` および `Anchor.update` に渡す状態 `'a` は、外部変数の借用を保持していてはなりません（`E1013`）。
- **`tzroutine` の自動スレッド固定**: `tzroutine` の内部で `Anchor.create` を呼び出すと、ランタイムはその `Anchor<'a>` が `Drop` されるまでの間、実行中の `tzroutine` を現在の OS スレッドに自動的に固定します。そのため事前に `Routine.with_locked_thread` で囲まなくてもスレッド移動による不整合は起きません。

## 引数の順序

- `Anchor.read` と `Anchor.update` は、操作対象であるトークン `i64` を**最後の引数**に取ります。これにより `tok |> Anchor.read (\s -> ...)` のようにパイプラインで記述できます。
- `Anchor.token` と `Anchor.create` は 1 引数関数です（[引数の順序](../conventions.md)）。

## API リファレンス

`Anchor` モジュールの公開型および全公開関数（標準ライブラリ定義関数 1 個＋コンパイラ組み込み関数 3 個）の一覧です。

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `Anchor<'a>` | 型（不透明ハンドル、`Drop` 実装） | スロットテーブル内の値 `'a` の寿命を管理する所有ハンドル |
| `Anchor.Error` | 共用体（`Eq`, `Display`） | `Stale \| WrongType \| WrongThread \| Busy` |
| `Anchor.create` | `'a -> Anchor<'a>` | 値を現在の OS スレッドのアンカー表に登録し、所有ハンドルを返す（組み込み） |
| `Anchor.token` | `ref Anchor<'a> -> i64` | アンカーが生存する間有効な非ゼロの `i64` トークンを返す |
| `Anchor.read` | `(ref 'a -> 'b) -> i64 -> Result<'b, Anchor.Error>` | トークンが指す値を共有借用してコールバックを実行し、結果を返す（組み込み） |
| `Anchor.update` | `('a -> 'a) -> i64 -> Result<unit, Anchor.Error>` | トークンが指す値をコールバックの戻り値で置き換える（組み込み） |

## 関連項目

- [FnPtr](./fnptr.md)
- [Routine](../sync/routine.md)
- [引数の順序](../conventions.md)
- [ネイティブ連携（C ABI）](../../compiler/native-interop.md)
