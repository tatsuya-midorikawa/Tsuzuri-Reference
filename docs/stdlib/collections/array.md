# Array

`Array` は、同一型の要素を連続したメモリ領域に格納する所有配列モジュールです。配列型は `[T]`（または `Array<T>`）と表記し、一度生成された配列の要素数は変化しません。インデックス添字 `xs[i]` による読み取りは $O(1)$ で動作し、連続メモリレイアウトを活かした高速走査、スライス参照、インプレース更新、数値集計、データ並列処理の基盤となります。

`Array.random_choice`・`Array.random_choices`・`Array.random_sample`・`Array.random_shuffle`・`Array.random_shuffle_in_place`（OS 乱数を使用する5関数）を呼び出すパッケージには `random` 権限が必要です（[パッケージ管理と権限](../../modules/packages.md)）。

## 要点

- 型は `[T]`（別名 `Array<T>`）です。コンパイル時定数長のインライン固定長配列 `[T; N]` とは別の型であり、`Array` という識別子は予約されています（再定義は `E1001`）。
- F# の `Array` モジュール（`Array.Parallel` を除く）の全関数を `snake_case` 名で網羅し、さらに Tsuzuri 独自の参照アクセス・スライス更新・高精度浮動小数点集計を備えています（`std/Array.tz` 公開155関数およびコンパイラ組み込み関数）。
- すべての関数で**操作対象の配列が最後の引数**に統一されているため、`xs |> Array.filter p |> Array.map f` や `Array.sort >> Array.rev` のように自在に合成できます。
- Edition 2028 では、半開区間スライス `ref xs[a..<b]`、閉区間スライス `ref xs[a..=b]`（および `ref xs[a..b]`）、開境界 `<..` / `<..<`、末尾相対インデックス `^k`（`^0` が末尾要素）をサポートします。
- Edition 2027 以降では、`map`・`mapi`・`iter`・`iteri`・`fold`・`fold_back` のコールバックは要素の読み取りビューを受け取るため、非 `Copy` 型の要素もそのまま処理できます。
- 境界外アクセス、空配列に対する先頭・最小値取得、2配列間の長さ不一致などは例外ではなく即座にトラップします。失敗を値として扱う場合は `try_` 接頭辞付きの関数（`Maybe` を返す）を使用します。

## 標準コレクションの選択指針

格納するデータの性質とアクセスパターンに応じて、以下の8種類の標準コレクションを使い分けます。

| コレクション | 型表記 | 所有と更新モデル | 要素参照 / 検索 | 追加・伸縮 | 主な用途 |
| --- | --- | --- | --- | --- | --- |
| **Array** | `[T]` | 長さ固定。排他スライスでインプレース更新可 | 添字 $O(1)$ | 新規配列を確保 | 連続メモリ走査・数値計算・スライス処理 |
| **[Vec](./vec.md)** | `Vec<T>` | 所有バッファ。排他借用 `push` または消費更新 | 添字 $O(1)$ | 末尾追加 償却 $O(1)$ | 動的に要素数が増減する作業バッファ |
| **[List](./list.md)** | `[\|T\|]` | 単一所有のチャンク連結リスト | 先頭・長さ $O(1)$ | 先頭 `cons` 償却 $O(1)$ | パターンマッチ・再帰アルゴリズム |
| **[Seq](./seq.md)** | `Seq<T>` | 1回消費（single-use）の遅延ジェネレータ | 順次取得のみ | 遅延ステップ合成 | 中間配列を作らないパイプライン・無限列 |
| **[Map](./map.md)** | `Map<K, V>` | 値セマンティクス（ソート済みチャンク列） | 二分探索 $O(\log n)$ | 比較 $O(\log n)$ + チャンク更新 | `Ord` キーによる昇順走査・範囲処理 |
| **[Set](./set.md)** | `Set<K>` | 値セマンティクス（ソート済みチャンク列） | 二分探索 $O(\log n)$ | 比較 $O(\log n)$ + チャンク更新 | `Ord` 要素の順序付き集合演算 |
| **[HashMap](./hashmap.md)** | `HashMap<K, V>` | 値セマンティクス（オープンアドレス表） | 平均 $O(1)$ | 平均償却 $O(1)$ | `Hash + Eq` キーによる高速検索 |
| **[HashSet](./hashset.md)** | `HashSet<K>` | 値セマンティクス（オープンアドレス表） | 平均 $O(1)$ | 平均償却 $O(1)$ | `Hash + Eq` 要素の高速メンバーシップ判定 |

## 生成と固定長配列 `[T; N]`

### リテラルと生成関数

配列リテラルは `[10, 20, 30]` のように角括弧で記述します。空配列 `[]` や `Array.empty()` は、型注釈または呼び出し先の引数型から要素型が推論できる文脈で使用します。動的な長さの配列は `new [T](length, initializer)` または `Array.init length initializer` で生成します。

```tsuzuri run=first%3D10%20squares%3D%5B0%2C%201%2C%204%2C%209%5D%20zeros%3D%5B0%2C%200%2C%200%5D
let numbers = [10, 20, 30]
let squares = new [i64](4, \i -> i * i)
let zeros: [i64] = Array.zero_create 3
$"first={numbers[0]} squares={squares} zeros={zeros}"
```

`new [T](length, f)` の `length` には任意の整数型（`i8`〜`i128`、`i8u`〜`i128u`）を指定でき、コールバック `f` には `0` から `length - 1` までの `i64` インデックスが昇順に渡されます。負の長さや `i64` の上限を超える長さはトラップします。

### インライン固定長配列 `[T; N]` と `FixedArray.init`

要素数 `N`（`0 <= N <= 1024` のコンパイル時整数定数。上限超過は `E1010`）を型に含む `[T; N]` は、ヒープ確保を行わず値そのものの中に要素をインライン保持します。期待型が `[T; N]` である位置では、リテラルまたは組み込み関数 `FixedArray.init` で初期化できます（型が定まらない場合は `E1015`）。

```tsuzuri run=sum%3D160
let triple: [i64; 3] = [10, 20, 30]
let generated: [i64; 4] = FixedArray.init (\i -> (i + 1) * 10)
$"sum={Array.sum triple + Array.sum generated}"
```

束縛名・レコードフィールド・参照外しなどの場所表現を持つ `[T; N]` は、`ref [T]` を受け取る関数へ `Array.sum triple` のように直接渡して共有スライスへ暗黙変換できます（`ref triple` と書くと `ref [T; N]` 型になるため `ref` は付けません）。なお `[T; N]` に対して直接の `for x in triple`、排他スライス取得、パターン分解を行うことはできません（添字ループ `for i in 0 ..< triple.length` を使用します）。

## 要素アクセス・末尾相対添字・スライス（Edition 2028）

### インデックス添字と末尾相対位置 `^k`

要素の読み取り `xs[i]` には、`i8`〜`i128` および `i8u`〜`i128u` のすべての整数型を変換なしで指定できます（整数以外の型は `E1003`）。負の値、`xs.length` 以上の値、`i64` に収まらない巨大な整数値は折り返さずに必ずトラップします。

負の整数リテラルを直接添字に書く `xs[-1]` は末尾要素を指さず実行時トラップとなるため、コンパイラは警告 `W1014`（`negative_literal_index`）を発します。Edition 2028 では、配列末尾からの相対位置を **`^k`**（長さ $n$ に対してインデックス $n - 1 - k$）で指定できます。**`^0` が最後の要素**（`xs.length - 1`）、`^1` が末尾から2番目の要素です。

