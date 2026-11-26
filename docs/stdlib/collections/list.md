# List

`List` は、単一所有のチャンク連結表現を持つリストモジュールです。リスト型はパイプ付きの角括弧 **`[|T|]`** で表記します（`List<T>` という型別名は存在しません。F# とは角括弧の記法が逆であり、Tsuzuri では `[1, 2]` が配列、`[|1, 2|]` がリストです）。先頭追加 `List.cons`・先頭分解 `head :: tail`・長さ取得 `.length` がいずれも $O(1)$ で動作し、パターンマッチや再帰的なデータ変換に適しています。

`List.random_choice`・`List.random_choices`・`List.random_sample`・`List.random_shuffle`（OS 乱数を使用する4関数）を呼び出すパッケージには `random` 権限が必要です（[パッケージ管理と権限](../../modules/packages.md)）。

## 要点

- 型は `[|T|]`、リテラルは `[|1, 2, 3|]`、空リストは `[||]`（または `List.empty()`）です。
- 要素は連続領域（チャンク）の連なりとして保持されます。リテラルや `new [|T|](n, f)`、`Array.to_list`、`List.map` 等で一括生成したリストは単一チャンクとなり、`List.cons` で伸ばしたリストはチャンクの連結になります。
- `::` 演算子は**パターンマッチ専用**です（式として `1 :: xs` と書くと構文エラー `E0002`）。先頭への要素追加には `List.cons x xs` を使用します。
- F# の `List` モジュール（廃止予定の `nth` を除く全関数）を `snake_case` 名で提供し、すべての関数で**操作対象のリストが最後の引数**に統一されています（`std/List.tz` 公開126関数およびコンパイラ組み込み関数）。
- Edition 2027 以降では、`map`・`mapi`・`iter`・`iteri`・`fold`・`fold_back` は要素の読み取りビューを受け取るため、非 `Copy` 要素のリストにもそのまま適用できます。また、`let mut` で所有するリストの既存要素に対する添字代入 `xs[i] = v` や Edition 2028 の末尾相対添字 `xs[^k]`（`^0` が末尾要素）も利用できます。

## 生成とパターンマッチ

### リテラル・`List.cons`・動的生成

```tsuzuri run=len%3D4%20head%3D5%20last%3D30%20evens%3D%5B%7C0%2C%202%2C%204%2C%206%7C%5D
let base = [|10, 20, 30|]
let extended = List.cons 5 base
let evens = new [|i64|](4, \i -> i * 2)
$"len={extended.length} head={extended[0]} last={extended[^0]} evens={evens}"
```

`List.cons x xs` は所有するリスト `xs` を消費し、先頭チャンクに空きスロットがあればそこへ書き込み、満杯であれば容量を1.5倍（上限 32 KiB）に広げた新チャンクを連結して返します。

### パターンマッチによる分解

`match` 式では空リスト `[||]`、固定長リスト `[|x|]`・`[|x, y|]`、および先頭と残りに分ける `head :: tail` パターンを使用できます。

```tsuzuri run=sum%3D60
def rec sum_all :: own [|i64|] -> i64
fn rec sum_all xs =
    match xs with
    | head :: tail -> head + sum_all tail
    | [||] -> 0

$"sum={sum_all [|10, 20, 30|]}"
```

Tsuzuri のリストは常に単一の所有者を持ち、F# や Haskell のように複数リスト間で末尾ノードを共有しません（共有永続リストが必要な場合は [Rc](../memory/rc.md) を組み合わせた再帰共用体を定義します）。そのため、`head :: tail` パターンで `tail` を所有値として取り出すには要素が `Copy` である必要があり、残りの要素が複製されます。長いリストを先頭から走査する場合は、`for x in xs` ループまたは `List.fold` を使用すると余分なコピーが発生せず高速です（先頭要素のみを破棄して所有権ごと残りを進める場合は $O(1)$ の `List.tail` を使用できます）。

## チャンク構造と添字アクセスの特性

- **長さ `.length`**: ヘッダに要素数が保持されているため常に $O(1)$ です。
- **添字 `xs[i]` / `xs[^k]`**: インデックスには `i8`〜`i128`・`i8u`〜`i128u` の任意の整数型および Edition 2028 の末尾相対位置 `^k`（`^0` が末尾要素）を指定できます（負リテラル添字 `xs[-1]` は警告 `W1014` かつトラップ）。一括生成された単一チャンクリストでは $O(1)$ ですが、`List.cons` を繰り返したリストでは先行チャンクをたどるためチャンク数に比例します。ループ内で `xs[i]` を繰り返す代わりに、チャンクを連続走査する `for x in xs` や `List.map` / `List.fold` を使用してください。

## 引数の順序と F# `List` モジュールとの対応

### 引数の順序

操作対象のリストはすべての関数で**最後の引数**です（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。F# の `List` でリストが末尾になかった以下の4関数も、Tsuzuri では初期状態 `state` の後ろ（末尾）にリストを受け取ります。

| 関数 | Tsuzuri の引数順 | F# の引数順 |
| --- | --- | --- |
| `fold_back` | `List.fold_back folder state list` | `List.foldBack folder list state` |
| `fold_back2` | `List.fold_back2 folder state list1 list2` | `List.foldBack2 folder list1 list2 state` |
| `scan_back` | `List.scan_back folder state list` | `List.scanBack folder list state` |
| `map_fold_back` | `List.map_fold_back mapping state list` | `List.mapFoldBack mapping list state` |

