# Vec

`Vec<'a>` は、連続したヒープバッファを所有し、末尾への要素追加を償却 $O(1)$ で行える動的可変長コレクションです。`Vec` モジュールは .NET の `List<T>` の公開メンバー群を `snake_case` 名で網羅しつつ、Tsuzuri の所有権モデルとパイプライン規約（対象 `Vec` を最後の引数に配置）に合わせて設計されています。動的に要素を蓄積・編集し、最終的に [Array](./array.md) へゼロコピー移送する用途に最適です。

## 要点

- 型は `Vec<'a>` で、要素型 `'a` にかかわらず常に非 `Copy` 型です。
- すべての関数で操作対象の `Vec` が**最後の引数**に配置されるため、`Vec.empty() |> Vec.add 1 |> Vec.sort` や `Vec.sort >> Vec.reverse` のようにパイプラインと関数合成が一貫して使えます。
- 変更操作には、所有する `Vec` を消費して更新後の `Vec` を返す関数的更新（`Vec.add`、`Vec.push_owned`、`Vec.insert`、`Vec.sort` 等）と、Edition 2027 以降の排他借用による末尾追加 `Vec.push`（および全エディション共通の `Vec.push_mut`、添字代入 `v[i] = x`）があります。
- 要素を値で受け取るコールバック関数（`find_index`、`exists`、`convert_all` 等）は `Copy<'a>` を要求し、`r` 接尾辞付きの借用版（`find_indexr`、`existsr`、`convert_allr` 等）は共有参照 `ref 'a` で任意の非 `Copy` 要素を扱えます。
- `Vec.of_array` と `Vec.to_array` は要素を複製せず、所有ヒープバッファを $O(1)$ で相互に移送します。
- 境界外添字、負の容量・個数、現在長を下回る `set_capacity` はトラップします。一方、要素探索の不一致は `-1`（`find` / `find_last` / `get` は `Maybe.None`）、`binary_search` の不一致は挿入位置のビット補数（`-1 - insert_idx`）を返します。

## 生成と容量管理

### 生成と要素追加の2つのスタイル

`Vec.empty()`（0引数関数のため括弧を密着させます）または事前容量確保 `Vec.with_capacity cap` で生成します。Edition 2027 / 2028 では、`let mut` 変数に対して排他借用で追加する `Vec.push item v` と、所有値を変換してつなぐ `Vec.add item v`（または `Vec.push_owned`）のどちらも使用できます。

```tsuzuri run=pushed%3D%5B10%2C%2020%2C%2030%5D%20piped%3D%5B1%2C%2015%2C%202%2C%203%5D
let mut buf: Vec<i64> = Vec.empty()
Vec.push 10 buf
Vec.push 20 buf
buf[1] = 20
Vec.push 30 buf

let piped =
    Vec.empty()
    |> Vec.add 3
    |> Vec.add 1
    |> Vec.add 2
    |> Vec.sort
    |> Vec.insert 1 15

$"pushed={Vec.to_array buf} piped={Vec.to_array piped}"
```

### 容量の拡張規則

容量不足時の拡張は .NET の `List<T>` と同一の規則に従います。空（容量 `0`）からの初回追加では容量 `4` を確保し、以降は現在容量を2倍（それでも要求数に満たなければ要求数ちょうど）へ拡張します。

| 拡張パターン | 対象関数 | 新しい容量 |
| --- | --- | --- |
| 倍増ステップ | `push` / `push_mut` / `push_owned`, `add`, `insert`, `add_range_seq`, `insert_range_seq`, `of_seq`, `reserve` | `4` から要求数以上に達するまで倍増 |
| 一括要求反映 | `add_range`, `append`, `insert_range`, `ensure_capacity` | `max(現在容量 * 2 (空なら 4), 必要総要素数)` |
| 厳密一致 | `with_capacity`, `set_capacity`, `of_array`, `of_list`, `clone`, `get_range`, `slice`, `convert_all` | 指定容量または要素数ちょうど |

`Vec.trim_excess` は、現在の要素数が容量の 90% 未満である場合にのみバッファを要素数ちょうどへ縮小します。

