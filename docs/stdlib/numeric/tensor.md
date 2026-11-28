# Tensor

`Tensor` は、最大 64 軸までの N 次元配列を行優先（C 順）の連続バッファで所有する `Tensor<'a>`、負ストライドや 0 ストライド（ブロードキャスト軸）を含む任意のストライド窓をゼロコピーで借用する読み取りビュー `Tensor.View<'a> { r }`、および単射性（エイリアシングなし）を保証した排他書き込みビュー `Tensor.Mut<'a> { r }` を提供する opt-in 標準モジュールです。

2 次元専用の固定ランク型および決定論的行列積については[`Matrix`](matrix.md)・[`MatrixView`](matrix-view.md)、ブラケット窓構文が用いるセレクタ型については[`Slice`](slice.md)を参照してください。

## 要点

- `Tensor<'a>`・`Tensor.View<'a>`・`Tensor.Mut<'a>` はいずれも非 `Copy` の不透明レコードであり、暗黙のバッファ複製を防ぎつつ借用検査（`E1012` / `E1013` / `E1014`）によってダングリング参照やデータ競合を静的に排除します。
- Edition 2028 の多次元ブラケット添字により、`t[i, j]`・`t[^0, 0]`・`mt[i, j] = v` による**ヒープ確保 0 回の要素読み書き**と、`ref t[0 ..< 2, ..]`・`ref t[.. -1 .., 0]` による**データ複製なしの `Tensor.View` 切り出し**が可能です（ビューを返す添字で `ref` を省略すると `E1042`）。
- NumPy 互換の右揃えブロードキャストを備える要素ごと演算（ufunc）、追加ヒープ確保 0 回で出力ビューへ書き込む `*_into` カーネル、および累積更新を行う `*_in_place` カーネルを提供します（C 連続かつ同形状の入力では 1 次元スライス直走査の高速経路が自動選択されます）。
- 所有 `Tensor` 同士の 7 算術インスタンスに加え、`Tensor`・`View`・スカラー `'a` を自在に混在できる **43 個の演算子拡張インスタンス**（`+`, `-`, `*`, `/`, `%`, `**`, 単項 `-`）を備え、`ref a[1..] - ref a[..= ^1]` や `2.0 * x + 1.0` を被演算子を消費せずにそのまま記述できます。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、引数順序は以下の規則で統一されています。

- **単一対象の変換・検査・軸操作**: 対象の `ref Tensor<'a>`・`ref View<'a>`・`own Tensor<'a>` が常に最後の引数です（`Tensor.permute axes view`、`Tensor.narrow axis start len view`、`Tensor.roll axis shift view`、`Tensor.split axis sections view`、`Tensor.clip low high view`）。
- **二項・三項ブロードキャスト ufunc**: 数式どおり左から右の順です（`Tensor.sub left right` は `left - right`、`Tensor.where_select cond on_true on_false`、`Tensor.fma a b c`）。
- **スカラーとの二項関数**: スカラーが第 1 引数、対象ビューが第 2 引数です。非可換演算では `sub_scalar s v` が `v - s`、`rsub_scalar s v` が `s - v` を表します。
- **`*_into` および `*_in_place` カーネル**: 書き込み先の可変ビュー `ref mut Mut` が常に最後の引数です（`Tensor.add_into left right out`、`Tensor.add_in_place rhs target`）。

```tsuzuri run=corner%3D23%20missing%3D-1%20plane_count%3D12
let t = Tensor.init [2, 3, 4] (\i -> i)
let v = Tensor.view (ref t)
let rotated = ref v |> Tensor.permute [2, 0, 1]
let corner = ref rotated |> Tensor.at [3, 1, 2]
let missing = ref rotated |> Tensor.get [4, 0, 0] |> Maybe.default_value (-1)
let plane_count = ref v |> (Tensor.index_axis 0 1 >> Tensor.count)
$"corner={deref corner} missing={missing} plane_count={plane_count}"
```

## データ型とエラー型

```text
record Tensor<'a>             // 所有テンソル（最大 64 軸、行優先連続バッファ、Eq / Display 実装）
record View<'a> { r }         // 読み取り専用ストライド窓（負・0 ストライド可、Display 実装）
record Mut<'a> { r }          // 単射な書き込み可能ストライド窓（extent > 1 の軸で 0 ストライド不可）

union Error =
    | ShapeMismatch of ([i64] * [i64])
    | IncompatibleBroadcast of ([i64] * [i64])
    | InvalidAxis of (i64 * i64)
    | InvalidShape of [i64]
    | NonContiguous
    deriving (Eq)             // instance Display<Error> 実装済み

union PadMode<'a> = Constant of 'a | Edge | Reflect | Symmetric | Wrap
```

ランク `0`（`shape == []`）は要素 1 個のスカラーテンソルを表し、長さ `0` の軸を 1 つでも含む形状は要素数 `0` の空テンソルを表します。`Display` インスタンスは要素数が `1000` を超える場合に中央部を `...` で省略整形します。

## 多次元ブラケット添字（要素アクセス・厳格ビュー・ブールマスク）

`Tensor`・`Tensor.View`・`Tensor.Mut` は `Index` / `IndexMut` 型クラスを通じて以下のブラケット構文をサポートします。

- **ゼロアロケーション要素読み書き**: `t[i, j]`・`t[^0, 0]`・`v[i, j, k]`・`mt[i, j] = val`・`mt[^0, ^1] = val` はヒープ確保を一切行わずに要素へアクセスします（1〜4 軸はタプル特殊化、5 軸以上はスタック配列経由。次元数がランクと一致しない場合や範囲外はトラップ）。
- **厳格セレクタ窓 `ref t[...]`（[`Slice.Sel`](slice.md)）**: 範囲（`a ..< b`、`a ..= b`、`..`、刻み付き `0 .. 2 ..< 6`、逆順 `.. -1 ..`）や `Slice.rest()`・`Slice.Sel.AddAxis` を 1 つ以上含むキーには先頭に `ref` を付け、要素コピーなしで `Tensor.View` を取得します（`ref` 欠落時は `E1042`）。整数位置の軸は除去され、範囲や `..` の軸は残ります（不足する末尾軸は自動的に `..` で補完）。窓の連鎖 `ref t[1 ..= 2, ..][0, ..]` もそのまま記述でき、窓から要素を読む際は `(ref t[1 ..= 2, ..])[0, 1]` のように括弧を添えます。
- **クランプ付き記述子窓 `ref t[[...]]`（[`Slice.Axis`](slice.md)）**: 配列リテラルで包んだ `ref t[[Slice.range 1 4, Slice.rev()]]` は NumPy 互換の端丸め・負添字折り返しを行います。
- **ブールマスク抽出・代入**: 同形状の `Tensor<bool>` をキーにした `t[bmask]` は真の位置を 1 次元 `Tensor<'a>` として抽出し（コピーのため `ref` 不要）、`mt[bmask] = scalar` は真の位置へ一括代入します。

