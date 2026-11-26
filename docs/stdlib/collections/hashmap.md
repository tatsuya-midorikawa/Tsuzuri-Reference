# HashMap

`HashMap<'key, 'value>` は、オープンアドレス法と密なエントリ配列を組み合わせた高速な連想配列です。平均 **$O(1)$** で検索・挿入・削除を行え、反復走査はエントリ配列に沿って決定論的かつキャッシュ効率よく実行されます。

`HashMap.randomized` および `HashMap.try_randomized` を呼び出すパッケージには `random` 権限が必要です（[パッケージ管理と権限](../../modules/packages.md)）。また `HashMap` は予約モジュール名であり、同名のユーザーファイルは `E1011` となります。

## 要点

- 型は `HashMap<'key, 'value>` で、常に非 `Copy` 型です（内部構造は不透明であり、フィールド参照・分解は `E1022`、`export def` での公開は `E1008` となります）。
- キー型には `Hash<'key>` と `Eq<'key>` が必要です（`Ord` は不要。ユーザー定義型では `deriving (Eq, Hash)` で自動導出可能）。比較前に反射性 `Eq.eq key key` を検査するため、`NaN` を含むキーは空マップへの検索でもトラップします（`-0.0` と `+0.0` は等価なキーとして扱われます）。
- キーの所有権を消費しない借用版 API（`contains_key_ref`、`get_ref`、`at_ref`、`try_at_ref`、`remove_ref`）と、`Copy<'value>` 向けのブラケット添字 `map[key]`（`Index` インスタンス）を備えています。
- 反復順序はハッシュ値やシードに依存しない**挿入順**ですが、`remove` / `remove_ref` は末尾エントリを削除位置へ詰める **swap-remove** を行うため、削除後は末尾要素がその位置へ移動します。
- 信頼できない外部入力に対する HashDoS 対策として、SipHash-1-3 で鍵付き混合を行う `with_seed`・`with_capacity_and_seed`・`randomized`・`try_randomized` を提供します。

## 生成・更新・要素アクセス

### 基本操作とブラケット添字

空マップは `HashMap.empty()`（0引数関数のため括弧を密着させます）、事前容量確保は `HashMap.with_capacity count`（`0 <= count <= 2^60`、範囲外はトラップ）で生成します。既存キーへの `HashMap.insert` はキー代表値と並び位置を保ったまま値のみを置換します。

```tsuzuri run=len%3D3%20alice%3D100%20bob%3D85
let scores =
    HashMap.empty()
    |> HashMap.insert "Alice" 90
    |> HashMap.insert "Bob" 85
    |> HashMap.insert "Charlie" 95
    |> HashMap.insert "Alice" 100

let alice = scores["Alice"]
let bob = HashMap.get "Bob" scores |> Maybe.default_value 0
$"len={HashMap.length scores} alice={alice} bob={bob}"
```

### キーを消費しない借用版 API（`*_ref` と `try_at_ref`）

`string` などの非 `Copy` キーを手元に残したまま検索・削除したい場合は `*_ref` 関数を使用します。

- **`HashMap.at_ref {r s}`**: マップの領域 `r` とキーの領域 `s` が分離されているため、取得した値参照 `ref {r} 'value` は一時的な検索キーの寿命に縛られず、マップが生存している限り有効です。
- **`HashMap.try_at_ref`**: 1回のハッシュ探査で `Maybe<ref 'value>` を返します（`contains_key_ref` と `at_ref` に分ける2回探査を回避できます）。ただし `Maybe` 内の参照はキーとマップ双方の借用を引き継ぐため、検索キーより長く参照を保持したい場合は `at_ref` を使用します。

```tsuzuri run=found%3D300%20missing%3Dnone%20key_kept%3Dtea
let menu = HashMap.empty() |> HashMap.insert "tea" 300 |> HashMap.insert "cake" 500
let key = "tea"
let other = "milk"

let found = match HashMap.try_at_ref (ref key) menu with
    | Some price -> to_string (deref price)
    | None -> "none"
let missing = match HashMap.try_at_ref (ref other) menu with
    | Some price -> to_string (deref price)
    | None -> "none"

$"found={found} missing={missing} key_kept={key}"
```

## 引数の順序

シード計算補助の `HashMap.sip13` や引数なしの生成関数を除き、すべての操作関数は対象の `HashMap` を**最後の引数**にとります（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。

```tsuzuri run=len%3D1%20val%3D10%20has2%3Dfalse
let update = HashMap.insert 1 10 >> HashMap.remove 2
let table = HashMap.empty() |> HashMap.insert 2 20 |> update
$"len={HashMap.length table} val={HashMap.at 1 table} has2={HashMap.contains_key 2 table}"
```

## 反復順序と swap-remove

`HashMap` の走査（`iter`、`fold`、`keys`、`values`、`to_array`）は内部の密な `entries` 配列を先頭から順にたどります。削除を行わない限り厳密な挿入順となり、シード値やターゲット環境（ネイティブ / WASM）によって順序が変動することはありません。

