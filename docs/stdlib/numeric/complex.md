# Complex

`Complex` は、実部 `re` と虚部 `im` を連続フィールドとして保持する複素数値型レコード `Complex<'a>` と、四則演算・極座標変換・初等複素関数を提供する opt-in 標準モジュールです。すべての公開関数はヒープ確保を行わない純粋関数（`pure def`）として定義されています。

実数側の初等関数仕様については[`Math`](math.md)を、複素数を要素とする多次元配列演算については[`Tensor`](tensor.md)を参照してください。

## 要点

- `record Complex<'a> { re: 'a, im: 'a }` は `'a` が `Copy` のとき自身も `Copy` 値型となり、スタックやレジスタ上で軽量に受け渡されます（公開フィールド `z.re`・`z.im` への直接アクセスも可能です）。
- `+`・`-`・`*`・`/`・単項 `-`・`==`・`!=`・`Default.default`・`Display.display` の各型クラスインスタンスを備えています。
- 複素除算 `Complex.div`（および `/` 演算子）は事前スケーリング付きの Smith 法を採用しており、`1.0e308 + 1.0e308i` のように絶対値の 2 乗がオーバーフローする領域でも中間桁溢れを回避します。
- 基本構築・四則演算は任意の `Float<'a>` 型で動作し、三角・双曲線・指数・対数などの超越関数は `Elementary<'a>`（`f32` / `f64`）を対象とします。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、1 つの複素数を変換・検査する関数および実数倍 `Complex.scale factor z` は対象の `Complex<'a>` を最後の引数に取ります（`z |> Complex.scale 2.0 |> Complex.conj` のようにパイプラインで連鎖できます）。2 つの複素数を取る `add`・`sub`・`mul`・`div`・`pow` は数式どおり左被演算子・右被演算子の順です。

## 基本的な使い方

```tsuzuri run=sum%3D4%2B6i%20mag%3D5%20scaled%3D6-8i%20safe_div%3Dtrue
let a = Complex.of 1.0 2.0
let b = Complex.of 3.0 4.0
let sum = a + b
let mag = Complex.abs b
let scaled = b |> Complex.scale 2.0 |> Complex.conj
let q = Complex.div (Complex.of 1.0e308 1.0e308) (Complex.of 1.0e308 1.0e308)
$"sum={sum} mag={mag} scaled={scaled} safe_div={q.re == 1.0 && q.im == 0.0}"
```

`Display` インスタンスは虚部の符号ビット（`Math.signbit z.im`）を見て `"3+4i"` または `"3-4i"` の形式で整形します（`-0.0` の虚部も `"-0i"` として符号が保持されます）。

## 公開関数一覧（全 32 関数）

### 構築・定数・成分取得（9 関数）