```tsuzuri run=elem%3D6%20bl%3D8%20row1%3D%5B4%2C%205%2C%206%2C%207%5D%20block%3D%5B1%2C%202%2C%205%2C%206%5D%20rev0%3D%5B8%2C%204%2C%200%5D%20exp_shape%3D%5B1%2C%203%2C%204%5D
let t = Tensor.init [3, 4] (\i -> i)
let elem = t[1, 2]
let bl = t[^0, 0]
let row1 = Tensor.to_array (Tensor.to_tensor (ref (ref t[1, ..])))
let block = Tensor.to_array (Tensor.to_tensor (ref (ref t[0 ..= 1, 1 ..< 3])))
let rev0 = Tensor.to_array (Tensor.to_tensor (ref (ref t[.. -1 .., 0])))
let exp_v = ref t[Slice.Sel.AddAxis, ..]
$"elem={elem} bl={bl} row1={row1} block={block} rev0={rev0} exp_shape={Tensor.shape (ref exp_v)}"
```

## 算術演算子（同種 7 インスタンス + 拡張 43 インスタンス）

所有 `Tensor<'a>` 同士の標準算術インスタンス 7 個（`Add`, `Sub`, `Mul`, `Div`, `Rem`, `Pow`, `Neg`）に加え、異種オペランド間の[演算子拡張インスタンス](../../types/type-classes.md) **43 個**が実装されています。すべての演算子はオペランドを共有借用で受け取り、新しい所有 `Tensor<'a>` を返します（ブロードキャスト不能な形状は確保前にトラップします。`Result` で受け取りたい場合は関数版 `Tensor.add` 等を使用します）。

| 演算子（6 二項 + 1 単項） | サポートされるオペランド型の組み合わせ |
| --- | --- |
| `+`, `-`, `*`, `/`, `%`, `**` | `Tensor × Tensor`（標準 6 個）、および拡張 36 個（各演算子につき `View × View`、`Tensor × View`、`View × Tensor`、`'a × Tensor`、`Tensor × 'a`、`'a × View`、`View × 'a` の 6 通り × 6 演算子 = 36 個、または同種 View を含め 7 通り × 6 = 42 個） |
| 単項 `-` | `-Tensor<'a>`（標準 1 個）および `-View<'a>`（拡張 `Neg<View<'a>, Tensor<'a>>` 1 個） |

```tsuzuri run=diff%3D%5B10%2C%2010%2C%2010%2C%2010%5D%20lin%3D%5B2%2C%204%2C%206%5D%20z_ok%3Dtrue
let a = Tensor.of_array [5] [10.0, 20.0, 30.0, 40.0, 50.0]
let diff = ref a[1..] - ref a[..= ^1]
let x = Tensor.of_array [3] [0.5, 1.5, 2.5]
let lin = 2.0 * x + 1.0

let mat = Tensor.of_array [2, 3] [2.0, 4.0, 6.0, 10.0, 20.0, 30.0]
let mean = Tensor.of_array [2, 1] [4.0, 20.0]
let std_dev = Tensor.of_array [2, 1] [2.0, 10.0]
let z = (mat - mean) / std_dev
let expected = Tensor.of_array [2, 3] [-1.0, 0.0, 1.0, -1.0, 0.0, 1.0]
let z_ok = Tensor.allclose 1e-12 1e-12 false (Tensor.view (ref z)) (Tensor.view (ref expected))
$"diff={Tensor.to_array diff} lin={Tensor.to_array lin} z_ok={z_ok}"
```

### NumPy との主な相違点

- **整数の `/` と `%`**: Tsuzuri の整数演算規則に従い `/`（`Tensor.div`）はゼロ方向切り捨て、`%`（`Tensor.rem`）は被除数と同符号です。負の無限大方向へ丸める床除算・床剰余には `Tensor.floor_divide` / `Tensor.floor_mod`（浮動小数点は `floor_divide_float` / `floor_mod_float`）を使用します。
- **`round` と `sign(-0.0)`**: `Tensor.round` は中間値 `.5` をゼロから遠い側へ丸めます（最近接偶数丸めは `Tensor.round_even`）。`Tensor.sign` は浮動小数点ゼロの符号ビットを保持します。
- **`==` とブールマスク演算**: `t1 == t2` はテンソル全体の構造的等価判定（`bool`）です。要素ごとの比較マスク生成には `Tensor.elem_eq`〜`elem_ge` や `gt_scalar` を、マスク同士の論理結合には `Tensor.logical_and` / `logical_or` / `logical_xor` / `logical_not` を使用します。

## 公開関数一覧（全 258 関数）

