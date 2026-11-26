# タプル

タプルは、2 つ以上の値を順序によって 1 つの不変な値にまとめる構造的積型です。要素ごとに異なる型を組み合わせることができ、専用の型宣言を行わずに `T1 * T2` と表記します。関数から複数の計算結果を同時に返したい場合、`union` ペイロードへ複数の値を持たせたい場合、あるいは連想配列や集合の複合キーを作る場合に適しています。各要素の意味を名前で明示したいドメインデータには[レコード](records.md)を使用します。

## 要点

- **2要素以上の構造的型**: 型は `i64 * string`、値は `(42, "ok")` と記述します。0 要素の `()` は `unit` 型、1 要素の `(42)` は優先順位の丸括弧であり、1 要素タプルは存在しません。
- **パターン分解で要素を取得**: 不変 `let (x, y) = pair`、`match` 式、`for (k, v) in ...`、およびラムダ引数パターンで分解します。`pair.0` や `pair[0]` による添字アクセスは存在しません。
- **カリー化関数との区別**: `\(a, b) -> ...` はタプル 1 個を受け取る関数（`(A * B) -> C`）であり、カリー化された 2 引数関数 `\a b -> ...`（`A -> B -> C`）とは型が異なります。
- **自動成立する組み込み型クラス**: 構成要素が満たしていれば、`Copy`・`Eq`・`Ord`・`Hash`・`Display`・`Default`（全要素数）および JSON / CBOR 用の `Encode`・`Decode`（2〜4 要素）が `deriving` なしで自動的に成立します。

## タプル型と構築

タプル型は要素型を `*` で連結し、タプルリテラルはカンマ区切りの式を丸括弧 `(...)` で囲んで構築します。

```text
i64 * string              // 2要素タプル型
i64 * f64 * bool          // 3要素タプル型
(i64 -> i64) * string     // 関数型を含むタプル型（-> より * が強く結合するため括弧が必要）
```

要素式は左から右の順序で厳密に 1 回ずつ評価されます。

```tsuzuri run=42:ok
let pair: i64 * string = (42, "ok")
let (code, label) = pair
$"{code}:{label}"
```

- **0要素と1要素の扱い**: `()` は[Unit 型](overview.md)のリテラルであり、`(42)` は単なる式のグループ化（`i32` 型）です。型注釈で `i64 *` のように末尾に要素を欠いた記述を行うと構文エラー `E0002` になります。
- **メモリレイアウト**: タプルの要素は宣言した順序のまま値内にインライン配置されます（レコードのようなアライメント順の自動並べ替えは行われないため、`bool * i64 * bool` はパディングを含めて 24 バイトになります）。値単体のインラインサイズ上限（64 KiB、`E1010`）が適用されます。また、タプルは `export def` の C ABI 境界には直接渡せません（`E1008`）。

## パターン分解と要素の取り出し

### `let`・`match`・ラムダによる分解

タプルは単一コンストラクタの反駁不可能な構造であるため、不変 `let` 束縛、`match` 式、`for ... in` ループ、コンピュテーション式の `let!`、およびラムダ引数で直接分解できます（なお、`let mut` は単一識別子のみを受け付けます）。不要な要素はワイルドカード `_` で無視します。

```tsuzuri run=60
let triple = (10, 20, 30)
let (first, _, third) = triple

let nested = ((5, 15), 99)
let bonus = match nested with
    | ((a, b), _) -> a + b

first + third + bonus
```

### `pair.0` は使わず分解で取り出す規則

Tsuzuri には Rust の `pair.0` のような番号フィールド記法や、F# の `fst` / `snd` 組み込み関数、配列風の `pair[0]` 添字はありません。

- `pair.0` と記述すると、`.` の直後に識別子を期待する構文エラー **`E0002`**（`expected_identifier`）となり、コンパイラはパターンマッチで取り出す方法を案内するヒント（`help: read a tuple element by pattern matching, as in 'match pair with | (first, _) -> first'`）を表示します。
- `pair[0]` と記述すると、添字不可能型に対するエラー **`E1005`** になります。

要素数が増えて位置だけでは役割が分かりにくくなった場合は、タプルではなく名前付きフィールドを持つ[レコード](records.md)へ切り替える設計が推奨されます。

### タプル引数とカリー化引数の違い

ラムダ式の引数における `\a b -> a + b` と `\(a, b) -> a + b` は明確に異なる型を持ちます。

| 記法 | 関数の型 | 呼び出し方 |
| --- | --- | --- |
| `\a b -> a + b` | `i64 -> i64 -> i64`（カリー化 2 引数） | `f 20 22`（部分適用 `f 20` が可能） |
| `\(a, b) -> a + b` | `(i64 * i64) -> i64`（タプル 1 引数） | `f (20, 22)` |

タプル 1 引数の関数に対して `f 20 22` のように 2 つの引数を空白区切りで渡すと、過剰適用エラー `E1006` になります。

### 所有権と部分ムーブ

