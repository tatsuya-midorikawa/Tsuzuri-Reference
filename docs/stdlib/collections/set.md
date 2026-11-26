# Set

`Set<'key>` は、重複のない要素を全順序（`Ord` 型クラス）に従って昇順に保持する順序付き集合です。[Map](./map.md) と同じく内部表現は1〜512要素ごとの整列済みチャンク配列であり、$O(\log n)$ の包含判定、決定論的な昇順走査、および $O(n + m)$ のマージ走査による集合演算（和集合・積集合・差集合）を提供します。

要素の順序が不要で平均 $O(1)$ の包含判定のみを必要とする場合は [HashSet](./hashset.md) を使用します。

## 要点

- 型は `Set<'key>` で、要素型 `'key` にかかわらず常に非 `Copy` 型です（内部表現は不透明であり、フィールド参照やパターン分解は `E1022` となります）。
- 要素型には `Ord<'key>` が必要です。比較時に反射性 `Eq.eq key key` が検証されるため、`NaN` を含む浮動小数点値は空集合に対する検査であってもトラップします。
- 更新操作（`Set.insert`、`Set.remove`）は所有する `Set` を消費して新しい `Set` を返します。既存要素と同じキーを `insert` した場合は既存の代表要素を維持してそのまま返します。
- 集合演算のうち、`Set.union` は左右両方の集合の所有権を消費するため非 `Copy` 要素（`string` など）にも適用でき、`Set.intersect` と `Set.difference` は両辺を共有借用して選択要素のみを複製するため `Copy<'key>` を要求します。

## 生成・追加・集合演算

### 生成と包含判定

空集合は `Set.empty()`（0引数関数のため括弧を密着させます）、単一要素集合は `Set.singleton key` で生成します。

```tsuzuri run=len%3D3%20arr%3D%5B1%2C%202%2C%203%5D%20has2%3Dtrue
let nums =
    Set.empty()
    |> Set.insert 3
    |> Set.insert 1
    |> Set.insert 2
    |> Set.insert 1

$"len={Set.length nums} arr={Set.to_array nums} has2={Set.contains 2 nums}"
```

### 集合演算（`union` / `intersect` / `difference`）

整列済みチャンク列の特性を活かし、3つの集合演算はいずれも線形時間 $O(n + m)$ で384要素単位のチャンクを一括構築します。

```tsuzuri run=union%3D%5B1%2C%202%2C%203%2C%204%5D%20inter%3D%5B2%2C%203%5D%20diff%3D%5B1%5D
let left = Set.empty() |> Set.insert 1 |> Set.insert 2 |> Set.insert 3
let right = Set.empty() |> Set.insert 2 |> Set.insert 3 |> Set.insert 4

let inter = Set.intersect left right
let diff = Set.difference left right
let combined = Set.union left right

$"union={Set.to_array combined} inter={Set.to_array inter} diff={Set.to_array diff}"
```

上の例では、`intersect` と `difference` は `left`・`right` を共有借用するため両変数はそのまま残り、最後の `Set.union left right` で両辺の所有権が消費されます。重複する要素があるとき、`union` は左辺 `left` 側の要素を保持します。

## 引数の順序

単一の集合を操作する関数（`insert`、`remove`、`contains`、`fold`、`to_array` など）はすべて対象の `Set` を**最後の引数**にとります。2つの集合を対象とする `union`・`intersect`・`difference` は F# の `Set` と同じく `(left, right)` の順にとります（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。

```tsuzuri run=len%3D1%20has1%3Dtrue%20has2%3Dfalse
let step = Set.insert 1 >> Set.remove 2
let s = Set.empty() |> Set.insert 2 |> step
$"len={Set.length s} has1={Set.contains 1 s} has2={Set.contains 2 s}"
```

## 昇順走査

`Set` に対して直接 `for x in set` と書くことはできないため（`E1005`）、`Set.iter set` で `Seq<ref 'key>` を取得するか `Set.fold` を用いて昇順に走査します。

