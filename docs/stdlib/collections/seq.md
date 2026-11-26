# Seq

`Seq<'a>` は、要求された要素だけをオンデマンドで順次計算する同期的・**1回消費型（single-use）**の遅延シーケンス型です。中間配列をヒープに一括確保したくない変換パイプライン、上限が動的に決まるストリーム処理、および各標準コレクションに対する借用イテレータの共通表現として使用します。

## 要点

- 型は `Seq<'a>` で、要素型 `'a` にかかわらず常に非 `Copy` 型です（内部表現は不透明であり、フィールド参照やレコード分解は `E1022` となります）。
- .NET の `IEnumerable<T>` とは異なり、同じ `Seq` を複数回走査することはできません。`for ... in` ループ、`Seq.next`、`Seq.to_array` で一度消費すると所有権が移動し、再利用は `E1012` としてコンパイル時に防止されます。
- `Seq.map` と `Seq.filter` は計算を即座に実行せず、終端操作（`for ... in`、`Seq.next`、`Seq.to_array`）が呼ばれた時点で1要素ずつ評価を進めます。
- `for ... in` ループの途中で `break` して脱出した場合でも、未消費の先頭要素およびクロージャ環境が保持するリソースはデストラクタによって安全に解放されます。
- `Map`・`Set`・`HashMap`・`HashSet`・`Vec` の `iter`、および `Array.to_seqr`・`List.to_seqr` はすべて要素への共有参照を列挙する `Seq` を返します。

## 生成とステップ進行

### 単一要素・空・遅延ステップからの生成

- **`Seq.empty()`**: 要素を持たない空シーケンスを生成します（0引数関数のため括弧を密着させます）。
- **`Seq.once value`**: 所有値1つだけを生成するシーケンスを作ります。
- **`Seq.defer step`**: 初回読み取り時まで `step ()`（戻り値 `(Seq<'a> * Maybe<'a>)`）の実行を遅延させます。
- **`Seq.unfold generator state`**: 状態遷移関数 `'state -> Maybe<('a * 'state)>` が `None` を返すまで要素と次状態を順次生成します（`'state` にはクロージャ捕捉可能な型を表す `Capture<'state>` 制約が課されます）。

```tsuzuri run=single%3D42%20powers%3D%5B1%2C%202%2C%204%2C%208%2C%2016%5D
let one = Seq.once 42
let first = match Seq.next one with
    | (_, Some v) -> v
    | (_, None) -> 0

let powers =
    Seq.unfold (\n -> if n <= 16 then Some (n, n * 2) else None) 1
    |> Seq.to_array

$"single={first} powers={powers}"
```

### `Seq.next` による1ステップ進行

コンパイラ組み込み関数 `Seq.next` は現在の `Seq<'a>` を所有権ごと消費し、`(残りの Seq<'a> * Maybe<'a>)` のタプルを返します。終端に到達すると第2要素が `Maybe.None` になります。

## 引数の順序と遅延パイプライン

`Seq` を受け取る変換関数（`Seq.map`、`Seq.filter`、`Seq.to_array`）はすべて対象の `Seq` を**最後の引数**にとります（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。`Seq.unfold` は状態遷移関数を第1引数、初期状態を第2引数にとります。

```tsuzuri run=result%3D%5B0%2C%206%2C%2012%2C%2018%5D%20sum%3D36
let result =
    Seq.unfold (\v -> if v < 10 then Some (v, v + 1) else None) 0
    |> Seq.map (\x -> x * 2)
    |> Seq.filter (\r -> deref r % 3 == 0)
    |> Seq.to_array

$"result={result} sum={Array.sum result}"
```

`Seq.map` は要素の所有権を消費して変換し、`Seq.filter` は要素の共有参照 `ref 'a` を述語へ渡して真となる要素のみを通過させます。途中の `map` や `filter` の段階では配列は一切確保されません。

## `for ... in` ループとコレクションの反復

### `Seq` の反復と無限列の停止

`for item in seq do ...` は内部で `Seq.next` を繰り返してシーケンスを消費します。`Seq.unfold` などで無限列を構築した場合、`Seq.to_array` を呼ぶとメモリが枯渇するまで停止しないため、`for` ループ内で `break` を用いて打ち切ります。

```tsuzuri run=acc%3D21
let naturals = Seq.unfold (\n -> Some (n, n + 1)) 1
let mut acc = 0
for n in naturals do
    if n > 6 then break
    acc = acc + n
$"acc={acc}"
```

