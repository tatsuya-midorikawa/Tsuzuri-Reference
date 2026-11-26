# Result

`Result<'a, 'e>` は、計算の成功値（`Ok`）と失敗の原因（`Error`）を1つの型で表現する標準ライブラリの判別共用体です。構文解析、入力検証、I/O エラー、並列ジョブの部分失敗など、呼び出し側で検査・回復すべきエラー処理に使用します。失敗の理由が不要な場合は [Maybe](./maybe.md) を使用します。

## 要点

- 型定義は `union Result<'a, 'e> = Ok of 'a | Error of 'e` で、インポートなしで `Ok`・`Error`（または `Result.Ok`・`Result.Error`）を使用できます。
- 変換・連鎖関数（`map`、`map_error`、`bind`、`or_else` など）はすべて `Result` を最後の引数にとります。
- コンピュテーション式 `Result { let! ... return ... }` により、最初の `Error` で後続処理を短絡するエラー伝播を簡潔に記述できます。
- 借用版の `map_ref` と `bind_ref` は、エラー時にエラー値を複製して返すため `Copy<'e>` 制約を要求します。
- ゼロ除算や境界外添字などの言語トラップは自動で `Error` にはなりません。`@checked` 算術オーバーフローのみ、`try ... with` 式で捕捉して `Result` に変換できます。

## 型定義と基本操作

```text
union Result<'a, 'e> =
    | Ok of 'a
    | Error of 'e
```

成功型 `'a` と失敗型 `'e` は互いに独立した型パラメータです。`Ok 42` だけでは `'e` が、`Error "bad"` だけでは `'a` が未確定となるため、文脈から推論できない場合は型注釈を付与します（未推論のまま残ると `E1015`）。

```tsuzuri run=42
let answer: Result<i64, string> = Ok 42
match answer with
| Ok value -> value
| Error _ -> 0
```

## 引数の順序

コンピュテーション式用のビルダー操作（大文字始まりの関数）を除き、`Result` モジュールのすべての関数は操作対象の `Result<'a, 'e>`（`of_maybe` では変換元の `Maybe<'a>`）を**最後の引数**にとります（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。

```tsuzuri run=60%200
let positive = \n -> if n > 0 then Ok n else Error "not positive"
let halve = \n -> if n % 2 == 0 then Ok (n / 2) else Error "odd"
let pipeline = Result.bind positive >> Result.bind halve

let a = Ok 12 |> pipeline |> Result.map (\n -> n * 10)
let b = Ok 7 |> pipeline |> Result.or_else (\() -> Ok 0)
$"{Result.default_value (-1) a} {Result.default_value (-1) b}"
```

## コンピュテーション式 `Result { ... }`

`std/Result.tc` のビルダーにより、`let!` で `Ok` の値を取り出し、`Error` が発生した時点で残りの計算をスキップできます。ブロック内のすべての `let!` / `do!` は同一のエラー型 `'e` を共有します。エラー型が異なる場合は `Result.map_error` で揃えてから束縛します。

```tsuzuri run=42%20stop
def fail_never :: i64 -> Result<i64, string> = \_ -> unreachable ()

let ok_sum: Result<i64, string> = Result {
    let! first = Ok 20
    let! second = Ok 22
    return first + second
}

let failed: Result<i64, string> = Error "stop"
let halted: Result<i64, string> = Result {
    let! _ = failed
    let! rest = fail_never 1
    return rest
}

let msg = match halted with | Ok _ -> "ok" | Error e -> e
$"{Result.default_value 0 ok_sum} {msg}"
```

### `and!` による複数入力の結合

`let! ... and! ...` は複数の `Result` を左から右へ順番にすべて評価した上で結合します。スレッドの並列起動は行わず、左辺が `Error` であっても右辺の式自体は評価されます。複数の入力が `Error` になった場合は、最も左にある `Error` が優先して保持されます。

```tsuzuri run=left%2042
let both_err: Result<i64, string> = Result {
    let! a = Error "left"
    and! b = Error "right"
    return a + b
}

let both_ok: Result<i64, string> = Result {
    let! a = Ok 20
    and! b = Ok 22
    return a + b
}

let tag = match both_err with | Ok _ -> "ok" | Error e -> e
$"{tag} {Result.default_value 0 both_ok}"
```

## 公開関数一覧（全26関数）

