# Polynomial

`Polynomial` は、多項式の評価・四則演算・微分と積分・最小二乗フィッティング・求根を提供する opt-in 標準モジュールです。Chebyshev 多項式と Legendre 多項式の級数の評価とフィッティングも含みます。すべての公開関数は `pure def` です。

フィッティングと求根は [`Tensor`](tensor.md) の上の線形代数（SVD による最小二乗と、一般行列の固有値）で計算します。根は [`Complex`](complex.md) の配列で返します。

## 要点

- 係数は**昇べきの順**の配列 `['a]` です。`[1.0, 2.0, 3.0]` は $1 + 2x + 3x^2$ を表します（`numpy.polynomial` と同じ向きで、最高次を先に書く旧 `np.polyval` とは逆です）。空の配列は零多項式として扱います。
- 標本点とデータは 1 次元の窓 `Tensor.View<'a>`、根は `[Complex<'a>]` です。要素型は `Elementary<'a>`（`f32`・`f64`）です。
- 演算の結果は 0 の係数を取り除きません（`add` と `sub` の結果は長いほうの長さ）。取り除くときは `Polynomial.trim` を使います。
- 失敗は `Result<_, Polynomial.Error>` で返します。負のべき・負の階数・負の許容差は事前条件の違反としてトラップします。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、操作する多項式（係数の配列）を最後の引数に取ります。評価する点（`eval x c`）、べき（`pow 2 c`）、積分定数（`integ_const k c`）、次数（`fit 2 points values`）はその前に置きます。2 つの多項式を取る `add`・`sub`・`mul`・`divmod` は数式どおり左・右（被除数・除数）の順です。データの窓を取る関数は窓が最後で、`eval_tensor c points` は点の窓、`fit degree points values` は値の窓が最後です。

## 基本的な使い方

```tsuzuri run=value%3D17%20product%3D[3,%2011,%2019,%2015]%20slope%3D[2,%206]
let p = [1.0, 2.0, 3.0]
let value = Polynomial.eval 2.0 p
let product = Polynomial.mul p [3.0, 5.0]
let slope = Polynomial.deriv p
$"value={value} product={product} slope={slope}"
```

データへの当てはめと求根は `Result` を返します。

```tsuzuri run=true
let x = Tensor.of_array [4] [0.0, 1.0, 2.0, 3.0]
let y = Tensor.of_array [4] [1.0, 3.0, 7.0, 13.0]
match Polynomial.fit 2 (Tensor.view x) (Tensor.view y) with
| Result.Ok c -> Math.abs (c[0] - 1.0) < 1e-10 && Math.abs (c[1] - 1.0) < 1e-10 && Math.abs (c[2] - 1.0) < 1e-10
| Result.Error _ -> false
```

## 公開関数一覧（全 23 関数）

どの関数も `Elementary<'a> =>` の制約を持ちます（`roots` は `Neg<'a>` も）。`P` は係数の配列 `ref ['a]`、`V` は `ref Tensor.View<'a>`、`R<T>` は `Result<T, Polynomial.Error>` の略です。

### 評価（3 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Polynomial.eval` | `'a -> P -> 'a` | Horner 法による `x` での値 |
| `Polynomial.eval_complex` | `Complex<'a> -> P -> Complex<'a>` | 複素数の点での値（係数は実数） |
| `Polynomial.eval_tensor` | `P -> V -> Tensor<'a>` | 窓の各要素での値（同じ形のテンソル） |

### 四則演算と整形（6 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Polynomial.add` | `P -> P -> ['a]` | 和（長いほうの長さ。少なくとも 1 個） |
| `Polynomial.sub` | `P -> P -> ['a]` | 差 `left - right` |
| `Polynomial.mul` | `P -> P -> ['a]` | 積（係数の畳み込み） |
| `Polynomial.divmod` | `P -> P -> R<(['a] * ['a])>` | 筆算による商と余り（被除数・除数の順）。除数が零多項式なら `ZeroDivisor` |
| `Polynomial.pow` | `i64 -> P -> ['a]` | 掛け算の繰り返しによるべき。負のべきはトラップ |
| `Polynomial.trim` | `'a -> P -> ['a]` | 最高次の側から、絶対値が許容差以下の係数を取り除く（少なくとも 1 個残す）。負の許容差はトラップ |

```tsuzuri run=[1,%201]%20[2]
match Polynomial.divmod [3.0, 2.0, 1.0] [1.0, 1.0] with
| Result.Ok (quotient, remainder) -> $"{quotient} {remainder}"
| Result.Error problem -> $"{problem}"
```

`divmod` は、被除数と除数の最高次の側のちょうど 0 の係数を先に取り除きます。余りの次数は除数より低くなります。

### 微分と積分（4 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Polynomial.deriv` | `P -> ['a]` | 導関数（定数の導関数は `[0]`） |
| `Polynomial.deriv_n` | `i64 -> P -> ['a]` | `order` 階の導関数。負の階数はトラップ |
| `Polynomial.integ` | `P -> ['a]` | 0 で 0 になる原始関数 |
| `Polynomial.integ_const` | `'a -> P -> ['a]` | 0 での値が `constant` の原始関数 |