### 1. 所有テンソル構築・変換・Matrix 相互変換・連続性検査（32 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Tensor.of_array` | `[i64] -> ['a] -> Tensor<'a>` | 形状と行優先配列から所有テンソルを構築（長さ不一致はトラップ） |
| `Tensor.init` | `[i64] -> (i64 -> 'a) -> Tensor<'a>` | 平坦通し番号 `0 ..< count` に関数を適用して初期化 |
| `Tensor.scalar` | `'a -> Tensor<'a>` | ランク `0`（形状 `[]`）の 1 要素テンソルを構築 |
| `Tensor.zeros` | `Default<'a> => [i64] -> Tensor<'a>` | `Default.default`（数値型では `0`）で埋めた指定形状テンソル |
| `Tensor.ones` | `Numeric<'a> => [i64] -> Tensor<'a>` | `1` で埋めた指定形状テンソル |
| `Tensor.full` | `Copy<'a> => 'a -> [i64] -> Tensor<'a>` | 指定値で埋めた指定形状テンソル |
| `Tensor.zeros_like` | `Default<'a> => ref View<'b> -> Tensor<'a>` | 参照ビューと同じ形状のゼロ初期化テンソル |
| `Tensor.ones_like` | `Numeric<'a> => ref View<'b> -> Tensor<'a>` | 参照ビューと同じ形状の `1` 初期化テンソル |
| `Tensor.full_like` | `Copy<'a> => 'a -> ref View<'b> -> Tensor<'a>` | 参照ビューと同じ形状を定数値で埋めたテンソル |
| `Tensor.clone` | `Copy<'a> => ref Tensor<'a> -> Tensor<'a>` | 所有テンソルの深いコピー |
| `Tensor.as_array` | `ref Tensor<'a> -> ref ['a]` | 内部の行優先配列全体をゼロコピーで共有借用 |
| `Tensor.to_array` | `Tensor<'a> -> ['a]` | テンソルを消費して行優先配列を取り出す |
| `Tensor.reshape` | `[i64] -> Tensor<'a> -> Tensor<'a>` | 要素数を保ったまま所有テンソルの形状を変更（不一致はトラップ） |
| `Tensor.reshape_infer` | `[i64] -> Tensor<'a> -> Tensor<'a>` | 最大 1 個の `-1` 軸を自動推論して形状変更（不正時はトラップ） |
| `Tensor.try_reshape` | `[i64] -> Tensor<'a> -> Result<Tensor<'a>, Error>` | `-1` 推論付きの失敗可能な形状変更 |
| `Tensor.of_matrix` | `Matrix<'a> -> Tensor<'a>` | `Matrix<'a>` を消費して 2 次元テンソルへ変換 |
| `Tensor.to_matrix` | `Tensor<'a> -> Matrix<'a>` | 2 次元テンソルを消費して `Matrix<'a>` へ変換（ランク `!= 2` はトラップ） |
| `Tensor.view` | `ref { r } Tensor<'a> -> View<'a> { r }` | 所有テンソル全体の読み取りビューを作成 |
| `Tensor.borrow` | `[i64] -> ref { r } ['a] -> View<'a> { r }` | 平坦配列を指定形状の行優先ビューとして借用 |
| `Tensor.strided` | `i64 -> [i64] -> [i64] -> ref { r } ['a] -> View<'a> { r }` | `offset`, `shape`, `strides` を明示して境界検証済みビューを構築 |
| `Tensor.of_matrix_view` | `MatrixView<'a> { r } -> View<'a> { r }` | `MatrixView` を 2 次元の `Tensor.View` へ変換 |
| `Tensor.as_matrix_view` | `ref View<'a> { r } -> MatrixView<'a> { r }` | ランク 2・非負ストライドの `View` を `MatrixView` へ変換 |
| `Tensor.fortran_strides` | `ref [i64] -> [i64]` | 指定形状に対する列優先（Fortran 順）のストライド配列を計算 |
| `Tensor.is_contiguous` | `ref View<'a> -> bool` | C 順（行優先）連続であれば `true` |
| `Tensor.is_c_contiguous` | `ref View<'a> -> bool` | C 順（行優先）連続判定（`is_contiguous` と同義） |
| `Tensor.is_f_contiguous` | `ref View<'a> -> bool` | Fortran 順（列優先）連続判定 |
| `Tensor.to_tensor` | `Copy<'a> => ref View<'a> -> Tensor<'a>` | ビューの論理順序どおり新しい行優先 `Tensor` へ複製 |
| `Tensor.as_contiguous` | `Copy<'a> => ref View<'a> -> Tensor<'a>` | C 順連続の所有 `Tensor` として実体化 |
| `Tensor.clone_view` | `Copy<'a> => ref View<'a> -> Tensor<'a>` | ビューの内容を新しい所有 `Tensor` へ複製 |
| `Tensor.as_fortran` | `Copy<'a> => ref View<'a> -> ['a]` | ビューの要素を列優先（Fortran 順）に並べた 1 次元配列を返す |
| `Tensor.astype` | `(Copy<'a>, Copy<'b>) => ('a -> 'b) -> ref View<'a> -> Tensor<'b>` | 要素変換関数を適用して別要素型のテンソルを生成 |
| `Tensor.format_view` | `Display<'a> => ref View<'a> -> string` | ビューを多次元ブラケット表記の文字列へ整形 |

### 2. 読み取りビューのメタデータ・要素参照・基本軸操作（16 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Tensor.rank` | `ref View<'a> -> i64` | 軸の本数（次元数） |
| `Tensor.shape` | `ref View<'a> -> ref [i64]` | 各軸の長さ配列への共有参照 |
| `Tensor.count` | `ref View<'a> -> i64` | 論理要素の総数 |
| `Tensor.strides` | `ref View<'a> -> ref [i64]` | 各軸のストライド配列への共有参照 |
| `Tensor.offset` | `ref View<'a> -> i64` | 先頭要素の基底配列内オフセット |
| `Tensor.data` | `ref View<'a> { r } -> ref { r } ['a]` | 基底バッファ全体の共有参照 |
| `Tensor.at` | `[i64] -> ref View<'a> { r } -> ref { r } 'a` | 座標配列による要素の共有借用（範囲外・次元不一致はトラップ） |
| `Tensor.get` | `Copy<'a> => [i64] -> ref View<'a> -> Maybe<'a>` | 範囲外・次元不一致時に `None` を返す要素取得 |
| `Tensor.fold` | `Copy<'a> => ('s -> 'a -> 's) -> 's -> ref View<'a> -> 's` | 論理的な行優先順で左から右へ全要素を畳み込む |
| `Tensor.map` | `Copy<'a> => ('a -> 'b) -> ref View<'a> -> Tensor<'b>` | 全要素に関数を適用した新しい所有 `Tensor<'b>` を生成 |
| `Tensor.permute` | `[i64] -> ref View<'a> { r } -> View<'a> { r }` | `0 ..< rank` の順列に従って軸を並べ替えたゼロコピービュー |
| `Tensor.index_axis` | `i64 -> i64 -> ref View<'a> { r } -> View<'a> { r }` | `axis` を位置 `pos` に固定してその軸を取り除いたビュー |
| `Tensor.narrow` | `i64 -> i64 -> i64 -> ref View<'a> { r } -> View<'a> { r }` | `axis` を `start` から長さ `len` に絞ったビュー |
| `Tensor.reshape_view` | `[i64] -> ref View<'a> { r } -> View<'a> { r }` | C 連続ビューの形状をゼロコピーで読み替える（非連続はトラップ） |
| `Tensor.slice` | `[Slice.Axis] -> ref View<'a> { r } -> View<'a> { r }` | クランプ付き `Slice.Axis` 配列によるゼロコピースライス |
| `Tensor.normalize_axis` | `pure i64 -> i64 -> i64` | 負の軸番号 `axis` を `rank` に対して `[0, rank)` へ正規化 |

