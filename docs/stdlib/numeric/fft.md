# Fft

`Fft` は、任意の長さの離散フーリエ変換を $O(n \log n)$ で計算する opt-in 標準モジュールです。複素数・実数・エルミート対称の 1 次元変換、2 次元・N 次元の変換、周波数とシフトの補助関数、繰り返し使う計画 `Fft.Plan<'a>`、CPU のコアで線を分け合う並列版を提供します。外部の C ライブラリは使わず、ネイティブと WebAssembly で同じビットの結果を返します。

要素の複素数は [`Complex`](complex.md)、入力と出力の多次元配列は [`Tensor`](tensor.md) です。

## 要点

- 入力は借用の窓 `Tensor.View<Complex<'a>>`（実数の変換は `Tensor.View<'a>`）、出力は新しい `Tensor` です。要素型は `Elementary<'a>`（`f32`・`f64`）です。
- 変換の定義は $X_k = \sum_j x_j e^{-2\pi i jk/n}$、逆変換は $x_j = \frac{1}{n}\sum_k X_k e^{2\pi i jk/n}$ です。スケーリングは `Fft.Norm` で選びます（既定の `Backward` は NumPy と同じく、順変換が 1、逆変換が $1/n$）。
- 素因数が 2・3・5 だけの長さは混合基数（基数 4・2・3・5）で直接変換し、それ以外の長さ（素数など）は Bluestein のアルゴリズムで変換します。どの長さでも $O(n \log n)$ です。
- 失敗はトラップではなく `Result<_, Fft.Error>` で返します。長さ 0 の軸の変換は `Fft.Error.EmptyAxis` です。
- `ref mut` を取る `execute_into`・`execute_in_place` と並列版を除き、公開関数は `pure def` です。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、変換する窓 `Tensor.View` を最後の引数に取ります。軸（`fft_axis 0 view`）、出力長（`irfft_len 5 view`）、設定レコード（`fft_with options view`）、計画（`execute plan view`）はその前に置きます。書き込み先を取る `execute_into plan input work output` と `execute_in_place plan work data` は、書き込まれる排他スライスが最後です。`fftfreq spacing n`・`plan n direction` のように窓を取らない構築関数は、この規則の対象外です。

## 基本的な使い方

```tsuzuri run=dc%3D10%20bins%3D3%20back%3D[1,%202,%203,%204]
let signal = Tensor.of_array [4] [1.0, 2.0, 3.0, 4.0]
let dc =
    match Fft.rfft (Tensor.view signal) with
    | Result.Ok spectrum ->
        let terms = Tensor.as_array spectrum
        $"dc={terms[0].re} bins={terms.length}"
    | Result.Error problem -> $"{problem}"
let back =
    match Fft.rfft (Tensor.view signal) with
    | Result.Ok spectrum ->
        match Fft.irfft (Tensor.view spectrum) with
        | Result.Ok samples -> $"{Tensor.to_array samples}"
        | Result.Error problem -> $"{problem}"
    | Result.Error problem -> $"{problem}"
$"{dc} back={back}"
```

複素数の信号は `Fft.fft`・`Fft.ifft` で変換します。

```tsuzuri run=true
let x = Tensor.of_array [4] [Complex.of 1.0 0.0, Complex.of 1.0 0.0, Complex.of 1.0 0.0, Complex.of 1.0 0.0]
match Fft.fft (Tensor.view x) with
| Result.Ok y ->
    let s = Tensor.as_array y
    s[0].re == 4.0 && s[1].re == 0.0 && s[2].re == 0.0 && s[3].re == 0.0
| Result.Error _ -> false
```

## 型