```tsuzuri run=20%2040%2040%2030
let values = [10, 20, 30, 40]
let idx_u32 = 1i32u
$"{values[idx_u32]} {values[3i128]} {values[^0]} {values[^1]}"
```

ループ境界や事前条件ガードによって `i64` インデックスや定数添字が確実に `[0, xs.length)` に収まるとコンパイラが証明できた箇所では、実行時の境界検査命令が自動的に除去されます。

### 共有スライス `ref xs[...]`

配列の連続した部分領域をコピーせずに共有参照 `ref [T]` として切り出すには、`ref xs[範囲]` を使用します（裸の `xs[a..<b]` や両端省略の `ref xs[..]` は構文エラー `E0002` です。配列全体の共有参照は `ref xs` と記述します）。

Edition 2028 では、端点の開閉を記号で明確に区別します。

- **半開区間（終端を含まない）**: `ref xs[start..<end]`、`ref xs[..<end]`
- **閉区間（両端を含む）**: `ref xs[start..=end]`、`ref xs[..=end]`（Edition 2028 では裸の `ref xs[start..end]` / `ref xs[..end]` も閉区間として動作します。Edition 2026・2027 では半開区間であり、警告 `W1013` が報告されます）
- **始端から末尾まで**: `ref xs[start..]`（始端を含む）、`ref xs[start<..]`（始端を除く）
- **左開区間**: `ref xs[start<..end]`（始端を除き終端を含む）、`ref xs[start<..<end]`（両端を除く）

`xs = [10, 20, 30, 40, 50]`（長さ `5`）に対する Edition 2028 のスライス評価と正規化後の半開境界 `[lo, hi)` は次のとおりです。`0 <= lo <= hi <= xs.length` を満たせば有効（`lo == hi` は空スライス `[]`）であり、範囲外はトラップします。

| スライス式（Edition 2028） | 切り出される要素 | 半開境界 `[lo, hi)` | 説明 |
| --- | --- | --- | --- |
| `ref xs[1..<3]` | `[20, 30]` | `[1, 3)` | インデックス `1` 以上 `3` 未満（半開区間） |
| `ref xs[1..=3]` / `ref xs[1..3]` | `[20, 30, 40]` | `[1, 4)` | インデックス `1` から `3` まで（閉区間） |
| `ref xs[1<..3]` / `ref xs[1<..<3]` | `[30, 40]` / `[30]` | `[2, 4)` / `[2, 3)` | 始端 `1` を除外する区間 |
| `ref xs[..<2]` / `ref xs[..=2]` | `[10, 20]` / `[10, 20, 30]` | `[0, 2)` / `[0, 3)` | 先頭からの半開区間・閉区間 |
| `ref xs[2..]` / `ref xs[2<..]` | `[30, 40, 50]` / `[40, 50]` | `[2, 5)` / `[3, 5)` | 指定位置から末尾まで |
| `ref xs[1..^1]` / `ref xs[..<^0]` | `[20, 30, 40]` / `[10, 20, 30, 40]` | `[1, 4)` / `[0, 4)` | 末尾相対位置 `^k` との組み合わせ |
| `ref xs[2..<2]` / `ref xs[2..1]` | `[]` | `[2, 2)` | 長さ `0` の空スライス |

```tsuzuri run=half%3D%5B20%2C%2030%5D%20closed%3D%5B20%2C%2030%2C%2040%5D%20init%3D%5B10%2C%2020%2C%2030%2C%2040%5D%20sum%3D50
let xs = [10, 20, 30, 40, 50]
let half_slice = ref xs[1..<3]
let half: [i64] = deref half_slice
let closed: [i64] = deref (ref xs[1..=3])
let init: [i64] = deref (ref xs[..<^0])
$"half={half} closed={closed} init={init} sum={Array.sum half_slice}"
```

配列スライスは連続メモリを表すため、ステップ付き範囲（`ref xs[0..2..4]`）は `E1005` となります。多次元添字やストライド付きビューが必要な場合は [Matrix](../numeric/matrix.md) や [Tensor](../numeric/tensor.md) を使用します。

### 排他スライス `ref mut` とインプレース更新・関数的更新

`let mut` で束縛された配列は、添字代入 `xs[i] = v`、または排他スライス `ref mut xs[start..<end]`（配列全体なら `ref mut xs[0..]`、または `ref mut [T..]` を受け取る関数への直接渡し）によってその場で要素を書き換えられます。

```tsuzuri run=target%3D%5B12%2C%2013%2C%202%2C%20100%2C%20100%2C%209%5D%20sorted%3D%5B30%2C%2020%2C%2010%5D
let mut target = [0, 1, 2, 3, 4, 5]
Array.fill 3 2 100 target
Array.blit 0 0 2 [12, 13, 14] target
target[^0] = 9

let mut words = [30, 10, 20]
Array.sort_in_place_by (\x -> -x) words
$"target={target} sorted={words}"
```

`Array.split_at_mut index slice` は排他スライスを2つの非重複な排他スライス `(left, right)` に分割します。ただし片方をさらに部分スライスとして再借用している間にもう片方へアクセスすると借用検査エラー `E1014` となるため、再借用スコープを分けて順次処理します。

元の配列を変更せず更新後の新しい配列を得るには、`Array.update_at`・`Array.update`・`Array.swap`・`Array.insert_at`・`Array.remove_at` を使用します。`update_at`・`update`・`swap` は所有配列を受け取り、呼び出し後に元の局所変数が使われないことをコンパイラが確認できた場合は内部バッファをコピーなしで再利用します。

## 引数の順序と F# `Array` モジュールとの対応

### 引数の順序

`Array` モジュールのすべての関数は、操作対象の配列（または排他スライス）を**最後の引数**にとります（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。F# の `Array` モジュールで配列が末尾になかった以下の9関数も、パイプラインと部分適用合成を統一するため配列が末尾に移されています。

| 関数 | Tsuzuri の引数順 | F# の引数順 |
| --- | --- | --- |
| `get` / `item` | `Array.get index array` | `Array.get array index` |
| `set` / `write` | `Array.set index value slice` | `Array.set array index value` |
| `sub` | `Array.sub start count array` | `Array.sub array start count` |
| `fill` | `Array.fill start count value slice` | `Array.fill target index count value` |
| `blit` | `Array.blit src_idx dst_idx count src dst` | `Array.blit src srcIdx dst dstIdx count` |
| `fold_back` | `Array.fold_back folder state array` | `Array.foldBack folder array state` |
| `fold_back2` | `Array.fold_back2 folder state array1 array2` | `Array.foldBack2 folder array1 array2 state` |
| `scan_back` | `Array.scan_back folder state array` | `Array.scanBack folder array state` |
| `map_fold_back` | `Array.map_fold_back mapping state array` | `Array.mapFoldBack mapping array state` |

```tsuzuri run=top%3D%5B9%2C%204%5D%20folded%3D321
let sort_down = Array.sort >> Array.rev
let top = [4, 9, 1] |> sort_down |> Array.take 2
let folded = [1, 2, 3] |> Array.fold_back (\x acc -> acc * 10 + x) 0
$"top={top} folded={folded}"
```

### コールバックの借用モード（Edition 2027 以降・`r` 形・`_owned` 形）