### 状態判定と値の取り出し

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Result.is_ok` | `ref (Result<'a, 'e>) -> bool` | `Ok` であれば `true` を返す（共有借用） |
| `Result.is_error` | `ref (Result<'a, 'e>) -> bool` | `Error` であれば `true` を返す（共有借用） |
| `Result.get` | `own Result<'a, 'e> -> 'a` | 所有値を消費して `Ok` の中身を返す。`Error` の場合はトラップする |
| `Result.get_error` | `own Result<'a, 'e> -> 'e` | 所有値を消費して `Error` の中身を返す。`Ok` の場合はトラップする |
| `Result.default_value` | `own 'a -> own Result<'a, 'e> -> 'a` | `Ok` なら成功値を、`Error` なら事前評価済みの `fallback` を返す |
| `Result.default_with` | `own (unit -> 'a) -> own Result<'a, 'e> -> 'a` | `Ok` なら成功値を、`Error` のときのみ `fallback ()` を呼び出して返す |

### 変換・エラー変換・連鎖

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Result.map` | `own ('a -> 'b) -> own Result<'a, 'e> -> Result<'b, 'e>` | `Ok` の成功値を消費して変換する。`Error` はそのまま通す |
| `Result.map_ref` | `Copy<'e> => own (ref 'a -> 'b) -> ref (Result<'a, 'e>) -> Result<'b, 'e>` | 元の `Result` を消費せず成功値を共有借用して変換する（`Error` 時はエラー値をコピー） |
| `Result.map_error` | `own ('e -> 'f) -> own Result<'a, 'e> -> Result<'a, 'f>` | `Error` の失敗値のみを変換する。`Ok` はそのまま通す |
| `Result.bind` | `own ('a -> Result<'b, 'e>) -> own Result<'a, 'e> -> Result<'b, 'e>` | `Ok` の成功値を次の `Result` を返す関数へ渡す。`Error` では呼ばない |
| `Result.bind_ref` | `Copy<'e> => own (ref 'a -> Result<'b, 'e>) -> ref (Result<'a, 'e>) -> Result<'b, 'e>` | 成功値を共有借用したまま次の `Result` を生成する（`Error` 時はエラー値をコピー） |
| `Result.or_else` | `own (unit -> Result<'a, 'e>) -> own Result<'a, 'e> -> Result<'a, 'e>` | `Ok` ならそのまま返し、`Error` のときのみ代替関数を呼び出す |

`map_ref` と `bind_ref` ではエラー型 `'e` が `Copy` である必要があります。エラー型が `string` のような非 `Copy` 型である場合にこれらを呼ぶと `E1005` となります。

```tsuzuri run=5%20code-404
let item: Result<string, i64> = Ok "order"
let len = Result.map_ref (\s -> s.length) item
let mapped: Result<i64, string> = Result.map_error (\code -> $"code-{code}") (Error 404)
let err_text = match mapped with | Ok _ -> "ok" | Error e -> e
$"{Result.get len} {err_text}"
```

### `Maybe` との相互変換

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Result.to_maybe` | `own Result<'a, 'e> -> Maybe<'a>` | `Ok v` を `Maybe.Some v` に、`Error _` をエラー値を破棄して `Maybe.None` に変換する |
| `Result.of_maybe` | `own 'e -> own Maybe<'a> -> Result<'a, 'e>` | `Maybe.Some v` を `Ok v` に、`Maybe.None` を `Error error` に変換する |

### コンピュテーション式ビルダー操作

以下の12関数は `Result { ... }` の展開先プロトコルであり、通常の公開関数としても呼び出せます（`Zero` の呼び出しは `Result.Zero()` と括弧を密着させます）。