| 型 | 内容 |
| --- | --- |
| `Fft.Norm` | `Backward`（順変換 1、逆変換 $1/n$。既定）・`Ortho`（どちらも $1/\sqrt{n}$）・`Forward`（順変換 $1/n$、逆変換 1） |
| `Fft.Direction` | 計画の向き。`Direct`（指数の符号が負）・`Inverse`（正） |
| `Fft.Options` | 1 次元の設定 `{ axis: i64, n: Maybe<i64>, norm: Fft.Norm }`。`axis` は負なら末尾から数え、`n` が `Maybe.None` なら軸の長さ |
| `Fft.NdOptions` | N 次元の設定 `{ axes: Maybe<[i64]>, shape: Maybe<[i64]>, norm: Fft.Norm }`。`axes` が `Maybe.None` なら全軸（`shape` が k 個あれば最後の k 軸） |
| `Fft.Plan<'a>` | 1 つの長さと向きの変換の計画（不透明なレコード）。変更できず、複数のスレッドが同時に借用できます |
| `Fft.Error` | `EmptyAxis axis`・`InvalidAxis (axis, rank)`・`RepeatedAxis axis`・`InvalidLength n`・`LengthMismatch (expected, found)`・`ShapeMismatch (left, right)`。`Eq` と `Display` を持ちます |

`n`（`shape`）が軸より長ければ入力の後ろを 0 で埋め、短ければ先頭の `n` 個だけを使います。`Fft.options()` は `{ axis: -1, n: Maybe.None, norm: Fft.Norm.Backward }`、`Fft.nd_options()` は `{ axes: Maybe.None, shape: Maybe.None, norm: Fft.Norm.Backward }` を返します。

長さ 2 の入力を 4 へ 0 で埋め、順変換を $1/n$ 倍する例です。

```tsuzuri run=terms%3D4%20first%3D0.5
let x = Tensor.of_array [2] [Complex.of 1.0 0.0, Complex.of 1.0 0.0]
let o = Fft.Options { axis: 0, n: Maybe.Some 4, norm: Fft.Norm.Forward }
match Fft.fft_with o (Tensor.view x) with
| Result.Ok y ->
    let terms = Tensor.as_array y
    $"terms={terms.length} first={terms[0].re}"
| Result.Error problem -> $"{problem}"
```

## 公開関数一覧（全 48 関数）

以下の表では `C<'a>` は `Complex<'a>`、`V<T>` は `ref Tensor.View<T>`、`R<T>` は `Result<T, Fft.Error>` の略です。どの関数も `Elementary<'a> =>` の制約を持ちます（`fftshift` の 4 関数は `Copy<'a> =>`、`fftfreq`・`rfftfreq`・`options`・`nd_options` は制約なし）。

### 複素数の 1 次元変換（6 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Fft.fft` | `V<C<'a>> -> R<Tensor<C<'a>>>` | 最後の軸に沿った順変換 |
| `Fft.fft_axis` | `i64 -> V<C<'a>> -> R<Tensor<C<'a>>>` | 指定した軸に沿った順変換 |
| `Fft.fft_with` | `Fft.Options -> V<C<'a>> -> R<Tensor<C<'a>>>` | 軸・長さ・スケーリングを指定した順変換 |
| `Fft.ifft` | `V<C<'a>> -> R<Tensor<C<'a>>>` | 最後の軸に沿った逆変換 |
| `Fft.ifft_axis` | `i64 -> V<C<'a>> -> R<Tensor<C<'a>>>` | 指定した軸に沿った逆変換 |
| `Fft.ifft_with` | `Fft.Options -> V<C<'a>> -> R<Tensor<C<'a>>>` | 軸・長さ・スケーリングを指定した逆変換 |

### 実数とエルミート対称の 1 次元変換（11 関数）

