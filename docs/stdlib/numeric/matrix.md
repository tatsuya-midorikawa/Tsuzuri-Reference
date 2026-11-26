# Matrix

`Matrix` は、行数 `rows` と列数 `cols` を持つ 2 次元データを 1 本の行優先（row-major）連続バッファ `data[row * cols + col]` として所有する不透明レコード `Matrix<'a>` と、その構築・要素参照・行列積を提供する opt-in 標準モジュールです。

データを複製せず部分行列や転置を借用する 2 次元ビューには[`MatrixView`](matrix-view.md)、3 次元以上を含む任意ランク配列には[`Tensor`](tensor.md)を使用します。

## 要点

- `Matrix<'a>` は要素型 `'a` が `Copy` であっても常に非 `Copy` 型であり、巨大なバッファの暗黙コピーを型レベルで防ぎます。
- Edition 2028 の多次元ブラケット添字により、`m[r, c]`（および末尾相対 `m[^0, c]`）で確保なしの要素読み取りが、`ref m[0 ..< 2, ..]` で[`MatrixView`](matrix-view.md)としてのゼロコピー部分窓切り出しが可能です（ビュー添字の `ref` 省略は `E1042`）。
- 行列積は加算順序と丸め規則を API 名で厳格に区別します。`Matrix.mul` は `+0` から $k = 0, 1, \dots$ の昇順で乗算と加算を個別に丸め、`Matrix.mul_fma` は各ステップを `Math.fma`（1 回丸め）で計算します。このためターゲットや最適化レベル（`-O0` / `-O3`）によらずビット単位で同一の結果が得られます。
- 並列版 `Matrix.mul_parallel` と `Matrix.mul_fma_parallel` は `Parallel.for_each_chunk_with` を用いて入力バッファをゼロコピーで共有しつつ行チャンク単位で並列計算を行い、スレッド数に依存せず逐次版とビット完全一致します。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、操作対象の行列（`ref Matrix<'a>` または `own Matrix<'a>`）は常に最後の引数に配置されます（`Matrix.at row col m`、`Matrix.set row col value m`、`Matrix.scale factor m`、`Matrix.map f m`、`Matrix.fold folder init m`）。2 つの行列を取る二項演算（`add`・`sub`・`hadamard`・`mul` 系）は左オペランド・右オペランドの順です。なお、要素積 `hadamard` と行列積 `mul` の混同を防ぐため、`Matrix` には `*` 演算子（`Mul` インスタンス）は定義されていません。

```tsuzuri run=top%3D101%20last%3D77%20found%3D99
let edit = Matrix.set 0 1 99 >> Matrix.set 1 2 77
let m = Matrix.init 2 3 (\row col -> row * 10 + col) |> edit
let top = ref m |> Matrix.row 0
let last = ref m |> Matrix.at 1 2
let found = ref m |> Matrix.get 0 1 |> Maybe.default_value 0
$"top={Array.sum top} last={deref last} found={found}"
```

## 多次元ブラケット添字（要素読み取りと 2 次元窓）

`Copy<'a>` を満たす要素型の行列では、ブラケット添字構文で要素と部分窓の双方に直接アクセスできます（`MatrixView` モジュールが読み込まれている文脈では厳格セレクタ[`Slice.Sel`](slice.md)による窓切り出しも有効になります）。

| 構文例 | 戻り値の型 | 動作 |
| --- | --- | --- |
| `m[r, c]` / `m[(r, c)]` | `'a` | `(r, c)` 要素をゼロアロケーションで読み取る（範囲外はトラップ） |
| `m[^0, ^1]` | `'a` | Edition 2028 末尾相対位置（最終行・末尾から 2 列目）の読み取り |
| `ref m[0 ..< 2, 1 ..= 2]` | `MatrixView<'a>` | 半開・閉区間セレクタによるゼロコピー部分窓（`ref` 必須、欠落時は `E1042`） |
| `ref m[1, ..]` | `MatrixView<'a>` | 第 1 行を `1 × cols` の `MatrixView` として借用（1 次元スライスが欲しい場合は `Matrix.row 1 (ref m)`） |