すべての要素型が `Copy` であればタプル全体も `Copy` になります。`string` や `Vec<T>` のような非 `Copy` 要素を含むタプルは非 `Copy` となり、パターン分解で非 `Copy` 要素を取り出すとその要素の所有権が移動します（部分ムーブ）。残りの `Copy` 要素は引き続き使用できますが、ムーブ済みの要素を含むタプル全体を再利用すると `E1012` エラーになります。

共有参照 `ref T` は `Copy` であるためタプルに格納して自由に返却・複製できます。排他参照 `ref mut T` はローカルスコープ内で一時的にタプルへまとめることはできますが、所有者の生存期間を超えて関数の外へ返却したり、レコードのフィールド型内のタプルに含めたりすることはできません（`E1013`）。

## 自動成立する型クラス

レコードや判別共用体とは異なり、タプルは要素型が対象の型クラスを満たしていれば `deriving` 宣言なしで以下の組み込み・標準インスタンスを自動的に満たします。

| 型クラス | 対象要素数 | 自動成立条件と動作仕様 |
| --- | --- | --- |
| `Copy` | 2 以上すべて | 全要素が `Copy` のとき成立 |
| `Send` / `Sync` / `Capture` | 2 以上すべて | 全要素がそれぞれ `Send` / `Sync` / `Capture` のとき成立 |
| `Eq`（`==`, `!=`） | 2 以上すべて | 全要素が `Eq` のとき成立。左の要素から順に比較し、最初の不一致で短絡終了（被演算子は共有借用されるため非 `Copy` タプルも消費しない） |
| `Ord`（`<`, `<=`, `>`, `>=`） | 2 以上すべて | 全要素が `Ord` のとき成立。左から右への辞書式順序（lexicographical order）で比較 |
| `Hash` | 2 以上すべて | 全要素が `Hash` のとき成立。64 bit FNV-1a で左から順にハッシュを混合 |
| `Display` | 2 以上すべて | 全要素が `Display` のとき成立。`(20, "order")` のように丸括弧とカンマ区切りで整形（内部の文字列は引用符付きエスケープ表記） |
| `Default` | 2 以上すべて | 全要素が `Default` のとき成立。各要素の `Default.default()` を組にした値を生成 |
| `Encode` / `Decode` | **2〜4 要素** | 全要素が `Encode` / `Decode` のとき成立。JSON および CBOR において要素数と一致する配列 `[e0, e1, ...]` として直列化・復元（5 要素以上は `E1005`） |

```tsuzuri run=%2820%2C%20%22order%22%29%20true%20%5B7%2C%22ok%22%2Ctrue%5D
let left = (20, "order")
let right = (20, "order")
let fallback: i64 * bool = Default.default()
assert (left == right)
assert ((1, 99) < (2, 0))
assert (Hash.hash (ref left) == Hash.hash (ref right))
assert (fallback == (0, false))

let json_bytes = Json.serialize (ref (7, "ok", true)) |> Result.get
let restored: (i64 * string * bool) = Json.deserialize (ref json_bytes) |> Result.get
$"{Display.display (ref left)} {restored == (7, "ok", true)} {String.from_utf8 (ref json_bytes)}"
```

## 複数戻り値や複合キーとしての活用

### 複数戻り値の返却

商と余り、最小値と最大値、あるいは更新後の状態と出力値など、密接に関連する複数の値を 1 回の関数呼び出しから返す際にタプルを用います。

```tsuzuri run=3:2
def div_rem :: i64 -> i64 -> (i64 * i64) = \dividend divisor ->
    (dividend / divisor, dividend % divisor)

let (quotient, remainder) = div_rem 17 5
$"{quotient}:{remainder}"
```

### `Map`・`HashMap` の複合キー

タプルには辞書式順序の `Ord` と構造的な `Eq` + `Hash` が自動で備わるため、複数の軸を組み合わせた座標や年月のペアなどをそのまま [`Map`](../stdlib/collections/map.md)・[`Set`](../stdlib/collections/set.md)・[`HashMap`](../stdlib/collections/hashmap.md)・[`HashSet`](../stdlib/collections/hashset.md) のキーとして使用できます。

```tsuzuri run=300:2
let grid_hash =
    HashMap.empty()
    |> HashMap.insert (0, 0) 100
    |> HashMap.insert (1, 2) 200

let ordered =
    Set.empty()
    |> Set.insert (2028, 11)
    |> Set.insert (2028, 3)
    |> Set.insert (2028, 11)

let v1 = Maybe.default_value 0 (HashMap.get (0, 0) (ref grid_hash))
let v2 = Maybe.default_value 0 (HashMap.get (1, 2) (ref grid_hash))
$"{v1 + v2}:{Set.length (ref ordered)}"
```

## 関連項目

- [型システムの概要](overview.md)
- [レコード](records.md)
- [判別共用体](unions.md)
- [パターンマッチング](../expressions/pattern-matching.md)
- [ラムダ式](../expressions/lambdas.md)
- [Map](../stdlib/collections/map.md)
- [HashMap](../stdlib/collections/hashmap.md)
- [Json](../stdlib/encoding/json.md)