- **Edition 2027 / 2028 の読み取りビュー**: `map`・`mapi`・`iter`・`iteri`・`fold`・`fold_back` の6関数は、コールバックに要素の読み取りビューを渡します。コールバック内で `deref` を書かずにフィールドやメソッドへアクセスでき、`string` などの非 `Copy` 要素を持つ配列にもそのまま適用できます（ラムダ引数を `\(s: ref string) -> ...` と注釈すれば明示参照としても受け取れます）。
- **明示参照の `r` 形**: `mapr`・`mapir`・`iterr`・`iterir`・`foldr`・`foldr_back`・`existsr`・`forallr`・`countr`・`findr`・`try_findr`・`minr`・`maxr`・`containsr`・`to_seqr` は、エディションを問わず常に共有参照 `ref 'a` を扱います。なお `findr`・`minr`・`maxr` は配列内部を指す参照を返すため、一時配列にパイプライン合成すると寿命違反 `E1013` になります（配列を変数に束縛してから呼び出します）。
- **所有値コールバック `_owned` 形**: `map_owned`・`mapi_owned`・`iter_owned`・`iteri_owned`・`fold_owned`・`fold_back_owned`、および `filter`・`choose`・`partition` などの値コールバック関数は要素の複製を行うため `Copy<'a>` を要求します。

```tsuzuri run=lengths%3D%5B5%2C%203%2C%206%5D%20long_count%3D2%20has_fig%3Dtrue
let names = ["apple", "fig", "banana"]
let lengths = Array.map (\s -> s.length) names
let long_count = Array.countr (\s -> s.length > 4) names
let has_fig = Array.containsr "fig" names
$"lengths={lengths} long_count={long_count} has_fig={has_fig}"
```

## ソート・集計・浮動小数点と乱数の仕様

- **安定ソートと NaN の順序**: `Array.sort`・`sort_descending`・`sort_by`・`sort_by_descending`・`sort_with`・`sort_in_place`・`sort_in_place_by`・`sort_in_place_with` はすべて安定ソート（同値要素の入力順を保持）です。`sort_by` / `sort_by_descending` / `sort_in_place_by` はすべてのキー型で自己非等値キー（NaN）を末尾へ集めます。`sort` / `sort_descending` / `sort_with` / `sort_in_place_with` は要素型が `f32`・`f64` の場合に NaN を末尾へ配置します（`sort_in_place` は追加メモリ確保なしの SymMerge であり NaN の特別処理を行いません）。
- **ハッシュ系集計での NaN**: `distinct`・`distinct_by`・`except`・`count_by`・`group_by` は NaN でトラップせず、同一ハッシュ値を持つ1つの代表キーとしてグループ化します。
- **整数集計と SIMD ディスパッチ**: 整数型の `Array.sum` / `sum_by` は言語の `+` 演算子と同じくオーバーフロー時に2の補数でラップアラウンドします（トラップしません）。ネイティブの実行ファイル・オブジェクト出力では、8種類の整数型（`i8`〜`i64`、`i8u`〜`i64u`）に対する `Array.sum`・`Array.min`・`Array.max` が実行時 CPU 機能（SSE4.2 / AVX2 等）に応じた SIMD カーネルを自動選択し、スカラー版と完全に同一の結果を返します。
- **高精度浮動小数点演算**: コンパイラは `Array.sum` に fast-math 再結合を適用しません。丸め誤差を抑えたい場面向けに、ペア加算木 `Array.sum_pairwise`、Kahan-Babuška-Neumaier 補償加算 `Array.sum_kahan`、通常丸め内積 `Array.dot`、融合積和内積 `Array.dot_fma` が提供されています。
- **乱数操作の3形態**: `random_*_by` は `[0.0, 1.0)` を返す関数 `unit -> f64`（範囲外はトラップ）、`random_*_with` は純粋な乱数状態 [`Random.Pcg`](../sys/random.md)、接尾辞なしの `random_*` は OS エントロピーで初期化する `IO<Result<..., Os.Error>>` を返します（WASM 既定ターゲットでは接尾辞なし版は `E2000` となるため `--wasm-host wasi` または `_with` / `_by` を使用します）。

## 公開関数一覧

以下の表は `std/Array.tz` の全155公開関数に加え、コンパイラ組み込み関数（`Array.update`、`Array.swap`、`Array.write`、`Array.swap_in`、`Array.split_at_mut`、`Array.concat`、`Array.to_list`、`FixedArray.init`、および `_owned` 入口）を機能別に網羅しています。