```tsuzuri run=cap5%3D8%20ensured%3D40%20exact%3D12%20trimmed%3D5
let mut v: Vec<i64> = Vec.empty()
for n in 1 ..= 5 do
    Vec.push n v
let cap5 = Vec.capacity v
v = Vec.ensure_capacity 40 v
let ensured = Vec.capacity v
v = Vec.set_capacity 12 v
let exact = Vec.capacity v
v = Vec.trim_excess v
$"cap5={cap5} ensured={ensured} exact={exact} trimmed={Vec.capacity v}"
```

## 要素アクセス・削除・ソート・二分探索

### 添字アクセスと借用規則

- **`v[i]` と `v[^k]`**: インデックスには `i8`〜`i128` および `i8u`〜`i128u` の任意の整数型を指定でき、Edition 2028 では末尾相対位置 `v[^0]`（末尾要素）、`v[^1]`（末尾から2番目）も使用できます（負リテラル添字 `v[-1]` は警告 `W1014` かつトラップ）。
- **`Vec.at` と `Vec.get`**: 非 `Copy` 要素への共有参照は `Vec.at idx v`（または `ref v[idx]`）で取得し、範囲外を `None` として安全に値コピー取得したい場合は `Vec.get idx v` を使用します。
- **要素単体の排他参照の禁止**: 再確保時のダングリングポインタを防ぐため、`ref mut v[0]` のように要素への排他参照を取得することは禁止されています（`E1014`）。要素の書き換えには `v[i] = val`、`Vec.set`、`Vec.swap` を使用します。

### 削除操作と `pop`

末尾要素の取り出し `Vec.pop` は `(Vec<'a> * Maybe<'a>)` を返し、非 `Copy` 要素も所有権ごと取り出せます。値一致削除 `Vec.remove` は `(Vec<'a> * bool)`、条件一括削除 `Vec.remove_all` / `remove_allr` は `(Vec<'a> * i64)`（削除件数）をタプルで返します。

```tsuzuri run=popped%3D30%20found%3Dtrue%20removed%3D2%20rest%3D%5B1%5D
let v0 = Vec.of_array [5, 3, 5, 1, 30]
let (v1, last_opt) = Vec.pop v0
let (v2, found) = Vec.remove 5 v1
let (v3, removed) = Vec.remove_all (\n -> n > 2) v2
$"popped={Maybe.default_value 0 last_opt} found={found} removed={removed} rest={Vec.to_array v3}"
```

### 安定ソートと二分探索

- **安定ソート**: .NET の `List<T>.Sort`（不安定）とは異なり、`Vec.sort`・`sort_range`・`sort_with`・`sort_range_with`・`sort_withr`・`sort_range_withr` はすべて同値要素の相対順序を保つ**安定ソート**です。`sort` と `sort_range` は NaN を最小値として先頭に配置し、追加の作業メモリを確保しません（SymMerge）。
- **二分探索**: 昇順整列済みの `Vec` に対して `Vec.binary_search` を呼ぶと、一致位置のインデックス（不在の場合は挿入すべきインデックス `idx` のビット補数 `-1 - idx`）が返ります。

```tsuzuri run=found%3D3%20missing%3D-3%20inserted%3D%5B1%2C%203%2C%204%2C%205%2C%207%2C%209%5D
let mut nums = Vec.of_array [5, 3, 9, 1, 7] |> Vec.sort
let found = Vec.binary_search 7 nums
let missing = Vec.binary_search 4 nums
nums = Vec.insert (-1 - missing) 4 nums
$"found={found} missing={missing} inserted={Vec.to_array nums}"
```

## 引数の順序と `r` 接尾辞の借用関数

### 引数の順序

.NET の `list.Method(arg1, arg2)` に対し、Tsuzuri では補助引数 `arg1`、`arg2` の順序をそのまま維持しつつ、レシーバである `Vec` を**最後の引数**に置きます（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。これにより、`Vec.insert (Vec.length v) x v` のように対象 `v` のムーブ前に先行引数で `v` を共有借用することも可能です。