```tsuzuri run=elem%3D5%20last%3D6%20win%3D%5B2%2C%203%2C%205%2C%206%5D
let m = Matrix.of_array 2 3 [1, 2, 3, 4, 5, 6]
let elem = m[1, 1]
let last = m[^0, ^0]
let win = ref m[.., 1 ..< 3]
$"elem={elem} last={last} win={Matrix.to_array (MatrixView.to_matrix win)}"
```

## 公開関数一覧（全 21 関数）

### 構築・形状・バッファ変換（7 関数）

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `Matrix.of_array` | `i64 -> i64 -> ['a] -> Matrix<'a>` | 次元 `< 0`・積溢れ・長さ不一致でトラップ | 行優先の配列を複製せずそのまま所有して行列を構築（$O(1)$） |
| `Matrix.init` | `i64 -> i64 -> (i64 -> i64 -> 'a) -> Matrix<'a>` | 次元 `< 0`・積溢れでトラップ | `f row col` を行優先順に各要素 1 回ずつ呼んで初期化 |
| `Matrix.rows` | `ref Matrix<'a> -> i64` | なし | 行数を返す（$O(1)$） |
| `Matrix.cols` | `ref Matrix<'a> -> i64` | なし | 列数を返す（$O(1)$） |
| `Matrix.row` | `i64 -> ref Matrix<'a> -> ref ['a]` | 行番号の範囲外でトラップ | 指定行（長さ `cols`）を配列スライスとしてゼロコピー借用 |
| `Matrix.as_array` | `ref Matrix<'a> -> ref ['a]` | なし | 内部の行優先バッファ全体を共有借用（$O(1)$） |
| `Matrix.to_array` | `Matrix<'a> -> ['a]` | なし | 行列を消費して内部配列を取り出す |

### 要素参照・更新・高階変換・転置（6 関数）

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `Matrix.at` | `i64 -> i64 -> ref Matrix<'a> -> ref 'a` | 行・列の範囲外でトラップ | 要素への共有参照を返す（非 `Copy` 要素にも対応、$O(1)$） |
| `Matrix.get` | `Copy<'a> => i64 -> i64 -> ref Matrix<'a> -> Maybe<'a>` | 範囲外は `None` | 範囲検査付きで要素のコピーを取得（$O(1)$） |
| `Matrix.set` | `i64 -> i64 -> 'a -> Matrix<'a> -> Matrix<'a>` | 行・列の範囲外でトラップ | 行列を消費し、`(row, col)` を新値で置き換えた行列を返す |
| `Matrix.map` | `Copy<'a> => ('a -> 'b) -> ref Matrix<'a> -> Matrix<'b>` | なし | 全要素を行優先順に変換した同形状の新規行列を返す |
| `Matrix.fold` | `Copy<'a> => ('s -> 'a -> 's) -> 's -> ref Matrix<'a> -> 's` | なし | 行優先順で左から右へ全要素を畳み込む |
| `Matrix.transpose` | `Copy<'a> => ref Matrix<'a> -> Matrix<'a>` | なし | 行と列を入れ替えた `cols × rows` の新規行列を返す |

> [!NOTE]
> 現在のコンパイラ実装では、要素型 `'a` が `Copy` の場合に `Matrix.set` および `Matrix.to_array` が内部バッファの要素複製を伴います。ループ内で多数の要素をインプレース更新したい場合は、`let mut` 配列に対して[`MatrixView.of_array_mut`](matrix-view.md)を使用してください。