`zero`・`one`・`i` は戻り値型から要素型 `'a` を決定するため、文脈から型が推論されない場合は `let u: Complex<f64> = Complex.i ()` のように型注釈を添えます。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Complex.of` | `Copy<'a> => 'a -> 'a -> Complex<'a>` | 実部 `re` と虚部 `im` から `re + im * i` を構築 |
| `Complex.from_real` | `(Float<'a>, Numeric<'a>, Copy<'a>) => 'a -> Complex<'a>` | 実軸上の複素数 `re + 0i` を構築 |
| `Complex.from_imag` | `(Float<'a>, Numeric<'a>, Copy<'a>) => 'a -> Complex<'a>` | 純虚数 `0 + im * i` を構築 |
| `Complex.polar` | `(Elementary<'a>, Mul<'a>, Copy<'a>) => 'a -> 'a -> Complex<'a>` | 極座標 `(r, theta)` から $r(\cos\theta + i\sin\theta)$ を構築 |
| `Complex.zero` | `(Float<'a>, Numeric<'a>, Copy<'a>) => unit -> Complex<'a>` | 加法単位元 `0 + 0i` |
| `Complex.one` | `(Float<'a>, Numeric<'a>, Copy<'a>) => unit -> Complex<'a>` | 乗法単位元 `1 + 0i` |
| `Complex.i` | `(Float<'a>, Numeric<'a>, Copy<'a>) => unit -> Complex<'a>` | 虚数単位 `0 + 1i` |
| `Complex.real` | `Copy<'a> => Complex<'a> -> 'a` | 実部 `z.re` を取得 |
| `Complex.imag` | `Copy<'a> => Complex<'a> -> 'a` | 虚部 `z.im` を取得 |

### 四則演算・スカラー倍・共役・絶対値・偏角（10 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Complex.add` | `(Float<'a>, Add<'a>, Copy<'a>) => Complex<'a> -> Complex<'a> -> Complex<'a>` | 加算 `left + right` |
| `Complex.sub` | `(Float<'a>, Sub<'a>, Copy<'a>) => Complex<'a> -> Complex<'a> -> Complex<'a>` | 減算 `left - right` |
| `Complex.mul` | `(Float<'a>, Add<'a>, Sub<'a>, Mul<'a>, Copy<'a>) => Complex<'a> -> Complex<'a> -> Complex<'a>` | 乗算 $(a+bi)(c+di) = (ac-bd) + (ad+bc)i$ |
| `Complex.div` | `(Float<'a>, Add<'a>, Sub<'a>, Mul<'a>, Div<'a>, Ord<'a>, Copy<'a>) => Complex<'a> -> Complex<'a> -> Complex<'a>` | スケーリング付き Smith 法による除算 `left / right` |
| `Complex.neg` | `(Float<'a>, Neg<'a>, Copy<'a>) => Complex<'a> -> Complex<'a>` | 符号反転 `-re - im * i` |
| `Complex.scale` | `(Float<'a>, Mul<'a>, Copy<'a>) => 'a -> Complex<'a> -> Complex<'a>` | 実数スカラー倍 `(factor * re) + (factor * im)i` |
| `Complex.conj` | `(Float<'a>, Neg<'a>, Copy<'a>) => Complex<'a> -> Complex<'a>` | 複素共役 `re - im * i` |
| `Complex.norm_sq` | `(Float<'a>, Add<'a>, Mul<'a>, Copy<'a>) => Complex<'a> -> 'a` | ノルム二乗 $\text{re}^2 + \text{im}^2$ |
| `Complex.abs` | `(Elementary<'a>, Copy<'a>) => Complex<'a> -> 'a` | 絶対値 $|z| = \text{hypot}(\text{re}, \text{im})$ |
| `Complex.arg` | `(Elementary<'a>, Copy<'a>) => Complex<'a> -> 'a` | 主偏角 $\text{atan2}(\text{im}, \text{re}) \in [-\pi, \pi]$ |

### 平方根・指数・対数・累乗・三角・双曲線関数（10 関数）

いずれも `Elementary<'a>`（`f32` または `f64`）を対象とし、主値（principal branch）を返します。

| 関数 | 定義・主値仕様 |
| --- | --- |
| `Complex.sqrt` | 主平方根（実部が非負で負の実軸に分岐切断を持ち、`z.im` の符号ビットを保存） |
| `Complex.exp` | $e^{\text{re}}(\cos\text{im} + i\sin\text{im})$ |
| `Complex.log` | 主自然対数 $\ln|z| + i\,\text{arg}(z)$ |
| `Complex.pow` | 複素累乗 $\exp(\text{exponent} \cdot \log(\text{base}))$（`0 + 0i` の `0 + 0i` 乗は `1 + 0i`） |
| `Complex.sin` | $\sin(a)\cosh(b) + i\cos(a)\sinh(b)$ |
| `Complex.cos` | $\cos(a)\cosh(b) - i\sin(a)\sinh(b)$ |
| `Complex.tan` | $\sin(z) / \cos(z)$（Smith 法除算） |
| `Complex.sinh` | $\sinh(a)\cos(b) + i\cosh(a)\sin(b)$ |
| `Complex.cosh` | $\cosh(a)\cos(b) + i\sinh(a)\sin(b)$ |
| `Complex.tanh` | $\sinh(z) / \cosh(z)$（Smith 法除算） |

### 有限性・特殊値分類（3 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Complex.is_nan` | `(Float<'a>, Copy<'a>) => Complex<'a> -> bool` | 実部または虚部のいずれかが NaN のとき `true` |
| `Complex.is_infinite` | `(Float<'a>, Copy<'a>) => Complex<'a> -> bool` | 実部または虚部のいずれかが `±inf` のとき `true` |
| `Complex.is_finite` | `(Float<'a>, Copy<'a>) => Complex<'a> -> bool` | 実部と虚部の双方が有限値のとき `true` |

```tsuzuri run=root%3D0%2B2i%20p00%3D1%2B0i%20fin%3Dtrue
let root = Complex.of (-4.0) 0.0 |> Complex.sqrt
let z0: Complex<f64> = Complex.zero ()
let p00 = Complex.pow z0 z0
let fin = Complex.is_finite root && not (Complex.is_nan root)
$"root={root} p00={p00} fin={fin}"
```

## 関連項目

- [Math](math.md)
- [Tensor](tensor.md)
- [プリミティブ型](../../types/primitive-types.md)
- [レコード](../../types/records.md)
- [標準ライブラリの設計規約](../conventions.md)