### 3. 可変ビュー `Tensor.Mut` とインプレース更新（15 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Tensor.borrow_mut` | `[i64] -> ref mut { r } ['a..] -> Mut<'a> { r }` | 排他スライスを指定形状の可変ビューとして借用 |
| `Tensor.update` | `(ref mut Mut<'a> -> unit) -> Tensor<'a> -> Tensor<'a>` | 所有テンソルを消費し、可変ビュー経由で更新したテンソルを返す |
| `Tensor.freeze` | `ref { r } Mut<'a> { r } -> View<'a> { r }` | 可変ビューから読み取り専用 `View` を一時再借用 |
| `Tensor.is_contiguous_mut` | `ref Mut<'a> { r } -> bool` | 可変ビューが正ストライドの C 順連続であれば `true` |
| `Tensor.as_slice_mut` | `ref mut { r } Mut<'a> { r } -> ref mut { r } ['a..]` | C 順連続な可変ビューを 1 次元排他スライスとして貸し出す |
| `Tensor.write` | `[i64] -> 'a -> ref mut Mut<'a> { r } -> unit` | 指定座標の要素を書き換える（`mt[i, j] = v` の関数版） |
| `Tensor.fill` | `Copy<'a> => 'a -> ref mut Mut<'a> { r } -> unit` | 窓内の全要素を同一値で埋める |
| `Tensor.copy_from` | `Copy<'a> => ref View<'a> { s } -> ref mut Mut<'a> { r } -> unit` | 同形状の読み取りビューから全要素をコピー |
| `Tensor.map_in_place` | `Copy<'a> => ('a -> 'a) -> ref mut Mut<'a> { r } -> unit` | 窓内の全要素をインプレース変換 |
| `Tensor.permute_mut` | `[i64] -> ref mut { r } Mut<'a> { r } -> Mut<'a> { r }` | 単射性を保った軸の並べ替え可変サブビュー |
| `Tensor.index_axis_mut` | `i64 -> i64 -> ref mut { r } Mut<'a> { r } -> Mut<'a> { r }` | 1 軸を固定して落とした可変サブビュー |
| `Tensor.narrow_mut` | `i64 -> i64 -> i64 -> ref mut { r } Mut<'a> { r } -> Mut<'a> { r }` | 指定軸の部分区間を切り出した可変サブビュー |
| `Tensor.sub_mut` | `[i64] -> [i64] -> ref mut { r } Mut<'a> { r } -> Mut<'a> { r }` | 全軸の `starts` と `lengths` で切り出した可変サブビュー |
| `Tensor.step_mut` | `i64 -> i64 -> ref mut { r } Mut<'a> { r } -> Mut<'a> { r }` | `axis` を非ゼロの `step` 刻みにした可変サブビュー |
| `Tensor.flip_mut` | `i64 -> ref mut { r } Mut<'a> { r } -> Mut<'a> { r }` | `axis` の向きを反転した可変サブビュー |

### 4. 数列・グリッド・単位/対角/三角テンソル生成（17 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Tensor.arange_i64` | `i64 -> i64 -> i64 -> Tensor<i64>` | `start` から `stop` 手前まで `step` 刻みの 1 次元 `i64` テンソル |
| `Tensor.arange_f64` | `f64 -> f64 -> f64 -> Tensor<f64>` | `start` から `stop` 手前まで `step` 刻みの 1 次元 `f64` テンソル |
| `Tensor.arange_f32` | `f32 -> f32 -> f32 -> Tensor<f32>` | `start` から `stop` 手前まで `step` 刻みの 1 次元 `f32` テンソル |
| `Tensor.linspace` | `(Float<'a>, ...) => 'a -> 'a -> i64 -> Tensor<'a>` | 閉区間 `[start, stop]` を等分する `count` 点の 1 次元テンソル |
| `Tensor.linspace_open` | `(Float<'a>, ...) => 'a -> 'a -> i64 -> Tensor<'a>` | 半開区間 `[start, stop)` を等分する `count` 点の 1 次元テンソル |
| `Tensor.logspace` | `(Elementary<'a>, ...) => 'a -> 'a -> i64 -> 'a -> Tensor<'a>` | `base ** linspace(start, stop, count)` の対数等間隔数列 |
| `Tensor.geomspace` | `(Elementary<'a>, ...) => 'a -> 'a -> i64 -> Tensor<'a>` | `start` から `stop` までの等比数列（ゼロを跨ぐ指定はトラップ） |
| `Tensor.eye` | `Numeric<'a> => i64 -> i64 -> i64 -> Tensor<'a>` | 第 `k` 対角線が `1`、他が `0` の `rows × cols` テンソル |
| `Tensor.identity` | `Numeric<'a> => i64 -> Tensor<'a>` | `n × n` 単位行列テンソル |
| `Tensor.diag` | `(Default<'a>, Copy<'a>) => i64 -> ref View<'a> -> Tensor<'a>` | 1D ビューからは対角行列を生成、2D ビューからは第 `k` 対角線を抽出 |
| `Tensor.diagonal` | `Copy<'a> => i64 -> ref View<'a> -> Tensor<'a>` | 2D 以上のビューから第 `k` 対角成分を抽出 |
| `Tensor.diag_flat` | `(Default<'a>, Copy<'a>) => i64 -> ref View<'a> -> Tensor<'a>` | 入力を 1 次元に平坦化して第 `k` 対角に配置した 2D テンソル |
| `Tensor.tri` | `Numeric<'a> => i64 -> i64 -> i64 -> Tensor<'a>` | 第 `k` 対角以下が `1`、それより上が `0` の `rows × cols` テンソル |
| `Tensor.tril` | `(Default<'a>, Copy<'a>) => i64 -> ref View<'a> -> Tensor<'a>` | 第 `k` 対角より上をゼロクリアした下三角テンソル |
| `Tensor.triu` | `(Default<'a>, Copy<'a>) => i64 -> ref View<'a> -> Tensor<'a>` | 第 `k` 対角より下をゼロクリアした上三角テンソル |
| `Tensor.meshgrid` | `(Copy<'a>, Copy<'b>) => ref View<'a> -> ref View<'b> -> (Tensor<'a> * Tensor<'b>)` | 1D ベクトル 2 本から直交座標グリッド（`xy` 順: `[len_y, len_x]`）を生成 |
| `Tensor.meshgrid_ij` | `(Copy<'a>, Copy<'b>) => ref View<'a> -> ref View<'b> -> (Tensor<'a> * Tensor<'b>)` | 行列添字順（`ij` 順: `[len_x, len_y]`）の座標グリッドを生成 |

