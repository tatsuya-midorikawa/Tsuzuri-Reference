# Maybe

`Maybe<'a>` は、値が存在する状態（`Some`）と不在である状態（`None`）を型レベルで表現する標準ライブラリの判別共用体です。検索の不一致、省略可能な設定値、ストリームの終端など、不在の理由を保持する必要がない場面で使用します。失敗の原因を呼び出し元へ伝える必要がある場合は [Result](./result.md) を使用します。

## 要点

- 型定義は `union Maybe<'a> = None | Some of 'a` であり、インポートなしで `Some`・`None`（または修飾名 `Maybe.Some`・`Maybe.None`）を使用できます（`Option` という型名は存在せず `E1004` となります）。
- 変換・連結関数（`map`、`bind`、`filter` など）はすべて `Maybe` を最後の引数にとり、`None` の場合はコールバックを実行せずに短絡します。
- 所有権を消費せずに中身を参照する借用版ツイン（`map_ref`、`bind_ref`）を備えています。
- コンピュテーション式 `Maybe { let! ... return ... }` により、複数のオプション値を扱う処理を平坦に記述できます。
- `Maybe.get` は `None` に対して回復不能なトラップを発生させます。通常の分岐にはパターンマッチまたは `default_value` / `default_with` を使用します。

## 型定義と基本操作

```text
union Maybe<'a> =
    | None
    | Some of 'a
```

自モジュール内で同名のケースを定義している場合はそちらが優先されるため、`Maybe.Some` や `std::Maybe.None` のようにモジュール名を修飾して参照します。

```tsuzuri run=42
let parsed = Some 42
match parsed with
| Some value -> value
| None -> 0
```

`None` 単独では要素型 `'a` が決まらないため、文脈から型が推論できない場合は `E1015` となります。`let missing: Maybe<i64> = None` のように型注釈を添えるか、`Maybe.default_value 0 None` のように型が確定する関数へ渡します。

### パターンマッチと所有権

`match` 式では `Some` と `None` の双方を網羅する必要があります（網羅性違反は `E1021`）。所有する `Maybe<'a>` に対してパターンマッチを行い、非 `Copy` 型の中身を値として束縛すると、元の `Maybe` から所有権がムーブされます。

```tsuzuri run=42
let found = Some "answer"
let missing: Maybe<string> = None
let a = match found with
    | Some text -> text.length
    | None -> 0
let b = match missing with
    | Some text -> text.length
    | None -> 36
a + b
```

## 引数の順序

コンピュテーション式用のビルダー操作（大文字始まりの関数）を除き、`Maybe` モジュールのすべての関数は操作対象の `Maybe<'a>` を**最後の引数**にとります（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。これにより、パイプライン `|>` や関数合成 `>>` で処理を直列につなげられます。

```tsuzuri run=30%200
let halve = \n -> if n % 2 == 0 then Some (n / 2) else None
let quarter = Maybe.bind halve >> Maybe.bind halve
let a = Some 12 |> quarter |> Maybe.map (\n -> n * 10)
let b = Some 6 |> quarter |> Maybe.or_else (\() -> Some 0)
$"{Maybe.default_value (-1) a} {Maybe.default_value (-1) b}"
```

## コンピュテーション式 `Maybe { ... }`

`std/Maybe.tc` は `Maybe` ビルダーを提供しており、`let!`・`and!`・`do!`・`match!`・`for`・`while`・`return`・`return!` を使用できます。途中の束縛が `None` になった時点で後続の継続はスキップされ、ブロック全体の結果が `None` になります。

```tsuzuri run=42
let total = Maybe {
    let! left = Some 20
    and! right = Some 22
    return left + right
}
Maybe.default_value 0 total
```

- **`return expr`**: 関数からの早期脱出ではなく、`Some expr` を生成する式です。
- **`and!`**: 直前の `let!` とグループ化し、複数の `Maybe` を左から右へすべて評価した後に結合します（並列実行ではなく、左辺が `None` でも右辺の式自体は評価されます）。
- **`match! expr with ...`**: `expr` の中身を `Bind` で取り出した値に対してパターンマッチを行います。
- **`for x in arr do ...`**: `Copy<'a>` を満たす配列 `['a]` の要素を順に走査し、`None` が返った時点で反復を打ち切ります（非 `Copy` 配列は `E1005`）。`for` や `while` の本体はクロージャとなるため、外側の `let mut` 変数を書き換えると `E1014` になります。

