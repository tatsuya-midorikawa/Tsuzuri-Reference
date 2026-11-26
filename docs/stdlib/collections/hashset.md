# HashSet

`HashSet<'key>` は、`HashMap<'key, unit>` を基盤とするオープンアドレス法の高速ハッシュ集合です。平均 **$O(1)$** で要素の包含判定・追加・削除を行え、重複排除や高速なメンバーシップ検査に適しています。

`HashSet.randomized` および `HashSet.try_randomized` を呼び出すパッケージには `random` 権限が必要です（[パッケージ管理と権限](../../modules/packages.md)）。要素の昇順整列や集合演算（`union`・`intersect`・`difference`）が必要な場合は順序付きの [Set](./set.md) を使用します。

## 要点

- 型は `HashSet<'key>` で、常に非 `Copy` 型です（内部表現は不透明であり、フィールド参照・分解は `E1022`、モジュール名 `HashSet` の再定義は `E1011` となります）。
- 要素型には `Hash<'key>` と `Eq<'key>` が必要です（`Ord` は不要）。反射性 `Eq.eq key key` が検査されるため、`NaN` を含む要素は空集合に対する判定でもトラップします。
- 検索キーの所有権を消費せずに判定・削除できる借用版 API（`contains_ref`、`remove_ref`）を備えています。
- 反復順序は削除を行うまでは**挿入順**であり、`remove` / `remove_ref` 実行時は末尾要素が削除位置へ移動する **swap-remove** となります。
- 外部入力に対する HashDoS 対策として、SipHash-1-3 で鍵付き混合を行う `with_seed`・`with_capacity_and_seed`・`randomized`・`try_randomized` を提供します。

## 生成・追加・借用判定

### 生成と重複排除

空集合は `HashSet.empty()`（0引数関数のため括弧を密着させます）、容量事前確保は `HashSet.with_capacity count` で生成します。既存要素と等しい要素を `HashSet.insert` で追加した場合、既存の代表値が維持され新しい値は破棄されます。

```tsuzuri run=len%3D3%20has_banana%3Dtrue
let fruits =
    HashSet.empty()
    |> HashSet.insert "apple"
    |> HashSet.insert "banana"
    |> HashSet.insert "cherry"
    |> HashSet.insert "apple"

$"len={HashSet.length fruits} has_banana={HashSet.contains "banana" fruits}"
```

### キーを手放さない `contains_ref` と `remove_ref`

`string` などの非 `Copy` キーを所有権ごと消費したくない場合は、共有借用で受け取る `HashSet.contains_ref` および `HashSet.remove_ref` を使用します。

```tsuzuri run=before%3Dtrue%20after%3Dfalse%20kept%3Dtarget
let mut set = HashSet.empty() |> HashSet.insert "target" |> HashSet.insert "other"
let needle = "target"

let before = HashSet.contains_ref (ref needle) set
set = HashSet.remove_ref (ref needle) set
let after = HashSet.contains_ref (ref needle) set

$"before={before} after={after} kept={needle}"
```

## 引数の順序

引数なしの生成関数を除き、`HashSet` のすべての操作関数は対象の `HashSet` を**最後の引数**にとります（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。

```tsuzuri run=len%3D1%20has1%3Dtrue%20has2%3Dfalse
let step = HashSet.insert 1 >> HashSet.remove 2
let set = HashSet.empty() |> HashSet.insert 2 |> step
$"len={HashSet.length set} has1={HashSet.contains 1 set} has2={HashSet.contains 2 set}"
```

## 反復順序・swap-remove・HashDoS 対策

### エントリ順走査と swap-remove

`HashSet` を直接 `for x in set` に渡すことはできないため（`E1005`）、`for item in HashSet.iter set` または `HashSet.fold` を使用します。削除時は末尾要素が空いたスロットへ移動します。

```tsuzuri run=arr%3D%5B'a'%2C%20'd'%2C%20'c'%5D%20total_len%3D7
let chars =
    HashSet.empty()
    |> HashSet.insert 'a'
    |> HashSet.insert 'b'
    |> HashSet.insert 'c'
    |> HashSet.insert 'd'
    |> HashSet.remove 'b'

let words = HashSet.empty() |> HashSet.insert "tea" |> HashSet.insert "cake"
let mut total_len = 0
for w in HashSet.iter words do
    total_len = total_len + w.length

$"arr={HashSet.to_array chars} total_len={total_len}"
```

### シード付き集合（HashDoS 対策）

[HashMap](./hashmap.md) と同様、信頼できない外部入力を格納する際は `HashSet.with_seed seed`、`HashSet.with_capacity_and_seed count seed`、または OS 乱数からシードを得る `HashSet.randomized ()` / `HashSet.try_randomized ()` を使用します（`randomized` 系は `unit` 引数を受け取るため括弧の前に空白を入れて呼び出します。既定の `wasm32` ターゲットでは `E2000` となります）。

