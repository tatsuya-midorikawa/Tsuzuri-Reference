# RandomTensor

`RandomTensor` は、乱数の [Tensor](./tensor.md) を一度に作る関数、多変量分布（ディリクレ分布・多変量正規分布）、ランダムな並べ替えと重み付きの抽出を提供する opt-in の標準モジュールです。乱数の源は [Random](../sys/random.md) の 64 ビット生成器 `Random.Pcg64` で、どの関数も生成器を値で受け取り、結果と次に使う生成器を返します。暗黙のグローバル乱数状態は存在しません。

ソースが `RandomTensor` という名前を書いたときだけ読み込まれ、そのとき `Tensor` と `Linalg`（`multivariate_normal` の Cholesky 分解とエラー型に使います）も読み込まれます。常時読み込まれる `Random` は `Tensor` を参照しないので、`RandomTensor` を使わないプログラムの型検査と生成コードは変わりません。権限は不要で、既定の `wasm32` でも使用できます。

## 要点

- 生成関数は「分布のパラメータ、形状、生成器」の順に引数を取り、`(テンソル * 次の生成器)` を返します。
- テンソルは、`Random` の同じ名前のスカラー関数を行優先の順に 1 要素につき 1 回呼んだ結果とビット単位で同じです。2 回に分けて作っても、1 回で作っても同じ列になります。
- 同じ種からは、ネイティブと `wasm32`、`-O0` と `-O3` のどれでもビット単位に同じテンソルが出ます。
- 不正な分布パラメータは、形状に要素がなくてもトラップします。数学的な失敗（共分散が正定値でないなど）は `Result` で返します。
- `shuffle_axis` だけが書き込み窓 `Tensor.Mut` をその場で書き換えます。ほかの関数はすべて `pure def` です。

## テンソルの生成

```tsuzuri run=[-0.135,%200.394,%200.645,%20-0.664,%201.975,%200.86]%0A[3,%202,%204,%201,%205,%204,%205,%203]%0A[5,%200,%201,%203,%204,%202]
def main :: unit -> i32 = \() ->
    let rng = Random.pcg64 42i64u
    let (samples, rng) = RandomTensor.normal 0.0 1.0 [2, 3] rng
    let rounded = Tensor.map (\x -> Math.round (x * 1000.0) / 1000.0) (Tensor.view samples)
    do! IO.writeln $"{Tensor.to_array rounded}"
    let (dice, rng) = RandomTensor.integers 1 7 [2, 4] rng
    do! IO.writeln $"{Tensor.to_array dice}"
    let (order, _) = RandomTensor.permutation 6 rng
    do! IO.writeln $"{Tensor.to_array order}"
    0
```

連続分布は `Tensor<f64>`、`integers`・`binomial`・`poisson`・`geometric` は `Tensor<i64>`、`bernoulli` は `Tensor<bool>` を返します。形状は `own [i64]` で、`[]` は 1 要素のランク 0 のテンソル、要素数が 0 の形状は乱数を引かずに空のテンソルを返します。負の軸長はトラップします。

| 関数 | 分布 | 対応するスカラー関数 |
| --- | --- | --- |
| `uniform low high` | `[low, high)` の一様分布 | `Random.pcg64_uniform` |
| `standard_normal` | 標準正規分布 | `Random.pcg64_standard_normal` |
| `normal loc scale` | 正規分布 | `Random.pcg64_normal` |
| `exponential scale` | 指数分布 | `Random.pcg64_exponential` |
| `gamma k scale` | ガンマ分布（形状 `k`） | `Random.pcg64_gamma` |
| `beta a b` | ベータ分布 | `Random.pcg64_beta` |
| `chisquare df` | カイ二乗分布 | `Random.pcg64_chisquare` |
| `laplace loc scale` | ラプラス分布 | `Random.pcg64_laplace` |
| `lognormal mean sigma` | 対数正規分布 | `Random.pcg64_lognormal` |
| `standard_t df` | スチューデントの t 分布 | `Random.pcg64_standard_t` |
| `f_dist dfnum dfden` | F 分布 | `Random.pcg64_f_dist` |
| `integers low high` | `[low, high)` の整数 | `Random.pcg64_next_i64_range` |
| `bernoulli p` | 確率 `p` で `true` | `Random.pcg64_bernoulli` |
| `binomial n p` | 二項分布 | `Random.pcg64_binomial` |
| `poisson lam` | ポアソン分布 | `Random.pcg64_poisson` |
| `geometric p` | 幾何分布（1 以上） | `Random.pcg64_geometric` |

