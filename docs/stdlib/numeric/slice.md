# Slice

`Slice` は、[`Matrix`](matrix.md)・[`MatrixView`](matrix-view.md)・[`Tensor`](tensor.md) の多次元ブラケット添字構文が用いる厳格な軸セレクタ（`Slice.Sel`・`Slice.Pos`・`Slice.Bound`）と、`Tensor.slice`・`MatrixView.slice` や配列キー添字 `ref t[[...]]` が用いるクランプ付き軸記述子（`Slice.Axis`）を提供する opt-in 標準モジュールです。すべての公開関数はヒープ確保を行わない `pure def` です。

## 要点

- **Edition 2028 の範囲・末尾相対セレクタ構文との対応**: 多次元ブラケット窓構文 `ref t[0 ..< 2, .., ^0]` はコンパイラによって `Slice.Sel` の配列へ脱糖されます。半開区間 `a ..< b`・閉区間 `a ..= b`（および Edition 2028 の境界付き `a .. b`）・左開区間 `a <.. b`・開区間 `a <..< b`・全範囲 `..`・末尾相対位置 `^k`（`^0` が末尾要素）をそのまま記述できます。
- **厳格モデル（`Slice.Sel`）**: 範囲外インデックスの丸め（クランプ）や負整数の末尾折り返しを行わず、軸長 `[0, len)` を外れる指定や `step == 0` は即座にトラップします（負の整数リテラル `-1` を位置や境界に書くと警告 `W1014` が出力されます）。
- **クランプ付きモデル（`Slice.Axis`）**: NumPy / Python と同様に負の添字を `len + index` として扱い、範囲端を軸の境界へ丸めます。`Tensor.slice`・`MatrixView.slice` または配列リテラルを 1 段ネストした `ref t[[Slice.range 1 4, Slice.rev()]]` で使用します（カンマ区切りの窓構文 `ref t[...]` に `Slice.Axis` を混在させると `E1003` となります）。
- **ビュー添字の `ref` 規則**: スライスや窓（ビュー）を返すブラケット添字には `ref t[0 ..< 2, ..]`（可変ビューは `ref mut`）の明示が必須であり、省略すると `E1042` となります。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、構築子は範囲パラメータを先頭から順に受け取り（`Slice.range start stop`、`Slice.step start stop stride`）、軸長に対してセレクタを解決する `Slice.resolve len axis` と `Slice.resolve_sel len sel` は検査対象の記述子（`ref Axis` / `ref Sel`）を最後の引数に取ります。

## Edition 2028 ブラケット窓構文と `Slice.Sel` の対応

多次元オブジェクトに対する窓構文 `ref t[k1, k2, ...]` の各要素は、以下の規則で厳格セレクタ `Slice.Sel`（および `Slice.Pos`・`Slice.Bound`）へ変換されます。

| ブラケット内の記法 | 変換後の `Slice.Sel` 値 | 意味（軸長 $n$ に対して） |
| --- | --- | --- |
| `i`（整数式） | `Sel.Item (Pos.Front i)` | 先頭基準の単一位置 `i`（`0` が先頭。範囲外はトラップ） |
| `^k` | `Sel.Item (Pos.Back k)` | 末尾基準の単一位置 $n - 1 - k$（`^0` が末尾、`^1` が末尾の 1 つ前） |
| `..` | `Sel.Whole` | 軸全体 $[0, n)$（刻み `1`） |
| `a ..< b` | `Sel.Span (Included a', Excluded b', 1)` | 半開区間 $[a', b')$（全エディションで半開） |
| `a ..= b`（2028 では `a .. b` も同義） | `Sel.Span (Included a', Included b', 1)` | 閉区間 $[a', b']$（2026/2027 の裸の `a .. b` は半開で警告 `W1013`） |
| `a <.. b` / `a <..< b` | `Sel.Span (Excluded a', Included/Excluded b', 1)` | 左開区間 $(a', b']$ / 両端開区間 $(a', b')$ |
| `a..` / `..<b` / `..=b` | 片側が `Bound.Unbounded` の `Sel.Span` | 始点から軸末まで / 先頭から終点まで |
| `a .. step ..= b` 等 | 第 3 要素が `step` の `Sel.Span` | ストライド指定スライス（負の `step` では開境界 `<` は使用不可） |
| `Slice.rest()` | `Sel.Rest` | 残りの軸すべてを `Whole` で埋める省略記号（1 キー内に最大 1 個） |
| `Slice.Sel.AddAxis` | `Sel.AddAxis` | 入力軸を消費せず長さ `1`・ストライド `0` の新規軸を挿入 |

上表の `a'`・`b'` は、通常の整数式なら `Pos.Front`、`^k` なら `Pos.Back k` になります。たとえば末尾の 1 要素を除いた先頭から末尾手前までの範囲は `0 ..< ^0`（または `..< ^0` / `..= ^1`）と書けます。