なお、ループ本体で非 `Copy` 要素への参照を外側の長命な変数へ逃がすことは寿命検査（`E1013`）によって拒否されます。

### 標準コレクションのイテレータ関数との対応

`Array`・`Vec`・`List`・文字列・整数範囲・`Seq` は `for ... in` に直接渡して走査できます。一方、`Map`・`Set`・`HashMap`・`HashSet` は直接 `for` に渡せないため（`E1005`）、以下の関数で `Seq` を取得して走査します。

| コレクション | 共有参照列の取得 | 返却される `Seq` 型 | 備考 |
| --- | --- | --- | --- |
| **[Array](./array.md)** | `Array.to_seqr xs` | `Seq<ref 'a>` | インデックス昇順（`Copy` 値列は `Array.to_seq`） |
| **[Vec](./vec.md)** | `Vec.iter v` | `Seq<ref 'a>` | インデックス昇順 |
| **[List](./list.md)** | `List.to_seqr xs` | `Seq<ref 'a>` | 初回に $O(n)$ で参照テーブルを構築（単純走査には直接 `for` を推奨） |
| **[Map](./map.md)** | `Map.iter m` | `Seq<(ref 'k * ref 'v)>` | キーの `Ord` 昇順 |
| **[Set](./set.md)** | `Set.iter s` | `Seq<ref 'k>` | 要素の `Ord` 昇順 |
| **[HashMap](./hashmap.md)** | `HashMap.iter m` | `Seq<(ref 'k * ref 'v)>` | 内部エントリ配列順 |
| **[HashSet](./hashset.md)** | `HashSet.iter s` | `Seq<ref 'k>` | 内部エントリ配列順 |

借用イテレータ `Seq<ref ...>` が生存している間、借用元のコレクションに対するムーブや更新・排他借用はコンパイル時に禁止されます（`E1014`）。

```tsuzuri run=total_len%3D11
let words = ["Tsuzuri", "Docs"]
let mut total_len = 0
for w in Array.to_seqr words do
    total_len = total_len + w.length
$"total_len={total_len}"
```

## 公開関数一覧（全7公開関数 + 1組み込み関数）

`std/Seq.tz` の7公開関数およびコンパイラ組み込み関数 `Seq.next` の仕様は次のとおりです。

| 関数 | シグネチャ | 計算量 | 説明 |
| --- | --- | --- | --- |
| `Seq.empty` | `Seq<'a>` | $O(1)$ | 要素を持たない空シーケンスを返す（`Seq.empty()` で呼び出す） |
| `Seq.once` | `own 'a -> Seq<'a>` | $O(1)$ | 単一の所有値 `value` のみを生成するシーケンスを返す |
| `Seq.defer` | `own (unit -> (Seq<'a> * Maybe<'a>)) -> Seq<'a>` | $O(1)$ | 初回読み取り時に `step ()` を評価する遅延シーケンスを返す |
| `Seq.unfold` | `Capture<'state> => own ('state -> Maybe<('a * 'state)>) -> own 'state -> Seq<'a>` | 生成 $O(1)$ / 1要素ごとに遷移1回 | 初期状態から `None` が返るまで要素と次状態を遅延生成する |
| `Seq.next` | `own Seq<'a> -> (Seq<'a> * Maybe<'a>)` | 先頭保持時 $O(1)$ / 遅延時ステップ1回分 | シーケンスを1段階消費し、残りのシーケンスと次要素の組を返す（組み込み） |
| `Seq.map` | `Capture<'a> => own ('a -> 'b) -> own Seq<'a> -> Seq<'b>` | 生成 $O(1)$ / 全走査 $O(n)$ | 各要素に関数を遅延適用するシーケンスを返す |
| `Seq.filter` | `Capture<'a> => own (ref 'a -> bool) -> own Seq<'a> -> Seq<'a>` | 生成 $O(1)$ / 全走査 $O(n)$ | 要素の共有参照が述語を満たすもののみを遅延抽出する |
| `Seq.to_array` | `own Seq<'a> -> ['a]` | $O(n)$ | シーケンスを終端まで消費し、全要素を格納した所有配列を返す |

## 関連項目

- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [Array](./array.md)
- [Vec](./vec.md)
- [List](./list.md)
- [Map](./map.md)
- [HashMap](./hashmap.md)
- [ループ構文（`for` / `while`）](../../expressions/loops.md)
- [所有権とムーブ](../../ownership/ownership-and-move.md)
