# 標準ライブラリの設計規約と引数の順序

Tsuzuri の標準ライブラリとコンパイラ組み込み関数は、モジュールをまたいで一貫したパイプライン記述と関数合成を実現するため、厳格な引数順序規約に基づいて設計されています。本章では、「対象（subject）は最後の引数」の原則、所有版と借用版のツイン関数、同型引数の命名規則、および原則から除外される4種類の例外を説明します。

## 要点

- 関数が読み取り・変換・更新する中心的な値（**対象 / subject**）は、常に**最後の引数**に配置します（例: `Map.insert key value map`、`String.sub start count text`、`Maybe.bind f maybe`）。
- 対象が最後にあるため、パイプライン `x |> M.f a`（`M.f a x` と等価）および部分適用による関数合成 `M.f a >> M.g b` がすべてのモジュールで統一的に機能します。
- 構築関数や対象を持たない関数（`empty`、`init`、`of_array`、`parse` など）、および1引数関数は順序選択の対象外です。
- 所有権を消費する関数と借用で受け取るツイン関数（`get` と `get_ref`、`map` と `map_ref`、`fold` と `foldr` など）は、完全に同じ引数順序をとります。
- 原則の例外は、**リソースハンドル**・**数値および文字演算**・**コンパイラプロトコル**・**テストおよびベンチマークハーネス**の4分類のみに限定されます。

## 「対象は最後の引数」の原則

関数の「対象（subject）」とは、その関数が読み取る・変換する・書き換える対象となるデータ構造やコンテナを指します。キー、インデックス、要素数、コールバック関数、区切り文字列などの補助パラメータはすべて対象より前に置き、F# や .NET の慣習に沿った順序で並べます。

| 分類 | 該当モジュール | 対象（最後の引数） | 呼び出し例 |
| --- | --- | --- | --- |
| シーケンス・動的配列 | [Array](./collections/array.md), [Vec](./collections/vec.md), [List](./collections/list.md), [Seq](./collections/seq.md) | 配列、`Vec`、連結リスト、遅延シーケンス | `Array.sub 1 3 xs`, `Vec.push 10 buf`, `Seq.map f seq` |
| 連想配列・集合 | [Map](./collections/map.md), [Set](./collections/set.md), [HashMap](./collections/hashmap.md), [HashSet](./collections/hashset.md) | マップ、集合 | `Map.insert key value map`, `HashSet.contains item set` |
| 選択・結果・作用 | [Maybe](./core/maybe.md), [Result](./core/result.md), [IO](./sys/io.md) | `Maybe`、`Result`、`IO` アクション | `Maybe.bind f opt`, `Result.map_error f res`, `IO.bind f act` |
| 文字列・正規表現 | [String](./text/string.md), [Utf8String](./text/utf8string.md), [Text](./text/text.md), [Format](./text/format.md), [Unicode](./text/unicode.md), [Regex](./text/regex.md), [Path](./sys/path.md), [ZString](./text/zstring.md) | 検査・加工対象の文字列（または文字列配列） | `String.slice 0 4 text`, `Regex.replace_all re rep text` |
| 多次元配列・スライス | [Matrix](./numeric/matrix.md), [MatrixView](./numeric/matrix-view.md), [Tensor](./numeric/tensor.md), [Slice](./numeric/slice.md), [Gpu](./numeric/gpu.md) | 行列、ビュー、テンソル、スライス指定、GPU バッファ | `Matrix.get row col mat`, `MatrixView.write r c v view` |
| メモリ領域・状態 | [Arena](./memory/arena.md), [Anchor](./memory/anchor.md), [Random](./sys/random.md), [Alloc](./testing/alloc.md) | アリーナ、アンカートークン、乱数生成器、統計値 | `Arena.insert val arena`, `Anchor.read f token`, `Alloc.since snap` |
| 構造化データ | [Json](./encoding/json.md), [Gen](./testing/gen.md) | JSON 値・リーダー・ライター、ジェネレータ | `Json.write_bool true writer`, `Gen.map f gen` |
| テンソルのファイル | [TensorCodec](./encoding/tensor-codec.md), [TensorIO](./encoding/tensor-io.md) | 窓、`Raw`、アーカイブ、バイト列・テキスト、マップしたファイル | `TensorCodec.archive_get name archive`, `TensorIO.save_npy path view` |

### 複数の対象をとる関数