| 操作 | Tsuzuri | .NET `List<T>` |
| --- | --- | --- |
| 挿入 | `Vec.insert index item v` | `list.Insert(index, item)` |
| 範囲削除 | `Vec.remove_range index count v` | `list.RemoveRange(index, count)` |
| 範囲探索 | `Vec.index_of_range item index count v` | `list.IndexOf(item, index, count)` |
| 範囲ソート | `Vec.sort_range_with index count cmp v` | `list.Sort(index, count, comparer)` |
| 配列への複写 | `Vec.copy_to_range src_idx dst dst_idx count v` | `list.CopyTo(index, array, arrayIndex, count)` |

### 非 `Copy` 要素向けの `r` 形

`string` などの非 `Copy` 要素や、検索キーの所有権を消費したくない場面では、末尾に `r` が付いた借用関数を使用します。

```tsuzuri run=has_long%3Dtrue%20pos%3D1%20len%3D3
let words = Vec.of_array ["pear", "fig", "banana"]
let has_long = Vec.existsr (\w -> w.length > 5) words
let pos = Vec.index_ofr "fig" words
let len = match Vec.findr (\w -> w.length == 3) words with
    | Some w -> w.length
    | None -> 0
$"has_long={has_long} pos={pos} len={len}"
```

## 公開関数一覧

以下の表は `std/Vec.tz` の全68公開関数と、コンパイラ組み込みの19関数（`empty`, `with_capacity`, `length`, `capacity`, `is_empty`, `push`, `push_mut`, `push_owned`, `pop`, `reserve`, `truncate`, `clear`, `set`, `swap`, `get`, `at`, `clone`, `of_array`, `to_array`）を網羅しています。

### 生成・変換・基本情報・要素参照

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Vec.empty` | `Vec<'a>` | 長さ `0`・容量 `0` の空 `Vec` を生成する（`Vec.empty()` で呼び出す、組み込み） |
| `Vec.with_capacity` | `i64 -> Vec<'a>` | 指定容量を事前確保した空 `Vec` を生成する（負数はトラップ、組み込み） |
| `Vec.of_array` | `['a] -> Vec<'a>` | 所有配列のバッファをコピーなしで `Vec` へ移送する（組み込み） |
| `Vec.to_array` | `Vec<'a> -> ['a]` | `Vec` の内部バッファを所有配列へ移送する（組み込み） |
| `Vec.of_list` | `Copy<'a> => ref [\|'a\|] -> Vec<'a>` | 連結リストの要素を複製して要素数ちょうどの容量を持つ `Vec` を作る |
| `Vec.of_seq` | `own Seq<'a> -> Vec<'a>` | `Seq` の全要素を順次追加して `Vec` を作る |
| `Vec.clone` | `Copy<'a> => ref Vec<'a> -> Vec<'a>` | `Copy` 要素を複製し、要素数ちょうどの容量を持つ独立した `Vec` を返す（組み込み） |
| `Vec.length` | `ref Vec<'a> -> i64` | 現在の要素数を返す（`v.length` と同一、組み込み） |
| `Vec.capacity` | `ref Vec<'a> -> i64` | 現在確保されている内部容量を返す（組み込み） |
| `Vec.is_empty` | `ref Vec<'a> -> bool` | 要素数が `0` であれば `true` を返す（組み込み） |
| `Vec.at` | `i64 -> ref Vec<'a> -> ref 'a` | 指定位置の要素への共有参照を返す（範囲外はトラップ、組み込み） |
| `Vec.get` | `Copy<'a> => i64 -> ref Vec<'a> -> Maybe<'a>` | 指定位置の要素を `Some` で返す（範囲外は `None`、組み込み） |
| `Vec.iter` | `ref Vec<'a> -> Seq<ref 'a>` | 要素への共有参照を昇順に列挙する `Seq` を返す |