### 5. ブロードキャスト・軸変形・反転・反復・パディング（24 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Tensor.broadcast_shape` | `ref [i64] -> ref [i64] -> Result<[i64], Error>` | 2 つの形状の右揃えブロードキャスト結果形状を計算 |
| `Tensor.broadcast_to` | `[i64] -> ref View<'a> -> Result<View<'a>, Error>` | 0 ストライド軸を用いて目標形状へゼロコピー拡張 |
| `Tensor.broadcast_pair` | `ref View<'a> -> ref View<'b> -> Result<(View<'a> * View<'b>), Error>` | 2 つのビューを共通形状へゼロコピーでブロードキャスト |
| `Tensor.broadcast_arrays` | `ref [View<'a>] -> Result<[View<'a>], Error>` | ビュー配列全体を共通形状へゼロコピーでブロードキャスト |
| `Tensor.transpose` | `ref View<'a> { r } -> View<'a> { r }` | 全軸の順序を反転したゼロコピー転置ビュー |
| `Tensor.swapaxes` | `i64 -> i64 -> ref View<'a> { r } -> View<'a> { r }` | 2 本の軸を入れ替えたゼロコピービュー（負の軸番号対応） |
| `Tensor.moveaxis` | `i64 -> i64 -> ref View<'a> { r } -> View<'a> { r }` | `src` 軸を `dst` 位置へ移動したゼロコピービュー |
| `Tensor.squeeze` | `ref View<'a> { r } -> View<'a> { r }` | 長さ `1` の軸をすべて除去したゼロコピービュー |
| `Tensor.squeeze_axis` | `i64 -> ref View<'a> { r } -> View<'a> { r }` | 指定した長さ `1` の軸を取り除いたビュー（長さ `!= 1` はトラップ） |
| `Tensor.expand_dims` | `i64 -> ref View<'a> { r } -> View<'a> { r }` | 指定位置に長さ `1` の新規軸を挿入したゼロコピービュー |
| `Tensor.atleast_1d` | `ref View<'a> { r } -> View<'a> { r }` | ランク 0 なら `[1]` へ拡張し、1D 以上はそのまま返すビュー |
| `Tensor.atleast_2d` | `ref View<'a> { r } -> View<'a> { r }` | 2 次元未満のビューに先頭軸を補って最低 2D にしたビュー |
| `Tensor.atleast_3d` | `ref View<'a> { r } -> View<'a> { r }` | 3 次元未満のビューを最低 3D に拡張したビュー |
| `Tensor.flip_axis` | `i64 -> ref View<'a> { r } -> View<'a> { r }` | 指定軸の要素順を負ストライドで逆転したゼロコピービュー |
| `Tensor.flip` | `ref View<'a> { r } -> View<'a> { r }` | 全軸の要素順を逆転したゼロコピービュー |
| `Tensor.fliplr` | `ref View<'a> { r } -> View<'a> { r }` | 軸 `1`（左右方向）を逆転したビュー（ランク `< 2` はトラップ） |
| `Tensor.flipud` | `ref View<'a> { r } -> View<'a> { r }` | 軸 `0`（上下方向）を逆転したビュー（ランク `< 1` はトラップ） |
| `Tensor.rot90` | `i64 -> ref View<'a> { r } -> View<'a> { r }` | 先頭 2 軸の平面内で 90 度 × `k` 回反時計回りに回転したビュー |
| `Tensor.ravel_view` | `ref View<'a> { r } -> View<'a> { r }` | C 連続ビューを 1 次元 `[count]` に読み替えたビュー（非連続はトラップ） |
| `Tensor.flatten` | `Copy<'a> => ref View<'a> -> Tensor<'a>` | 任意のビューを 1 次元の所有 `Tensor` へ複製・平坦化 |
| `Tensor.roll` | `Copy<'a> => i64 -> i64 -> ref View<'a> -> Tensor<'a>` | `roll axis shift view`: 指定軸に沿って要素を循環シフト |
| `Tensor.tile` | `Copy<'a> => [i64] -> ref View<'a> -> Tensor<'a>` | 各軸の繰り返し回数 `reps` に従って全体をタイル反復 |
| `Tensor.repeat` | `Copy<'a> => i64 -> i64 -> ref View<'a> -> Tensor<'a>` | `repeat axis repeats view`: 指定軸の各要素を連続反復 |
| `Tensor.pad` | `Copy<'a> => [(i64 * i64)] -> PadMode<'a> -> ref View<'a> -> Tensor<'a>` | 各軸の前後に `(before, after)` 幅のパディングを適用 |