### 長さ・要素取得

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Array.length` | `ref ['a] -> i64` | 要素数を返す（`xs.length` と同一） |
| `Array.is_empty` | `ref ['a] -> bool` | 要素数が `0` であれば `true` を返す |
| `Array.get` | `Copy<'a> => own i64 -> ref ['a] -> 'a` | 指定位置の要素をコピーして返す（範囲外はトラップ） |
| `Array.item` | `Copy<'a> => own i64 -> ref ['a] -> 'a` | `Array.get` と同一 |
| `Array.try_item` | `Copy<'a> => own i64 -> ref ['a] -> Maybe<'a>` | 指定位置の要素を `Some` で返し、範囲外なら `None` を返す |
| `Array.at` | `own i64 -> ref ['a] -> ref 'a` | 指定位置の要素への共有参照を返す（非 `Copy` 対応、範囲外はトラップ） |
| `Array.head` | `Copy<'a> => ref ['a] -> 'a` | 先頭要素を返す（空配列はトラップ） |
| `Array.try_head` | `Copy<'a> => ref ['a] -> Maybe<'a>` | 先頭要素を `Some` で返し、空配列なら `None` を返す |
| `Array.last` | `Copy<'a> => ref ['a] -> 'a` | 末尾要素を返す（空配列はトラップ） |
| `Array.try_last` | `Copy<'a> => ref ['a] -> Maybe<'a>` | 末尾要素を `Some` で返し、空配列なら `None` を返す |
| `Array.exactly_one` | `Copy<'a> => ref ['a] -> 'a` | 長さが `1` のときその要素を返す（それ以外はトラップ） |
| `Array.try_exactly_one` | `Copy<'a> => ref ['a] -> Maybe<'a>` | 長さが `1` なら `Some`、それ以外は `None` を返す |

### 生成・コレクション間変換

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Array.empty` | `['a]` | 長さ `0` の空配列を生成する（`Array.empty()` として呼び出す） |
| `Array.singleton` | `own 'a -> ['a]` | 1要素のみを持つ配列 `[value]` を生成する |
| `Array.create` | `Copy<'a> => own i64 -> own 'a -> ['a]` | 指定値を `count` 個複製した配列を生成する（負数はトラップ） |
| `Array.replicate` | `Copy<'a> => own i64 -> own 'a -> ['a]` | `Array.create` と同一 |
| `Array.zero_create` | `Default<'a> => own i64 -> ['a]` | `Default.default()` で埋めた長さ `count` の配列を生成する |
| `Array.init` | `own i64 -> own (i64 -> 'a) -> ['a]` | インデックス `0 ..< count` に初期化関数を適用して配列を生成する |
| `Array.unfold` | `own ('state -> Maybe<('a * 'state)>) -> own 'state -> ['a]` | `None` が返るまで状態遷移関数から要素列を生成する |
| `Array.copy` | `Copy<'a> => ref ['a] -> ['a]` | 全要素を複製した新しい所有配列を返す |
| `Array.rev` | `Copy<'a> => ref ['a] -> ['a]` | 要素順を反転した新しい配列を返す |
| `Array.permute` | `Copy<'a> => own (i64 -> i64) -> ref ['a] -> ['a]` | 添字 `i` の要素を位置 `f i` へ配置した配列を返す（全単射でない場合はトラップ） |
| `Array.of_list` | `Copy<'a> => ref [\|'a\|] -> ['a]` | 連結リストから配列を生成する |
| `Array.to_list` | `Copy<'a> => ref ['a] -> [\|'a\|]` | 配列から単一チャンクの連結リストを生成する（コンパイラ組み込み） |
| `Array.of_seq` | `own Seq<'a> -> ['a]` | `Seq` を最後まで消費して配列を生成する |
| `Array.to_seq` | `Copy<'a> => ref ['a] -> Seq<'a>` | 要素のコピーを順次列挙する `Seq` を返す |
| `Array.to_seqr` | `ref ['a] -> Seq<ref 'a>` | 要素への共有参照を順次列挙する `Seq` を返す |
| `FixedArray.init` | `(i64 -> 'a) -> ['a; N]` | 期待型の定数長 `N` に合わせてインライン固定長配列を初期化する（組み込み） |

### 部分切り出し・分割・結合・組操作

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Array.sub` | `Copy<'a> => own i64 -> own i64 -> ref ['a] -> ['a]` | `start` から `count` 個の部分配列を複製して返す（範囲外はトラップ） |
| `Array.tail` | `Copy<'a> => ref ['a] -> ['a]` | 先頭要素を除いた残りの配列を返す（空配列はトラップ） |
| `Array.take` | `Copy<'a> => own i64 -> ref ['a] -> ['a]` | 先頭 `count` 個を複製して返す（負数または長さ超過はトラップ） |
| `Array.skip` | `Copy<'a> => own i64 -> ref ['a] -> ['a]` | 先頭 `count` 個を除いた残りを返す（長さ超過はトラップ、負数は `0` 扱い） |
| `Array.truncate` | `Copy<'a> => own i64 -> ref ['a] -> ['a]` | 先頭から最大 `count` 個を返す（長さを超えてもトラップしない） |
| `Array.split_at` | `Copy<'a> => own i64 -> ref ['a] -> (['a] * ['a])` | 指定位置で前後2つの配列に分割する（範囲外はトラップ） |
| `Array.take_while` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> ['a]` | 先頭から述語を満たす連続要素を切り出す |
| `Array.skip_while` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> ['a]` | 先頭から述語を満たす連続要素を飛ばした残りを返す |
| `Array.chunk_by_size` | `Copy<'a> => own i64 -> ref ['a] -> [['a]]` | 最大 `size` 個ずつのチャンク配列に分割する（`size <= 0` はトラップ） |
| `Array.split_into` | `Copy<'a> => own i64 -> ref ['a] -> [['a]]` | 最大 `count` 個の均等サイズチャンクに分割する（`count <= 0` はトラップ） |
| `Array.windowed` | `Copy<'a> => own i64 -> ref ['a] -> [['a]]` | 長さ `size` のスライディングウィンドウ配列群を返す（`size <= 0` はトラップ） |
| `Array.pairwise` | `Copy<'a> => ref ['a] -> [('a * 'a)]` | 隣接する2要素ずつのタプル配列を返す（2要素未満は空配列） |
| `Array.append` | `Copy<'a> => ref ['a] -> ref ['a] -> ['a]` | 2つの配列を連結した新しい配列を返す |
| `Array.concat` | `Copy<'a> => ref [['a]] -> ['a]` | 配列の配列を1次元に平坦化して連結する（コンパイラ組み込み） |
| `Array.zip` | `ref ['a] -> ref ['b] -> [('a * 'b)]` | 2配列の対応要素をタプル化する（要素は `Copy`、長さ不一致はトラップ） |
| `Array.zip3` | `ref ['a] -> ref ['b] -> ref ['c] -> [('a * 'b * 'c)]` | 3配列の対応要素を3要素タプル化する（長さ不一致はトラップ） |
| `Array.unzip` | `ref [('a * 'b)] -> (['a] * ['b])` | 2要素タプル配列を2つの配列へ分解する |
| `Array.unzip3` | `ref [('a * 'b * 'c)] -> (['a] * ['b] * ['c])` | 3要素タプル配列を3つの配列へ分解する |
| `Array.all_pairs` | `(Copy<'a>, Copy<'b>) => ref ['a] -> ref ['b] -> [('a * 'b)]` | 2配列の直積（全ペア）を返す |
| `Array.indexed` | `Copy<'a> => ref ['a] -> [(i64 * 'a)]` | `(インデックス, 要素)` のタプル配列を返す |
| `Array.transpose` | `Copy<'a> => ref [['a]] -> [['a]]` | 2次元ジャグ配列の行と列を転置する（行の長さが不揃いならトラップ） |

### 走査・要素変換・フィルタ

Edition 2027 / 2028 では `iter`・`iteri`・`map`・`mapi` は読み取りビュー渡し（`iterr` 等と同等）に解決され、値コピー版は `iter_owned`・`iteri_owned`・`map_owned`・`mapi_owned` でも明示呼び出しできます。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Array.iter` | `Copy<'a> => own ('a -> unit) -> ref ['a] -> unit` | 各要素に副作用関数を適用する（Edition 2027+ は読み取りビュー渡しで非 `Copy` 可） |
| `Array.iterr` | `own (ref 'a -> unit) -> ref ['a] -> unit` | 各要素の共有参照に副作用関数を適用する（`iter_owned` は所有値コールバック固定） |
| `Array.iteri` | `Copy<'a> => own (i64 -> 'a -> unit) -> ref ['a] -> unit` | インデックス付きで副作用関数を適用する（Edition 2027+ は非 `Copy` 可） |
| `Array.iterir` | `own (i64 -> ref 'a -> unit) -> ref ['a] -> unit` | インデックスと共有参照を渡す `iteri`（`iteri_owned` は所有値コールバック固定） |
| `Array.iter2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> unit) -> ref ['a] -> ref ['b] -> unit` | 2配列の対応要素に関数を適用する（長さ不一致はトラップ） |
| `Array.iteri2` | `(Copy<'a>, Copy<'b>) => own (i64 -> 'a -> 'b -> unit) -> ref ['a] -> ref ['b] -> unit` | インデックス付きで2配列に関数を適用する（長さ不一致はトラップ） |
| `Array.map` | `Copy<'a> => own ('a -> 'b) -> ref ['a] -> ['b]` | 各要素を変換した新しい配列を返す（Edition 2027+ は読み取りビュー渡しで非 `Copy` 可） |
| `Array.mapr` | `own (ref 'a -> 'b) -> ref ['a] -> ['b]` | 各要素の共有参照から新しい配列を生成する（`map_owned` は所有値コールバック固定） |
| `Array.mapi` | `Copy<'a> => own (i64 -> 'a -> 'b) -> ref ['a] -> ['b]` | インデックス付きで要素を変換する（Edition 2027+ は非 `Copy` 可） |
| `Array.mapir` | `own (i64 -> ref 'a -> 'b) -> ref ['a] -> ['b]` | インデックスと共有参照から変換する（`mapi_owned` は所有値コールバック固定） |
| `Array.map2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> 'c) -> ref ['a] -> ref ['b] -> ['c]` | 2配列の対応要素から新しい配列を生成する（長さ不一致はトラップ） |
| `Array.mapi2` | `(Copy<'a>, Copy<'b>) => own (i64 -> 'a -> 'b -> 'c) -> ref ['a] -> ref ['b] -> ['c]` | インデックス付きで2配列を変換する（長さ不一致はトラップ） |
| `Array.map3` | `(Copy<'a>, Copy<'b>, Copy<'c>) => own ('a -> 'b -> 'c -> 'd) -> ref ['a] -> ref ['b] -> ref ['c] -> ['d]` | 3配列の対応要素から新しい配列を生成する（長さ不一致はトラップ） |
| `Array.map_fold` | `Copy<'a> => own ('state -> 'a -> ('b * 'state)) -> own 'state -> ref ['a] -> (['b] * 'state)` | 先頭から状態を引き回しながら要素変換と最終状態を同時に得る |
| `Array.map_fold_back` | `Copy<'a> => own ('a -> 'state -> ('b * 'state)) -> own 'state -> ref ['a] -> (['b] * 'state)` | 末尾から状態を引き回しながら要素変換と最終状態を得る |
| `Array.collect` | `(Copy<'a>, Copy<'b>) => own ('a -> ['b]) -> ref ['a] -> ['b]` | 各要素から生成された配列を平坦に連結する（flatMap） |
| `Array.choose` | `Copy<'a> => own ('a -> Maybe<'b>) -> ref ['a] -> ['b]` | `Some` を返した結果のみを抽出して配列にする |
| `Array.filter` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> ['a]` | 述語を満たす要素のみを順序を保って集める |
| `Array.where` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> ['a]` | `Array.filter` と同一 |
| `Array.partition` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> (['a] * ['a])` | 述語が `true` の配列と `false` の配列に振り分ける |
| `Array.partition_with` | `Copy<'a> => own ('a -> Result<'b, 'c>) -> ref ['a] -> (['b] * ['c])` | `Ok` の値群と `Error` の値群の2配列に振り分ける |

### 畳み込み・スキャン

Edition 2027 / 2028 では `fold`・`fold_back` は読み取りビュー渡しに解決され、値コピー版は `fold_owned`・`fold_back_owned` でも呼び出せます。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Array.fold` | `Copy<'a> => own ('state -> 'a -> 'state) -> own 'state -> ref ['a] -> 'state` | 先頭から左畳み込みを行う（Edition 2027+ は非 `Copy` 要素可） |
| `Array.foldr` | `own ('state -> ref 'a -> 'state) -> own 'state -> ref ['a] -> 'state` | 共有参照を受け取る左畳み込み（`fold_owned` は所有値コールバック固定） |
| `Array.fold_monoid` | `(Monoid<'m>, Copy<'m>) => ref ['m] -> 'm` | `Monoid.empty ()` と `Monoid.combine` で左畳み込みを行う（[Monoid](../core/monoid.md)） |
| `Array.fold2` | `(Copy<'a>, Copy<'b>) => own ('state -> 'a -> 'b -> 'state) -> own 'state -> ref ['a] -> ref ['b] -> 'state` | 2配列の対応要素を先頭から畳み込む（長さ不一致はトラップ） |
| `Array.fold_back` | `Copy<'a> => own ('a -> 'state -> 'state) -> own 'state -> ref ['a] -> 'state` | 末尾から右畳み込みを行う（Edition 2027+ は非 `Copy` 要素可） |
| `Array.foldr_back` | `own (ref 'a -> 'state -> 'state) -> own 'state -> ref ['a] -> 'state` | 共有参照を受け取る右畳み込み（`fold_back_owned` は所有値コールバック固定） |
| `Array.fold_back2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> 'state -> 'state) -> own 'state -> ref ['a] -> ref ['b] -> 'state` | 2配列の対応要素を末尾から右畳み込みする |
| `Array.reduce` | `Copy<'a> => own ('a -> 'a -> 'a) -> ref ['a] -> 'a` | 先頭要素を初期値として左畳み込みする（空配列はトラップ） |
| `Array.reduce_back` | `Copy<'a> => own ('a -> 'a -> 'a) -> ref ['a] -> 'a` | 末尾要素を初期値として右畳み込みする（空配列はトラップ） |
| `Array.scan` | `(Copy<'a>, Copy<'state>) => own ('state -> 'a -> 'state) -> own 'state -> ref ['a] -> ['state]` | 初期値と各ステップの累積状態からなる長さ `n + 1` の配列を返す |
| `Array.scan_back` | `(Copy<'a>, Copy<'state>) => own ('a -> 'state -> 'state) -> own 'state -> ref ['a] -> ['state]` | 末尾からの累積状態配列（長さ `n + 1`）を返す |

### 探索・述語判定・比較

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Array.exists` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> bool` | 述語を満たす要素が1つでもあれば `true` を返す（短絡評価） |
| `Array.existsr` | `own (ref 'a -> bool) -> ref ['a] -> bool` | 要素を共有借用して判定する `exists` |
| `Array.exists2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> bool) -> ref ['a] -> ref ['b] -> bool` | 2配列の対応ペアで `exists` 判定を行う（長さ不一致は事前トラップ） |
| `Array.forall` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> bool` | 全要素が述語を満たせば `true` を返す（空配列は `true`） |
| `Array.forallr` | `own (ref 'a -> bool) -> ref ['a] -> bool` | 要素を共有借用して判定する `forall` |
| `Array.forall2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> bool) -> ref ['a] -> ref ['b] -> bool` | 2配列の対応ペアで `forall` 判定を行う（長さ不一致は事前トラップ） |
| `Array.count` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> i64` | 述語を満たす要素の個数を返す |
| `Array.countr` | `own (ref 'a -> bool) -> ref ['a] -> i64` | 要素を共有借用して数える `count` |
| `Array.contains` | `Eq<'a> => own 'a -> ref ['a] -> bool` | 指定値と `==` で等しい要素が含まれるか判定する |
| `Array.containsr` | `Eq<'a> => ref 'a -> ref ['a] -> bool` | 検索値を共有借用で渡す `contains` |
| `Array.index_of` | `Eq<'a> => ref 'a -> ref ['a] -> Maybe<i64>` | 等しい最初の要素のインデックスを `Some` で返す（不在なら `None`） |
| `Array.find` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> 'a` | 述語を満たす最初の要素を返す（不在ならトラップ） |
| `Array.try_find` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> Maybe<'a>` | 述語を満たす最初の要素を `Some` で返す（不在なら `None`） |
| `Array.find_back` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> 'a` | 述語を満たす最後の要素を返す（不在ならトラップ） |
| `Array.try_find_back` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> Maybe<'a>` | 述語を満たす最後の要素を `Some` で返す |
| `Array.findr` | `own (ref 'a -> bool) -> ref ['a] -> ref 'a` | 述語を満たす最初の要素への共有参照を返す（不在ならトラップ） |
| `Array.try_findr` | `own (ref 'a -> bool) -> ref ['a] -> Maybe<ref 'a>` | 述語を満たす最初の要素への共有参照を `Some` で返す |
| `Array.find_index` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> i64` | 述語を満たす最初のインデックスを返す（不在ならトラップ） |
| `Array.try_find_index` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> Maybe<i64>` | 述語を満たす最初のインデックスを `Some` で返す |
| `Array.find_index_back` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> i64` | 述語を満たす最後のインデックスを返す（不在ならトラップ） |
| `Array.try_find_index_back` | `Copy<'a> => own ('a -> bool) -> ref ['a] -> Maybe<i64>` | 述語を満たす最後のインデックスを `Some` で返す |
| `Array.pick` | `Copy<'a> => own ('a -> Maybe<'b>) -> ref ['a] -> 'b` | 最初に `Some` を返した変換結果を取り出す（不在ならトラップ） |
| `Array.try_pick` | `Copy<'a> => own ('a -> Maybe<'b>) -> ref ['a] -> Maybe<'b>` | 最初に `Some` を返した変換結果を返す（不在なら `None`） |
| `Array.equal` | `Eq<'a> => ref ['a] -> ref ['a] -> bool` | 2つの配列の長さと全対応要素が等しいか判定する |
| `Array.compare_with` | `Copy<'a> => own ('a -> 'a -> i64) -> ref ['a] -> ref ['a] -> i64` | 比較関数による辞書式比較を行う |
| `Array.binary_search` | `Ord<'a> => ref 'a -> ref ['a] -> Maybe<i64>` | 昇順整列済み配列を二分探索し、一致要素の先頭位置を `Some` で返す |

### 数値集計・重複除去・グループ化

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Array.sum` | `Numeric<'a> => ref ['a] -> 'a` | 全要素の総和（空配列は `0`、整数はラップアラウンド） |
| `Array.sum_by` | `(Copy<'a>, Numeric<'b>) => own ('a -> 'b) -> ref ['a] -> 'b` | 各要素に関数を適用した結果の総和 |
| `Array.product` | `Numeric<'a> => ref ['a] -> 'a` | 全要素の総乗（空配列は `1`） |
| `Array.average` | `Float<'a> => ref ['a] -> 'a` | 浮動小数点配列の算術平均（空配列はトラップ） |
| `Array.average_by` | `(Copy<'a>, Float<'b>) => own ('a -> 'b) -> ref ['a] -> 'b` | 射影結果の浮動小数点平均（空配列はトラップ） |
| `Array.min` | `(Ord<'a>, Copy<'a>) => ref ['a] -> 'a` | 最小要素を返す（同値は先頭優先、空配列はトラップ） |
| `Array.max` | `(Ord<'a>, Copy<'a>) => ref ['a] -> 'a` | 最大要素を返す（同値は先頭優先、空配列はトラップ） |
| `Array.minr` | `Ord<'a> => ref ['a] -> ref 'a` | 最小要素への共有参照を返す（空配列はトラップ） |
| `Array.maxr` | `Ord<'a> => ref ['a] -> ref 'a` | 最大要素への共有参照を返す（空配列はトラップ） |
| `Array.min_by` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref ['a] -> 'a` | キーが最小となる最初の要素を返す（空配列はトラップ） |
| `Array.max_by` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref ['a] -> 'a` | キーが最大となる最初の要素を返す（空配列はトラップ） |
| `Array.sum_pairwise` | `Float<'a> => ref ['a] -> 'a` | ペアワイズ加算木による高精度浮動小数点総和（空配列は `+0.0`） |
| `Array.sum_kahan` | `Float<'a> => ref ['a] -> 'a` | Kahan-Babuška-Neumaier 補償加算による総和（空配列は `+0.0`） |
| `Array.dot` | `Float<'a> => ref ['a] -> ref ['a] -> 'a` | 個別丸めによる浮動小数点内積（長さ不一致はトラップ） |
| `Array.dot_fma` | `Float<'a> => ref ['a] -> ref ['a] -> 'a` | FMA（単一丸め積和）による浮動小数点内積（長さ不一致はトラップ） |
| `Array.distinct` | `(Hash<'a>, Eq<'a>, Copy<'a>) => ref ['a] -> ['a]` | 初出順を保って重複要素を除去する（NaN 安全） |
| `Array.distinct_by` | `(Copy<'a>, Hash<'key>, Eq<'key>) => own ('a -> 'key) -> ref ['a] -> ['a]` | キーの初出順を保って重複を除去する（NaN 安全） |
| `Array.except` | `(Hash<'a>, Eq<'a>, Copy<'a>) => ref ['a] -> ref ['a] -> ['a]` | 第1引数の除外集合に含まれない要素を重複なしで返す |
| `Array.count_by` | `(Copy<'a>, Copy<'key>, Hash<'key>, Eq<'key>) => own ('a -> 'key) -> ref ['a] -> [('key * i64)]` | キーごとの出現回数をキーの初出順で返す |
| `Array.group_by` | `(Copy<'a>, Copy<'key>, Hash<'key>, Eq<'key>) => own ('a -> 'key) -> ref ['a] -> [('key * ['a])]` | キーごとに要素配列をグループ化して初出順で返す |

### ソート・更新・乱数

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Array.sort` | `Ord<'a> => ref ['a] -> ['a]` | `Ord` 昇順の安定ソート結果を新しい配列で返す |
| `Array.sort_descending` | `Ord<'a> => ref ['a] -> ['a]` | `Ord` 降順の安定ソート結果を新しい配列で返す |
| `Array.sort_by` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref ['a] -> ['a]` | キー昇順の安定ソート（キー計算は要素ごとに1回） |
| `Array.sort_by_descending` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref ['a] -> ['a]` | キー降順の安定ソート |
| `Array.sort_with` | `Copy<'a> => own ('a -> 'a -> i64) -> ref ['a] -> ['a]` | 比較関数による安定ソート |
| `Array.sort_in_place` | `Ord<'a> => ref mut ['a..] -> unit` | 排他スライスを作業メモリ確保なしでインプレース安定ソートする |
| `Array.sort_in_place_by` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref mut ['a..] -> unit` | キー昇順で排他スライスをインプレース安定ソートする |
| `Array.sort_in_place_with` | `Copy<'a> => own ('a -> 'a -> i64) -> ref mut ['a..] -> unit` | 比較関数で排他スライスをインプレース安定ソートする |
| `Array.insert_at` | `Copy<'a> => own i64 -> own 'a -> ref ['a] -> ['a]` | 指定位置の手前に1要素を挿入した新配列を返す |
| `Array.insert_many_at` | `Copy<'a> => own i64 -> ref ['a] -> ref ['a] -> ['a]` | 指定位置の手前に複数要素を挿入した新配列を返す |
| `Array.remove_at` | `Copy<'a> => own i64 -> ref ['a] -> ['a]` | 指定位置の1要素を除いた新配列を返す |
| `Array.remove_many_at` | `Copy<'a> => own i64 -> own i64 -> ref ['a] -> ['a]` | 指定位置から `count` 個を除いた新配列を返す |
| `Array.update_at` | `own i64 -> own 'a -> own ['a] -> ['a]` | 所有配列の指定位置を新値で置換した配列を返す |
| `Array.update` | `i64 -> ('a -> 'a) -> ['a] -> ['a]` | 所有配列の指定位置に関数を適用して置換した配列を返す（組み込み） |
| `Array.swap` | `i64 -> i64 -> ['a] -> ['a]` | 所有配列の2位置の要素を入れ替えた配列を返す（組み込み） |
| `Array.set` | `own i64 -> own 'a -> ref mut ['a..] -> unit` | 排他スライスの指定位置を上書きする（`Array.write` と同一） |
| `Array.write` | `i64 -> 'a -> ref mut ['a..] -> unit` | 排他スライスの指定位置を上書きする（組み込み） |
| `Array.fill` | `Copy<'a> => own i64 -> own i64 -> own 'a -> ref mut ['a..] -> unit` | 排他スライスの `start` から `count` 個を同値で埋める |
| `Array.blit` | `Copy<'a> => own i64 -> own i64 -> own i64 -> ref ['a] -> ref mut ['a..] -> unit` | `source` の部分範囲を排他スライスへ複写する |
| `Array.swap_in` | `i64 -> i64 -> ref mut ['a..] -> unit` | 排他スライス内の2位置をその場で入れ替える（組み込み） |
| `Array.split_at_mut` | `i64 -> ref mut ['a..] -> (ref mut ['a..] * ref mut ['a..])` | 排他スライスを指定位置で2つに分割する（組み込み） |
| `Array.random_shuffle_in_place_by` | `own (unit -> f64) -> ref mut ['a..] -> unit` | 乱数関数で排他スライスをその場で Fisher-Yates シャッフルする |
| `Array.random_shuffle_by` | `Copy<'a> => own (unit -> f64) -> ref ['a] -> ['a]` | 乱数関数でシャッフルした新配列を返す |
| `Array.random_choice_by` | `Copy<'a> => own (unit -> f64) -> ref ['a] -> 'a` | 乱数関数で1要素を無作為抽出する（空配列はトラップ） |
| `Array.random_choices_by` | `Copy<'a> => own (unit -> f64) -> own i64 -> ref ['a] -> ['a]` | 乱数関数で重複を許して `count` 個抽出する |
| `Array.random_sample_by` | `Copy<'a> => own (unit -> f64) -> own i64 -> ref ['a] -> ['a]` | 乱数関数で重複なしに `count` 個抽出する（`count > length` はトラップ） |
| `Array.random_shuffle_in_place_with` | `own Random.Pcg -> ref mut ['a..] -> Random.Pcg` | `Random.Pcg` で排他スライスをシャッフルし更新後の生成器を返す |
| `Array.random_shuffle_with` | `Copy<'a> => own Random.Pcg -> ref ['a] -> (['a] * Random.Pcg)` | `Random.Pcg` でシャッフルした新配列と更新後の生成器を返す |
| `Array.random_choice_with` | `Copy<'a> => own Random.Pcg -> ref ['a] -> ('a * Random.Pcg)` | `Random.Pcg` で1要素と更新後の生成器を返す |
| `Array.random_choices_with` | `Copy<'a> => own Random.Pcg -> own i64 -> ref ['a] -> (['a] * Random.Pcg)` | `Random.Pcg` で重複あり `count` 個と生成器を返す |
| `Array.random_sample_with` | `Copy<'a> => own Random.Pcg -> own i64 -> ref ['a] -> (['a] * Random.Pcg)` | `Random.Pcg` で重複なし `count` 個と生成器を返す |
| `Array.random_shuffle_in_place` | `own ['a] -> IO<Result<['a], Os.Error>>` | OS 乱数で所有配列をシャッフルする `IO` アクション（`random` 権限） |
| `Array.random_shuffle` | `Copy<'a> => own ['a] -> IO<Result<['a], Os.Error>>` | OS 乱数でシャッフルした配列を返す `IO` アクション（`random` 権限） |
| `Array.random_choice` | `Copy<'a> => own ['a] -> IO<Result<'a, Os.Error>>` | OS 乱数で1要素を選ぶ `IO` アクション（`random` 権限） |
| `Array.random_choices` | `Copy<'a> => own i64 -> own ['a] -> IO<Result<['a], Os.Error>>` | OS 乱数で重複あり抽出を行う `IO` アクション（`random` 権限） |
| `Array.random_sample` | `Copy<'a> => own i64 -> own ['a] -> IO<Result<['a], Os.Error>>` | OS 乱数で重複なし抽出を行う `IO` アクション（`random` 権限） |

## 計算量

以下の表は `std/Array.tz` の構造化タグ `@complexity` から自動生成された各関数の時間計算量です。`n` は主入力の要素数、`m` は副入力の要素数、`k` は出力要素数（または指定個数）を表し、コールバック・比較・ハッシュ・1要素コピーを $O(1)$ として換算しています。また構文・組み込み操作の `xs[i]`、`xs.length`、`ref xs[a..<b]`、`Array.write`、`Array.swap_in`、`Array.split_at_mut` はいずれも $O(1)$、`Array.concat`・`Array.to_list` は $O(k)$ / $O(n)$ です。

<!-- generated:complexity:Array -->
| 関数 | 計算量 | 導入版 | 関連 |
| --- | --- | --- | --- |
| `Array.length` | $O(1)$ | - | - |
| `Array.is_empty` | $O(1)$ | - | - |
| `Array.empty` | $O(1)$ | - | - |
| `Array.singleton` | $O(1)$ | - | - |
| `Array.create` | $O(k)$ | - | - |
| `Array.replicate` | $O(k)$ | - | - |
| `Array.zero_create` | $O(k)$ | - | - |
| `Array.init` | $O(k)$ | - | - |
| `Array.get` | $O(1)$ | - | - |
| `Array.item` | $O(1)$ | - | - |
| `Array.try_item` | $O(1)$ | - | - |
| `Array.at` | $O(1)$ | - | - |
| `Array.head` | $O(1)$ | - | - |
| `Array.try_head` | $O(1)$ | - | - |
| `Array.last` | $O(1)$ | - | - |
| `Array.try_last` | $O(1)$ | - | - |
| `Array.exactly_one` | $O(1)$ | - | - |
| `Array.try_exactly_one` | $O(1)$ | - | - |
| `Array.sub` | $O(k)$ | - | - |
| `Array.tail` | $O(n)$ | - | - |
| `Array.take` | $O(k)$ | - | - |
| `Array.skip` | $O(n)$ | - | - |
| `Array.truncate` | $O(k)$ | - | - |
| `Array.split_at` | $O(n)$ | - | - |
| `Array.take_while` | $O(k)$ | - | - |
| `Array.skip_while` | $O(n)$ | - | - |
| `Array.where` | $O(n)$ | - | - |
| `Array.filter` | $O(n)$ | - | - |
| `Array.transpose` | $O(n + k)$ | - | - |
| `Array.iter` | $O(n)$ | - | `Array.iterr` |
| `Array.iterr` | $O(n)$ | - | `Array.iter` |
| `Array.iteri` | $O(n)$ | - | `Array.iterir` |
| `Array.iterir` | $O(n)$ | - | `Array.iteri` |
| `Array.iter2` | $O(n)$ | - | - |
| `Array.iteri2` | $O(n)$ | - | - |
| `Array.map` | $O(n)$ | - | `Array.mapr` |
| `Array.mapi` | $O(n)$ | - | `Array.mapir` |
| `Array.mapr` | $O(n)$ | - | `Array.map` |
| `Array.mapir` | $O(n)$ | - | `Array.mapi` |
| `Array.map2` | $O(n)$ | - | - |
| `Array.mapi2` | $O(n)$ | - | - |
| `Array.map3` | $O(n)$ | - | - |
| `Array.map_fold` | $O(n)$ | - | - |
| `Array.map_fold_back` | $O(n)$ | - | - |
| `Array.collect` | $O(n + k)$ | - | - |
| `Array.choose` | $O(n)$ | - | - |
| `Array.fold` | $O(n)$ | - | `Array.foldr` |
| `Array.fold_monoid` | $O(n)$ | 0.1.0 | `Array.fold`, `Parallel.fold` |
| `Array.foldr` | $O(n)$ | - | `Array.fold` |
| `Array.fold2` | $O(n)$ | - | - |
| `Array.fold_back` | $O(n)$ | - | `Array.foldr_back` |
| `Array.foldr_back` | $O(n)$ | - | `Array.fold_back` |
| `Array.fold_back2` | $O(n)$ | - | - |
| `Array.reduce` | $O(n)$ | - | - |
| `Array.reduce_back` | $O(n)$ | - | - |
| `Array.scan` | $O(n)$ | - | - |
| `Array.scan_back` | $O(n)$ | - | - |
| `Array.exists` | $O(n)$ | - | `Array.existsr` |
| `Array.existsr` | $O(n)$ | - | `Array.exists` |
| `Array.exists2` | $O(n)$ | - | - |
| `Array.forall` | $O(n)$ | - | `Array.forallr` |
| `Array.forallr` | $O(n)$ | - | `Array.forall` |
| `Array.forall2` | $O(n)$ | - | - |
| `Array.count` | $O(n)$ | - | `Array.countr` |
| `Array.countr` | $O(n)$ | - | `Array.count` |
| `Array.try_find_index` | $O(n)$ | - | - |
| `Array.find_index` | $O(n)$ | - | - |
| `Array.try_find_index_back` | $O(n)$ | - | - |
| `Array.find_index_back` | $O(n)$ | - | - |
| `Array.try_find` | $O(n)$ | - | `Array.try_findr` |
| `Array.find` | $O(n)$ | - | `Array.findr` |
| `Array.try_find_back` | $O(n)$ | - | - |
| `Array.find_back` | $O(n)$ | - | - |
| `Array.try_findr` | $O(n)$ | - | `Array.try_find` |
| `Array.findr` | $O(n)$ | - | `Array.find` |
| `Array.try_pick` | $O(n)$ | - | - |
| `Array.pick` | $O(n)$ | - | - |
| `Array.partition` | $O(n)$ | - | - |
| `Array.partition_with` | $O(n)$ | - | - |
| `Array.sum` | $O(n)$ | - | `Array.sum_pairwise`, `Array.sum_kahan` |
| `Array.sum_by` | $O(n)$ | - | - |
| `Array.average` | $O(n)$ | - | - |
| `Array.average_by` | $O(n)$ | - | - |
| `Array.product` | $O(n)$ | - | - |
| `Array.min` | $O(n)$ | - | `Array.minr` |
| `Array.max` | $O(n)$ | - | `Array.maxr` |
| `Array.minr` | $O(n)$ | - | `Array.min` |
| `Array.maxr` | $O(n)$ | - | `Array.max` |
| `Array.min_by` | $O(n)$ | - | - |
| `Array.max_by` | $O(n)$ | - | - |
| `Array.compare_with` | $O(n)$ | - | - |
| `Array.containsr` | $O(n)$ | - | `Array.contains` |
| `Array.contains` | $O(n)$ | - | `Array.containsr` |
| `Array.index_of` | $O(n)$ | - | - |
| `Array.equal` | $O(n)$ | - | - |
| `Array.binary_search` | $O(\log n)$ | - | - |
| `Array.copy` | $O(n)$ | - | - |
| `Array.rev` | $O(n)$ | - | - |
| `Array.append` | $O(n + m)$ | - | - |
| `Array.zip` | $O(n)$ | - | - |
| `Array.zip3` | $O(n)$ | - | - |
| `Array.unzip` | $O(n)$ | - | - |
| `Array.unzip3` | $O(n)$ | - | - |
| `Array.all_pairs` | $O(n \cdot m)$ | - | - |
| `Array.indexed` | $O(n)$ | - | - |
| `Array.pairwise` | $O(n)$ | - | - |
| `Array.windowed` | $O(k)$ | - | - |
| `Array.chunk_by_size` | $O(k)$ | - | - |
| `Array.split_into` | $O(k)$ | - | - |
| `Array.unfold` | $O(k)$ | - | - |
| `Array.permute` | $O(n)$ | - | - |
| `Array.insert_at` | $O(n)$ | - | - |
| `Array.insert_many_at` | $O(n + m)$ | - | - |
| `Array.remove_at` | $O(n)$ | - | - |
| `Array.remove_many_at` | $O(n)$ | - | - |
| `Array.update_at` | $O(1)$ | - | - |
| `Array.set` | $O(1)$ | - | - |
| `Array.fill` | $O(n)$ | - | - |
| `Array.blit` | $O(n)$ | - | - |
| `Array.of_list` | $O(n)$ | - | - |
| `Array.of_seq` | $O(n)$ | - | - |
| `Array.to_seq` | $O(1)$ | - | `Array.to_seqr` |
| `Array.to_seqr` | $O(1)$ | - | `Array.to_seq` |
| `Array.distinct` | 平均 $O(n)$、最悪 $O(n \cdot n)$ | - | - |
| `Array.distinct_by` | 平均 $O(n)$、最悪 $O(n \cdot n)$ | - | - |
| `Array.except` | 平均 $O(n + m)$、最悪 $O(n \cdot n + m \cdot m)$ | - | - |
| `Array.count_by` | 平均 $O(n)$、最悪 $O(n \cdot n)$ | - | - |
| `Array.group_by` | 平均 $O(n)$、最悪 $O(n \cdot n)$ | - | - |
| `Array.sort` | $O(n \log n)$ | - | - |
| `Array.sort_descending` | $O(n \log n)$ | - | - |
| `Array.sort_with` | $O(n \log n)$ | - | - |
| `Array.sort_by` | $O(n \log n)$ | - | - |
| `Array.sort_by_descending` | $O(n \log n)$ | - | - |
| `Array.sort_in_place_with` | $O(n \log n)$ | - | - |
| `Array.sort_in_place_by` | $O(n \log n)$ | - | - |
| `Array.sort_in_place` | $O(n \log^2 n)$ | - | - |
| `Array.sum_pairwise` | $O(n)$ | - | `Array.sum`, `Array.sum_kahan` |
| `Array.sum_kahan` | $O(n)$ | - | `Array.sum`, `Array.sum_pairwise` |
| `Array.dot` | $O(n)$ | - | `Array.dot_fma` |
| `Array.dot_fma` | $O(n)$ | - | `Array.dot` |
| `Array.random_shuffle_in_place_by` | $O(n)$ | - | - |
| `Array.random_shuffle_by` | $O(n)$ | - | - |
| `Array.random_choice_by` | $O(1)$ | - | - |
| `Array.random_choices_by` | $O(k)$ | - | - |
| `Array.random_sample_by` | $O(n)$ | - | - |
| `Array.random_shuffle_in_place_with` | $O(n)$ | - | - |
| `Array.random_shuffle_with` | $O(n)$ | - | - |
| `Array.random_choice_with` | $O(1)$ | - | - |
| `Array.random_choices_with` | $O(k)$ | - | - |
| `Array.random_sample_with` | $O(n)$ | - | - |
| `Array.random_shuffle_in_place` | $O(n)$ | - | - |
| `Array.random_shuffle` | $O(n)$ | - | - |
| `Array.random_choice` | $O(1)$ | - | - |
| `Array.random_choices` | $O(k)$ | - | - |
| `Array.random_sample` | $O(n)$ | - | - |
<!-- /generated:complexity:Array -->

## 反復走査

配列は `for x in values do ...` で追加のヒープ割り当てなしに直接走査できます。遅延シーケンスとしてパイプラインへ流す場合は `Array.to_seqr`（共有参照列 `Seq<ref 'a>`）または `Array.to_seq`（`Copy` 要素列 `Seq<'a>`）を使用します。

```tsuzuri run=sum%3D60%20chars%3D11
let values = [10, 20, 30]
let mut sum = 0
for x in values do
    sum = sum + x

let words = ["Tsuzuri", "Lang"]
let mut chars = 0
for w in Array.to_seqr words do
    chars = chars + w.length

$"sum={sum} chars={chars}"
```

## 関連項目

- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [Vec](./vec.md)
- [List](./list.md)
- [Seq](./seq.md)
- [Slice](../numeric/slice.md)
- [Matrix](../numeric/matrix.md)
- [Tensor](../numeric/tensor.md)
- [Parallel](../sync/parallel.md)
- [Monoid と Monoids](../core/monoid.md)
- [借用と参照](../../ownership/borrowing.md)