### 容量制御

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Vec.set_capacity` | `own i64 -> own Vec<'a> -> Vec<'a>` | 容量を指定値ちょうどに変更する（現在長未満はトラップ） |
| `Vec.ensure_capacity` | `own i64 -> own Vec<'a> -> Vec<'a>` | 総容量が指定値以上になるよう必要に応じて拡張する（負数はトラップ） |
| `Vec.reserve` | `i64 -> Vec<'a> -> Vec<'a>` | 現在長に加えて `additional` 個追加できる容量を確保する（組み込み） |
| `Vec.trim_excess` | `own Vec<'a> -> Vec<'a>` | 要素数が容量の 90% 未満であれば容量を現在長まで縮小する |
| `Vec.truncate` | `i64 -> Vec<'a> -> Vec<'a>` | 指定長を超える末尾側要素を破棄して縮小する（容量は維持、組み込み） |
| `Vec.clear` | `Vec<'a> -> Vec<'a>` | 全要素を破棄して長さ `0` にする（容量は維持、組み込み） |

### 追加・挿入・削除・置換

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Vec.push` | `'a -> ref mut Vec<'a> -> unit` | 排他借用で末尾に要素を追加する（Edition 2027+。Edition 2026 では消費型、組み込み） |
| `Vec.push_mut` | `'a -> ref mut Vec<'a> -> unit` | 全エディション共通で排他借用により末尾へ要素を追加する（組み込み） |
| `Vec.push_owned` | `'a -> Vec<'a> -> Vec<'a>` | 全エディション共通で所有 `Vec` を消費し末尾追加後の `Vec` を返す |
| `Vec.add` | `own 'a -> own Vec<'a> -> Vec<'a>` | 末尾に1要素を追加した `Vec` を返す（`push_owned` と同一契約） |
| `Vec.add_range` | `Copy<'a> => ref ['a] -> own Vec<'a> -> Vec<'a>` | 配列の全要素を複製して末尾へ追加する |
| `Vec.add_range_seq` | `own Seq<'a> -> own Vec<'a> -> Vec<'a>` | `Seq` の全要素を末尾へ追加する（非 `Copy` 対応） |
| `Vec.append` | `own Vec<'a> -> own Vec<'a> -> Vec<'a>` | 第1引数の `Vec` の全要素を第2引数の `Vec` の末尾へムーブ連結する |
| `Vec.insert` | `own i64 -> own 'a -> own Vec<'a> -> Vec<'a>` | 指定位置（`0 ..= length`）に1要素を挿入する |
| `Vec.insert_range` | `Copy<'a> => own i64 -> ref ['a] -> own Vec<'a> -> Vec<'a>` | 指定位置に配列の要素群を複製して挿入する |
| `Vec.insert_range_seq` | `own i64 -> own Seq<'a> -> own Vec<'a> -> Vec<'a>` | 指定位置に `Seq` の要素群を挿入する |
| `Vec.pop` | `Vec<'a> -> (Vec<'a> * Maybe<'a>)` | 末尾要素を取り出し、残りの `Vec` と `Maybe<'a>` の組を返す（組み込み） |
| `Vec.set` | `i64 -> 'a -> Vec<'a> -> Vec<'a>` | 指定位置の要素を置換した `Vec` を返す（範囲外はトラップ、組み込み） |
| `Vec.swap` | `i64 -> i64 -> Vec<'a> -> Vec<'a>` | 2つの位置の要素を入れ替えた `Vec` を返す（範囲外はトラップ、組み込み） |
| `Vec.remove_at` | `own i64 -> own Vec<'a> -> Vec<'a>` | 指定位置の要素を削除し後続要素を前詰めする |
| `Vec.remove_range` | `own i64 -> own i64 -> own Vec<'a> -> Vec<'a>` | `index` から `count` 個の要素を削除する |
| `Vec.remove` | `Eq<'a> => own 'a -> own Vec<'a> -> (Vec<'a> * bool)` | 最初に一致する要素を削除し、削除成否との組を返す |
| `Vec.remover` | `Eq<'a> => ref 'a -> own Vec<'a> -> (Vec<'a> * bool)` | 検索値を共有借用で受け取る `remove` |
| `Vec.remove_all` | `Copy<'a> => own ('a -> bool) -> own Vec<'a> -> (Vec<'a> * i64)` | 述語を満たす全要素を削除し、削除個数との組を返す |
| `Vec.remove_allr` | `own (ref 'a -> bool) -> own Vec<'a> -> (Vec<'a> * i64)` | 要素を共有借用で判定する `remove_all` |