算法とパラメータの条件は [Random の確率分布](../sys/random.md#確率分布)と同じです。

### スカラーの生成との一致

テンソルの要素は、スカラー関数を行優先の順に呼んだ結果そのものです。次の例は、`[2, 3]` のテンソルと 6 回のスカラー生成が一致し、返ってきた生成器も同じ位置にあることを確かめます。

```tsuzuri run=true%20true
def main :: unit -> i32 = \() ->
    let (tensor, after_tensor) = RandomTensor.gamma 2.5 1.5 [2, 3] (Random.pcg64 7i64u)
    let values = Tensor.to_array tensor
    let mut state = Random.pcg64 7i64u
    let mut same = true
    for index in 0 ..< 6 do
        let (sample, next) = Random.pcg64_gamma 2.5 1.5 state
        state = next
        if values[index] != sample then same = false
    let (left, _) = Random.pcg64_next_u64 after_tensor
    let (right, _) = Random.pcg64_next_u64 state
    do! IO.writeln $"{same} {left == right}"
    0
```

## 多変量分布

`dirichlet alpha shape rng` はディリクレ分布のベクトルを作ります。結果の形状は `shape` に `alpha` の長さを続けたもので、最後の軸に沿った各ベクトルは非負で和が 1、平均は `alpha / sum alpha` です。ガンマ分布の標本を和で割って作り、パラメータがすべて 0.1 未満のときはベータ分布の連鎖で作ります（ガンマの標本がすべて 0 に丸まるのを避けます）。`alpha` がランク 1 でない、要素がない、要素が正の有限値でないときはトラップします。

`multivariate_normal mean cov shape rng` は、平均 `mean`（ランク 1、長さ `n`）と共分散 `cov`（`[n, n]`、対称正定値）の多変量正規分布のベクトルを作ります。結果の形状は `shape` に `n` を続けたもので、各ベクトルは `cov` の Cholesky 因子 `L` と `n` 個の標準正規乱数 `z` から `mean + L z` で作ります。形状が合わないときは `Linalg.Error.ShapeMismatch`、`cov` が対称正定値でないときは `Linalg.Error.NotPositiveDefinite` を返し、そのとき乱数は引きません。

```tsuzuri run=[4,%203]%20true%0A[5,%202]%0Ashape%20mismatch:%20[3]%20vs%20[2,%202]%0Amatrix%20is%20not%20symmetric%20positive%20definite
def describe :: own Result<(Tensor<f64> * Random.Pcg64), Linalg.Error> -> string
fn describe result =
    match result with
    | Result.Ok (samples, _) ->
        let view = Tensor.view (ref samples)
        $"{Tensor.shape (ref view)}"
    | Result.Error error -> $"{error}"

def main :: unit -> i32 = \() ->
    let rng = Random.pcg64 42i64u
    let alpha = Tensor.of_array [3] [1.0, 2.0, 3.0]
    let (shares, rng) = RandomTensor.dirichlet (Tensor.view alpha) [4] rng
    let view = Tensor.view (ref shares)
    let first_row = view[[0, 0]] + view[[0, 1]] + view[[0, 2]]
    do! IO.writeln $"{Tensor.shape (ref view)} {Math.abs (first_row - 1.0) < 1e-12}"
    let mean = Tensor.of_array [2] [1.0, -1.0]
    let cov = Tensor.of_array [2, 2] [2.0, 0.5, 0.5, 1.0]
    do! IO.writeln (describe (RandomTensor.multivariate_normal (Tensor.view mean) (Tensor.view cov) [5] rng))
    let long_mean = Tensor.of_array [3] [0.0, 0.0, 0.0]
    do! IO.writeln (describe (RandomTensor.multivariate_normal (Tensor.view long_mean) (Tensor.view cov) [5] rng))
    let indefinite = Tensor.of_array [2, 2] [1.0, 2.0, 2.0, 1.0]
    do! IO.writeln (describe (RandomTensor.multivariate_normal (Tensor.view mean) (Tensor.view indefinite) [5] rng))
    0
```

## 並べ替えと抽出

- `permutation count rng` は `0 ..< count` の並べ替えを、どの順序も同じ確率で返します（Fisher-Yates）。負の `count` はトラップします。
- `shuffle_axis axis rng target` は、書き込み窓 `target` の `axis` に沿った切片をその場で並べ替え、次に使う生成器を返します。切片は丸ごと動きます。行列の軸 0 なら行が入れ替わり、各行の中身は変わりません。順序は同じ生成器の `permutation` と同じで、`i` 番目の切片は元の `order[i]` 番目になります。負の `axis` は末尾から数え、ランクの外の軸はトラップします。要素数に比例する作業領域を 1 つ使います。
- `choice_weighted count replace weights rng source` は、`source` の軸 0 の切片を `weights / sum weights` の確率で `count` 個取り出します。結果の形状は `source` の最初の軸を `count` にしたものです。重みの合計は 1 でなくて構いません。重み 0 の切片は選ばれません。
  - `replace` が `true` のときは、同じ切片が何度も出ることがあります。1 回の抽出に一様乱数を 1 つ使います。
  - `replace` が `false` のときは、各切片は高々 1 回で、残った切片からその重みで順に取ります。重みが正の切片ごとに一様乱数を 1 つ使い、`count` には依りません。

```tsuzuri run=[3,%204,%205,%206,%201,%202]%0A[1,%202,%200]%0A[20,%2020,%2020]%0A[10,%2030]
def main :: unit -> i32 = \() ->
    let mut data = [1, 2, 3, 4, 5, 6]
    let mut rows = Tensor.borrow_mut [3, 2] (ref mut data)
    let _next = RandomTensor.shuffle_axis 0 (Random.pcg64 7i64u) (ref mut rows)
    do! IO.writeln $"{data}"
    let (order, _) = RandomTensor.permutation 3 (Random.pcg64 7i64u)
    do! IO.writeln $"{Tensor.to_array order}"
    let values = Tensor.of_array [3] [10, 20, 30]
    let only_second = Tensor.of_array [3] [0.0, 1.0, 0.0]
    let (repeated, rng) = RandomTensor.choice_weighted 3 true (Tensor.view only_second) (Random.pcg64 7i64u) (Tensor.view values)
    do! IO.writeln $"{Tensor.to_array repeated}"
    let outer = Tensor.of_array [3] [2.0, 0.0, 1.0]
    let (distinct, _) = RandomTensor.choice_weighted 2 false (Tensor.view outer) rng (Tensor.view values)
    do! IO.writeln $"{Array.sort (Tensor.to_array distinct)}"
    0
```

`choice_weighted` は、`weights` がランク 1 でない、長さが `source` の最初の軸と違う、要素が負・NaN・無限大、合計が 0、`count` が負、`replace` が `false` で `count` が正の重みの個数を超える、のどれかのときトラップします。

## エラーとトラップ

| 状況 | 結果 |
| --- | --- |
| 不正な分布パラメータ（`Random` のスカラー関数と同じ条件）、負の軸長、ランクの外の軸、不正な重みや `alpha` | トラップ（`assertion failed`）。要素数が 0 の形状でも検査します |
| `multivariate_normal` の `mean` と `cov` の形状が合わない | `Result.Error (Linalg.Error.ShapeMismatch (mean の形状, cov の形状))` |
| `multivariate_normal` の `cov` が対称正定値でない | `Result.Error Linalg.Error.NotPositiveDefinite` |

## 対応環境

OS 呼び出しやホストインポートを行わないため、ネイティブと既定の `wasm32` で使用できます。`-O0` と `-O3` のどちらでも、同じ種から同じテンソルが出ることを検査しています。OS の乱数を種にするときは、`Random.pcg64_from_os`（権限 `random`）で作った生成器を渡します。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、関数が読み、進める対象を最後の引数に取ります。

- **生成関数**（`uniform`〜`geometric`、`dirichlet`、`multivariate_normal`、`permutation`）: 対象は生成器 `Random.Pcg64` で、分布のパラメータと形状の後に置きます（`RandomTensor.normal loc scale shape rng`）。
- **`shuffle_axis axis rng target`**: 書き換える窓 `Tensor.Mut` が最後です。
- **`choice_weighted count replace weights rng source`**: 取り出す元の `Tensor.View` が最後です。

対象が最後なので、パイプラインで生成器を渡せます。

```tsuzuri run=[3]
def main :: unit -> i32 = \() ->
    let (samples, _) = Random.pcg64 42i64u |> RandomTensor.standard_normal [3]
    let view = Tensor.view (ref samples)
    do! IO.writeln $"{Tensor.shape (ref view)}"
    0
```

## 公開 API

### 分布（16 関数、`pure def`）

| 関数 | シグネチャ |
| --- | --- |
| `RandomTensor.uniform` | `own f64 -> own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.standard_normal` | `own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.normal` | `own f64 -> own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.exponential` | `own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.gamma` | `own f64 -> own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.beta` | `own f64 -> own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.chisquare` | `own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.laplace` | `own f64 -> own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.lognormal` | `own f64 -> own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.standard_t` | `own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.f_dist` | `own f64 -> own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` |
| `RandomTensor.integers` | `own i64 -> own i64 -> own [i64] -> own Random.Pcg64 -> (Tensor<i64> * Random.Pcg64)` |
| `RandomTensor.bernoulli` | `own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<bool> * Random.Pcg64)` |
| `RandomTensor.binomial` | `own i64 -> own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<i64> * Random.Pcg64)` |
| `RandomTensor.poisson` | `own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<i64> * Random.Pcg64)` |
| `RandomTensor.geometric` | `own f64 -> own [i64] -> own Random.Pcg64 -> (Tensor<i64> * Random.Pcg64)` |

### 多変量分布・並べ替え・抽出（5 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `RandomTensor.dirichlet` | `ref Tensor.View<f64> -> own [i64] -> own Random.Pcg64 -> (Tensor<f64> * Random.Pcg64)` | ディリクレ分布のベクトル（`pure def`） |
| `RandomTensor.multivariate_normal` | `ref Tensor.View<f64> -> ref Tensor.View<f64> -> own [i64] -> own Random.Pcg64 -> Result<(Tensor<f64> * Random.Pcg64), Linalg.Error>` | 多変量正規分布のベクトル（`pure def`） |
| `RandomTensor.permutation` | `own i64 -> own Random.Pcg64 -> (Tensor<i64> * Random.Pcg64)` | `0 ..< count` の並べ替え（`pure def`） |
| `RandomTensor.shuffle_axis` | `Copy<'a> => own i64 -> own Random.Pcg64 -> ref mut Tensor.Mut<'a> -> Random.Pcg64` | 窓の切片をその場で並べ替える |
| `RandomTensor.choice_weighted` | `Copy<'a> => own i64 -> own bool -> ref Tensor.View<f64> -> own Random.Pcg64 -> ref Tensor.View<'a> -> (Tensor<'a> * Random.Pcg64)` | 重み付きの抽出（`pure def`） |

## 関連項目

- [Random](../sys/random.md)
- [Tensor](./tensor.md)
- [Math](./math.md)
- [標準ライブラリの規約](../conventions.md)