```tsuzuri run=col_last%3D%5B3%2C%207%2C%2011%5D%20crop%3D%5B4%2C%205%2C%206%2C%208%2C%209%2C%2010%5D%20rev_row%3D%5B3%2C%202%2C%201%2C%200%5D
let t = Tensor.init [3, 4] (\i -> i)
let col_last = ref t[Slice.rest(), ^0]
let crop = ref t[1 ..= 2, 0 ..< ^0]
let rev_row = ref t[[Slice.at 0, Slice.rev()]]
$"col_last={Tensor.to_array (Tensor.to_tensor (ref col_last))} crop={Tensor.to_array (Tensor.to_tensor (ref crop))} rev_row={Tensor.to_array (Tensor.to_tensor (ref rev_row))}"
```

## データ型定義

```text
// 厳格セレクタ体系（ブラケット窓構文が使用）
union Pos   = Front of i64 | Back of i64                        // deriving (Eq)
union Bound = Unbounded | Included of Pos | Excluded of Pos     // deriving (Eq)
union Sel   = Item of Pos
            | Span of (Bound * Bound * i64)
            | Whole
            | Rest
            | AddAxis                                           // deriving (Eq)

// クランプ付き記述子体系（Tensor.slice / MatrixView.slice / ref t[[...]] が使用）
union Axis  = All
            | At of i64
            | Range of (i64 * i64)
            | From of i64
            | To of i64
            | Step of (Maybe<i64> * Maybe<i64> * i64)
            | NewAxis                                           // instance Eq<Axis>

// 具体軸長に対する正規化結果
union Resolved = Index of i64 | Slice of (i64 * i64 * i64) | InsertAxis   // deriving (Eq)
```

`Slice.Resolved.Slice (start, count, stride)` は正規化後の開始インデックス `start`、要素数 `count`（`>= 0`）、およびステップ幅 `stride`（`!= 0`）を表します。

## 公開関数一覧（全 12 関数）

### 厳格セレクタ（`Slice.Sel`）の構築と解決（2 関数）

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `Slice.rest` | `pure unit -> Slice.Sel` | なし | 残余の全軸に展開される `Sel.Rest` を返す（`Slice.rest()` で呼び出す） |
| `Slice.resolve_sel` | `pure i64 -> ref Slice.Sel -> Slice.Resolved` | `len < 0`、範囲外位置、逆転区間、`step == 0`、負ステップでの `Excluded`、未展開の `Sel.Rest` でトラップ | 長さ `len` の軸に対して `Sel` をクランプなしで厳密解決 |

### クランプ付き記述子（`Slice.Axis`）の構築と解決（10 関数）

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `Slice.all` | `pure unit -> Slice.Axis` | なし | 軸全体を選択する `Axis.All`（`Slice.all()` で呼び出す） |
| `Slice.at` | `pure i64 -> Slice.Axis` | 解決時に範囲外ならトラップ | 単一位置を選択して軸を落とす `Axis.At index`（負数は `len + index`） |
| `Slice.range` | `pure i64 -> i64 -> Slice.Axis` | なし（解決時に軸端へクランプ） | 半開区間 `[start, stop)`（ステップ `1`）を表す `Axis.Range` |
| `Slice.from` | `pure i64 -> Slice.Axis` | なし（解決時にクランプ） | `start` から軸末まで（ステップ `1`）を表す `Axis.From` |
| `Slice.until` | `pure i64 -> Slice.Axis` | なし（解決時にクランプ） | 先頭から `stop` 未満まで（ステップ `1`）を表す `Axis.To` |
| `Slice.step` | `pure i64 -> i64 -> i64 -> Slice.Axis` | `stride == 0` は解決時にトラップ | `start` から `stop` 手前まで `stride` 刻みの `Axis.Step`（負ステップ対応） |
| `Slice.every` | `pure i64 -> Slice.Axis` | `stride == 0` は解決時にトラップ | 軸全体を `stride` 刻みで選択（負値で逆順走査） |
| `Slice.rev` | `pure unit -> Slice.Axis` | なし | 軸全体を逆順（ステップ `-1`）で選択（`Slice.rev()` で呼び出す） |
| `Slice.new_axis` | `pure unit -> Slice.Axis` | なし | 長さ `1` の新しい軸を挿入する `Axis.NewAxis`（`Slice.new_axis()` で呼び出す） |
| `Slice.resolve` | `pure i64 -> ref Slice.Axis -> Slice.Resolved` | `len < 0`、`At` の範囲外、`stride == 0` でトラップ | 長さ `len` の軸に対して `Axis` をクランプ付きで `Resolved` へ正規化 |

```tsuzuri run=strict_ok%3Dtrue%20clamped_ok%3Dtrue
let sel = Slice.Sel.Span (Slice.Bound.Included (Slice.Pos.Front 1), Slice.Bound.Excluded (Slice.Pos.Back 0), 1)
let r1 = Slice.resolve_sel 5 (ref sel) == Slice.Resolved.Slice (1, 3, 1)
let r2 = Slice.resolve 5 (Slice.range (-10) 99) == Slice.Resolved.Slice (0, 5, 1)
$"strict_ok={r1} clamped_ok={r2}"
```

## 関連項目

- [Matrix](matrix.md)
- [MatrixView](matrix-view.md)
- [Tensor](tensor.md)
- [Array](../collections/array.md)
- [借用と参照](../../ownership/borrowing.md)
- [型クラス](../../types/type-classes.md)
- [標準ライブラリの設計規約](../conventions.md)