```tsuzuri run=stopped
let checked = Maybe {
    for n in [2, -1, 4] do
        do! if n >= 0 then Some () else None
    return "ok"
}
Maybe.default_value "stopped" checked
```

## 公開関数一覧（全25関数）

### 状態判定と値の取り出し

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Maybe.is_some` | `ref (Maybe<'a>) -> bool` | `Some` であれば `true` を返す（共有借用） |
| `Maybe.is_none` | `ref (Maybe<'a>) -> bool` | `None` であれば `true` を返す（共有借用） |
| `Maybe.get` | `own Maybe<'a> -> 'a` | 所有値を消費して `Some` の中身を返す。`None` の場合はトラップする |
| `Maybe.default_value` | `own 'a -> own Maybe<'a> -> 'a` | `Some` なら中身を、`None` なら事前評価済みの既定値 `fallback` を返す |
| `Maybe.default_with` | `own (unit -> 'a) -> own Maybe<'a> -> 'a` | `Some` なら中身を、`None` のときのみ `fallback ()` を呼び出してその結果を返す |

`default_value` の第1引数は正格評価されるため、構築コストが高い既定値や副作用・トラップを伴う式には遅延評価版の `default_with` を使用します。

```tsuzuri run=true%2042
let missing: Maybe<i64> = None
let fallback = Maybe.default_with (\() -> 40 + 2) missing
$"{Maybe.is_none missing} {fallback}"
```

### 変換・フィルタ・連鎖

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Maybe.map` | `own ('a -> 'b) -> own Maybe<'a> -> Maybe<'b>` | `Some` の中身を消費して関数で変換する。`None` はそのまま返す |
| `Maybe.map_ref` | `own (ref 'a -> 'b) -> ref (Maybe<'a>) -> Maybe<'b>` | 元の `Maybe` と中身を共有借用したまま変換し、新しい `Maybe<'b>` を返す |
| `Maybe.bind` | `own ('a -> Maybe<'b>) -> own Maybe<'a> -> Maybe<'b>` | `Some` の中身を次の `Maybe` を返す関数へ渡す。`None` では関数を呼ばない |
| `Maybe.bind_ref` | `own (ref 'a -> Maybe<'b>) -> ref (Maybe<'a>) -> Maybe<'b>` | 元の `Maybe` と中身を共有借用したまま、次の `Maybe<'b>` を返す関数へ渡す |
| `Maybe.filter` | `own (ref 'a -> bool) -> own Maybe<'a> -> Maybe<'a>` | 中身の共有借用に対して述語が `true` を返せば `Some` を維持し、`false` なら `None` にする |
| `Maybe.or_else` | `own (unit -> Maybe<'a>) -> own Maybe<'a> -> Maybe<'a>` | `Some` ならそのまま返し、`None` のときのみ代替関数を呼び出す |

`map_ref` と `bind_ref` を用いると、`string` や配列などの非 `Copy` 値を `Maybe` 内に保持したまま属性や派生値を取り出せます。

```tsuzuri run=7%20tsuzuri
let word = Some "tsuzuri"
let len = Maybe.map_ref (\s -> s.length) word
let kept = Maybe.filter (\n -> deref n >= 5) len
$"{Maybe.default_value 0 kept} {Maybe.get word}"
```

### `Result` との相互変換

Tsuzuri には暗黙の型変換がないため、`Result` との行き来は以下の関数で明示します。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Maybe.to_result` | `own 'e -> own Maybe<'a> -> Result<'a, 'e>` | `Some v` を `Result.Ok v` に、`None` を `Result.Error error` に変換する |
| `Maybe.of_result` | `own Result<'a, 'e> -> Maybe<'a>` | `Result.Ok v` を `Some v` に、`Result.Error _` をエラー値を破棄して `None` に変換する |

```tsuzuri run=missing%205
let none_val: Maybe<i64> = None
let err_msg = match Maybe.to_result "missing" none_val with
    | Result.Ok _ -> "ok"
    | Result.Error msg -> msg
let ok_val: Result<i64, string> = Result.Ok 5
$"{err_msg} {Maybe.default_value 0 (Maybe.of_result ok_val)}"
```

### コンピュテーション式ビルダー操作

以下の12関数は `Maybe { ... }` の脱糖先としてコンパイラが呼び出すプロトコル関数ですが、通常の公開関数としても呼び出し可能です。引数なしの `Zero` を値として得る際は `Maybe.Zero()` のように空白を入れずに記述します（空白を入れると `unit` 引数渡しと解釈され `E1006` になります）。

| 関数 | シグネチャ | コンピュテーション式での役割 |
| --- | --- | --- |
| `Maybe.Return` | `own 'a -> Maybe<'a>` | `return expr` の展開先（`Some expr`） |
| `Maybe.ReturnFrom` | `own Maybe<'a> -> Maybe<'a>` | `return! expr` の展開先（恒等変換） |
| `Maybe.Bind` | `own Maybe<'a> -> own ('a -> Maybe<'b>) -> Maybe<'b>` | `let!` および `do!` の展開先 |
| `Maybe.BindReturn` | `own Maybe<'a> -> own ('a -> 'b) -> Maybe<'b>` | 末尾が `return` のみの単一 `let!` の最適化展開先 |
| `Maybe.Bind2` | `own Maybe<'a> -> own Maybe<'b> -> own ('a -> 'b -> 'c) -> Maybe<'c>` | 2要素の `let! ... and! ...` と末尾 `return` の最適化展開先 |
| `Maybe.MergeSources` | `own Maybe<'a> -> own Maybe<'b> -> Maybe<('a * 'b)>` | 一般の `and!` 結合の展開先（双方 `Some` のときのみタプル化） |
| `Maybe.Zero` | `Maybe<unit>` | `else` 省略時や空ブロックの単位元（`Some ()`） |
| `Maybe.Delay` | `own (unit -> Maybe<'a>) -> (unit -> Maybe<'a>)` | 後続ブロックの遅延化 |
| `Maybe.Run` | `own (unit -> Maybe<'a>) -> Maybe<'a>` | 遅延化された本体の実行 |
| `Maybe.Combine` | `own Maybe<unit> -> own (unit -> Maybe<'a>) -> Maybe<'a>` | 逐次文の連結（前半が `None` なら後半を実行しない） |
| `Maybe.For` | `Copy<'a> => own ['a] -> own ('a -> Maybe<unit>) -> Maybe<unit>` | `for ... in` ループの展開先 |
| `Maybe.While` | `own (unit -> bool) -> own (unit -> Maybe<unit>) -> Maybe<unit>` | `while` ループの展開先 |

## 所有権・FFI・境界条件

- **参照の格納**: `Maybe<ref string>` のように共有参照を要素型に持つことができ、その生存期間は借用元の所有者に結び付けられます。排他参照（`ref mut T`）を `Maybe` の要素型にすることはできません。
- **ホスト境界と C ABI の NULL 最適化**: 判別共用体であるため、一般の `Maybe<'a>` を `export def` の引数・戻り値に使うことはできません（`E1008`）。ただしネイティブターゲットの `extern def` および静的コールバックに限り、非 Null 不変条件を持つ不透明ハンドル `H` やスカラーレコード参照 `ref R` を包んだ `Maybe<H>`・`Maybe<ref H>`・`Maybe<ref R>` はタグなしの単一ポインタ（8バイト、`None` が C の `NULL` に対応）として直接受け渡しできます（WebAssembly ターゲットでは `E1008`）。
- **トラップ条件**: `Maybe.get` に `None` を渡すと `unreachable ()` により即座にトラップします。このトラップは `try ... with` では捕捉できません。

## 関連項目

- [Result](./result.md)
- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [判別共用体](../../types/unions.md)
- [パターンマッチ](../../expressions/pattern-matching.md)
- [コンピュテーション式](../../expressions/computation-expressions.md)
- [借用と参照](../../ownership/borrowing.md)
- [ネイティブ連携（FFI）](../../compiler/native-interop.md)
