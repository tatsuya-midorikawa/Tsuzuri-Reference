# MatrixView

`MatrixView` は、[`Matrix`](matrix.md)や 1 次元配列のバッファを複製せずに借用し、オフセットと非負の行・列ストライド（`offset + row * row_stride + col * col_stride`）によって転置・部分行列・単一行・単一列を $O(1)$ で表現する 2 次元ビューモジュールです。読み取り専用ビュー `MatrixView<'a> { r }` と、排他スライスを保持してインプレース更新を行う可変ビュー `MatrixView.Mut<'a> { r }` の 2 種類を提供します。

負ストライド（逆順スライス）や 3 次元以上のビューが必要な場合は[`Tensor`](tensor.md)を使用します。

## 要点

- 読み取りビュー `MatrixView<'a> { r }` は共有借用を包む軽量な `Copy` 値型であり、関数へ渡した後もそのまま再利用できます（借用元の行列や配列の移動・破棄は借用検査 `E1013` / `E1014` で静的に防止されます）。
- 可変ビュー `MatrixView.Mut<'a> { r }` は非 `Copy` 型であり、異なる 2 要素が同一スロットを指さない配置（行優先パディングまたはその転置）を保証したうえで安全な要素更新・行スライス貸し出しを行います。
- Edition 2028 のブラケット添字構文により、`view[r, c]` / `mut_view[r, c] = v`（末尾相対 `^k` 対応）およびゼロコピー部分窓 `ref m[0 ..< 2, ..]`・`ref view[1, ..]`・`ref mut_view[0 ..< 2, ..]`（内部レイアウト計算 `sel_layout_2d` による厳格 `Slice.Sel` 解決）が利用できます。
- `MatrixView.mul` は形状一致を先に検査したうえでオペランドを行優先バッファへパックし、[`Matrix.mul`](matrix.md)とビット完全一致する積を返します。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、読み取りまたは書き込みの対象となるビュー（`MatrixView` または `ref mut Mut`）は常に最後の引数です（`MatrixView.sub row col rows cols view`、`MatrixView.slice row_axis col_axis view`、`MatrixView.write row col value mut_view`）。2 つのビュー間でデータを転送する `MatrixView.copy_from source target` では、書き込み先の `target` が最後の引数となります。

```tsuzuri run=corner%3D22%20row_sum%3D86%20buf%3D%5B7%2C%207%2C%205%2C%200%5D
let m = Matrix.init 3 4 (\row col -> row * 10 + col)
let view = MatrixView.of_matrix (ref m)
let corner = view |> MatrixView.sub 1 1 2 2 |> MatrixView.at 1 1
let row_sum = view |> (MatrixView.row 2 >> MatrixView.fold (\acc x -> acc + x) 0)
let mut buf = [0, 0, 0, 0]
let mut grid = MatrixView.of_array_mut 2 2 (ref mut buf)
let mut top = ref mut grid |> MatrixView.sub_mut 0 0 1 2
ref mut top |> MatrixView.fill 7
ref mut grid |> MatrixView.write 1 0 5
$"corner={deref corner} row_sum={row_sum} buf={buf}"
```

## ブラケット添字と 2 次元セレクタ解決

`Matrix`・`MatrixView`・`MatrixView.Mut` には以下の `Index` / `IndexMut` インスタンスが定義されています。

| キーの種類 | 対象型と構文例 | 挙動 |
| --- | --- | --- |
| `(i64 * i64)` / `(Slice.Pos * Slice.Pos)` | `view[r, c]`, `view[^0, ^1]`, `mut_view[r, c] = v` | 要素の直接読み書き（範囲外はトラップ） |
| `(Slice.Sel * Slice.Sel)` | `ref m[0 ..< 2, ..]`, `ref view[1, ..]`, `ref mut_view[.., ^0]` | 内部ヘルパー `sel_layout_2d` で厳格検証し、新しい `MatrixView<'a>` を返す（`ref` 省略時は `E1042`） |
| `(Slice.Axis * Slice.Axis)` | `ref m[(Slice.range 0 2, Slice.every 2)]` | クランプ付き記述子で `MatrixView.slice` を呼び出す |