実数の列の変換は後ろ半分が前半分の複素共役なので、`rfft` は先頭の `n / 2 + 1` 項だけを返します。偶数長の `rfft` は、長さ `n / 2` の複素変換 1 回で計算します。`irfft` の既定の出力長は入力の項数 `m` から `2 (m - 1)` で、奇数長に戻すときは `irfft_len` か `irfft_with` で長さを指定します。`irfft` は NumPy と同じく、第 0 項と（偶数長の）第 `n / 2` 項の虚部を使いません。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Fft.rfft` | `V<'a> -> R<Tensor<C<'a>>>` | 実数の順変換（`n / 2 + 1` 項） |
| `Fft.rfft_axis` | `i64 -> V<'a> -> R<Tensor<C<'a>>>` | 指定した軸に沿った `rfft` |
| `Fft.rfft_with` | `Fft.Options -> V<'a> -> R<Tensor<C<'a>>>` | 軸・実数の個数・スケーリングを指定した `rfft` |
| `Fft.irfft` | `V<C<'a>> -> R<Tensor<'a>>` | `rfft` の逆変換（`2 (m - 1)` 個の実数） |
| `Fft.irfft_len` | `i64 -> V<C<'a>> -> R<Tensor<'a>>` | 出力の実数の個数を指定した `irfft` |
| `Fft.irfft_with` | `Fft.Options -> V<C<'a>> -> R<Tensor<'a>>` | 軸・実数の個数・スケーリングを指定した `irfft` |
| `Fft.hfft` | `V<C<'a>> -> R<Tensor<'a>>` | エルミート対称な信号（先頭の `m` 項）の変換。実数のスペクトル `2 (m - 1)` 個 |
| `Fft.hfft_len` | `i64 -> V<C<'a>> -> R<Tensor<'a>>` | スペクトルの個数を指定した `hfft` |
| `Fft.hfft_with` | `Fft.Options -> V<C<'a>> -> R<Tensor<'a>>` | 軸・個数・スケーリングを指定した `hfft` |
| `Fft.ihfft` | `V<'a> -> R<Tensor<C<'a>>>` | `hfft` の逆変換（`n / 2 + 1` 項） |
| `Fft.ihfft_with` | `Fft.Options -> V<'a> -> R<Tensor<C<'a>>>` | 軸・個数・スケーリングを指定した `ihfft` |

`hfft` は共役を取った入力の `irfft` に、`ihfft` は `rfft` の共役に当たり、どちらもスケーリングの向きが入れ替わります（`Backward` の `hfft` は係数なし、`ihfft` は $1/n$）。

```tsuzuri run=[2,%202,%202]
let half = Tensor.of_array [2] [Complex.of 6.0 0.0, Complex.of 0.0 0.0]
match Fft.irfft_len 3 (Tensor.view half) with
| Result.Ok samples -> $"{Tensor.to_array samples}"
| Result.Error problem -> $"{problem}"
```

### 2 次元・N 次元の変換（12 関数）

`fft2`・`ifft2`・`rfft2`・`irfft2` は最後の 2 軸、`fftn`・`ifftn`・`rfftn`・`irfftn` は全軸を変換します。軸を選ぶ・長さを変える・スケーリングを変えるときは `*_with` に `Fft.NdOptions` を渡します。変換は列挙した最後の軸から順に行います。実数の変換（`rfft2`・`rfftn`）は、列挙した最後の軸だけが実数の変換（長さ `n / 2 + 1`）で、残りの軸は複素数の変換です。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Fft.fft2`・`Fft.ifft2` | `V<C<'a>> -> R<Tensor<C<'a>>>` | 最後の 2 軸の順変換・逆変換 |
| `Fft.fftn`・`Fft.ifftn` | `V<C<'a>> -> R<Tensor<C<'a>>>` | 全軸の順変換・逆変換 |
| `Fft.fftn_with`・`Fft.ifftn_with` | `Fft.NdOptions -> V<C<'a>> -> R<Tensor<C<'a>>>` | 軸・各軸の長さ・スケーリングを指定 |
| `Fft.rfft2`・`Fft.rfftn` | `V<'a> -> R<Tensor<C<'a>>>` | 実数の 2 軸・全軸の変換 |
| `Fft.irfft2`・`Fft.irfftn` | `V<C<'a>> -> R<Tensor<'a>>` | その逆変換（最後の軸は `2 (m - 1)` 個の実数） |
| `Fft.rfftn_with` | `Fft.NdOptions -> V<'a> -> R<Tensor<C<'a>>>` | 軸・実数の個数・スケーリングを指定 |
| `Fft.irfftn_with` | `Fft.NdOptions -> V<C<'a>> -> R<Tensor<'a>>` | 軸・実数の個数（奇数長に要る）・スケーリングを指定 |

```tsuzuri run=[2,%203]%20true
let image = Tensor.of_array [2, 4] [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
match Fft.rfft2 (Tensor.view image) with
| Result.Ok spectrum ->
    let view = Tensor.view spectrum
    let shape = Array.copy (Tensor.shape view)
    match Fft.irfft2 view with
    | Result.Ok back -> $"{shape} {Tensor.to_array back == Tensor.to_array (Tensor.to_tensor (Tensor.view image))}"
    | Result.Error problem -> $"{problem}"
| Result.Error problem -> $"{problem}"
```

