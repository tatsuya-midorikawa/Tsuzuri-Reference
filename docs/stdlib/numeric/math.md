# Math

`Math` は、浮動小数点数の型幅と基数（2 進・10 進）を保持したまま丸め・分類・融合積和（FMA）・定数・初等超越関数を提供する組み込み数学モジュール（および互換定数関数 `Math.zero` を持つ `std/Math.tz`）です。暗黙の `f64` への拡幅や `fast-math` による勝手な式変形は行わず、ネイティブと WebAssembly、`-O0` と `-O3` の間で再現可能な演算結果を提供します。

固定幅整数の絶対値や選択関数については[`Int`](int.md)を参照してください。

## 要点

- **基本浮動小数点操作（`Float<'a>` 制約）**: 2 進浮動小数点（`f16`, `f32`, `f64`, `f128`）および 10 進浮動小数点（`d32`, `d64`, `d128`）の全 7 型で動作し、入力と同じ型を返します。
- **初等超越関数（`Elementary<'a>` 制約）**: `f32` と `f64` に対応します（他の型へ適用するとコンパイルエラー `E1005`）。ホスト OS の `libm` に依存しない同梱実装により、非 NaN の結果は 1 ulp 以内の精度でターゲット・最適化レベルを問わずビット単位で一致します。
- **明示的 FMA**: `Math.fma x y z` は `x * y + z` を最近接偶数丸めで 1 回だけ丸めます（通常の `x * y + z` が勝手に FMA へ融合されることはありません）。
- **定数関数**: `Math.pi()` と `Math.e()` は引数なしの多相関数であり、文脈または型注釈が要求する `Float<'a>` 型へ 1 回だけ丸められた定数を返します。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)における数値・数式関数の規則に従い、すべての関数が数学上の記法順（`Math.atan2 y x`、`Math.pow base exp`、`Math.clamp value low high`、`Math.fma x y z`、`Math.copysign magnitude sign`）で引数を受け取ります。

## 基本関数と定数（`Float<'a>` 対象: 19 組み込み関数 + `Math.zero`）

2 進・10 進すべての浮動小数点型で使用でき、10 進型（`d32` / `d64` / `d128`）が内部で 2 進へ変換されることはありません。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Math.sqrt` | `Float<'a> => 'a -> 'a` | 最近接偶数丸めの平方根（負の有限値・`-inf` は NaN、`sqrt(-0.0)` は `-0.0`） |
| `Math.floor` | `Float<'a> => 'a -> 'a` | 負の無限大方向への丸め（ゼロの符号を保持） |
| `Math.ceil` | `Float<'a> => 'a -> 'a` | 正の無限大方向への丸め（ゼロの符号を保持） |
| `Math.trunc` | `Float<'a> => 'a -> 'a` | ゼロ方向への切り捨て丸め（ゼロの符号を保持） |
| `Math.round` | `Float<'a> => 'a -> 'a` | 最近接整数丸め（中間値 `.5` はゼロから遠い方向へ丸める） |
| `Math.round_even` | `Float<'a> => 'a -> 'a` | 最近接偶数丸め（中間値 `.5` は偶数へ丸める） |
| `Math.abs` | `Float<'a> => 'a -> 'a` | 符号ビットをクリアした絶対値 |
| `Math.sign` | `Float<'a> => 'a -> 'a` | 負なら `-1`、ゼロなら同符号の `0`、正なら `+1`、NaN は NaN |
| `Math.copysign` | `Float<'a> => 'a -> 'a -> 'a` | 第 1 引数の大きさに第 2 引数の符号ビットを付与 |
| `Math.min` | `Float<'a> => 'a -> 'a -> 'a` | 小さい方（NaN は伝播、`-0.0` と `+0.0` では `-0.0`） |
| `Math.max` | `Float<'a> => 'a -> 'a -> 'a` | 大きい方（NaN は伝播、`-0.0` と `+0.0` では `+0.0`） |
| `Math.clamp` | `Float<'a> => 'a -> 'a -> 'a -> 'a` | `low <= high` なら `min (max x low) high`、そうでなければ NaN |
| `Math.fma` | `Float<'a> => 'a -> 'a -> 'a -> 'a` | `x * y + z` を 1 回の最近接偶数丸めで計算 |
| `Math.is_nan` | `Float<'a> => 'a -> bool` | NaN であれば `true` |
| `Math.is_infinite` | `Float<'a> => 'a -> bool` | `+inf` または `-inf` であれば `true` |
| `Math.is_finite` | `Float<'a> => 'a -> bool` | NaN でも無限大でもない有限値であれば `true` |
| `Math.signbit` | `Float<'a> => 'a -> bool` | 符号ビットが立っていれば `true`（`-0.0` でも `true`） |
| `Math.pi` | `Float<'a> => unit -> 'a` | 円周率 $\pi$（`Math.pi()` として呼び出す） |
| `Math.e` | `Float<'a> => unit -> 'a` | ネイピア数 $e$（`Math.e()` として呼び出す） |
| `Math.zero` | `unit -> f64` | 互換用 `f64` の `0.0`（`std/Math.tz` 公開関数。`Math.zero()` で呼び出す） |