```tsuzuri run=digits%3D321%20top%3D%5B%7C9%2C%204%7C%5D
let digits = [|1, 2, 3|] |> List.fold_back (\x acc -> acc * 10 + x) 0
let sort_down = List.sort >> List.rev
let top = [|4, 9, 1|] |> sort_down |> List.take 2
$"digits={digits} top={top}"
```

### 2つのリストを受け取る関数の評価と短絡

F# の連結リストと同様に、先頭からペアで走査する関数は短い方のリストが尽きた時点で長さ不一致を検出します。
- `exists2` / `forall2`: 長さが異なっていても、共通部分の途中で結果が確定すれば（`exists2` で `true`、`forall2` で `false`）トラップせずに結果を返します。未確定のまま片方が尽きるとトラップします。
- `iter2` / `iteri2` / `map2` / `mapi2` / `map3` / `fold2`: 共通部分のペアすべてにコールバックを適用した後にトラップします（`fold_back2`・`zip`・`zip3` は事前に長さを検査してトラップします）。

### コールバックの借用モード（Edition 2027 以降・`r` 形・`_owned` 形）

- **Edition 2027 / 2028 の読み取りビュー**: `map`・`mapi`・`iter`・`iteri`・`fold`・`fold_back` は要素の読み取りビューをコールバックへ渡すため、非 `Copy` 型（`string` など）のリストにもそのまま使用できます。
- **明示参照の `r` 形**: `mapr`・`mapir`・`iterr`・`iterir`・`foldr`・`foldr_back`・`existsr`・`forallr`・`findr`・`try_findr`・`minr`・`maxr`・`containsr`・`to_seqr` は全エディションで共有参照 `ref 'a` を扱います。
- **所有値コールバック `_owned` 形**: `map_owned`・`mapi_owned`・`iter_owned`・`iteri_owned`・`fold_owned`・`fold_back_owned`、および要素を複製する `filter`・`append`・`rev` 等は `Copy<'a>` を要求します。なお `map`・`mapi`・`choose`・`init`・`unfold`・`of_seq` の**出力要素型** `'b` には `Copy` 制約はありません。

```tsuzuri run=lengths%3D%5B%7C5%2C%203%2C%206%7C%5D%20has_fig%3Dtrue
let names = [|"apple", "fig", "banana"|]
let lengths = List.map (\s -> s.length) names
let has_fig = List.containsr "fig" names
$"lengths={lengths} has_fig={has_fig}"
```

## 公開関数一覧

以下の表は `std/List.tz` の全126公開関数に加え、コンパイラ組み込み関数（`List.cons`、`List.tail`、`List.map`、`List.mapr`、`List.rev`、`List.to_array`、`List.foldr`、および `_owned` 入口）を機能別に網羅しています。

### 長さ・先頭分解・要素取得

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `List.length` | `ref [\|'a\|] -> i64` | 要素数を $O(1)$ で返す（`xs.length` と同一） |
| `List.is_empty` | `ref [\|'a\|] -> bool` | リストが空であれば `true` を返す |
| `List.cons` | `'a -> [\|'a\|] -> [\|'a\|]` | 所有リストの先頭に要素を追加した新しいリストを返す（組み込み） |
| `List.tail` | `[\|'a\|] -> [\|'a\|]` | 所有リストを消費し先頭要素を除いた残りを返す（空リストはトラップ、組み込み） |
| `List.head` | `Copy<'a> => ref [\|'a\|] -> 'a` | 先頭要素を返す（空リストはトラップ） |
| `List.try_head` | `Copy<'a> => ref [\|'a\|] -> Maybe<'a>` | 先頭要素を `Some` で返し、空リストなら `None` を返す |
| `List.last` | `Copy<'a> => ref [\|'a\|] -> 'a` | 末尾要素を返す（空リストはトラップ） |
| `List.try_last` | `Copy<'a> => ref [\|'a\|] -> Maybe<'a>` | 末尾要素を `Some` で返し、空リストなら `None` を返す |
| `List.item` | `Copy<'a> => own i64 -> ref [\|'a\|] -> 'a` | 指定位置の要素を返す（範囲外はトラップ） |
| `List.try_item` | `Copy<'a> => own i64 -> ref [\|'a\|] -> Maybe<'a>` | 指定位置の要素を `Some` で返し、範囲外なら `None` を返す |
| `List.exactly_one` | `Copy<'a> => ref [\|'a\|] -> 'a` | 長さが `1` のときその要素を返す（それ以外はトラップ） |
| `List.try_exactly_one` | `Copy<'a> => ref [\|'a\|] -> Maybe<'a>` | 長さが `1` なら `Some`、それ以外は `None` を返す |