### 周波数とシフト（6 関数）と既定値（2 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Fft.fftfreq` | `f64 -> i64 -> Tensor<f64>` | 間隔 `spacing` の `n` 個の標本に対する `fft` の各項の周波数（`0, 1, …` の後に負の周波数。各値は `1 / (n spacing)` 倍）。`n <= 0` はトラップ |
| `Fft.rfftfreq` | `f64 -> i64 -> Tensor<f64>` | `rfft` の各項の周波数（`n / 2 + 1` 個） |
| `Fft.fftshift` | `V<'a> -> Tensor<'a>` | 各軸で周波数 0 の項を中央へ移す（要素 `i` を `(i + n / 2) % n` へ） |
| `Fft.fftshift_axes` | `[i64] -> V<'a> -> R<Tensor<'a>>` | 指定した軸だけの `fftshift` |
| `Fft.ifftshift` | `V<'a> -> Tensor<'a>` | `fftshift` の逆（奇数長で違いが出ます） |
| `Fft.ifftshift_axes` | `[i64] -> V<'a> -> R<Tensor<'a>>` | 指定した軸だけの `ifftshift` |
| `Fft.options` | `Fft.Options` | 1 次元の既定の設定（`Fft.options()`） |
| `Fft.nd_options` | `Fft.NdOptions` | N 次元の既定の設定（`Fft.nd_options()`） |

`fftfreq`・`rfftfreq` の引数は `spacing`、`n` の順です（NumPy の `fftfreq(n, d)` と逆）。

```tsuzuri run=[0,%200.25,%20-0.5,%20-0.25]%20[-0.5,%20-0.25,%200,%200.25]
let frequencies = Fft.fftfreq 1.0 4
let centered = Fft.fftshift (Tensor.view frequencies)
$"{Tensor.as_array frequencies} {Tensor.as_array centered}"
```

### 計画（7 関数）

同じ長さの変換を何度も行うときは、回転因子と置換（Bluestein のアルゴリズムではチャープとフィルター）を `Fft.plan` で 1 回だけ計算し、`execute` で使い回します。計画は変更できない値で、隠れたキャッシュを持ちません。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Fft.plan` | `i64 -> Fft.Direction -> R<Fft.Plan<'a>>` | 長さ `n` と向きの計画（スケーリングは `Backward`）。`n <= 0` は `InvalidLength` |
| `Fft.plan_with` | `Fft.Norm -> i64 -> Fft.Direction -> R<Fft.Plan<'a>>` | スケーリングを指定した計画 |
| `Fft.plan_length` | `ref Fft.Plan<'a> -> i64` | 計画の変換長 |
| `Fft.plan_work_length` | `ref Fft.Plan<'a> -> i64` | `execute_into`・`execute_in_place` の作業バッファに要る要素数 |
| `Fft.execute` | `ref Fft.Plan<'a> -> V<C<'a>> -> R<Tensor<C<'a>>>` | 最後の軸（長さは計画と同じ）を変換した新しいテンソル |
| `Fft.execute_into` | `ref Fft.Plan<'a> -> ref [C<'a>] -> ref mut [C<'a>..] -> ref mut [C<'a>..] -> R<unit>` | 長さ `n` の `input` を変換して `output` へ書く（入力・作業・出力の順）。ヒープを確保しません |
| `Fft.execute_in_place` | `ref Fft.Plan<'a> -> ref mut [C<'a>..] -> ref mut [C<'a>..] -> R<unit>` | `data` をその場で変換する（作業・データの順）。`n` 個ずつが 1 本の線。ヒープを確保しません |

作業バッファ `work` は `plan_work_length plan` 個以上が要り、呼び出しの後の中身は未規定です。1 つの計画を複数のスレッドで使うときは、スレッドごとに `work` と出力を用意します。