### 反転・ソート・二分探索

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Vec.reverse` | `own Vec<'a> -> Vec<'a>` | 全要素の並び順を反転する |
| `Vec.reverse_range` | `own i64 -> own i64 -> own Vec<'a> -> Vec<'a>` | `index` から `count` 個の範囲のみを反転する |
| `Vec.sort` | `Ord<'a> => own Vec<'a> -> Vec<'a>` | `Ord` 昇順にインプレース安定ソートする（NaN は先頭） |
| `Vec.sort_range` | `Ord<'a> => own i64 -> own i64 -> own Vec<'a> -> Vec<'a>` | 指定範囲のみを `Ord` 昇順にインプレース安定ソートする |
| `Vec.sort_with` | `Copy<'a> => own ('a -> 'a -> i64) -> own Vec<'a> -> Vec<'a>` | 比較関数による安定ソート |
| `Vec.sort_range_with` | `Copy<'a> => own i64 -> own i64 -> own ('a -> 'a -> i64) -> own Vec<'a> -> Vec<'a>` | 指定範囲のみを比較関数で安定ソートする |
| `Vec.sort_withr` | `own (ref 'a -> ref 'a -> i64) -> own Vec<'a> -> Vec<'a>` | 共有参照を受け取る比較関数でインプレース安定ソートする |
| `Vec.sort_range_withr` | `own i64 -> own i64 -> own (ref 'a -> ref 'a -> i64) -> own Vec<'a> -> Vec<'a>` | 指定範囲を共有参照比較関数でインプレース安定ソートする |
| `Vec.binary_search` | `Ord<'a> => own 'a -> ref Vec<'a> -> i64` | 整列済み `Vec` を二分探索する（不在時は `-1 - 挿入位置`） |
| `Vec.binary_searchr` | `Ord<'a> => ref 'a -> ref Vec<'a> -> i64` | 検索値を共有借用で受け取る `binary_search` |
| `Vec.binary_search_with` | `Copy<'a> => own 'a -> own ('a -> 'a -> i64) -> ref Vec<'a> -> i64` | 比較関数を用いた二分探索 |
| `Vec.binary_search_withr` | `ref 'a -> own (ref 'a -> ref 'a -> i64) -> ref Vec<'a> -> i64` | 共有参照の比較関数を用いた二分探索 |
| `Vec.binary_search_range` | `Copy<'a> => own i64 -> own i64 -> own 'a -> own ('a -> 'a -> i64) -> ref Vec<'a> -> i64` | `index` から `count` 個の範囲に対する比較関数付き二分探索 |