`MatrixView` は常に 2 次元を保つため、単一位置セレクタ（`ref view[1, ..]` の `1` や `Slice.at 1`）も軸を削除せず長さ `1` の軸として残します。また、`MatrixView` のストライドは非負に制限されているため、負のステップ幅、`Slice.Sel.AddAxis`（`Slice.new_axis()`）、および 1 つのキーに 2 つの `Slice.rest()` を指定した場合はトラップします。

## 公開関数一覧（全 30 関数）

### 読み取りビューの構築・メタデータ取得（9 関数）

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `MatrixView.of_matrix` | `ref { r } Matrix<'a> -> MatrixView<'a> { r }` | なし | 行列全体を連続ビューとして借用（$O(1)$） |
| `MatrixView.of_array` | `i64 -> i64 -> ref { r } ['a] -> MatrixView<'a> { r }` | 長さ `!= rows * cols` でトラップ | 行優先配列を `rows × cols` ビューとして借用（$O(1)$） |
| `MatrixView.strided` | `i64 -> i64 -> i64 -> i64 -> i64 -> ref { r } ['a] -> MatrixView<'a> { r }` | 負引数・溢れ・範囲外到達でトラップ | `offset`, `rows`, `cols`, `row_stride`, `col_stride` を明示して構築（ストライド `0` による反復ビュー可） |
| `MatrixView.rows` | `MatrixView<'a> { r } -> i64` | なし | 行数を返す |
| `MatrixView.cols` | `MatrixView<'a> { r } -> i64` | なし | 列数を返す |
| `MatrixView.offset` | `MatrixView<'a> { r } -> i64` | なし | 先頭要素 `(0, 0)` の基底配列内オフセット |
| `MatrixView.row_stride` | `MatrixView<'a> { r } -> i64` | なし | 隣接行間の要素オフセット差 |
| `MatrixView.col_stride` | `MatrixView<'a> { r } -> i64` | なし | 隣接列間の要素オフセット差 |
| `MatrixView.data` | `MatrixView<'a> { r } -> ref { r } ['a]` | なし | 窓の外側も含む基底配列全体の共有参照 |

### 要素参照・ゼロコピー窓変換・実体化・積（12 関数）

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `MatrixView.at` | `i64 -> i64 -> MatrixView<'a> { r } -> ref { r } 'a` | 行・列の範囲外でトラップ | 要素への共有参照を取得（$O(1)$） |
| `MatrixView.get` | `Copy<'a> => i64 -> i64 -> MatrixView<'a> { r } -> Maybe<'a>` | 範囲外は `None` | 範囲検査付きで要素のコピーを取得（$O(1)$） |
| `MatrixView.transpose` | `MatrixView<'a> { r } -> MatrixView<'a> { r }` | なし | 行・列と両ストライドを交換した転置ビュー（$O(1)$） |
| `MatrixView.sub` | `i64 -> i64 -> i64 -> i64 -> MatrixView<'a> { r } -> MatrixView<'a> { r }` | 窓外にはみ出す指定でトラップ | `(row, col)` を左上とする `rows × cols` 部分窓（$O(1)$） |
| `MatrixView.row` | `i64 -> MatrixView<'a> { r } -> MatrixView<'a> { r }` | 行番号の範囲外でトラップ | 指定行を切り出した `1 × cols` ビュー（$O(1)$） |
| `MatrixView.col` | `i64 -> MatrixView<'a> { r } -> MatrixView<'a> { r }` | 列番号の範囲外でトラップ | 指定列を切り出した `rows × 1` ビュー（$O(1)$） |
| `MatrixView.slice` | `ref Slice.Axis -> ref Slice.Axis -> MatrixView<'a> { r } -> MatrixView<'a> { r }` | 負ステップ・`NewAxis`・範囲外 `At` でトラップ | 正ステップの `Slice.Axis` 2 個によるゼロコピー部分窓（$O(1)$） |
| `MatrixView.is_contiguous` | `MatrixView<'a> { r } -> bool` | なし | 要素が基底配列上で隙間なく行優先に並んでいれば `true`（空窓は `true`） |
| `MatrixView.to_matrix` | `Copy<'a> => MatrixView<'a> { r } -> Matrix<'a>` | なし | ビューの順序どおり新しい行優先 `Matrix` へ複製 |
| `MatrixView.fold` | `Copy<'a> => ('s -> 'a -> 's) -> 's -> MatrixView<'a> { r } -> 's` | なし | ビューの行優先順で左から右へ畳み込む |
| `MatrixView.map` | `Copy<'a> => ('a -> 'b) -> MatrixView<'a> { r } -> Matrix<'b>` | なし | 全要素を変換した新しい `Matrix<'b>` を生成 |
| `MatrixView.mul` | `Numeric<'a> => MatrixView<'a> { r } -> MatrixView<'a> { s } -> Matrix<'a>` | `left.cols != right.rows` でトラップ | 両ビューを行優先化して `Matrix.mul` を実行 |