```tsuzuri run=fma%3D42%20r%3D3%20re%3D2%20neg0%3Dtrue
let area: f32 = Math.fma 2f32 3f32 36f32
let r = Math.round 2.5
let re = Math.round_even 2.5
let circle: f64 = Math.pi()
assert (circle > 3.14159 && circle < 3.14160)
assert (Math.zero() == 0.0)
$"fma={area as i64} r={r} re={re} neg0={Math.signbit (-0.0)}"
```

なお、プレリュードの無修飾関数 `sqrt`・`floor`・`ceil`・`abs`（`f64 -> f64`）、`to_float`（`i64 -> f64`）、`to_int`（`f64 -> i64`、ゼロ方向切り捨て・範囲外飽和・NaN は `0`）は `f64` 固定の単相関数です。任意の浮動小数点型に対して使う場合は `Math.*` を呼び出します。

## 初等超越関数と分解・剰余（`Elementary<'a>` 対象: 36 組み込み関数）

`f32` および `f64` 専用です。演算子 `**` を `f32` / `f64` に適用した場合も `Math.pow` と同一の決定論的経路が選ばれます。

### 三角関数・双曲線関数・角度変換（15 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Math.sin` / `Math.cos` / `Math.tan` | `Elementary<'a> => 'a -> 'a` | 正弦・余弦・正接（ラジアン、`±inf` は NaN） |
| `Math.asin` / `Math.acos` / `Math.atan` | `Elementary<'a> => 'a -> 'a` | 逆正弦・逆余弦（`[-1, 1]` 外は NaN）・逆正接 |
| `Math.atan2` | `Elementary<'a> => 'a -> 'a -> 'a` | 象限と符号付きゼロを保持する `atan2 y x` |
| `Math.sinh` / `Math.cosh` / `Math.tanh` | `Elementary<'a> => 'a -> 'a` | 双曲線正弦・双曲線余弦・双曲線正接 |
| `Math.asinh` / `Math.acosh` / `Math.atanh` | `Elementary<'a> => 'a -> 'a` | 逆双曲線関数 |
| `Math.sinc` | `Elementary<'a> => 'a -> 'a` | 正規化 sinc 関数 $\sin(\pi x) / (\pi x)$（`x == 0` で `1`） |
| `Math.degrees` / `Math.radians` | `Elementary<'a> => 'a -> 'a` | ラジアンから度への変換 / 度からラジアンへの変換 |

### 指数・対数・累乗・斜辺（13 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Math.exp` / `Math.exp2` | `Elementary<'a> => 'a -> 'a` | $e^x$ および $2^x$ |
| `Math.expm1` | `Elementary<'a> => 'a -> 'a` | ゼロ近傍での桁落ちを防ぐ $e^x - 1$ |
| `Math.log` / `Math.log2` / `Math.log10` | `Elementary<'a> => 'a -> 'a` | 自然対数・底 2・底 10 の対数（`±0` は `-inf`、負数は NaN） |
| `Math.log1p` | `Elementary<'a> => 'a -> 'a` | ゼロ近傍での桁落ちを防ぐ $\ln(1 + x)$ |
| `Math.logaddexp` / `Math.logaddexp2` | `Elementary<'a> => 'a -> 'a -> 'a` | オーバーフローを防ぐ $\ln(e^x + e^y)$ / $\log_2(2^x + 2^y)$ |
| `Math.pow` | `Elementary<'a> => 'a -> 'a -> 'a` | 累乗 $x^y$（`pow(x, ±0)`・`pow(1, NaN)`・`pow(-1, ±inf)` は `1`） |
| `Math.cbrt` | `Elementary<'a> => 'a -> 'a` | 立方根 $\sqrt[3]{x}$（負数とゼロの符号を保持） |
| `Math.hypot` | `Elementary<'a> => 'a -> 'a -> 'a` | 中間オーバーフローを防ぐ $\sqrt{x^2 + y^2}$（一方が `±inf` なら NaN より優先して `+inf`） |