```tsuzuri run=2
let seeded =
    HashSet.with_capacity_and_seed 16 2028i64u
    |> HashSet.insert "alpha"
    |> HashSet.insert "beta"
HashSet.length seeded
```

## 公開関数一覧（全17関数）

### 生成・シード・基本情報・診断

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `HashSet.empty` | `HashSet<'key>` | 固定混合の空集合を生成する（`HashSet.empty()` で呼び出す） |
| `HashSet.with_capacity` | `own i64 -> HashSet<'key>` | `count` 件まで再確保なしで格納できる空集合を生成する |
| `HashSet.with_seed` | `own i64u -> HashSet<'key>` | 指定シードによる SipHash-1-3 混合を行う空集合を生成する |
| `HashSet.with_capacity_and_seed` | `own i64 -> own i64u -> HashSet<'key>` | 容量事前確保とシード指定を同時に行う空集合を生成する |
| `HashSet.randomized` | `own unit -> IO<HashSet<'key>>` | OS 乱数シードで初期化する `IO` アクション（失敗時はトラップ、`random` 権限） |
| `HashSet.try_randomized` | `own unit -> IO<Result<HashSet<'key>, Os.Error>>` | OS 乱数シードで初期化し失敗を `Result.Error` で返す `IO` アクション（`random` 権限） |
| `HashSet.length` | `ref HashSet<'key> -> i64` | 格納されている要素数を返す |
| `HashSet.is_empty` | `ref HashSet<'key> -> bool` | 要素数が `0` であれば `true` を返す |
| `HashSet.longest_probe` | `ref HashSet<'key> -> i64` | 内部ハッシュ表の最大線形探査距離を返す（診断用） |

### 判定・追加・削除・変換・反復

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `HashSet.contains` | `(Hash<'key>, Eq<'key>) => own 'key -> ref HashSet<'key> -> bool` | 要素を消費して包含判定を行う |
| `HashSet.contains_ref` | `(Hash<'key>, Eq<'key>) => ref 'key -> ref HashSet<'key> -> bool` | 要素を共有借用して包含判定を行う |
| `HashSet.insert` | `(Hash<'key>, Eq<'key>) => own 'key -> own HashSet<'key> -> HashSet<'key>` | 要素を追加した新しい集合を返す（既にあれば変更しない） |
| `HashSet.remove` | `(Hash<'key>, Eq<'key>) => own 'key -> own HashSet<'key> -> HashSet<'key>` | 要素を消費して対象要素を swap-remove した集合を返す |
| `HashSet.remove_ref` | `(Hash<'key>, Eq<'key>) => ref 'key -> own HashSet<'key> -> HashSet<'key>` | 要素を共有借用して対象要素を swap-remove した集合を返す |
| `HashSet.to_array` | `Copy<'key> => ref HashSet<'key> -> ['key]` | 内部エントリ順の要素配列を返す |
| `HashSet.fold` | `own ('state -> ref 'key -> 'state) -> own 'state -> ref HashSet<'key> -> 'state` | 内部エントリ順に要素を共有借用して左畳み込みを行う |
| `HashSet.iter` | `ref HashSet<'key> -> Seq<ref 'key>` | 内部エントリ順に要素の共有参照を列挙する遅延 `Seq` を返す |

## 計算量

以下の表は `std/HashSet.tz` の `@complexity` タグから自動生成された時間計算量です。

<!-- generated:complexity:HashSet -->
| 関数 | 計算量 | 関連 |
| --- | --- | --- |
| `HashSet.empty` | $O(1)$ | - |
| `HashSet.with_capacity` | $O(k)$ | - |
| `HashSet.length` | $O(1)$ | - |
| `HashSet.is_empty` | $O(1)$ | - |
| `HashSet.with_seed` | $O(1)$ | - |
| `HashSet.with_capacity_and_seed` | $O(k)$ | - |
| `HashSet.try_randomized` | $O(1)$ | - |
| `HashSet.randomized` | $O(1)$ | - |
| `HashSet.insert` | 償却 $O(1)$、最悪 $O(n \cdot n)$ | - |
| `HashSet.remove_ref` | 平均 $O(1)$、最悪 $O(n)$ | `HashSet.remove` |
| `HashSet.remove` | 平均 $O(1)$、最悪 $O(n)$ | `HashSet.remove_ref` |
| `HashSet.contains_ref` | 平均 $O(1)$、最悪 $O(n)$ | `HashSet.contains` |
| `HashSet.contains` | 平均 $O(1)$、最悪 $O(n)$ | `HashSet.contains_ref` |
| `HashSet.longest_probe` | $O(k)$ | - |
| `HashSet.to_array` | $O(n)$ | - |
| `HashSet.fold` | $O(n)$ | - |
| `HashSet.iter` | $O(1)$ | - |
<!-- /generated:complexity:HashSet -->

## 関連項目

- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [HashMap](./hashmap.md)
- [Set](./set.md)
- [Seq](./seq.md)
- [Random](../sys/random.md)
- [型クラスと制約](../../types/type-classes.md)