### 6. 結合・ゼロコピー分割・マスク・条件選択・Gather / Scatter（24 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Tensor.concatenate` | `Copy<'a> => i64 -> ref [View<'a>] -> Result<Tensor<'a>, Error>` | 既存軸 `axis` に沿って複数のビューを連結 |
| `Tensor.stack` | `Copy<'a> => i64 -> ref [View<'a>] -> Result<Tensor<'a>, Error>` | 新規軸 `axis` を挿入して同形状ビュー群を積層 |
| `Tensor.vstack` | `Copy<'a> => ref [View<'a>] -> Result<Tensor<'a>, Error>` | 縦方向（軸 `0`、1D は `[1, N]` 化）に連結 |
| `Tensor.hstack` | `Copy<'a> => ref [View<'a>] -> Result<Tensor<'a>, Error>` | 横方向（1D は軸 `0`、2D 以上は軸 `1`）に連結 |
| `Tensor.dstack` | `Copy<'a> => ref [View<'a>] -> Result<Tensor<'a>, Error>` | 奥行き方向（最低 3D 化して軸 `2`）に連結 |
| `Tensor.column_stack` | `Copy<'a> => ref [View<'a>] -> Result<Tensor<'a>, Error>` | 1D ベクトル群を列として並べ、2D ビュー群と軸 `1` で連結 |
| `Tensor.split` | `i64 -> i64 -> ref View<'a> -> [View<'a>]` | `split axis sections view`: 軸を等分したゼロコピービュー配列（割り切れなければトラップ） |
| `Tensor.split_at` | `i64 -> [i64] -> ref View<'a> -> [View<'a>]` | `split_at axis indices view`: 指定境界点群で軸をゼロコピー分割 |
| `Tensor.array_split` | `i64 -> i64 -> ref View<'a> -> [View<'a>]` | 割り切れない端数も許容して `sections` 個へゼロコピー分割 |
| `Tensor.hsplit` | `i64 -> ref View<'a> -> [View<'a>]` | 横方向（1D は軸 `0`、2D 以上は軸 `1`）の等分割 |
| `Tensor.vsplit` | `i64 -> ref View<'a> -> [View<'a>]` | 縦方向（軸 `0`、ランク `>= 2`）の等分割 |
| `Tensor.dsplit` | `i64 -> ref View<'a> -> [View<'a>]` | 奥行き方向（軸 `2`、ランク `>= 3`）の等分割 |
| `Tensor.mask` | `Copy<'a> => ref View<bool> -> ref View<'a> -> Tensor<'a>` | 同形状ブールマスクが `true` の要素を行優先順に 1D テンソルへ抽出 |
| `Tensor.compress` | `Copy<'a> => i64 -> ref [bool] -> ref View<'a> -> Tensor<'a>` | 1 本の軸 `axis` に沿って 1D ブール配列でスライスを選択 |
| `Tensor.flatnonzero` | `(Eq<'a>, Default<'a>) => ref View<'a> -> [i64]` | `Default.default`（`0` / `false`）でない要素の平坦インデックス配列 |
| `Tensor.nonzero` | `(Eq<'a>, Default<'a>) => ref View<'a> -> [[i64]]` | 非ゼロ要素の座標を軸ごとのインデックス配列として返す |
| `Tensor.argwhere` | `(Eq<'a>, Default<'a>) => ref View<'a> -> Tensor<i64>` | 非ゼロ要素の座標を `[num_nonzero, rank]` の 2D テンソルで返す |
| `Tensor.put_mask` | `Copy<'a> => ref View<bool> -> 'a -> ref mut Mut<'a> { r } -> unit` | マスクが `true` の位置にスカラー値をインプレース書き込み |
| `Tensor.where_select` | `Copy<'a> => ref View<bool> -> ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>` | 3 入力ブロードキャストによる要素選択 `if cond then x else y` |
| `Tensor.where_scalar` | `Copy<'a> => 'a -> 'a -> ref View<bool> -> Tensor<'a>` | ブールビューに対し真なら第 1 引数、偽なら第 2 引数を返す |
| `Tensor.clip` | `(Ord<'a>, Copy<'a>) => 'a -> 'a -> ref View<'a> -> Tensor<'a>` | 全要素を閉区間 `[low, high]` にクランプ |
| `Tensor.take` | `Copy<'a> => i64 -> ref View<i64> -> ref View<'a> -> Tensor<'a>` | 指定軸に沿って整数インデックステンソルの位置を収集（gather） |
| `Tensor.take_along_axis` | `Copy<'a> => i64 -> ref View<i64> -> ref View<'a> -> Tensor<'a>` | 同ランクのインデックスビューで軸方向に要素を収集 |
| `Tensor.put_along_axis` | `Copy<'a> => i64 -> ref View<i64> -> ref View<'a> -> ref mut Mut<'a> { r } -> unit` | 同ランクのインデックスビューに従い可変ビューへ要素を散布（scatter） |

```tsuzuri run=picked%3D%5B2%2C%203%5D%20updated%3D%5B1%2C%2099%2C%2099%2C%204%5D%20clipped%3D%5B2%2C%202%2C%203%2C%203%5D
let g = Tensor.of_array [2, 2] [1, 2, 3, 4]
let bmask = Tensor.of_array [2, 2] [false, true, true, false]
let picked = g[bmask]
let updated = Tensor.update (\m -> m[bmask] = 99) (Tensor.clone (ref g))
let clipped = Tensor.clip 2 3 (Tensor.view (ref g))
$"picked={Tensor.to_array picked} updated={Tensor.to_array updated} clipped={Tensor.to_array clipped}"
```

### 7. ブロードキャスト反復エンジンと二項・三項算術・ビット・論理 ufunc（40 関数）