### 線形探索・述語判定・走査・範囲複写

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Vec.contains` | `Eq<'a> => own 'a -> ref Vec<'a> -> bool` | 等しい要素が含まれるか判定する（IEEE `==` に従い NaN は一致しない） |
| `Vec.containsr` | `Eq<'a> => ref 'a -> ref Vec<'a> -> bool` | 検索値を共有借用で受け取る `contains` |
| `Vec.index_of` | `Eq<'a> => own 'a -> ref Vec<'a> -> i64` | 最初に一致する位置を返す（不在時は `-1`） |
| `Vec.index_ofr` | `Eq<'a> => ref 'a -> ref Vec<'a> -> i64` | 検索値を共有借用で受け取る `index_of` |
| `Vec.index_of_from` | `Eq<'a> => own 'a -> own i64 -> ref Vec<'a> -> i64` | `start` 以降で最初に一致する位置を返す（不在時は `-1`） |
| `Vec.index_of_range` | `Eq<'a> => own 'a -> own i64 -> own i64 -> ref Vec<'a> -> i64` | `start` から `count` 個の範囲で最初に一致する位置を返す |
| `Vec.last_index_of` | `Eq<'a> => own 'a -> ref Vec<'a> -> i64` | 最後に一致する位置を返す（不在時は `-1`） |
| `Vec.last_index_ofr` | `Eq<'a> => ref 'a -> ref Vec<'a> -> i64` | 検索値を共有借用で受け取る `last_index_of` |
| `Vec.last_index_of_from` | `Eq<'a> => own 'a -> own i64 -> ref Vec<'a> -> i64` | `start` から先頭方向へ探索して一致位置を返す |
| `Vec.last_index_of_range` | `Eq<'a> => own 'a -> own i64 -> own i64 -> ref Vec<'a> -> i64` | `start` から先頭方向へ `count` 個の範囲を探索する |
| `Vec.find_index` | `Copy<'a> => own ('a -> bool) -> ref Vec<'a> -> i64` | 述語を満たす最初の位置を返す（不在時は `-1`） |
| `Vec.find_indexr` | `own (ref 'a -> bool) -> ref Vec<'a> -> i64` | 共有参照述語による `find_index` |
| `Vec.find_index_from` | `Copy<'a> => own i64 -> own ('a -> bool) -> ref Vec<'a> -> i64` | `start` 以降で述語を満たす最初の位置を返す |
| `Vec.find_index_range` | `Copy<'a> => own i64 -> own i64 -> own ('a -> bool) -> ref Vec<'a> -> i64` | `start` から `count` 個の範囲で述語を満たす最初の位置を返す |
| `Vec.find_last_index` | `Copy<'a> => own ('a -> bool) -> ref Vec<'a> -> i64` | 述語を満たす最後の位置を返す（不在時は `-1`） |
| `Vec.find_last_indexr` | `own (ref 'a -> bool) -> ref Vec<'a> -> i64` | 共有参照述語による `find_last_index` |
| `Vec.find_last_index_from` | `Copy<'a> => own i64 -> own ('a -> bool) -> ref Vec<'a> -> i64` | `start` から先頭方向へ述語を満たす位置を探す |
| `Vec.find_last_index_range` | `Copy<'a> => own i64 -> own i64 -> own ('a -> bool) -> ref Vec<'a> -> i64` | `start` から先頭方向へ `count` 個の範囲で述語を満たす位置を探す |
| `Vec.find` | `Copy<'a> => own ('a -> bool) -> ref Vec<'a> -> Maybe<'a>` | 述語を満たす最初の要素を `Some` で返す（不在時は `None`） |
| `Vec.findr` | `own (ref 'a -> bool) -> ref Vec<'a> -> Maybe<ref 'a>` | 述語を満たす最初の要素への共有参照を `Some` で返す |
| `Vec.find_last` | `Copy<'a> => own ('a -> bool) -> ref Vec<'a> -> Maybe<'a>` | 述語を満たす最後の要素を `Some` で返す |
| `Vec.find_lastr` | `own (ref 'a -> bool) -> ref Vec<'a> -> Maybe<ref 'a>` | 述語を満たす最後の要素への共有参照を `Some` で返す |
| `Vec.find_all` | `Copy<'a> => own ('a -> bool) -> ref Vec<'a> -> Vec<'a>` | 述語を満たす全要素を複製した新しい `Vec` を返す |
| `Vec.exists` | `Copy<'a> => own ('a -> bool) -> ref Vec<'a> -> bool` | 述語を満たす要素が存在するか判定する |
| `Vec.existsr` | `own (ref 'a -> bool) -> ref Vec<'a> -> bool` | 共有参照述語による `exists` |
| `Vec.true_for_all` | `Copy<'a> => own ('a -> bool) -> ref Vec<'a> -> bool` | 全要素が述語を満たすか判定する（空の `Vec` は `true`） |
| `Vec.true_for_allr` | `own (ref 'a -> bool) -> ref Vec<'a> -> bool` | 共有参照述語による `true_for_all` |
| `Vec.for_each` | `Copy<'a> => own ('a -> unit) -> ref Vec<'a> -> unit` | 各要素に副作用関数を適用する |
| `Vec.for_eachr` | `own (ref 'a -> unit) -> ref Vec<'a> -> unit` | 各要素の共有参照に副作用関数を適用する |
| `Vec.convert_all` | `Copy<'a> => own ('a -> 'b) -> ref Vec<'a> -> Vec<'b>` | 各要素を変換した新しい `Vec` を返す（容量は要素数ちょうど） |
| `Vec.convert_allr` | `own (ref 'a -> 'b) -> ref Vec<'a> -> Vec<'b>` | 各要素の共有参照を変換した新しい `Vec` を返す |
| `Vec.get_range` | `Copy<'a> => own i64 -> own i64 -> ref Vec<'a> -> Vec<'a>` | `index` から `count` 個の部分範囲を複製した `Vec` を返す |
| `Vec.slice` | `Copy<'a> => own i64 -> own i64 -> ref Vec<'a> -> Vec<'a>` | `Vec.get_range` と同一 |
| `Vec.copy_to` | `Copy<'a> => ref mut ['a..] -> ref Vec<'a> -> unit` | 排他スライスの先頭へ全要素を複写する（容量不足はトラップ） |
| `Vec.copy_to_at` | `Copy<'a> => ref mut ['a..] -> own i64 -> ref Vec<'a> -> unit` | 排他スライスの指定位置から全要素を複写する |
| `Vec.copy_to_range` | `Copy<'a> => own i64 -> ref mut ['a..] -> own i64 -> own i64 -> ref Vec<'a> -> unit` | `Vec` の `src_idx` から `count` 個を排他スライスの `dst_idx` へ複写する |