### 根（3 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Polynomial.from_roots` | `ref ['a] -> ['a]` | 与えた実数の根を持つモニック多項式（$\prod (x - r_i)$） |
| `Polynomial.from_roots_complex` | `ref [Complex<'a>] -> [Complex<'a>]` | 複素数の根を持つモニック多項式（係数は複素数。根が共役の組なら虚部は丸め誤差の範囲で 0） |
| `Polynomial.roots` | `P -> R<[Complex<'a>]>` | すべての根。実部、次に虚部の昇順 |

`roots` は、最高次の側のちょうど 0 の係数を取り除いてから、コンパニオン行列の固有値を求めます。定数と零多項式の根は空で、1 次式は割り算 1 回で求めます。重根は、重複度を $m$ とするとおよそ $\varepsilon^{1/m}$ の精度になります（単根はほぼ機械精度）。固有値の反復が収束しなければ `Solver (Linalg.Error.DidNotConverge)` です。

```tsuzuri run=-2+0i%201+0i%203+0i
match Polynomial.roots [6.0, -5.0, -2.0, 1.0] with
| Result.Ok found -> $"{Complex.of (Math.round found[0].re) (Math.round found[0].im)} {Complex.of (Math.round found[1].re) (Math.round found[1].im)} {Complex.of (Math.round found[2].re) (Math.round found[2].im)}"
| Result.Error problem -> $"{problem}"
```

### フィッティング（3 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Polynomial.vander` | `i64 -> V -> R<Tensor<'a>>` | べきの行列（行 `i` が $1, x_i, x_i^2, \dots, x_i^{d}$） |
| `Polynomial.fit` | `i64 -> V -> V -> R<['a]>` | 次数 `degree` の最小二乗多項式（次数・点・値の順） |
| `Polynomial.fit_weighted` | `i64 -> V -> V -> V -> R<['a]>` | 点ごとの重み付き（次数・重み・点・値の順）。$\sum (w_i (y_i - p(x_i)))^2$ を最小にする |

べきの行列の各列を単位長に正規化してから、SVD による最小二乗で解きます（NumPy の `polyfit` と同じ前処理）。点の数が係数の数より少ないときは、ノルムが最小の解を返します。

### Chebyshev・Legendre の級数（4 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Polynomial.cheb_eval` | `'a -> P -> 'a` | $\sum c_k T_k(x)$ の値（Clenshaw の漸化式） |
| `Polynomial.cheb_fit` | `i64 -> V -> V -> R<['a]>` | 最小二乗の Chebyshev 級数の係数 |
| `Polynomial.leg_eval` | `'a -> P -> 'a` | $\sum c_k P_k(x)$ の値（Clenshaw の漸化式） |
| `Polynomial.leg_fit` | `i64 -> V -> V -> R<['a]>` | 最小二乗の Legendre 級数の係数 |

```tsuzuri run=7%205.5
let third_term = [0.0, 0.0, 1.0]
$"{Polynomial.cheb_eval 2.0 third_term} {Polynomial.leg_eval 2.0 third_term}"
```

$T_2(x) = 2x^2 - 1$、$P_2(x) = (3x^2 - 1)/2$ です。

## 誤りになる入力

| 誤り | 起きる場合 |
| --- | --- |
| `Polynomial.Error.ZeroDivisor` | `divmod` の除数が零多項式（係数がすべて 0 か、空） |
| `Polynomial.Error.InvalidDegree degree` | `vander`・`fit`・`fit_weighted`・`cheb_fit`・`leg_fit` の次数が負 |
| `Polynomial.Error.InvalidRank rank` | 点・値・重みの窓が 1 次元でない |
| `Polynomial.Error.ShapeMismatch (left, right)` | 点と値（または重み）の個数が違う |
| `Polynomial.Error.EmptyData` | 点が 0 個 |
| `Polynomial.Error.Solver cause` | 内部の線形代数の失敗（`cause` は `Linalg.Error`） |

```tsuzuri run=division%20by%20the%20zero%20polynomial
match Polynomial.divmod [1.0, 2.0] [0.0] with
| Result.Ok _ -> "ok"
| Result.Error problem -> $"{problem}"
```

## NumPy との違い

- 係数の向きは `numpy.polynomial.polynomial` と同じ昇べきです。`np.polyfit`・`np.polyval`・`np.roots`（最高次が先）とは逆です。
- `add`・`sub`・`mul` は結果の最高次の側の 0 を取り除きません。NumPy は取り除きます。
- `integ` は常に係数を 1 個増やします。積分の下端は 0 で固定です。
- `roots` の並びは実部、次に虚部の昇順です（NumPy も同じ並びですが、固有値の計算が違うので、近い根の順序は入れ替わることがあります）。

## 現在の制限

- 複素数の係数を持つ多項式の一般の演算、Hermite・Laguerre の基底、基底の間の変換はありません。
- `fit` は残差・階数・特異値を返しません。必要なときは `vander` の結果に線形代数の最小二乗を直接使います。
