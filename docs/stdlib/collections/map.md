# Map

`Map<'key, 'value>` は、キーの全順序（`Ord` 型クラス）に従ってエントリを厳密な昇順に保持する順序付き連想配列です。内部表現は二分探索木ではなく、1〜512エントリごとの整列済みチャンク配列（Bツリー葉チャンク列に相当する連続構造）であり、高いキャッシュ局所性と $O(\log n)$ 回の比較による検索を実現します。

キーの昇順で決定論的に走査したい場面や、キー型が `Hash` を持たず `Ord` のみを実装している場面で使用します。順序が不要で平均 $O(1)$ の検索・更新を求める場合は [HashMap](./hashmap.md) を使用します。

## 要点

- 型は `Map<'key, 'value>` で、要素型にかかわらず常に非 `Copy` 型です（内部フィールドは非公開であり、直接参照やレコード分解は `E1022` となります）。
- キー型には `Ord<'key>` が必要です。比較時に反射性 `Eq.eq key key` が検証されるため、`NaN` を含む浮動小数点キーは空マップに対する検索であってもトラップします（`-0.0` と `+0.0` は同一キーとして扱われます）。
- 更新操作（`Map.insert`、`Map.remove`）は所有する `Map` を消費して更新後の新しい `Map` を返します。
- 値の取得には、`Copy<'value>` を要求して `Maybe<'value>` を返す `Map.get`、非 `Copy` 値にも使え不在時にトラップする共有参照取得 `Map.at`、および `Copy<'value>` 向けのブラケット添字 `map[key]`（`Index` インスタンス）があります。
- 反復処理（`fold`、`iter`、`keys`、`values`、`to_array`）は常にキーの `Ord` 昇順で実行されます。

## 生成・挿入・要素アクセス

### 生成と関数的更新

空マップは `Map.empty()`（0引数関数のため括弧を密着させます）、1要素マップは `Map.singleton key value` で作成します。すでに存在するキーに対して `Map.insert` を呼ぶと、既存のキー代表値と並び位置を維持したまま値のみが置き換えられます。

```tsuzuri run=len%3D3%20keys%3D%5B1%2C%202%2C%203%5D%20two%3Dtwenty
let map =
    Map.empty()
    |> Map.insert 3 "three"
    |> Map.insert 1 "one"
    |> Map.insert 2 "two"
    |> Map.insert 2 "twenty"

$"len={Map.length map} keys={Map.keys map} two={Map.at 2 map}"
```

### 検索・参照取得・ブラケット添字 `map[key]`

- **`Map.contains_key key map`**: キーの存否を `bool` で返します。
- **`Map.get key map`**: 値型が `Copy` のとき `Maybe<'value>` を返します。
- **`Map.at key map`**: 値への共有参照 `ref 'value` を返します（不在時はトラップ）。
- **`map[key]`**: `(Ord<'key>, Copy<'value>) => Index<Map<'key, 'value>, 'key, 'value>` インスタンスにより、キーを指定して値を直接コピー取得できます（不在時はトラップ）。

```tsuzuri run=tea%3D300%20cake%3D0%20has_tea%3Dtrue
let prices =
    Map.empty()
    |> Map.insert "tea" 300
    |> Map.insert "coffee" 450

let tea = prices["tea"]
let cake = Map.get "cake" prices |> Maybe.default_value 0
$"tea={tea} cake={cake} has_tea={Map.contains_key "tea" prices}"
```

## 引数の順序

`Map` モジュールのすべての関数は、操作対象の `Map` を**最後の引数**にとります（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。F# の `Map` モジュールと同じ引数順であり、`|>` および `>>` による合成がそのまま機能します。

| 操作 | Tsuzuri | F# |
| --- | --- | --- |
| 追加・上書き | `Map.insert key value map` | `Map.add key value table` |
| 検索（`Maybe`） | `Map.get key map` | `Map.tryFind key table` |
| 参照取得 | `Map.at key map` | `Map.find key table` |
| キー存在判定 | `Map.contains_key key map` | `Map.containsKey key table` |
| 削除 | `Map.remove key map` | `Map.remove key table` |

なお、`Map.insert 1 "a" >> Map.at 1` のように一時生成された `Map` から内部参照 `ref 'value` を返す関数へ直接合成すると、一時値の寿命を超える参照となるため `E1013` になります。参照を得る場合はいったん `let` で束縛します。

## 昇順走査とイテレータ

`Map` 自体は `for ... in` に直接渡せないため（`E1005`）、`Map.iter map` で `Seq<(ref 'key * ref 'value)>` を取得して走査するか、`Map.fold` を使用します。どちらも非 `Copy` のキーや値を複製せずにキー昇順で処理できます。

```tsuzuri run=a%3D10%3Bb%3D20%3Bc%3D30%3B
let table =
    Map.empty()
    |> Map.insert "c" 30
    |> Map.insert "a" 10
    |> Map.insert "b" 20

let mut out = ""
for (k, v) in Map.iter table do
    out = $"{out}{k}={deref v};"
out
```