## 計算量

以下の表は `std/Vec.tz` の `@complexity` タグから自動生成された時間計算量です。これに加え、組み込み操作の `Vec.push` / `push_mut` / `push_owned` は償却 $O(1)$（再確保時 $O(n)$）、`Vec.pop`・`v[i]`・`Vec.at`・`Vec.get`・`Vec.set`・`Vec.swap`・`Vec.length`・`Vec.capacity`・`Vec.is_empty`・`Vec.of_array`・`Vec.to_array` は $O(1)$、`Vec.clear`・`Vec.truncate` は破棄要素数 $k$ に対し $O(k)$、`Vec.clone` は $O(n)$ です。

<!-- generated:complexity:Vec -->
| 関数 | 計算量 | 関連 |
| --- | --- | --- |
| `Vec.iter` | $O(1)$ | - |
| `Vec.of_seq` | $O(n)$ | - |
| `Vec.of_list` | $O(n)$ | - |
| `Vec.set_capacity` | $O(k)$ | - |
| `Vec.ensure_capacity` | $O(k)$ | - |
| `Vec.trim_excess` | $O(n)$ | - |
| `Vec.add` | 償却 $O(1)$、最悪 $O(n)$ | - |
| `Vec.add_range` | 償却 $O(m)$、最悪 $O(n + m)$ | - |
| `Vec.add_range_seq` | 償却 $O(m)$、最悪 $O(n + m)$ | - |
| `Vec.append` | 償却 $O(m)$、最悪 $O(n + m)$ | - |
| `Vec.insert` | $O(n)$ | - |
| `Vec.insert_range` | $O(n + m)$ | - |
| `Vec.insert_range_seq` | $O(n + m)$ | - |
| `Vec.remove_at` | $O(n)$ | - |
| `Vec.remove_range` | $O(n)$ | - |
| `Vec.remover` | $O(n)$ | `Vec.remove` |
| `Vec.remove` | $O(n)$ | `Vec.remover` |
| `Vec.remove_allr` | $O(n)$ | `Vec.remove_all` |
| `Vec.remove_all` | $O(n)$ | `Vec.remove_allr` |
| `Vec.reverse` | $O(n)$ | - |
| `Vec.reverse_range` | $O(n)$ | - |
| `Vec.sort_range` | $O(n \log^2 n)$ | - |
| `Vec.sort` | $O(n \log^2 n)$ | - |
| `Vec.sort_range_with` | $O(n \log n)$ | `Vec.sort_range_withr` |
| `Vec.sort_with` | $O(n \log n)$ | `Vec.sort_withr` |
| `Vec.sort_range_withr` | $O(n \log^2 n)$ | `Vec.sort_range_with` |
| `Vec.sort_withr` | $O(n \log^2 n)$ | `Vec.sort_with` |
| `Vec.index_ofr` | $O(n)$ | `Vec.index_of` |
| `Vec.index_of` | $O(n)$ | `Vec.index_ofr` |
| `Vec.index_of_from` | $O(n)$ | - |
| `Vec.index_of_range` | $O(n)$ | - |
| `Vec.last_index_ofr` | $O(n)$ | `Vec.last_index_of` |
| `Vec.last_index_of` | $O(n)$ | `Vec.last_index_ofr` |
| `Vec.last_index_of_from` | $O(n)$ | - |
| `Vec.last_index_of_range` | $O(n)$ | - |
| `Vec.containsr` | $O(n)$ | `Vec.contains` |
| `Vec.contains` | $O(n)$ | `Vec.containsr` |
| `Vec.find_indexr` | $O(n)$ | `Vec.find_index` |
| `Vec.find_index` | $O(n)$ | `Vec.find_indexr` |
| `Vec.find_index_from` | $O(n)$ | - |
| `Vec.find_index_range` | $O(n)$ | - |
| `Vec.find_last_indexr` | $O(n)$ | `Vec.find_last_index` |
| `Vec.find_last_index` | $O(n)$ | `Vec.find_last_indexr` |
| `Vec.find_last_index_from` | $O(n)$ | - |
| `Vec.find_last_index_range` | $O(n)$ | - |
| `Vec.existsr` | $O(n)$ | `Vec.exists` |
| `Vec.exists` | $O(n)$ | `Vec.existsr` |
| `Vec.true_for_allr` | $O(n)$ | `Vec.true_for_all` |
| `Vec.true_for_all` | $O(n)$ | `Vec.true_for_allr` |
| `Vec.findr` | $O(n)$ | `Vec.find` |
| `Vec.find` | $O(n)$ | `Vec.findr` |
| `Vec.find_lastr` | $O(n)$ | `Vec.find_last` |
| `Vec.find_last` | $O(n)$ | `Vec.find_lastr` |
| `Vec.find_all` | $O(n)$ | - |
| `Vec.binary_searchr` | $O(\log n)$ | `Vec.binary_search` |
| `Vec.binary_search` | $O(\log n)$ | `Vec.binary_searchr` |
| `Vec.binary_search_withr` | $O(\log n)$ | `Vec.binary_search_with` |
| `Vec.binary_search_with` | $O(\log n)$ | `Vec.binary_search_withr` |
| `Vec.binary_search_range` | $O(\log n)$ | - |
| `Vec.for_eachr` | $O(n)$ | `Vec.for_each` |
| `Vec.for_each` | $O(n)$ | `Vec.for_eachr` |
| `Vec.convert_allr` | $O(n)$ | `Vec.convert_all` |
| `Vec.convert_all` | $O(n)$ | `Vec.convert_allr` |
| `Vec.get_range` | $O(k)$ | - |
| `Vec.slice` | $O(k)$ | - |
| `Vec.copy_to_range` | $O(n)$ | - |
| `Vec.copy_to_at` | $O(n)$ | - |
| `Vec.copy_to` | $O(n)$ | - |
<!-- /generated:complexity:Vec -->

## 反復走査

`Vec` は `for x in v do ...` で直接走査でき、ループ変数は読み取り専用の要素ビューとなります（非 `Copy` 要素もコピーせずにフィールド等を参照可能）。`Seq` パイプラインへ渡す場合は `Vec.iter v` で `Seq<ref 'a>` を取得します。

```tsuzuri run=letters%3D6%20via_iter%3D6
let mut words: Vec<string> = Vec.empty()
Vec.push "ab" words
Vec.push "cdef" words

let mut letters = 0
for w in words do
    letters = letters + w.length

let mut via_iter = 0
for w in Vec.iter words do
    via_iter = via_iter + w.length

$"letters={letters} via_iter={via_iter}"
```

## 関連項目

- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [Array](./array.md)
- [List](./list.md)
- [Seq](./seq.md)
- [所有権とムーブ](../../ownership/ownership-and-move.md)
- [借用と参照](../../ownership/borrowing.md)