一方、`remove` / `remove_ref` は $O(1)$ を維持するために末尾エントリを空いたインデックスへ移動（swap-remove）します。

```tsuzuri run=keys%3D%5B10%2C%2040%2C%2030%5D
let m =
    HashMap.empty()
    |> HashMap.insert 10 "a"
    |> HashMap.insert 20 "b"
    |> HashMap.insert 30 "c"
    |> HashMap.insert 40 "d"
    |> HashMap.remove 20

$"keys={HashMap.keys m}"
```

`[10, 20, 30, 40]` から `20` を削除したことで、末尾の `40` がインデックス `1` に移動し、`[10, 40, 30]` となります。なお、`for x in map` と直接書くことはできないため（`E1005`）、ループ走査には `for (k, v) in HashMap.iter map` を使用します。

## シード設定と HashDoS 対策

`HashMap.empty()` と `with_capacity` は高速な固定混合関数（MurmurHash3 系の fmix64）を使用します。外部ネットワーク入力など攻撃者がキーを選べる環境では、スロット衝突を誘発する HashDoS を防ぐため、128ビット鍵付き **SipHash-1-3** でスロット位置を分散させる以下のコンストラクタを使用します。

- **`HashMap.with_seed seed`** / **`HashMap.with_capacity_and_seed count seed`**: 指定した `i64u` シードを SplitMix64 で128ビット鍵に展開して使用します。
- **`HashMap.randomized ()`** / **`HashMap.try_randomized ()`**: OS の乱数源（`Random.next_u64 ()`）からシードを取得する `IO` アクションです（`unit` 引数をとるため `HashMap.randomized ()` のように呼び出します。OS API を持たない既定の `wasm32` ターゲットでは `E2000` となるため、ホストから渡したシードで `with_seed` を呼びます）。

```tsuzuri run=20%20true
let seeded =
    HashMap.with_capacity_and_seed 16 2028i64u
    |> HashMap.insert "x" 10
    |> HashMap.insert "y" 20

$"{ seeded["y"] } {HashMap.longest_probe seeded >= 0}"
```

なお、SipHash-1-3 は `Hash.hash` が返した64ビットダイジェストに対して鍵付き最終混合を行います。完全な64ビットハッシュ衝突自体を排除したい信頼不能入力に対しては、最悪でも比較 $O(\log n)$ が保証される順序付き [Map](./map.md) の使用も有効です。

## 公開関数一覧（全25関数）

### 生成・シード・診断

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `HashMap.empty` | `HashMap<'key, 'value>` | 固定混合の空マップを生成する（`HashMap.empty()` で呼び出す） |
| `HashMap.with_capacity` | `own i64 -> HashMap<'key, 'value>` | `count` 件まで再確保なしで格納できる空マップを生成する（負荷率上限 0.5） |
| `HashMap.with_seed` | `own i64u -> HashMap<'key, 'value>` | 指定シードによる SipHash-1-3 混合を行う空マップを生成する |
| `HashMap.with_capacity_and_seed` | `own i64 -> own i64u -> HashMap<'key, 'value>` | 容量事前確保とシード指定を同時に行う空マップを生成する |
| `HashMap.randomized` | `own unit -> IO<HashMap<'key, 'value>>` | OS 乱数シードで初期化する `IO` アクション（乱数取得失敗時はトラップ、`random` 権限） |
| `HashMap.try_randomized` | `own unit -> IO<Result<HashMap<'key, 'value>, Os.Error>>` | OS 乱数シードで初期化し失敗を `Result.Error` で返す `IO` アクション（`random` 権限） |
| `HashMap.length` | `ref HashMap<'key, 'value> -> i64` | エントリ数を返す |
| `HashMap.is_empty` | `ref HashMap<'key, 'value> -> bool` | エントリ数が `0` であれば `true` を返す |
| `HashMap.longest_probe` | `ref HashMap<'key, 'value> -> i64` | 理想スロットからの最大線形探査距離を返す（空マップは `0`、診断用） |
| `HashMap.sip13` | `own i64u -> own i64u -> own i64u -> i64u` | 128ビット鍵 `(key0, key1)` による1ワード（64ビット）の SipHash-1-3 を計算する |