### 生成・コレクション間変換

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `List.empty` | `[\|'a\|]` | 空リストを生成する（`List.empty()` で呼び出す） |
| `List.singleton` | `own 'a -> [\|'a\|]` | 1要素のみのリスト `[|value|]` を生成する |
| `List.replicate` | `Copy<'a> => own i64 -> own 'a -> [\|'a\|]` | 指定値を `count` 個並べたリストを生成する（負数はトラップ） |
| `List.init` | `own i64 -> own (i64 -> 'a) -> [\|'a\|]` | インデックス `0 ..< count` に関数を適用して単一チャンクリストを生成する |
| `List.unfold` | `own ('state -> Maybe<('a * 'state)>) -> own 'state -> [\|'a\|]` | `None` が返るまで状態遷移関数からリストを生成する |
| `List.copy` | `Copy<'a> => ref [\|'a\|] -> [\|'a\|]` | 全要素を単一チャンクへ複製した新しいリストを返す |
| `List.rev` | `Copy<'a> => ref [\|'a\|] -> [\|'a\|]` | 要素順を反転した単一チャンクの新しいリストを返す（組み込み） |
| `List.permute` | `Copy<'a> => own (i64 -> i64) -> ref [\|'a\|] -> [\|'a\|]` | 添字 `i` の要素を `f i` へ移したリストを返す（全単射でない場合はトラップ） |
| `List.of_array` | `Copy<'a> => ref ['a] -> [\|'a\|]` | 配列から単一チャンクのリストを生成する |
| `List.to_array` | `Copy<'a> => ref [\|'a\|] -> ['a]` | リストの全要素を連続メモリの所有配列へ複写する（組み込み） |
| `List.of_seq` | `own Seq<'a> -> [\|'a\|]` | `Seq` を消費してリストを生成する（非 `Copy` 要素対応） |
| `List.to_seq` | `Copy<'a> => ref [\|'a\|] -> Seq<'a>` | 要素のコピーを順次列挙する `Seq` を返す |
| `List.to_seqr` | `ref [\|'a\|] -> Seq<ref 'a>` | 要素への共有参照を順次列挙する `Seq` を返す |

