# Monoid と Monoids

`Monoid` は、単位元（空の値）と結合的な二項演算を備える型を表す型クラスです。また `Monoids` モジュールは、整数や論理値に対する標準的なモノイドのラッパーレコード型群を提供します。モノイド則を満たし副作用を持たないインスタンスを用いることで、逐次畳み込み `Array.fold_monoid` と並列チャンク畳み込み `Parallel.fold` が**ビット単位で完全に同一の結果**を返すことが保証されます。

## 要点

- `class Monoid<'m>` は単位元 `empty :: unit -> 'm` と二項演算 `combine :: 'm -> 'm -> 'm` の2つを要求します。
- 満たすべきモノイド則は、**結合律**（`combine (combine a b) c == combine a (combine b c)`）、**左単位元**（`combine (empty ()) a == a`）、**右単位元**（`combine a (empty ()) == a`）の3つです（ビット単位での一致）。
- `Monoids` モジュールは `Sum`・`Product`・`MaxOf`・`MinOf`・`BitAnd`・`BitOr`・`BitXor`・`All`・`Any` の9種類のラッパー型を提供し、`Monoids.Sum` のようにモジュール修飾名で参照します。
- IEEE 754 浮動小数点数の加算・乗算は結合律を満たさないため、浮動小数点型を含む型で `Monoid` を使用するとコンパイルエラー `E1039` となります。
- コンパイラはユーザー定義インスタンスの代数的法則を自動証明しないため、独自インスタンスには `Gen` によるプロパティベーステストを作成することが推奨されます。

## `Monoid` 型クラス

```text
class Monoid<'m> {
    def empty :: unit -> 'm
    def combine :: 'm -> 'm -> 'm
}
```

| メソッド | シグネチャ | 説明 |
| --- | --- | --- |
| `Monoid.empty` | `unit -> 'm` | 畳み込みの初期値となる単位元を返す（`Monoid.empty ()` として呼び出す） |
| `Monoid.combine` | `'m -> 'm -> 'm` | 左右2つの値を結合して1つの値を返す（`Monoid.combine left right`） |

### 引数の順序

`Monoid.combine left right` は2つの引数がともに同格の対象であるため、二項演算の自然な左右順に受け取ります。`Monoid.empty` は対象をとらない構築操作であり、`Monoids` モジュールはレコード定義とインスタンス宣言のみで構成されます（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。

## `Monoids` の標準ラッパー型

数値型には加算と乗算のように複数のモノイド構造が存在するため、標準ライブラリでは演算の意味を明示する単一フィールドレコード（フィールド名はすべて `value`）を `Monoids` モジュールに定義しています。数値ラッパーはすべて `Integer<'a>` 制約を持ち、整数型のみを受け付けます。

| ラッパー型 | フィールド型 | 制約 | `empty ()` の値 | `combine left right` の動作 |
| --- | --- | --- | --- | --- |
| `Monoids.Sum<'a>` | `value: 'a` | `Integer<'a>, Numeric<'a>, Add<'a>, Copy<'a>` | `0` | `left.value + right.value`（2の補数ラップアラウンド加算） |
| `Monoids.Product<'a>` | `value: 'a` | `Integer<'a>, Numeric<'a>, Mul<'a>, Copy<'a>` | `1` | `left.value * right.value`（ラップアラウンド乗算） |
| `Monoids.MaxOf<'a>` | `value: Maybe<'a>` | `Integer<'a>, Ord<'a>, Copy<'a>` | `Maybe.None` | 大きい方の `Some` を保持（同値時は `left` を優先） |
| `Monoids.MinOf<'a>` | `value: Maybe<'a>` | `Integer<'a>, Ord<'a>, Copy<'a>` | `Maybe.None` | 小さい方の `Some` を保持（同値時は `left` を優先） |
| `Monoids.BitAnd<'a>` | `value: 'a` | `Integer<'a>, Numeric<'a>, Bits<'a>, Copy<'a>` | 全ビット `1`（`~~~0`） | `Bits.bit_and left.value right.value` |
| `Monoids.BitOr<'a>` | `value: 'a` | `Integer<'a>, Numeric<'a>, Bits<'a>, Copy<'a>` | `0` | `Bits.bit_or left.value right.value` |
| `Monoids.BitXor<'a>` | `value: 'a` | `Integer<'a>, Numeric<'a>, Bits<'a>, Copy<'a>` | `0` | `Bits.bit_xor left.value right.value` |
| `Monoids.All` | `value: bool` | なし | `true` | `left.value && right.value` |
| `Monoids.Any` | `value: bool` | なし | `false` | `left.value \|\| right.value` |

整数のラップアラウンド加算・乗算は法 $2^w$ の剰余環をなし厳密に結合的であるため、桁あふれが生じる入力であっても逐次と並列で完全に同じビット列が得られます。