```tsuzuri run=gram%3D%5B17%2C%2022%2C%2027%2C%2022%2C%2029%2C%2036%2C%2027%2C%2036%2C%2045%5D%20contig%3Dfalse
let a = Matrix.of_array 2 3 [1, 2, 3, 4, 5, 6]
let v = MatrixView.of_matrix (ref a)
let vt = MatrixView.transpose v
let gram = MatrixView.mul vt v
$"gram={Matrix.to_array gram} contig={MatrixView.is_contiguous vt}"
```

### 可変ビュー `MatrixView.Mut` の構築とインプレース操作（9 関数）

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `MatrixView.of_array_mut` | `i64 -> i64 -> ref mut { r } ['a..] -> Mut<'a> { r }` | 長さ `!= rows * cols` でトラップ | 排他スライスから書き込み可能な `rows × cols` ビューを構築 |
| `MatrixView.freeze` | `ref { r } Mut<'a> { r } -> MatrixView<'a> { r }` | なし | 次の書き込みまで有効な読み取り専用ビューとして一時再借用 |
| `MatrixView.write` | `i64 -> i64 -> 'a -> ref mut Mut<'a> { r } -> unit` | 行・列の範囲外でトラップ | `(row, col)` の要素をインプレースで書き換える |
| `MatrixView.row_mut` | `i64 -> ref mut { r } Mut<'a> { r } -> ref mut { r } ['a..]` | 範囲外または `col_stride != 1` でトラップ | 行優先配置の 1 行を排他配列スライスとして貸し出す |
| `MatrixView.sub_mut` | `i64 -> i64 -> i64 -> i64 -> ref mut { r } Mut<'a> { r } -> Mut<'a> { r }` | 窓外指定でトラップ | 部分領域の可変サブビューを再借用（生存中は親ビューにアクセス不可） |
| `MatrixView.transpose_mut` | `Mut<'a> { r } -> Mut<'a> { r }` | なし | 可変ビューを消費し、行と列を入れ替えた可変ビューを返す |
| `MatrixView.fill` | `Copy<'a> => 'a -> ref mut Mut<'a> { r } -> unit` | なし | 窓内の全要素を `value` で埋める |
| `MatrixView.copy_from` | `Copy<'a> => MatrixView<'a> { s } -> ref mut Mut<'a> { r } -> unit` | 形状不一致でトラップ | 同形状の読み取りビュー `source` から要素をコピー |
| `MatrixView.map_in_place` | `Copy<'a> => ('a -> 'a) -> ref mut Mut<'a> { r } -> unit` | なし | 窓内の全要素を `f x` の結果でインプレース置換 |

```tsuzuri run=frozen_sum%3D35%20final%3D%5B1%2C%209%2C%209%2C%2016%5D
let mut data = [1, 2, 3, 4]
let mut grid = MatrixView.of_array_mut 2 2 (ref mut data)
grid[0, 1] = 3
MatrixView.map_in_place (\x -> x * x) (ref mut grid)
let snap = MatrixView.freeze (ref grid)
let frozen_sum = MatrixView.fold (\acc x -> acc + x) 0 snap
$"frozen_sum={frozen_sum} final={data}"
```

## 関連項目

- [Matrix](matrix.md)
- [Tensor](tensor.md)
- [Slice](slice.md)
- [借用と参照](../../ownership/borrowing.md)
- [ライフタイム](../../ownership/lifetimes.md)
- [標準ライブラリの設計規約](../conventions.md)