## 公開関数一覧（全16関数）

### 生成・基本情報

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Map.empty` | `Map<'key, 'value>` | 空のマップを生成する（`Map.empty()` で呼び出す） |
| `Map.singleton` | `own 'key -> own 'value -> Map<'key, 'value>` | 1組のキーと値のみを持つマップを生成する |
| `Map.length` | `ref Map<'key, 'value> -> i64` | 格納されているエントリ数を返す |
| `Map.is_empty` | `ref Map<'key, 'value> -> bool` | エントリ数が `0` であれば `true` を返す |

### 検索・更新・削除

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Map.contains_key` | `Ord<'key> => own 'key -> ref Map<'key, 'value> -> bool` | 指定キーが存在すれば `true` を返す |
| `Map.get` | `(Ord<'key>, Copy<'value>) => own 'key -> ref Map<'key, 'value> -> Maybe<'value>` | 対応する値をコピーして `Some` で返し、不在なら `None` を返す |
| `Map.at` | `Ord<'key> => own 'key -> ref Map<'key, 'value> -> ref 'value` | 対応する値への共有参照を返す（不在時はトラップ） |
| `Map.insert` | `Ord<'key> => own 'key -> own 'value -> own Map<'key, 'value> -> Map<'key, 'value>` | エントリを挿入または値を置換した新しいマップを返す |
| `Map.remove` | `Ord<'key> => own 'key -> own Map<'key, 'value> -> Map<'key, 'value>` | 指定キーを削除した新しいマップを返す（不在時はそのまま返す） |

### 配列変換・畳み込み・反復・診断

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Map.to_array` | `(Copy<'key>, Copy<'value>) => ref Map<'key, 'value> -> [('key * 'value)]` | キー昇順の `(key, value)` タプル配列を返す |
| `Map.keys` | `Copy<'key> => ref Map<'key, 'value> -> ['key]` | 昇順に並んだキーの配列を返す |
| `Map.values` | `Copy<'value> => ref Map<'key, 'value> -> ['value]` | キー昇順に対応する値の配列を返す |
| `Map.fold` | `own ('state -> ref 'key -> ref 'value -> 'state) -> own 'state -> ref Map<'key, 'value> -> 'state` | キーと値を共有借用しながらキー昇順に左畳み込みを行う |
| `Map.iter` | `ref Map<'key, 'value> -> Seq<(ref 'key * ref 'value)>` | キー昇順に `(ref 'key * ref 'value)` を列挙する遅延 `Seq` を返す |
| `Map.chunk_count` | `ref Map<'key, 'value> -> i64` | 内部チャンク数を返す（空マップは `0`、テスト・診断用） |
| `Map.invariants_hold` | `Ord<'key> => ref Map<'key, 'value> -> bool` | チャンクサイズ上限（512）・隣接チャンク和下限（> 256）・キー昇順性の不変条件を検証する（テスト用） |

## 計算量とチャンク構造

検索はチャンク末尾キーに対する二分探索とチャンク内二分探索の2段階で行われ、比較回数は $O(\log n)$ です。既存キーの値置換は $O(\log n)$、最大キーより大きいキーの末尾追加は最終チャンクへの追記となります。一般の新規挿入・削除は1チャンク内（最大512要素）のシフトで完了しますが、満杯チャンクの分割や隣接チャンク（合計256以下）の併合が発生した場合はチャンク配列のシフトを伴うため最悪計算量は $O(n)$ と表記されます。

<!-- generated:complexity:Map -->
| 関数 | 計算量 |
| --- | --- |
| `Map.empty` | $O(1)$ |
| `Map.singleton` | $O(1)$ |
| `Map.length` | $O(1)$ |
| `Map.is_empty` | $O(1)$ |
| `Map.chunk_count` | $O(1)$ |
| `Map.contains_key` | $O(\log n)$ |
| `Map.get` | $O(\log n)$ |
| `Map.at` | $O(\log n)$ |
| `Map.insert` | $O(n)$ |
| `Map.remove` | $O(n)$ |
| `Map.to_array` | $O(n)$ |
| `Map.keys` | $O(n)$ |
| `Map.values` | $O(n)$ |
| `Map.fold` | $O(n)$ |
| `Map.iter` | $O(1)$ |
| `Map.invariants_hold` | $O(n)$ |
<!-- /generated:complexity:Map -->

## 所有権と境界条件

- `Map.insert` や `Map.remove` に所有権を渡した後の古い変数を再度参照すると `E1012` になります。
- `Map.at` や `Map.iter` で取得した共有参照が生存している間、元の `Map` をムーブまたは更新することはできません（`E1014`）。
- タプルや匿名共用体 `(i64 | string)` も、構成要素がすべて `Ord` を実装していればそのままキー型として使用できます。

## 関連項目

- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [Set](./set.md)
- [HashMap](./hashmap.md)
- [Seq](./seq.md)
- [型クラスと制約](../../types/type-classes.md)
- [匿名共用体](../../types/anonymous-unions.md)