| 関数 | シグネチャ | コンピュテーション式での役割 |
| --- | --- | --- |
| `Result.Return` | `own 'a -> Result<'a, 'e>` | `return expr` の展開先（`Ok expr`） |
| `Result.ReturnFrom` | `own Result<'a, 'e> -> Result<'a, 'e>` | `return! expr` の展開先（恒等変換） |
| `Result.Bind` | `own Result<'a, 'e> -> own ('a -> Result<'b, 'e>) -> Result<'b, 'e>` | `let!` および `do!` の展開先 |
| `Result.BindReturn` | `own Result<'a, 'e> -> own ('a -> 'b) -> Result<'b, 'e>` | 末尾が `return` のみの単一 `let!` の最適化展開先 |
| `Result.Bind2` | `own Result<'a, 'e> -> own Result<'b, 'e> -> own ('a -> 'b -> 'c) -> Result<'c, 'e>` | 2要素の `let! ... and! ...` と末尾 `return` の最適化展開先 |
| `Result.MergeSources` | `own Result<'a, 'e> -> own Result<'b, 'e> -> Result<('a * 'b), 'e>` | 一般の `and!` 結合の展開先（双方 `Error` なら左を保持） |
| `Result.Zero` | `Result<unit, 'e>` | 空ブロックの単位元（`Ok ()`） |
| `Result.Delay` | `own (unit -> Result<'a, 'e>) -> (unit -> Result<'a, 'e>)` | 後続ブロックの遅延化 |
| `Result.Run` | `own (unit -> Result<'a, 'e>) -> Result<'a, 'e>` | 遅延化された本体の実行 |
| `Result.Combine` | `own Result<unit, 'e> -> own (unit -> Result<'a, 'e>) -> Result<'a, 'e>` | 逐次文の連結（前半が `Error` なら後半を実行しない） |
| `Result.For` | `Copy<'a> => own ['a] -> own ('a -> Result<unit, 'e>) -> Result<unit, 'e>` | `for ... in` ループの展開先（要素型は `Copy` が必須） |
| `Result.While` | `own (unit -> bool) -> own (unit -> Result<unit, 'e>) -> Result<unit, 'e>` | `while` ループの展開先 |

## `try ... with` と並列処理における `Result`

### 検査付き算術と `Err` 型クラス

`try ... with` 式はコンピュテーション式とは独立した言語構文で、`@checked` 整数演算が送出する `OverflowException` を捕捉して直接 `Result` を生成します。ハンドラが返す型は組み込み型クラス `Err`（[Exception](./exception.md)）を実装している必要があります。

```tsuzuri run=overflow
def checked_mul :: i32 -> i32 -> Result<i32, Exception> = \x y ->
    try
        @checked x * y
    with
    | e is OverflowException -> e

match checked_mul 65536 65536 with
| Ok v -> to_string (v as i64)
| Error _ -> "overflow"
```

### 並列処理でのエラー集約

並列ジョブの失敗を `Result` で扱う手法には次の2通りがあります。

- **全件実行して入力順で決定的に検査**: [Parallel](../sync/parallel.md) の `Parallel.init` や `Parallel.map` で `[Result<'a, 'e>]` を構築します。残りのチャンクは停止しませんが、最小インデックスの `Error` を決定的に取得できます。
- **最初の失敗でグループ全体をキャンセル**: [ErrGroup](../sync/errgroup.md) を用いると、いずれかの tzroutine が `Error` を返した時点でグループの `Context` がキャンセルされ、最初に完了した `Error` が `ErrGroup.wait` から返ります。

```tsuzuri run=total%3D10%20first_err%3D2
def step :: i64 -> Result<i64, i64> = \i ->
    if i >= 2 then Error i else Ok (i * 10)

let outcomes = Parallel.init 4 (\i -> step i)
let mut total = 0i64
let mut first_err = -1i64
for item in outcomes do
    match item with
    | Ok v -> total = total + v
    | Error idx -> if first_err < 0 then first_err = idx
$"total={total} first_err={first_err}"
```

## 所有権・FFI・境界条件

- **所有権の移動**: 所有版の関数は `Result` を消費し、`Ok` または `Error` のペイロードをムーブします。共有参照 `Result<ref i64, i64>` を持つことは可能ですが、排他参照をペイロードに格納することはできません。
- **ホスト境界**: 判別共用体であるため、`export def` のシグネチャに `Result` を直接含めることはできません（`E1008`）。
- **トラップ条件**: `Result.get` を `Error` に対して呼ぶか、`Result.get_error` を `Ok` に対して呼ぶと `unreachable ()` によりトラップします。

## 関連項目

- [Maybe](./maybe.md)
- [Exception](./exception.md)
- [Domain](./domain.md)
- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [エラー処理と try 式](../../expressions/error-handling.md)
- [コンピュテーション式](../../expressions/computation-expressions.md)
- [Parallel](../sync/parallel.md)
- [ErrGroup](../sync/errgroup.md)