`append`、`zip`、`union`、`Matrix.mul`、`Monoid.combine` のように同格の対象を2つ受け取る関数では、F# と同じ自然な左右順（`left` が先、`right` が後）を維持します。

一方、片方の対象を読み取って他方の対象へ書き込む関数では、**書き換えられる側（出力先）を最後の引数**に置きます。

```text
MatrixView.copy_from source target
```

## パイプラインと関数合成

対象が常に末尾にあるため、異なるモジュールの関数を `|>` や `>>` で自在に連結できます。

```tsuzuri run=stock%3D1%20label%3Dababab%20parsed%3D40%20shouted%3Dhihi
let stock =
    HashMap.empty()
    |> HashMap.insert "apple" 3
    |> HashMap.insert "pear" 5
    |> HashMap.remove "apple"

let label = "ab" |> String.repeat 3

let parsed =
    Maybe.Some 20
    |> Maybe.bind (\n -> if n > 10 then Maybe.Some (n * 2) else Maybe.None)
    |> Maybe.default_value 0

let shout = String.trim >> String.repeat 2
let shouted = "  hi " |> shout

$"stock={HashMap.length stock} label={label} parsed={parsed} shouted={shouted}"
```

`String.trim >> String.repeat 2` は部分適用された関数同士を合成し、「文字列を受け取って前後空白を除去し2回繰り返す関数」を作ります。

### F# 標準ライブラリとの比較

F# の `Map`・`Set`・`Option`・`Result`・`String.replicate` とは引数順が一致しています。F# の `Array` や `List` で例外的にコレクションが先頭に置かれていた要素アクセス・書き換え関数（`Array.get`、`Array.set` など）も、Tsuzuri では対象が最後になるよう統一されています。

| 操作 | Tsuzuri | F# |
| --- | --- | --- |
| マップへの追加 | `Map.insert key value map` | `Map.add key value table` |
| マップの検索 | `Map.get key map` | `Map.tryFind key table` |
| 集合の要素判定 | `Set.contains value set` | `Set.contains value set` |
| オプションの連結 | `Maybe.bind f maybe` | `Option.bind f option` |
| 文字列の反復 | `String.repeat count text` | `String.replicate count str` |
| 配列要素の取得 | `Array.get index array` | `Array.get array index`（F# は配列が先頭） |
| 配列要素の更新 | `Array.write index value array` | `Array.set array index value`（F# は配列が先頭） |

## 借用ツイン関数と評価順序

### 所有版と借用版の対称性

Tsuzuri では所有権を消費する関数と、共有借用または排他借用で操作するツイン関数が対で提供されます（例: `Maybe.map` と `Maybe.map_ref`、`List.fold` と `List.foldr`、`Array.set` と `Array.write`）。借用版でも引数の順序は所有版と完全に同一です。

### 排他借用と引数の評価順序

関数呼び出しの引数は左から右へ評価されます。対象が最後の引数に置かれているため、直接呼び出しでは**対象を排他借用する前に、先行する引数式の中で同じ対象を読み取る**ことができます。

```tsuzuri run=values%3D%5B20%2C%202%2C%203%5D
let mut values = [1, 2, 3]
Array.write 0 (values[1] * 10) values
$"values={values}"
```

一方、パイプライン演算子 `x |> f a b` は左辺 `x` を先に評価・借用してから右辺の引数を評価します。排他借用を伴う関数にパイプラインで渡しつつ引数内でも同じ変数を参照すると、借用規則違反（`E1014`）となります。

```text
let mut values = [1, 2, 3]
// エラー E1014: values の排他借用中に values[1] を共有借用できない
values |> Array.write 0 (values[1] * 10)
```

## 同型引数の命名規約（`text` / `parts`）

`String.find`、`String.replace`、`Regex.replace_all` のように、検索語（needle）や置換文字列と操作対象のテキストが同じ文字列型をとる関数では、型シグネチャだけではどちらが対象かを判別できません。

`String`・`Utf8String`・`Regex`・`Text` モジュールでは、**最後の仮引数名を必ず `text`（文字列の配列やリストの場合は `parts`）とする**規約を設けており、コンパイラのテストスイートで機械的に検証しています。