```tsuzuri run=[3,%20-1]
let made: Result<Fft.Plan<f64>, Fft.Error> = Fft.plan 2 Fft.Direction.Direct
let input = [Complex.of 1.0 0.0, Complex.of 2.0 0.0]
let mut work = [Complex.of 0.0 0.0, Complex.of 0.0 0.0]
let mut output = [Complex.of 0.0 0.0, Complex.of 0.0 0.0]
match made with
| Result.Ok plan ->
    match Fft.execute_into plan input (ref mut work) (ref mut output) with
    | Result.Ok _ -> $"{Array.map (\z -> z.re) output}"
    | Result.Error problem -> $"{problem}"
| Result.Error problem -> $"{problem}"
```

### 並列版（4 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Fft.fft_parallel`・`Fft.ifft_parallel` | `V<C<'a>> -> R<Tensor<C<'a>>>` | 最後の軸の変換を、線ごとに CPU のコアで分け合う |
| `Fft.fft2_parallel`・`Fft.ifft2_parallel` | `V<C<'a>> -> R<Tensor<C<'a>>>` | 最後の 2 軸の変換を、行と列の線ごとに分け合う |

[`Parallel.for_each_chunk_with`](../sync/parallel.md) で 16384 要素以上を 1 つのチャンクにして線を分けます。各線の計算は直列版と同じなので、結果は `fft`・`fft2` とビットまで同じです。スレッドのない WebAssembly では、同じ線を順に計算します。1 本の長い変換（バッチのない 1 次元の入力）は分割しません。

```tsuzuri run=true
let x = Tensor.init [3, 4] (\i -> Complex.of (i as f64) 0.0)
match (Fft.fft_parallel (Tensor.view x), Fft.fft (Tensor.view x)) with
| (Result.Ok parallel, Result.Ok serial) -> parallel == serial
| _ -> false
```

## 誤りになる入力

```tsuzuri run=axis%200%20has%20no%20elements%20to%20transform%20/%20axis%202%20is%20out%20of%20bounds%20for%20rank%201
let empty: Tensor<Complex<f64>> = Tensor.of_array [0] []
let line = Tensor.of_array [2] [Complex.of 1.0 0.0, Complex.of 2.0 0.0]
let first =
    match Fft.fft (Tensor.view empty) with
    | Result.Error problem -> $"{problem}"
    | Result.Ok _ -> "ok"
let second =
    match Fft.fft_axis 2 (Tensor.view line) with
    | Result.Error problem -> $"{problem}"
    | Result.Ok _ -> "ok"
$"{first} / {second}"
```

- 変換する軸の長さ（または指定した `n`）が 0: `EmptyAxis axis`。変換しない軸の長さが 0 なら、空のテンソルを返します。
- 軸が階数の外: `InvalidAxis (axis, rank)`。階数 0 のテンソルの 1 次元変換もこの誤りです。
- `NdOptions.axes` に同じ軸が 2 回ある: `RepeatedAxis axis`（NumPy は同じ軸を 2 回変換します）。
- 負の長さ、0 以下の計画の長さ: `InvalidLength n`。
- `shape` の個数が軸の個数と違う、計画の長さと入力の長さが違う、作業バッファが足りない: `LengthMismatch (expected, found)`。

## 精度と決定性

- 回転因子 $e^{\pm 2\pi i k/n}$ は、角度を整数で 8 分円へ畳んでから `f64` の `Math.cos`・`Math.sin` を 1 回ずつ呼び、要素型へ 1 回だけ丸めた値です。反復乗算で作らないので、長い変換でも誤差が蓄積しません。軸の上の値（$k = n/4$ など）は厳密に 0 と ±1 です。
- Bluestein のアルゴリズムのチャープの位相は、$k^2 \bmod 2n$ を整数で厳密に計算してから求めます。`f32` でも、$k$ が大きいときに位相が崩れません。
- `fast-math`、式の再結合、暗黙の FMA は使いません。同じ入力には、ネイティブと WebAssembly、`-O0` と `-O3` で同じビットの結果を返します。
- NumPy（pocketfft）とはアルゴリズムが違うので、結果は丸め誤差の範囲で一致しますが、ビットまでは一致しません。

## 現在の制限

- SIMD・GPU を使う変換の核、外部の FFTW・Accelerate への接続はありません。
- 窓関数、短時間フーリエ変換（STFT）、離散コサイン変換はありません。
- 並列版は `Backward` のスケーリングだけで、軸と長さの指定はありません（先に [`Tensor`](tensor.md) の `permute` などで軸を並べ替えます）。