### 浮動小数点剰余・指数分解・隣接表現値（8 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Math.fmod` | `Elementary<'a> => 'a -> 'a -> 'a` | ゼロ方向切り捨て商に基づく浮動小数点剰余（被除数と同符号） |
| `Math.floor_div` | `Elementary<'a> => 'a -> 'a -> 'a` | 床除算商 $\lfloor x / y \rfloor$ |
| `Math.floor_mod` | `Elementary<'a> => 'a -> 'a -> 'a` | 床除算に基づく浮動小数点剰余（除数と同符号） |
| `Math.ieee_remainder` | `Elementary<'a> => 'a -> 'a -> 'a` | 最近接偶数整数商に基づく IEEE 754 `remainder` |
| `Math.modf` | `Elementary<'a> => 'a -> ('a * 'a)` | `(小数部, 整数部)` の組へ分解（双方とも元の符号を保持） |
| `Math.frexp` | `Elementary<'a> => 'a -> ('a * i32)` | $x = m \cdot 2^e$（$|m| \in [0.5, 1)$ または `0`）の `(仮数 m, 指数 e)` へ分解 |
| `Math.ldexp` | `Elementary<'a> => 'a -> i32 -> 'a` | $x \cdot 2^{\text{exp}}$ を計算 |
| `Math.nextafter` | `Elementary<'a> => 'a -> 'a -> 'a` | `from` から `toward` の方向にある次の表現可能な浮動小数点値 |

```tsuzuri run=hypot%3D5%20sinc0%3D1%20deg%3D180%20ld%3D12
let h = Math.hypot 3.0 4.0
let s0 = Math.sinc 0.0
let pi64: f64 = Math.pi()
let deg = Math.round (Math.degrees pi64)
let ld = Math.ldexp 1.5 3i32
$"hypot={h} sinc0={s0} deg={deg} ld={ld}"
```

## 順序付き総和と内積（`Array` との連携）

浮動小数点演算は結合法則を満たさないため、Tsuzuri はコンパイラが勝手に総和順序を並べ替えることを禁止し、[`Array`](../collections/array.md)モジュール側に加算順序を名前で固定した集計関数を用意しています。

| 関数 | シグネチャ | 加算順序・丸め仕様 |
| --- | --- | --- |
| `Array.sum` | `Numeric<'a> => ref ['a] -> 'a` | `+0` から添字昇順に左から逐次加算 |
| `Array.sum_pairwise` | `Float<'a> => ref ['a] -> 'a` | 隣接ペアを段階的に加算するペアワイズ総和（CPU や SIMD 幅に非依存） |
| `Array.sum_kahan` | `Float<'a> => ref ['a] -> 'a` | 添字昇順の Kahan 補償付き総和（情報落ちを抑制） |
| `Array.dot` | `Float<'a> => ref ['a] -> ref ['a] -> 'a` | 乗算と加算を個別に丸める逐次内積 |
| `Array.dot_fma` | `Float<'a> => ref ['a] -> ref ['a] -> 'a` | 各ステップを `Math.fma` で 1 回丸めにする逐次内積 |

```tsuzuri run=plain%3D0%20kahan%3D1%20pair%3D15
let samples = [1e16, 1.0, -1e16]
let plain = Array.sum (ref samples) as i64
let kahan = Array.sum_kahan (ref samples) as i64
let pair = Array.sum_pairwise [1.0, 2.0, 3.0, 4.0, 5.0] as i64
$"plain={plain} kahan={kahan} pair={pair}"
```

## 関連項目

- [プリミティブ型](../../types/primitive-types.md)
- [Int](int.md)
- [Complex](complex.md)
- [Tensor](tensor.md)
- [Simd](simd.md)
- [Array](../collections/array.md)
- [標準ライブラリの設計規約](../conventions.md)