```text
String.find :: ref string -> ref string -> Maybe<i64>
               ^^^^^^^^^^    ^^^^^^^^^^
               needle        text（対象）

String.replace :: ref string -> ref string -> ref string -> string
                  ^^^^^^^^^^    ^^^^^^^^^^^   ^^^^^^^^^^
                  needle        replacement   text（対象）

String.join :: ref string -> ref [string] -> string
               ^^^^^^^^^^    ^^^^^^^^^^^^
               separator     parts（対象）
```

## 原則の例外（4分類）

標準ライブラリ全体で「対象が最後」の原則から外れるのは、明確な設計上の根拠を持つ以下の4分類のみです。

| 例外分類 | 該当モジュール・関数 | 引数の順序 | 根拠 |
| --- | --- | --- | --- |
| リソースハンドル | [File](./sys/file.md), [Net](./sys/net.md), [Process](./sys/process.md), [Atomic](./sync/atomic.md), [Mutex](./sync/mutex.md), [RwMutex](./sync/rwmutex.md), [Cond](./sync/cond.md), [Semaphore](./sync/semaphore.md), [Channel](./sync/channel.md), [DataChannel](./sync/datachannel.md), [WaitGroup](./sync/waitgroup.md), [Once](./sync/once.md), [SyncMap](./sync/syncmap.md), [Context](./sync/context.md), [ErrGroup](./sync/errgroup.md), [Timer](./sync/timer.md), [Rc](./memory/rc.md), [Owned](./memory/owned.md) | ハンドル（レシーバ）が第1引数、データ・タイムアウト・コールバックが後続（例: `File.write handle bytes`, `Mutex.with_lock lock callback`） | 外部資源や同期プリミティブへの副作用操作であり、値変換パイプラインで連鎖させず .NET メソッドのレシーバと同じ語順で記述するため |
| 数値・文字演算 | [Int](./numeric/int.md), [Math](./numeric/math.md), [Simd](./numeric/simd.md), [Char](./text/char.md) | 数式・定義式の被演算子順（例: `Math.pow base exp`, `Int.clamp value low high`, `Simd.replace vec lane val`） | コレクション変換ではなく、数学的記法の非対称なオペランド順を崩すと誤読を招くため |
| コンパイラプロトコル | コンピュテーション式ビルダーの大文字メソッド（`Bind`, `Return`, `Combine`, `For` 等）、`derive` が呼ぶ `Json.decode_field`・`Json.case_index` | 脱糖規則・コード生成プロトコルで規定された順序（例: `Maybe.Bind maybe next`） | コンパイラが構文展開時に呼び出す内部規約であり、ユーザーがパイプラインで直接合成する API ではないため |
| テスト・ベンチマークハーネス | [Gen](./testing/gen.md)（`for_all`, `for_all_cases`, `for_all_where`, `check`, `check_where`）、[Test](./testing/test.md)、[Bench](./testing/bench.md) | ジェネレータや設定が先、テスト本体の複数行ラムダが最後 | 戻り値を次の処理へ流す関数ではなく、末尾に複数行のクロージャブロックを置いて可読性を高めるため |

組み込みのモジュール `ObjC`（[Objective-C 連携](../compiler/objective-c.md)）の関数はどれも 1 引数で、その引数が対象です。`extern class` のメンバーは利用者が宣言する `extern` であり標準ライブラリの API ではないので、この規約の対象外です。Objective-C のメソッド呼び出しと同じく受け手を最初の引数に置きます（`NSString.length (ref text)`）。

なお、純粋なデータ変換モジュールに例外は一切認められません。また、[Net](./sys/net.md) や [Json](./encoding/json.md) のような例外・複合モジュール内に含まれる純粋関数（`Net.parse_ip`、`Json.serialize_pretty` など）は、原則どおり対象を最後の引数にとります。

## ユーザー定義関数への適用

アプリケーションやライブラリの関数を定義する際も、対象を最後の引数に配置すると標準ライブラリの関数とそのまま `|>` や `>>` で組み合わせることができます。

```tsuzuri run=total%3D12
def scale :: i64 -> [i64] -> [i64] = \factor values ->
    Array.map (\x -> x * factor) values

let total = [1, 2, 3] |> scale 2 |> Array.sum
$"total={total}"
```

## 関連項目

- [演算子と式](../expressions/operators.md)
- [関数定義](../expressions/functions.md)
- [借用と参照](../ownership/borrowing.md)
- [Array](./collections/array.md)
- [Maybe](./core/maybe.md)
- [Result](./core/result.md)