| 分類 | 関数 | シグネチャ・説明 |
| --- | --- | --- |
| 反復エンジン（6） | `Tensor.map_into` | `('a -> 'b) -> ref View<'a> -> ref mut Mut<'b> -> Result<unit, Error>`（ゼロ確保 1 入力変換） |
| | `Tensor.map2` | `('a -> 'b -> 'c) -> ref View<'a> -> ref View<'b> -> Result<Tensor<'c>, Error>`（2 入力ブロードキャスト） |
| | `Tensor.map2_into` | `('a -> 'b -> 'c) -> ref View<'a> -> ref View<'b> -> ref mut Mut<'c> -> Result<unit, Error>` |
| | `Tensor.map3` | `('a -> 'b -> 'c -> 'd) -> ref View<'a> -> ref View<'b> -> ref View<'c> -> Result<Tensor<'d>, Error>` |
| | `Tensor.map3_into` | `('a -> 'b -> 'c -> 'd) -> ref View<'a> -> ref View<'b> -> ref View<'c> -> ref mut Mut<'d> -> Result<unit, Error>` |
| | `Tensor.map2_in_place` | `('a -> 'b -> 'a) -> ref View<'b> -> ref mut Mut<'a> -> Result<unit, Error>`（右辺をブロードキャストして累積更新） |
| 二項算術・除算・剰余（14） | `Tensor.add` / `Tensor.sub` / `Tensor.mul` | `ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（要素ごとの加減乗算） |
| | `Tensor.div` / `Tensor.rem` / `Tensor.pow` | `ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（除算・剰余・累乗） |
| | `Tensor.floor_divide` / `Tensor.floor_mod` | `(Integer<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（整数の床除算・床剰余） |
| | `Tensor.divmod` | `(Integer<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<(Tensor<'a> * Tensor<'a>), Error>`（床商と床剰余の組） |
| | `Tensor.floor_divide_float` / `Tensor.floor_mod_float` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（浮動小数点の床除算・床剰余） |
| | `Tensor.divmod_float` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<(Tensor<'a> * Tensor<'a>), Error>` |
| | `Tensor.fmod` / `Tensor.ieee_remainder` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（`Math.fmod` / `Math.ieee_remainder`） |
| 極値・二項数学・FMA（10） | `Tensor.maximum` / `Tensor.minimum` | `ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（浮動小数点では `NaN` を伝播する最大・最小） |
| | `Tensor.fmax` / `Tensor.fmin` | `(Float<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（`NaN` を無視する最大・最小） |
| | `Tensor.atan2` / `Tensor.hypot` / `Tensor.copysign` | `ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（要素ごとの `atan2`, `hypot`, `copysign`） |
| | `Tensor.logaddexp` / `Tensor.logaddexp2` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>` |
| | `Tensor.fma` | `(Float<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（3 入力 `Math.fma`） |
| ビット・論理演算（10） | `Tensor.bit_and` / `Tensor.bit_or` / `Tensor.bit_xor` | `(Bits<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>` |
| | `Tensor.bit_not` | `(Bits<'a>, Copy<'a>) => ref View<'a> -> Tensor<'a>`（ビット反転） |
| | `Tensor.shl` / `Tensor.shr` | `(Bits<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<'a>, Error>`（要素別シフト） |
| | `Tensor.logical_and` / `Tensor.logical_or` / `Tensor.logical_xor` | `ref View<bool> -> ref View<bool> -> Result<Tensor<bool>, Error>`（ブールマスク結合） |
| | `Tensor.logical_not` | `ref View<bool> -> Tensor<bool>`（ブールマスク反転） |

### 8. 両側スカラー演算・ゼロ確保 `_into` カーネル・累積 `_in_place` カーネル（29 関数）

ループ内で中間テンソルのヒープ確保を完全にゼロにしたい場合は、あらかじめ確保した配列から `Tensor.borrow_mut` で `Mut` を作り、`*_into` または `*_in_place` を呼び出します。

| 分類 | 関数 | シグネチャ・説明 |
| --- | --- | --- |
| 両側スカラー演算（12） | `Tensor.add_scalar` / `Tensor.radd_scalar` | `'a -> ref View<'a> -> Tensor<'a>`（`x + s` / `s + x`） |
| | `Tensor.sub_scalar` / `Tensor.rsub_scalar` | `'a -> ref View<'a> -> Tensor<'a>`（`x - s` / `s - x`） |
| | `Tensor.mul_scalar` / `Tensor.scale` | `'a -> ref View<'a> -> Tensor<'a>`（`x * s` / `s * x`） |
| | `Tensor.div_scalar` / `Tensor.rdiv_scalar` | `'a -> ref View<'a> -> Tensor<'a>`（`x / s` / `s / x`） |
| | `Tensor.rem_scalar` / `Tensor.rrem_scalar` | `'a -> ref View<'a> -> Tensor<'a>`（`x % s` / `s % x`） |
| | `Tensor.pow_scalar` / `Tensor.rpow_scalar` | `'a -> ref View<'a> -> Tensor<'a>`（`x ** s` / `s ** x`） |
| 二項・三項・スカラー `_into`（7） | `Tensor.add_into` / `Tensor.sub_into` / `Tensor.mul_into` / `Tensor.div_into` | `ref View<'a> -> ref View<'a> -> ref mut Mut<'a> -> Result<unit, Error>` |
| | `Tensor.scale_into` | `'a -> ref View<'a> -> ref mut Mut<'a> -> Result<unit, Error>` |
| | `Tensor.mul_add_into` | `ref View<'a> -> ref View<'a> -> ref View<'a> -> ref mut Mut<'a> -> Result<unit, Error>`（個別丸め `a * b + c`） |
| | `Tensor.fma_into` | `ref View<'a> -> ref View<'a> -> ref View<'a> -> ref mut Mut<'a> -> Result<unit, Error>`（1 回丸め `Math.fma`） |
| 単項 `_into`（5） | `Tensor.neg_into` / `Tensor.abs_into` / `Tensor.sqrt_into` / `Tensor.exp_into` / `Tensor.log_into` | `ref View<'a> -> ref mut Mut<'a> -> Result<unit, Error>` |
| 累積 `_in_place`（5） | `Tensor.add_in_place` / `Tensor.sub_in_place` / `Tensor.mul_in_place` / `Tensor.div_in_place` / `Tensor.rem_in_place` | `ref View<'a> -> ref mut Mut<'a> -> Result<unit, Error>`（`target` へブロードキャスト累積更新） |

```tsuzuri run=out%3D%5B11%2C%2022%2C%2013%2C%2024%5D
let a = Tensor.of_array [2, 2] [1, 2, 3, 4]
let bias = Tensor.of_array [2] [10, 20]
let mut scratch = [0, 0, 0, 0]
let mut out = Tensor.borrow_mut [2, 2] (ref mut scratch)
let _ = Tensor.add_into (Tensor.view (ref a)) (Tensor.view (ref bias)) (ref mut out)
$"out={scratch}"
```

### 9. 単項数学・複素数成分・特殊値分類 ufunc（43 関数）

| 分類 | 関数 | シグネチャ・説明 |
| --- | --- | --- |
| 符号・累乗根・丸め（12） | `Tensor.neg` / `Tensor.abs` / `Tensor.sign` | `ref View<'a> -> Tensor<'a>`（符号反転・絶対値・符号） |
| | `Tensor.square` / `Tensor.reciprocal` | `ref View<'a> -> Tensor<'a>`（$x^2$ および逆数 $1 / x$） |
| | `Tensor.sqrt` / `Tensor.cbrt` | `ref View<'a> -> Tensor<'a>`（平方根 `Float<'a>`・立方根 `Elementary<'a>`） |
| | `Tensor.floor` / `Tensor.ceil` / `Tensor.trunc` / `Tensor.round` / `Tensor.round_even` | `(Float<'a>, Copy<'a>) => ref View<'a> -> Tensor<'a>`（[`Math`](math.md)と同一の丸め規則） |
| 三角・逆三角・双曲線（12） | `Tensor.sin` / `Tensor.cos` / `Tensor.tan` / `Tensor.asin` / `Tensor.acos` / `Tensor.atan` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> Tensor<'a>` |
| | `Tensor.sinh` / `Tensor.cosh` / `Tensor.tanh` / `Tensor.asinh` / `Tensor.acosh` / `Tensor.atanh` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> Tensor<'a>` |
| 指数・対数・角度（10） | `Tensor.exp` / `Tensor.exp2` / `Tensor.expm1` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> Tensor<'a>` |
| | `Tensor.log` / `Tensor.log2` / `Tensor.log10` / `Tensor.log1p` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> Tensor<'a>` |
| | `Tensor.sinc` / `Tensor.degrees` / `Tensor.radians` | `(Elementary<'a>, Copy<'a>) => ref View<'a> -> Tensor<'a>` |
| 複素数・特殊値（9） | `Tensor.real` / `Tensor.imag` | `Copy<'a> => ref View<Complex<'a>> -> Tensor<'a>`（複素テンソルの実部・虚部） |
| | `Tensor.conj` | `(Float<'a>, Neg<'a>, Copy<'a>) => ref View<Complex<'a>> -> Tensor<Complex<'a>>`（複素共役） |
| | `Tensor.angle` | `(Elementary<'a>, Copy<'a>) => ref View<Complex<'a>> -> Tensor<'a>`（主偏角 `Complex.arg`） |
| | `Tensor.is_nan` / `Tensor.is_infinite` / `Tensor.is_finite` / `Tensor.signbit` | `(Float<'a>, Copy<'a>) => ref View<'a> -> Tensor<bool>`（IEEE 754 分類マスク） |
| | `Tensor.nan_to_num` | `(Float<'a>, Copy<'a>) => 'a -> 'a -> 'a -> ref View<'a> -> Tensor<'a>`（`nan_val`, `posinf_val`, `neginf_val` へ置換） |

### 10. 要素比較マスク・許容誤差比較・外積・軸累積（18 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Tensor.elem_eq` / `Tensor.elem_ne` | `(Eq<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<bool>, Error>` | ブロードキャスト対応の要素別 `==` / `!=` マスク |
| `Tensor.elem_lt` / `Tensor.elem_le` / `Tensor.elem_gt` / `Tensor.elem_ge` | `(Ord<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> Result<Tensor<bool>, Error>` | ブロードキャスト対応の要素別 `<`, `<=`, `>`, `>=` マスク |
| `Tensor.eq_scalar` / `Tensor.ne_scalar` | `(Eq<'a>, Copy<'a>) => 'a -> ref View<'a> -> Tensor<bool>` | `x == s` / `x != s` の要素比較マスク |
| `Tensor.lt_scalar` / `Tensor.le_scalar` / `Tensor.gt_scalar` / `Tensor.ge_scalar` | `(Ord<'a>, Copy<'a>) => 'a -> ref View<'a> -> Tensor<bool>` | `x < s`, `x <= s`, `x > s`, `x >= s` の要素比較マスク |
| `Tensor.isclose` | `(Float<'a>, ...) => 'a -> 'a -> bool -> ref View<'a> -> ref View<'a> -> Result<Tensor<bool>, Error>` | `rtol`, `atol`, `equal_nan` に基づく要素別近傍一致マスク（$|a - b| \le \text{atol} + \text{rtol} \cdot |b|$） |
| `Tensor.allclose` | `(Float<'a>, ...) => 'a -> 'a -> bool -> ref View<'a> -> ref View<'a> -> bool` | ブロードキャスト可能かつ全要素が許容誤差内で一致すれば `true` |
| `Tensor.array_equal` | `Eq<'a> => ref View<'a> -> ref View<'a> -> bool` | 形状と全要素が完全一致すれば `true` |
| `Tensor.array_equiv` | `(Eq<'a>, Copy<'a>) => ref View<'a> -> ref View<'a> -> bool` | ブロードキャスト後に全要素が一致すれば `true` |
| `Tensor.outer_with` | `(Copy<'a>, Copy<'b>) => ('a -> 'b -> 'c) -> ref View<'a> -> ref View<'b> -> Tensor<'c>` | 2 入力の直積形状（`shape_a ++ shape_b`）に関数を適用した一般化外積 |
| `Tensor.accumulate` | `Copy<'a> => ('a -> 'a -> 'a) -> i64 -> ref View<'a> -> Tensor<'a>` | 指定軸 `axis` に沿って二項演算を左から累積適用（累積和・累積積など） |

## 借用検査・診断コードの要点

- **ビュー添字の `ref` 必須（`E1042`）**: `t[0 ..< 2, ..]` や `t[[Slice.range 1 3]]` のように `View` を返す添字は元のバッファを借用するため、必ず `ref t[0 ..< 2, ..]` と明記します（逆に要素値やコピーを返す `t[1, 2]`・`t[bmask]` に `ref` を付けると `E1003` となります）。
- **一時値からのビュー借用禁止（`E1013`）**: `ref (Tensor.zeros [4])[1 ..< 3]` のように所有者を一時式のままビューで借りることはできません。先に `let z = Tensor.zeros [4]` とローカル変数へ束縛してください。
- **生存期間と排他性（`E1013` / `E1014`）**: `View` や `Mut` が生存している間に元の `Tensor` や配列をムーブ・書き換えようとすると `E1014`、関数内のローカルテンソルのビューを外へ返そうとすると `E1013` で静的に拒否されます。

## 関連項目

- [Slice](slice.md)
- [Matrix](matrix.md)
- [MatrixView](matrix-view.md)
- [Math](math.md)
- [Complex](complex.md)
- [RandomTensor](random-tensor.md)
- [型クラス](../../types/type-classes.md)
- [借用と参照](../../ownership/borrowing.md)
- [標準ライブラリの設計規約](../conventions.md)