```tsuzuri run=15%20true
let nums = [
    Monoids.Sum { value: 1 },
    Monoids.Sum { value: 2 },
    Monoids.Sum { value: 3 },
    Monoids.Sum { value: 4 },
    Monoids.Sum { value: 5 }
]
let flags = [Monoids.All { value: true }, Monoids.All { value: true }]
let sum = Parallel.fold nums
let all_ok = Array.fold_monoid flags
$"{sum.value} {all_ok.value}"
```

## 独自型の `Monoid` 実装と検証

### インスタンスの定義

複数の統計量（件数と合計など）を1パスで並列集計したい場合、レコード型を定義して `Monoid` インスタンスを実装します。引数なしメソッドの `empty` は、インスタンス内で `let empty = \() -> ...` の形式で定義します。

```tsuzuri run=3%2060%20true
record Summary { count: i64, total: i64 }

instance Monoid<Summary> {
    let empty = \() -> Summary { count: 0, total: 0 }
    fn combine left right =
        Summary {
            count: left.count + right.count,
            total: left.total + right.total,
        }
}

let items = [
    Summary { count: 1, total: 10 },
    Summary { count: 1, total: 20 },
    Summary { count: 1, total: 30 }
]
let seq_res = Array.fold_monoid items
let par_res = Parallel.fold items
let matched = seq_res.count == par_res.count && seq_res.total == par_res.total
$"{par_res.count} {par_res.total} {matched}"
```

### プロパティベーステストによる法則の検証

非可換なモノイド（アフィン変換の合成や文字列・リストの連結など）では、`left` と `right` の順序誤りがバグになりやすいため、[Gen](../testing/gen.md) を用いて結合律と左右単位元則を検証します。

```tsuzuri
record Affine { scale: i64, offset: i64 }

instance Display<Affine> {
    fn display a = $"Affine({a.scale}, {a.offset})"
}

instance Monoid<Affine> {
    let empty = \() -> Affine { scale: 1, offset: 0 }
    fn combine left right =
        Affine {
            scale: left.scale * right.scale,
            offset: left.offset * right.scale + right.offset,
        }
}

def eq_affine :: Affine -> Affine -> bool = \a b ->
    a.scale == b.scale && a.offset == b.offset

def gen_affine :: Gen<Affine>
fn gen_affine =
    Gen.pair (Gen.range (-20) 20) (Gen.range (-100) 100)
    |> Gen.map (\p -> match p with | (s, o) -> Affine { scale: s, offset: o })

test "Affine satisfies monoid laws" =
    let triples = Gen.pair (gen_affine()) (Gen.pair (gen_affine()) (gen_affine()))
    Gen.for_all_cases 100 triples (\t ->
        match t with
        | (a, (b, c)) ->
            let lhs = Monoid.combine (Monoid.combine a b) c
            let rhs = Monoid.combine a (Monoid.combine b c)
            let assoc = eq_affine lhs rhs
            let left_id = eq_affine (Monoid.combine (Monoid.empty ()) a) a
            let right_id = eq_affine (Monoid.combine a (Monoid.empty ())) a
            assoc && left_id && right_id)
```

## 浮動小数点型の制限（`E1039`）と純粋性

### 浮動小数点を含む型の拒否（`E1039`）

浮動小数点数（`f16`・`f32`・`f64`・`f128`）、10進浮動小数点数（`d32`・`d64`・`d128`）、浮動小数点レーンを持つ SIMD ベクトル、およびそれらをフィールド・要素・タプル・共用体ペイロードとして間接的に保持する型に対して `Monoid.combine`・`Array.fold_monoid`・`Parallel.fold` を呼び出すと、コンパイルエラー `E1039` が報告されます。

```text
record MeanAccum { sum: f64, count: i64 }
instance Monoid<MeanAccum> { ... }

// エラー E1039: MeanAccum は浮動小数点型 f64 を保持するため Monoid 畳み込みに使用できない
let r = Parallel.fold accum_array
```

浮動小数点配列の総和を求める場合は、チャンク分割規則により決定的な順序で総和を計算する `Parallel.sum`（[Parallel](../sync/parallel.md)）、または丸め誤差を抑える `Array.sum_pairwise` / `Array.sum_kahan`（[Array](../collections/array.md)）を使用します。厳密な結合律が必要な金額計算などでは、最小単位の整数（マイクロ単位など）による固定小数点表現を用います。

### 副作用と並列安全性レポート

`Parallel.fold` はチャンクごとに `Monoid.empty ()` を生成して部分畳み込みを行うため、`empty` や `combine` の呼び出し回数および評価順序は逐次の `Array.fold_monoid` とは異なります。これらのメソッドが出力・乱数・共有状態の書き換えなどの副作用を持つ場合、逐次との結果一致は保証されません。`tsuzuri check <PATH> --report parallel` を実行すると、各 `Parallel.fold` が呼び出す `Monoid` インスタンスの純粋性（`parallel_safe`）を静的に監査できます。

## 関連項目

- [Array](../collections/array.md)
- [Parallel](../sync/parallel.md)
- [Gen](../testing/gen.md)
- [Math](../numeric/math.md)
- [型クラスと制約](../../types/type-classes.md)
- [診断コード一覧](../../compiler/diagnostics.md)