```tsuzuri run=abc%2060
let words = Set.empty() |> Set.insert "b" |> Set.insert "c" |> Set.insert "a"
let mut joined = ""
for w in Set.iter words do
    joined = $"{joined}{w}"

let nums = Set.empty() |> Set.insert 20 |> Set.insert 10 |> Set.insert 30
let total = Set.fold (\acc x -> acc + deref x) 0 nums
$"{joined} {total}"
```

## 公開関数一覧（全15関数）

### 生成・基本情報・判定

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Set.empty` | `Set<'key>` | 空の集合を生成する（`Set.empty()` で呼び出す） |
| `Set.singleton` | `own 'key -> Set<'key>` | 1要素のみを持つ集合を生成する |
| `Set.length` | `ref Set<'key> -> i64` | 要素数を返す |
| `Set.is_empty` | `ref Set<'key> -> bool` | 集合が空であれば `true` を返す |
| `Set.contains` | `Ord<'key> => own 'key -> ref Set<'key> -> bool` | 指定要素が含まれていれば `true` を返す |

### 追加・削除・集合演算

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Set.insert` | `Ord<'key> => own 'key -> own Set<'key> -> Set<'key>` | 要素を追加した新しい集合を返す（既にあれば変更しない） |
| `Set.remove` | `Ord<'key> => own 'key -> own Set<'key> -> Set<'key>` | 指定要素を削除した新しい集合を返す（不在なら変更しない） |
| `Set.union` | `Ord<'key> => own Set<'key> -> own Set<'key> -> Set<'key>` | 両辺を消費して和集合を返す（重複時は左辺の代表値を保持） |
| `Set.intersect` | `(Ord<'key>, Copy<'key>) => ref Set<'key> -> ref Set<'key> -> Set<'key>` | 両辺を共有借用して共通要素からなる積集合を返す |
| `Set.difference` | `(Ord<'key>, Copy<'key>) => ref Set<'key> -> ref Set<'key> -> Set<'key>` | 両辺を共有借用し、`left` にあって `right` にない差集合を返す |

### 変換・反復・診断

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Set.to_array` | `Copy<'key> => ref Set<'key> -> ['key]` | 全要素を昇順に格納した所有配列を返す |
| `Set.fold` | `own ('state -> ref 'key -> 'state) -> own 'state -> ref Set<'key> -> 'state` | 要素を共有借用しながら昇順に左畳み込みを行う |
| `Set.iter` | `ref Set<'key> -> Seq<ref 'key>` | 要素への共有参照を昇順に列挙する遅延 `Seq` を返す |
| `Set.chunk_count` | `ref Set<'key> -> i64` | 内部チャンク数を返す（空集合は `0`、テスト・診断用） |
| `Set.invariants_hold` | `Ord<'key> => ref Set<'key> -> bool` | チャンクサイズ制約とキー厳密昇順の不変条件を検証する（テスト用） |

## 計算量

以下の表は `std/Set.tz` の `@complexity` タグから自動生成された時間計算量です。包含判定は二分探索により $O(\log n)$、`insert` / `remove` は通常1チャンク内（最大512要素）の移動で済みますが、チャンク分割・併合時に後続チャンクポインタの移動を伴うため最悪計算量は $O(n)$ となります。

<!-- generated:complexity:Set -->
| 関数 | 計算量 |
| --- | --- |
| `Set.empty` | $O(1)$ |
| `Set.singleton` | $O(1)$ |
| `Set.length` | $O(1)$ |
| `Set.is_empty` | $O(1)$ |
| `Set.chunk_count` | $O(1)$ |
| `Set.contains` | $O(\log n)$ |
| `Set.insert` | $O(n)$ |
| `Set.remove` | $O(n)$ |
| `Set.to_array` | $O(n)$ |
| `Set.fold` | $O(n)$ |
| `Set.union` | $O(n + m)$ |
| `Set.intersect` | $O(n + m)$ |
| `Set.difference` | $O(n + m)$ |
| `Set.iter` | $O(1)$ |
| `Set.invariants_hold` | $O(n)$ |
<!-- /generated:complexity:Set -->

## 関連項目

- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [Map](./map.md)
- [HashSet](./hashset.md)
- [Seq](./seq.md)
- [型クラスと制約](../../types/type-classes.md)