### 要素別算術・スカラー倍・決定論的行列積（8 関数）

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `Matrix.add` | `Numeric<'a> => ref Matrix<'a> -> ref Matrix<'a> -> Matrix<'a>` | 形状不一致でトラップ | 要素ごとの加算 `left + right` |
| `Matrix.sub` | `Numeric<'a> => ref Matrix<'a> -> ref Matrix<'a> -> Matrix<'a>` | 形状不一致でトラップ | 要素ごとの減算 `left - right` |
| `Matrix.hadamard` | `Numeric<'a> => ref Matrix<'a> -> ref Matrix<'a> -> Matrix<'a>` | 形状不一致でトラップ | 要素ごとの乗算（アダマール積 `left * right`） |
| `Matrix.scale` | `Numeric<'a> => 'a -> ref Matrix<'a> -> Matrix<'a>` | なし | 全要素の定数倍 `factor * x` |
| `Matrix.mul` | `Numeric<'a> => ref Matrix<'a> -> ref Matrix<'a> -> Matrix<'a>` | `left.cols != right.rows` でトラップ | 個別丸め・昇順累積（i-k-j ループ）の行列積 |
| `Matrix.mul_fma` | `Float<'a> => ref Matrix<'a> -> ref Matrix<'a> -> Matrix<'a>` | `left.cols != right.rows` でトラップ | 各積和ステップに `Math.fma` を用いる行列積 |
| `Matrix.mul_parallel` | `(Numeric<'a>, Send<'a>) => ref Matrix<'a> -> ref Matrix<'a> -> Matrix<'a>` | `left.cols != right.rows` でトラップ | ゼロコピー入力共有による行チャンク並列版 `mul` |
| `Matrix.mul_fma_parallel` | `(Float<'a>, Send<'a>) => ref Matrix<'a> -> ref Matrix<'a> -> Matrix<'a>` | `left.cols != right.rows` でトラップ | ゼロコピー入力共有による行チャンク並列版 `mul_fma` |

### 行列積の数値決定性と並列チャンク分割

- **`mul` と `mul_fma` の違い**: `mul` は出力要素 $(i, j)$ を `+0` から $k = 0, \dots, K-1$ の順に `total = total + (a * b)` で更新します。内部ループは `i-k-j` 順で構成されており、加算順序を一切変えずに内側 `j` ループの SIMD 自動ベクトル化を可能にします。一方 `mul_fma` は `Math.fma a b total` を使用します（AArch64 ネイティブターゲットの `f32` / `f64` ではハードウェア FMA 命令に展開されますが、スカラー FMA 命令を標準前提としない x86-64 や `wasm32` では厳密丸めのソフトウェアルーチン呼び出しとなるため低速になります）。
- **`mul_parallel` のゼロコピー並列化**: 1 チャンクあたりの行数はおおむね $2^{20}$ 回の積和演算（`max(1, 1048576 / (inner * cols))` 行）となるよう入力形状のみから決定されます。2 チャンク以上に分割される場合も、`Parallel.for_each_chunk_with` によって `ref left.data` と `ref right.data` を複製せずワーカースレッド間で共有し、出力バッファの互いに素な行スライスへ直接書き込みます。

```tsuzuri run=130x128%20same%3Dtrue%20had%3D%5B10%2C%2040%2C%2090%2C%20160%5D
let left = Matrix.init 130 70 (\i k -> (i * 7 + k * 3) % 11 - 5)
let right = Matrix.init 70 128 (\k j -> (k * 5 + j * 2) % 13 - 6)
let seq_p = Matrix.mul (ref left) (ref right)
let par_p = Matrix.mul_parallel (ref left) (ref right)
let digest = Matrix.fold (\acc x -> Int.wrapping_add (Int.wrapping_mul acc 31) x) 7
let a = Matrix.of_array 2 2 [1, 2, 3, 4]
let b = Matrix.of_array 2 2 [10, 20, 30, 40]
let had = Matrix.to_array (Matrix.hadamard (ref a) (ref b))
$"{Matrix.rows (ref par_p)}x{Matrix.cols (ref par_p)} same={digest (ref seq_p) == digest (ref par_p)} had={had}"
```

## 関連項目

- [MatrixView](matrix-view.md)
- [Tensor](tensor.md)
- [Slice](slice.md)
- [Math](math.md)
- [Parallel](../sync/parallel.md)
- [Array](../collections/array.md)
- [標準ライブラリの設計規約](../conventions.md)