### 部分リスト・分割・連結・組操作

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `List.take` | `Copy<'a> => own i64 -> ref [\|'a\|] -> [\|'a\|]` | 先頭 `count` 個を複製したリストを返す（負数・長さ超過はトラップ） |
| `List.skip` | `Copy<'a> => own i64 -> ref [\|'a\|] -> [\|'a\|]` | 先頭 `count` 個を除いた残りを複製して返す（長さ超過はトラップ） |
| `List.truncate` | `Copy<'a> => own i64 -> ref [\|'a\|] -> [\|'a\|]` | 先頭から最大 `count` 個を返す |
| `List.split_at` | `Copy<'a> => own i64 -> ref [\|'a\|] -> ([\|'a\|] * [\|'a\|])` | 指定位置で前後2つのリストに分割する |
| `List.take_while` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> [\|'a\|]` | 先頭から述語を満たす連続要素を切り出す |
| `List.skip_while` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> [\|'a\|]` | 先頭から述語を満たす連続要素を飛ばした残りを返す |
| `List.chunk_by_size` | `Copy<'a> => own i64 -> ref [\|'a\|] -> [\|[\|'a\|]\|]` | 最大 `size` 個ずつの部分リスト群に分割する（`size <= 0` はトラップ） |
| `List.split_into` | `Copy<'a> => own i64 -> ref [\|'a\|] -> [\|[\|'a\|]\|]` | 最大 `count` 個の均等サイズ部分リストに分割する（`count <= 0` はトラップ） |
| `List.windowed` | `Copy<'a> => own i64 -> ref [\|'a\|] -> [\|[\|'a\|]\|]` | 長さ `size` のスライディングウィンドウリスト群を返す |
| `List.pairwise` | `Copy<'a> => ref [\|'a\|] -> [\|('a * 'a)\|]` | 隣接する2要素ずつのタプルリストを返す |
| `List.append` | `Copy<'a> => ref [\|'a\|] -> ref [\|'a\|] -> [\|'a\|]` | 2つのリストを連結した新しいリストを返す |
| `List.concat` | `Copy<'a> => ref [\|[\|'a\|]\|] -> [\|'a\|]` | リストのリストを1段平坦化して連結する |
| `List.zip` | `(Copy<'a>, Copy<'b>) => ref [\|'a\|] -> ref [\|'b\|] -> [\|('a * 'b)\|]` | 2リストの対応要素をタプル化する（長さ不一致はトラップ） |
| `List.zip3` | `(Copy<'a>, Copy<'b>, Copy<'c>) => ref [\|'a\|] -> ref [\|'b\|] -> ref [\|'c\|] -> [\|('a * 'b * 'c)\|]` | 3リストの対応要素をタプル化する（長さ不一致はトラップ） |
| `List.unzip` | `(Copy<'a>, Copy<'b>) => ref [\|('a * 'b)\|] -> ([\|'a\|] * [\|'b\|])` | ペアのリストを2つのリストへ分解する |
| `List.unzip3` | `(Copy<'a>, Copy<'b>, Copy<'c>) => ref [\|('a * 'b * 'c)\|] -> ([\|'a\|] * [\|'b\|] * [\|'c\|])` | 3要素タプルのリストを3つのリストへ分解する |
| `List.all_pairs` | `(Copy<'a>, Copy<'b>) => ref [\|'a\|] -> ref [\|'b\|] -> [\|('a * 'b)\|]` | 2リストの直積（全組み合わせ）を返す |
| `List.indexed` | `Copy<'a> => ref [\|'a\|] -> [\|(i64 * 'a)\|]` | `(インデックス, 要素)` のリストを返す |
| `List.transpose` | `Copy<'a> => ref [\|[\|'a\|]\|] -> [\|[\|'a\|]\|]` | 2次元リストの行と列を転置する（長さ不揃いはトラップ） |

### 走査・変換・フィルタ・畳み込み

Edition 2027 / 2028 では `iter`・`iteri`・`map`・`mapi`・`fold`・`fold_back` は読み取りビュー渡しに解決され、値コピー版は `*_owned` でも呼び出せます。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `List.iter` | `Copy<'a> => own ('a -> unit) -> ref [\|'a\|] -> unit` | 各要素に副作用関数を適用する（Edition 2027+ は非 `Copy` 要素可） |
| `List.iterr` | `own (ref 'a -> unit) -> ref [\|'a\|] -> unit` | 共有参照を受け取る `iter`（`iter_owned` は所有値コールバック固定） |
| `List.iteri` | `Copy<'a> => own (i64 -> 'a -> unit) -> ref [\|'a\|] -> unit` | インデックス付き `iter`（Edition 2027+ は非 `Copy` 要素可） |
| `List.iterir` | `own (i64 -> ref 'a -> unit) -> ref [\|'a\|] -> unit` | インデックスと共有参照を受け取る `iteri`（`iteri_owned` は所有値固定） |
| `List.iter2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> unit) -> ref [\|'a\|] -> ref [\|'b\|] -> unit` | 2リストの対応要素に関数を適用する |
| `List.iteri2` | `(Copy<'a>, Copy<'b>) => own (i64 -> 'a -> 'b -> unit) -> ref [\|'a\|] -> ref [\|'b\|] -> unit` | インデックス付きで2リストの対応要素に関数を適用する |
| `List.map` | `Copy<'a> => ('a -> 'b) -> ref [\|'a\|] -> [\|'b\|]` | 各要素を変換した単一チャンクリストを返す（組み込み、Edition 2027+ は非 `Copy` 可） |
| `List.mapr` | `(ref 'a -> 'b) -> ref [\|'a\|] -> [\|'b\|]` | 共有参照から変換する組み込み `map`（`map_owned` は所有値コールバック固定） |
| `List.mapi` | `Copy<'a> => own (i64 -> 'a -> 'b) -> ref [\|'a\|] -> [\|'b\|]` | インデックス付き `map`（Edition 2027+ は非 `Copy` 可） |
| `List.mapir` | `own (i64 -> ref 'a -> 'b) -> ref [\|'a\|] -> [\|'b\|]` | インデックスと共有参照から変換する `mapi`（`mapi_owned` は所有値固定） |
| `List.map2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> 'c) -> ref [\|'a\|] -> ref [\|'b\|] -> [\|'c\|]` | 2リストの対応要素から新しいリストを生成する |
| `List.mapi2` | `(Copy<'a>, Copy<'b>) => own (i64 -> 'a -> 'b -> 'c) -> ref [\|'a\|] -> ref [\|'b\|] -> [\|'c\|]` | インデックス付きで2リストを変換する |
| `List.map3` | `(Copy<'a>, Copy<'b>, Copy<'c>) => own ('a -> 'b -> 'c -> 'd) -> ref [\|'a\|] -> ref [\|'b\|] -> ref [\|'c\|] -> [\|'d\|]` | 3リストの対応要素から新しいリストを生成する |
| `List.map_fold` | `Copy<'a> => own ('state -> 'a -> ('b * 'state)) -> own 'state -> ref [\|'a\|] -> ([\|'b\|] * 'state)` | 先頭から変換と状態畳み込みを同時に行う |
| `List.map_fold_back` | `Copy<'a> => own ('a -> 'state -> ('b * 'state)) -> own 'state -> ref [\|'a\|] -> ([\|'b\|] * 'state)` | 末尾から変換と状態畳み込みを同時に行う |
| `List.collect` | `(Copy<'a>, Copy<'b>) => own ('a -> [\|'b\|]) -> ref [\|'a\|] -> [\|'b\|]` | 各要素が生成したリストを平坦に連結する |
| `List.choose` | `Copy<'a> => own ('a -> Maybe<'b>) -> ref [\|'a\|] -> [\|'b\|]` | `Some` の結果のみを集めたリストを返す |
| `List.filter` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> [\|'a\|]` | 述語を満たす要素のみを順序を保って抽出する |
| `List.where` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> [\|'a\|]` | `List.filter` と同一 |
| `List.partition` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> ([\|'a\|] * [\|'a\|])` | 述語が `true` のリストと `false` のリストに分割する |
| `List.partition_with` | `Copy<'a> => own ('a -> Result<'b, 'c>) -> ref [\|'a\|] -> ([\|'b\|] * [\|'c\|])` | `Ok` 群と `Error` 群の2リストに振り分ける |
| `List.fold` | `Copy<'a> => own ('state -> 'a -> 'state) -> own 'state -> ref [\|'a\|] -> 'state` | 先頭から左畳み込みを行う（Edition 2027+ は非 `Copy` 可） |
| `List.foldr` | `('state -> ref 'a -> 'state) -> 'state -> ref [\|'a\|] -> 'state` | 共有参照を受け取る組み込み左畳み込み（`fold_owned` は所有値固定） |
| `List.fold2` | `(Copy<'a>, Copy<'b>) => own ('state -> 'a -> 'b -> 'state) -> own 'state -> ref [\|'a\|] -> ref [\|'b\|] -> 'state` | 2リストを先頭から左畳み込みする |
| `List.fold_back` | `Copy<'a> => own ('a -> 'state -> 'state) -> own 'state -> ref [\|'a\|] -> 'state` | 末尾から右畳み込みを行う（Edition 2027+ は非 `Copy` 可） |
| `List.foldr_back` | `own (ref 'a -> 'state -> 'state) -> own 'state -> ref [\|'a\|] -> 'state` | 共有参照を受け取る右畳み込み（`fold_back_owned` は所有値固定） |
| `List.fold_back2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> 'state -> 'state) -> own 'state -> ref [\|'a\|] -> ref [\|'b\|] -> 'state` | 2リストを末尾から右畳み込みする |
| `List.reduce` | `Copy<'a> => own ('a -> 'a -> 'a) -> ref [\|'a\|] -> 'a` | 先頭要素を初期値として左畳み込みする（空リストはトラップ） |
| `List.reduce_back` | `Copy<'a> => own ('a -> 'a -> 'a) -> ref [\|'a\|] -> 'a` | 末尾要素を初期値として右畳み込みする（空リストはトラップ） |
| `List.scan` | `(Copy<'a>, Copy<'state>) => own ('state -> 'a -> 'state) -> own 'state -> ref [\|'a\|] -> [\|'state\|]` | 初期値と累積状態のリスト（長さ `n + 1`）を返す |
| `List.scan_back` | `(Copy<'a>, Copy<'state>) => own ('a -> 'state -> 'state) -> own 'state -> ref [\|'a\|] -> [\|'state\|]` | 末尾からの累積状態リスト（長さ `n + 1`）を返す |

### 探索・判定・集計・ソート・更新・乱数

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `List.exists` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> bool` | 述語を満たす要素が存在するか判定する（短絡評価） |
| `List.existsr` | `own (ref 'a -> bool) -> ref [\|'a\|] -> bool` | 共有参照述語による `exists` |
| `List.exists2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> bool) -> ref [\|'a\|] -> ref [\|'b\|] -> bool` | 2リストの対応ペアで `exists` 判定を行う |
| `List.forall` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> bool` | 全要素が述語を満たすか判定する |
| `List.forallr` | `own (ref 'a -> bool) -> ref [\|'a\|] -> bool` | 共有参照述語による `forall` |
| `List.forall2` | `(Copy<'a>, Copy<'b>) => own ('a -> 'b -> bool) -> ref [\|'a\|] -> ref [\|'b\|] -> bool` | 2リストの対応ペアで `forall` 判定を行う |
| `List.contains` | `Eq<'a> => own 'a -> ref [\|'a\|] -> bool` | 指定値と等しい要素が含まれるか判定する |
| `List.containsr` | `Eq<'a> => ref 'a -> ref [\|'a\|] -> bool` | 検索値を共有借用で受け取る `contains` |
| `List.find` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> 'a` | 述語を満たす最初の要素を返す（不在ならトラップ） |
| `List.try_find` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> Maybe<'a>` | 述語を満たす最初の要素を `Some` で返す |
| `List.find_back` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> 'a` | 述語を満たす最後の要素を返す（不在ならトラップ） |
| `List.try_find_back` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> Maybe<'a>` | 述語を満たす最後の要素を `Some` で返す |
| `List.findr` | `own (ref 'a -> bool) -> ref [\|'a\|] -> ref 'a` | 述語を満たす最初の要素への共有参照を返す（不在ならトラップ） |
| `List.try_findr` | `own (ref 'a -> bool) -> ref [\|'a\|] -> Maybe<ref 'a>` | 述語を満たす最初の要素への共有参照を `Some` で返す |
| `List.find_index` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> i64` | 述語を満たす最初の位置を返す（不在ならトラップ） |
| `List.try_find_index` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> Maybe<i64>` | 述語を満たす最初の位置を `Some` で返す |
| `List.find_index_back` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> i64` | 述語を満たす最後の位置を返す（不在ならトラップ） |
| `List.try_find_index_back` | `Copy<'a> => own ('a -> bool) -> ref [\|'a\|] -> Maybe<i64>` | 述語を満たす最後の位置を `Some` で返す |
| `List.pick` | `Copy<'a> => own ('a -> Maybe<'b>) -> ref [\|'a\|] -> 'b` | 最初に `Some` を返した変換結果を取り出す（不在ならトラップ） |
| `List.try_pick` | `Copy<'a> => own ('a -> Maybe<'b>) -> ref [\|'a\|] -> Maybe<'b>` | 最初に `Some` を返した変換結果を返す |
| `List.compare_with` | `Copy<'a> => own ('a -> 'a -> i64) -> ref [\|'a\|] -> ref [\|'a\|] -> i64` | 比較関数による辞書式比較を行う |
| `List.sum` | `Numeric<'a> => ref [\|'a\|] -> 'a` | 全要素の総和（空リストは `0`、整数はラップアラウンド） |
| `List.sum_by` | `(Copy<'a>, Numeric<'b>) => own ('a -> 'b) -> ref [\|'a\|] -> 'b` | 射影結果の総和 |
| `List.average` | `Float<'a> => ref [\|'a\|] -> 'a` | 浮動小数点リストの平均（空リストはトラップ） |
| `List.average_by` | `(Copy<'a>, Float<'b>) => own ('a -> 'b) -> ref [\|'a\|] -> 'b` | 射影結果の浮動小数点平均（空リストはトラップ） |
| `List.min` | `(Ord<'a>, Copy<'a>) => ref [\|'a\|] -> 'a` | 最小要素を返す（同値は先頭優先、空リストはトラップ） |
| `List.max` | `(Ord<'a>, Copy<'a>) => ref [\|'a\|] -> 'a` | 最大要素を返す（同値は先頭優先、空リストはトラップ） |
| `List.minr` | `Ord<'a> => ref [\|'a\|] -> ref 'a` | 最小要素への共有参照を返す（空リストはトラップ） |
| `List.maxr` | `Ord<'a> => ref [\|'a\|] -> ref 'a` | 最大要素への共有参照を返す（空リストはトラップ） |
| `List.min_by` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref [\|'a\|] -> 'a` | キーが最小となる最初の要素を返す |
| `List.max_by` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref [\|'a\|] -> 'a` | キーが最大となる最初の要素を返す |
| `List.distinct` | `(Hash<'a>, Eq<'a>, Copy<'a>) => ref [\|'a\|] -> [\|'a\|]` | 初出順を保って重複要素を除去する（NaN 安全） |
| `List.distinct_by` | `(Copy<'a>, Hash<'key>, Eq<'key>) => own ('a -> 'key) -> ref [\|'a\|] -> [\|'a\|]` | キーの初出順を保って重複を除去する（NaN 安全） |
| `List.except` | `(Hash<'a>, Eq<'a>, Copy<'a>) => ref [\|'a\|] -> ref [\|'a\|] -> [\|'a\|]` | 除外リストに含まれない要素を重複なしで返す |
| `List.count_by` | `(Copy<'a>, Copy<'key>, Hash<'key>, Eq<'key>) => own ('a -> 'key) -> ref [\|'a\|] -> [\|('key * i64)\|]` | キーごとの出現回数を初出順で返す |
| `List.group_by` | `(Copy<'a>, Copy<'key>, Hash<'key>, Eq<'key>) => own ('a -> 'key) -> ref [\|'a\|] -> [\|('key * [\|'a\|])\|]` | キーごとの要素リストを初出順で返す |
| `List.sort` | `(Ord<'a>, Copy<'a>) => ref [\|'a\|] -> [\|'a\|]` | `Ord` 昇順の安定ソート結果を返す（`f32`/`f64` の NaN は末尾） |
| `List.sort_descending` | `(Ord<'a>, Copy<'a>) => ref [\|'a\|] -> [\|'a\|]` | `Ord` 降順の安定ソート結果を返す |
| `List.sort_by` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref [\|'a\|] -> [\|'a\|]` | キー昇順の安定ソート（NaN キーは末尾） |
| `List.sort_by_descending` | `(Copy<'a>, Ord<'key>) => own ('a -> 'key) -> ref [\|'a\|] -> [\|'a\|]` | キー降順の安定ソート |
| `List.sort_with` | `Copy<'a> => own ('a -> 'a -> i64) -> ref [\|'a\|] -> [\|'a\|]` | 比較関数による安定ソート |
| `List.insert_at` | `Copy<'a> => own i64 -> own 'a -> ref [\|'a\|] -> [\|'a\|]` | 指定位置の手前に1要素を挿入した新リストを返す |
| `List.insert_many_at` | `Copy<'a> => own i64 -> ref [\|'a\|] -> ref [\|'a\|] -> [\|'a\|]` | 指定位置の手前に複数要素を挿入した新リストを返す |
| `List.remove_at` | `Copy<'a> => own i64 -> ref [\|'a\|] -> [\|'a\|]` | 指定位置の要素を除いた新リストを返す |
| `List.remove_many_at` | `Copy<'a> => own i64 -> own i64 -> ref [\|'a\|] -> [\|'a\|]` | 指定位置から `count` 個を除いた新リストを返す（負数はトラップ） |
| `List.update_at` | `Copy<'a> => own i64 -> own 'a -> ref [\|'a\|] -> [\|'a\|]` | 指定位置を新値で置換した新リストを返す |
| `List.random_shuffle_by` | `Copy<'a> => own (unit -> f64) -> ref [\|'a\|] -> [\|'a\|]` | 乱数関数でシャッフルした新リストを返す |
| `List.random_choice_by` | `Copy<'a> => own (unit -> f64) -> ref [\|'a\|] -> 'a` | 乱数関数で1要素を無作為抽出する |
| `List.random_choices_by` | `Copy<'a> => own (unit -> f64) -> own i64 -> ref [\|'a\|] -> [\|'a\|]` | 乱数関数で重複あり `count` 個を抽出する |
| `List.random_sample_by` | `Copy<'a> => own (unit -> f64) -> own i64 -> ref [\|'a\|] -> [\|'a\|]` | 乱数関数で重複なし `count` 個を抽出する |
| `List.random_shuffle_with` | `Copy<'a> => own Random.Pcg -> ref [\|'a\|] -> ([\|'a\|] * Random.Pcg)` | `Random.Pcg` でシャッフルし更新後の生成器とともに返す |
| `List.random_choice_with` | `Copy<'a> => own Random.Pcg -> ref [\|'a\|] -> ('a * Random.Pcg)` | `Random.Pcg` で1要素と更新後の生成器を返す |
| `List.random_choices_with` | `Copy<'a> => own Random.Pcg -> own i64 -> ref [\|'a\|] -> ([\|'a\|] * Random.Pcg)` | `Random.Pcg` で重複あり `count` 個と生成器を返す |
| `List.random_sample_with` | `Copy<'a> => own Random.Pcg -> own i64 -> ref [\|'a\|] -> ([\|'a\|] * Random.Pcg)` | `Random.Pcg` で重複なし `count` 個と生成器を返す |
| `List.random_shuffle` | `Copy<'a> => own [\|'a\|] -> IO<Result<[\|'a\|], Os.Error>>` | OS 乱数でシャッフルする `IO` アクション（`random` 権限） |
| `List.random_choice` | `Copy<'a> => own [\|'a\|] -> IO<Result<'a, Os.Error>>` | OS 乱数で1要素を選ぶ `IO` アクション（`random` 権限） |
| `List.random_choices` | `Copy<'a> => own i64 -> own [\|'a\|] -> IO<Result<[\|'a\|], Os.Error>>` | OS 乱数で重複あり抽出を行う `IO` アクション（`random` 権限） |
| `List.random_sample` | `Copy<'a> => own i64 -> own [\|'a\|] -> IO<Result<[\|'a\|], Os.Error>>` | OS 乱数で重複なし抽出を行う `IO` アクション（`random` 権限） |

## 計算量と性能上の特性

以下の表は `std/List.tz` の `@complexity` タグから自動生成された時間計算量です。これに加え、組み込みの `List.cons` は償却 $O(1)$、`List.tail` は $O(1)$、`List.map`・`List.mapr`・`List.foldr`・`List.rev`・`List.to_array` はいずれも $O(n)$ です。

<!-- generated:complexity:List -->
| 関数 | 計算量 | 関連 |
| --- | --- | --- |
| `List.length` | $O(1)$ | - |
| `List.is_empty` | $O(1)$ | - |
| `List.copy` | $O(n)$ | - |
| `List.empty` | $O(1)$ | - |
| `List.singleton` | $O(1)$ | - |
| `List.replicate` | $O(k)$ | - |
| `List.init` | $O(k)$ | - |
| `List.head` | $O(1)$ | - |
| `List.try_head` | $O(1)$ | - |
| `List.item` | $O(n)$ | - |
| `List.try_item` | $O(n)$ | - |
| `List.last` | $O(n)$ | - |
| `List.try_last` | $O(n)$ | - |
| `List.exactly_one` | $O(1)$ | - |
| `List.try_exactly_one` | $O(1)$ | - |
| `List.take` | $O(k)$ | - |
| `List.skip` | $O(n)$ | - |
| `List.truncate` | $O(k)$ | - |
| `List.split_at` | $O(n)$ | - |
| `List.take_while` | $O(n)$ | - |
| `List.skip_while` | $O(n)$ | - |
| `List.where` | $O(n)$ | - |
| `List.filter` | $O(n)$ | - |
| `List.transpose` | $O(n + k)$ | - |
| `List.iter` | $O(n)$ | `List.iterr` |
| `List.iterr` | $O(n)$ | `List.iter` |
| `List.iteri` | $O(n)$ | `List.iterir` |
| `List.iterir` | $O(n)$ | `List.iteri` |
| `List.iter2` | $O(n)$ | - |
| `List.iteri2` | $O(n)$ | - |
| `List.mapi` | $O(n)$ | `List.mapir` |
| `List.mapir` | $O(n)$ | `List.mapi` |
| `List.map2` | $O(n)$ | - |
| `List.mapi2` | $O(n)$ | - |
| `List.map3` | $O(n)$ | - |
| `List.map_fold` | $O(n)$ | - |
| `List.map_fold_back` | $O(n)$ | - |
| `List.collect` | $O(n + k)$ | - |
| `List.choose` | $O(n)$ | - |
| `List.fold` | $O(n)$ | - |
| `List.fold2` | $O(n)$ | - |
| `List.fold_back` | $O(n)$ | `List.foldr_back` |
| `List.foldr_back` | $O(n)$ | `List.fold_back` |
| `List.fold_back2` | $O(n)$ | - |
| `List.reduce` | $O(n)$ | - |
| `List.reduce_back` | $O(n)$ | - |
| `List.scan` | $O(n)$ | - |
| `List.scan_back` | $O(n)$ | - |
| `List.exists` | $O(n)$ | `List.existsr` |
| `List.existsr` | $O(n)$ | `List.exists` |
| `List.exists2` | $O(n + m)$ | - |
| `List.forall` | $O(n)$ | `List.forallr` |
| `List.forallr` | $O(n)$ | `List.forall` |
| `List.forall2` | $O(n + m)$ | - |
| `List.try_find_index` | $O(n)$ | - |
| `List.find_index` | $O(n)$ | - |
| `List.try_find_index_back` | $O(n)$ | - |
| `List.find_index_back` | $O(n)$ | - |
| `List.try_find` | $O(n)$ | `List.try_findr` |
| `List.find` | $O(n)$ | `List.findr` |
| `List.try_find_back` | $O(n)$ | - |
| `List.find_back` | $O(n)$ | - |
| `List.try_findr` | $O(n)$ | `List.try_find` |
| `List.findr` | $O(n)$ | `List.find` |
| `List.try_pick` | $O(n)$ | - |
| `List.pick` | $O(n)$ | - |
| `List.partition` | $O(n)$ | - |
| `List.partition_with` | $O(n)$ | - |
| `List.sum` | $O(n)$ | - |
| `List.sum_by` | $O(n)$ | - |
| `List.average` | $O(n)$ | - |
| `List.average_by` | $O(n)$ | - |
| `List.min` | $O(n)$ | `List.minr` |
| `List.max` | $O(n)$ | `List.maxr` |
| `List.minr` | $O(n)$ | `List.min` |
| `List.maxr` | $O(n)$ | `List.max` |
| `List.min_by` | $O(n)$ | - |
| `List.max_by` | $O(n)$ | - |
| `List.compare_with` | $O(n + m)$ | - |
| `List.containsr` | $O(n)$ | `List.contains` |
| `List.contains` | $O(n)$ | `List.containsr` |
| `List.append` | $O(n + m)$ | - |
| `List.concat` | $O(n + k)$ | - |
| `List.zip` | $O(n)$ | - |
| `List.zip3` | $O(n)$ | - |
| `List.unzip` | $O(n)$ | - |
| `List.unzip3` | $O(n)$ | - |
| `List.all_pairs` | $O(n \cdot m)$ | - |
| `List.indexed` | $O(n)$ | - |
| `List.pairwise` | $O(n)$ | - |
| `List.windowed` | $O(n + k)$ | - |
| `List.chunk_by_size` | $O(n)$ | - |
| `List.split_into` | $O(n)$ | - |
| `List.unfold` | $O(k)$ | - |
| `List.permute` | $O(n)$ | - |
| `List.insert_at` | $O(n)$ | - |
| `List.insert_many_at` | $O(n + m)$ | - |
| `List.remove_at` | $O(n)$ | - |
| `List.remove_many_at` | $O(n)$ | - |
| `List.update_at` | $O(n)$ | - |
| `List.of_array` | $O(n)$ | - |
| `List.of_seq` | $O(n)$ | - |
| `List.to_seqr` | $O(n)$ | `List.to_seq` |
| `List.to_seq` | $O(n)$ | `List.to_seqr` |
| `List.distinct` | 平均 $O(n)$、最悪 $O(n \cdot n)$ | - |
| `List.distinct_by` | 平均 $O(n)$、最悪 $O(n \cdot n)$ | - |
| `List.except` | 平均 $O(n + m)$、最悪 $O(n \cdot n + n \cdot m + m \cdot m)$ | - |
| `List.count_by` | 平均 $O(n)$、最悪 $O(n \cdot n)$ | - |
| `List.group_by` | 平均 $O(n)$、最悪 $O(n \cdot n)$ | - |
| `List.sort` | $O(n \log n)$ | - |
| `List.sort_descending` | $O(n \log n)$ | - |
| `List.sort_with` | $O(n \log n)$ | - |
| `List.sort_by` | $O(n \log n)$ | - |
| `List.sort_by_descending` | $O(n \log n)$ | - |
| `List.random_shuffle_by` | $O(n)$ | - |
| `List.random_shuffle_with` | $O(n)$ | - |
| `List.random_choice_by` | $O(n)$ | - |
| `List.random_choice_with` | $O(n)$ | - |
| `List.random_choices_by` | $O(n + k)$ | - |
| `List.random_choices_with` | $O(n + k)$ | - |
| `List.random_sample_by` | $O(n)$ | - |
| `List.random_sample_with` | $O(n)$ | - |
| `List.random_shuffle` | $O(n)$ | - |
| `List.random_choice` | $O(n)$ | - |
| `List.random_choices` | $O(n + k)$ | - |
| `List.random_sample` | $O(n)$ | - |
<!-- /generated:complexity:List -->

### チャンク表現における定数サイズ小リストの注意点

チャンク連続表現により、実行時に長さが決まる中規模〜大規模リストの構築と `for ... in` 走査は従来の単一ノード連結表現より1桁以上高速化され、チャンク内の連続ループは LLVM の自動ベクトル化対象にもなります。一方で、2〜3要素の定数長小リストをホットループ内で「毎回 `List.cons` や `List.map` / `List.rev` で生成して即座に破棄する」パターンでは、チャンクヘッダの動的管理によりヒープ確保が消去されず 1回あたり数十ナノ秒を要する場合があります。固定少数の値を一時的に束ねるホットパスでは、タプルまたはインライン固定長配列 `[T; N]`（[Array](./array.md)）の使用を検討してください。

## 反復走査

`for x in xs do ...` は追加メモリを一切確保せず、各チャンクの連続領域を直接走査します。一方、`List.to_seq` / `List.to_seqr` は事前に $O(n)$ の一時参照バッファを構築するため、単純な1回走査には直接の `for` ループを使用します。

```tsuzuri run=total%3D60%20chars%3D11
let nums = [|10, 20, 30|]
let mut total = 0
for n in nums do
    total = total + n

let words = [|"Tsuzuri", "List"|]
let mut chars = 0
for w in words do
    chars = chars + w.length

$"total={total} chars={chars}"
```

## 関連項目

- [標準ライブラリの設計規約と引数の順序](../conventions.md)
- [Array](./array.md)
- [Vec](./vec.md)
- [Seq](./seq.md)
- [Rc と Arc](../memory/rc.md)
- [パターンマッチ](../../expressions/pattern-matching.md)