### 検索・参照取得・更新・削除

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `HashMap.contains_key` | `(Hash<'key>, Eq<'key>) => own 'key -> ref HashMap<'key, 'value> -> bool` | キーを消費して存在判定を行う |
| `HashMap.contains_key_ref` | `(Hash<'key>, Eq<'key>) => ref 'key -> ref HashMap<'key, 'value> -> bool` | キーを共有借用して存在判定を行う |
| `HashMap.get` | `(Hash<'key>, Eq<'key>, Copy<'value>) => own 'key -> ref HashMap<'key, 'value> -> Maybe<'value>` | キーを消費し、対応する値のコピーを `Some`（不在なら `None`）で返す |
| `HashMap.get_ref` | `(Hash<'key>, Eq<'key>, Copy<'value>) => ref 'key -> ref HashMap<'key, 'value> -> Maybe<'value>` | キーを共有借用し、対応する値のコピーを `Some`（不在なら `None`）で返す |
| `HashMap.at` | `(Hash<'key>, Eq<'key>) => own 'key -> ref HashMap<'key, 'value> -> ref 'value` | キーを消費し、値への共有参照を返す（不在時はトラップ） |
| `HashMap.at_ref` | `{r s} :: (Hash<'key>, Eq<'key>) => ref {s} 'key -> ref {r} HashMap<'key, 'value> -> ref {r} 'value` | キーを共有借用し、マップの領域 `r` に紐づく値参照を返す（不在時はトラップ） |
| `HashMap.try_at_ref` | `(Hash<'key>, Eq<'key>) => ref 'key -> ref HashMap<'key, 'value> -> Maybe<ref 'value>` | キーを共有借用し、1回の探査で `Maybe<ref 'value>` を返す |
| `HashMap.insert` | `(Hash<'key>, Eq<'key>) => own 'key -> own 'value -> own HashMap<'key, 'value> -> HashMap<'key, 'value>` | エントリを追加または値を上書きした新しいマップを返す |
| `HashMap.remove` | `(Hash<'key>, Eq<'key>) => own 'key -> own HashMap<'key, 'value> -> HashMap<'key, 'value>` | キーを消費して対象エントリを swap-remove したマップを返す |
| `HashMap.remove_ref` | `(Hash<'key>, Eq<'key>) => ref 'key -> own HashMap<'key, 'value> -> HashMap<'key, 'value>` | キーを共有借用して対象エントリを swap-remove したマップを返す |

### 変換・畳み込み・反復

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `HashMap.to_array` | `(Copy<'key>, Copy<'value>) => ref HashMap<'key, 'value> -> [('key * 'value)]` | エントリ配列順の `(key, value)` タプル配列を返す |
| `HashMap.keys` | `Copy<'key> => ref HashMap<'key, 'value> -> ['key]` | エントリ配列順のキー配列を返す |
| `HashMap.values` | `Copy<'value> => ref HashMap<'key, 'value> -> ['value]` | エントリ配列順の値配列を返す |
| `HashMap.fold` | `own ('state -> ref 'key -> ref 'value -> 'state) -> own 'state -> ref HashMap<'key, 'value> -> 'state` | エントリ配列順にキーと値を共有借用して左畳み込みを行う |
| `HashMap.iter` | `ref HashMap<'key, 'value> -> Seq<(ref 'key * ref 'value)>` | エントリ配列順に `(ref 'key * ref 'value)` を列挙する遅延 `Seq` を返す |

## 計算量

以下の表は `std/HashMap.tz` の `@complexity` タグから自動生成された時間計算量です。平均・償却計算量はハッシュ値が一様に分散する前提の値であり、`longest_probe`・`with_capacity` 系の `k` は内部スロット表サイズを表します。

<!-- generated:complexity:HashMap -->
| 関数 | 計算量 | 関連 |
| --- | --- | --- |
| `HashMap.empty` | $O(1)$ | - |
| `HashMap.length` | $O(1)$ | - |
| `HashMap.is_empty` | $O(1)$ | - |
| `HashMap.sip13` | $O(1)$ | - |
| `HashMap.with_capacity` | $O(k)$ | - |
| `HashMap.with_seed` | $O(1)$ | - |
| `HashMap.with_capacity_and_seed` | $O(k)$ | - |
| `HashMap.try_randomized` | $O(1)$ | - |
| `HashMap.randomized` | $O(1)$ | - |
| `HashMap.contains_key_ref` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.contains_key` |
| `HashMap.contains_key` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.contains_key_ref` |
| `HashMap.get_ref` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.get` |
| `HashMap.get` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.get_ref` |
| `HashMap.at_ref` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.at` |
| `HashMap.try_at_ref` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.at_ref` |
| `HashMap.at` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.at_ref` |
| `HashMap.insert` | 償却 $O(1)$、最悪 $O(n \cdot n)$ | - |
| `HashMap.remove_ref` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.remove` |
| `HashMap.remove` | 平均 $O(1)$、最悪 $O(n)$ | `HashMap.remove_ref` |
| `HashMap.longest_probe` | $O(k)$ | - |
| `HashMap.to_array` | $O(n)$ | - |
| `HashMap.keys` | $O(n)$ | - |
| `HashMap.values` | $O(n)$ | - |
| `HashMap.fold` | $O(n)$ | - |
| `HashMap.iter` | $O(1)$ | - |
<!-- /generated:complexity:HashMap -->

## 関連項目

- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [HashSet](./hashset.md)
- [Map](./map.md)
- [Seq](./seq.md)
- [Random](../sys/random.md)
- [型クラスと制約](../../types/type-classes.md)
- [生存期間と領域（リージョン）](../../ownership/lifetimes.md)
