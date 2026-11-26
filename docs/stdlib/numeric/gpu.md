# Gpu

`Gpu` は、要素並列のスカラーカーネルから WGSL（WebGPU）および SPIR-V（Vulkan）コンピュートシェーダーを抽出し、CPU 参照実装・WebGPU・Vulkan、およびコスト見積りに基づく自動選択バックエンド（`Gpu.Auto`）上で実行する**実験的（experimental）**な標準モジュールです。

> [!WARNING]
> `Gpu` モジュールは実験的機能です。明示的に `Gpu.WebGpu` や `Gpu.Vulkan` を要求して利用不能だった場合に暗黙で CPU へフォールバックすることはなく、必ず `Result.Error Gpu.Unavailable`（または未対応カーネル実行時の明示的トラップ）として報告されます。また、現在のバッファは呼び出しのたびにホスト・デバイス間で転送と完了同期を行う設計であり、GPU メモリ常駐バッファや行列積カーネルはまだ提供されていません。

パッケージマニフェストで権限（capabilities）を制限している場合、`request`・`init`・`map`・`init_relaxed`・`map_relaxed`・`last_backend` の呼び出しには `gpu` 権限が必要です（[パッケージ管理](../../modules/packages.md)参照）。

## 要点

- バックエンド指定子 `Gpu.Backend` には `CpuReference`・`WebGpu`・`Vulkan`・`Cuda`・`Metal`・`Auto` があります。`CpuReference` と `Auto` は常に `Result.Ok` を返し、`Cuda` と `Metal` は現在常に `Result.Error Gpu.Unavailable` を返します。
- 厳密 API（`Gpu.init`・`Gpu.map`）は、言語の整数折り返しや IEEE 754 丸め・符号付きゼロ・非正規化数をビット単位で再現できるカーネルのみを GPU 上で実行します（WebGPU は `i32` / `i32u`、Vulkan はそれに加えて `shaderInt64` 対応時の `i64` / `i64u`、および `VK_KHR_shader_float_controls` 申告と実行時適合プローブの双方を通過したデバイスでの `f32`）。
- 浮動小数点の積和融合・再結合・非正規化数フラッシュ・2.5 ULP 除算を許容して GPU 実行したい場合は、名前で明示的に分離された緩和 API（`Gpu.init_relaxed`・`Gpu.map_relaxed`、および `--emit wgsl-relaxed` / `--emit spirv-relaxed`）を選択します。
- `Gpu.Auto` は論理デバイスを事前オープンせず、呼び出しごとにレーン数 $n$ とカーネル命令重み下限 $w$ のコストモデルから「CPU 参照」と「統合 GPU 上の Vulkan」のどちらで実行するかを動的に選択します（実際に選ばれたバックエンドは `Gpu.last_backend ()` で確認できます）。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)において、`Gpu.Device` はリソースハンドルの免除カテゴリに属するため、`backend`・`init`・`map`・`init_relaxed`・`map_relaxed`・`from_array` では共有借用 `ref Gpu.Device` が第 1 引数に置かれ、変換対象の `Gpu.Buffer<'a>` は `Gpu.map (ref device) f buffer` や `Gpu.to_array buffer` のとおり最後の引数に置かれます。ただし、カーネル抽出を伴う `init`・`map`・`init_relaxed`・`map_relaxed`・`from_array` は直接の完全適用が必須であり、`|>` による部分適用形式（`buf |> Gpu.map ...`）も `E1018` となる点に注意してください（`Gpu.to_array` はパイプライン利用が可能です）。

## 基本的な使い方（CPU 参照・明示的フォールバック・`Gpu.Auto`）

`Gpu.WebGpu` や `Gpu.Vulkan` を要求した場合、デバイス非対応時は `Result.Error Gpu.Unavailable` が返るため、CPU 参照へ切り替えるかどうかを呼び出し側で明示的に記述できます。

```tsuzuri run=explicit%3D35%20auto_sum%3D18%20cuda%3Dunavailable
def step_kernel :: i32 -> i32
fn step_kernel x = x * 3i32 + 1i32

def run_on :: ref Gpu.Device -> i32
fn run_on dev =
    let buf = Gpu.init dev 5 step_kernel
    let arr = Gpu.to_array buf
    Array.sum (ref arr)

let explicit = match Gpu.request Gpu.Vulkan with
    | Result.Ok dev -> run_on (ref dev)
    | Result.Error Gpu.Unavailable ->
        let cpu = Result.get (Gpu.request Gpu.CpuReference)
        run_on (ref cpu)

let auto_dev = Result.get (Gpu.request Gpu.Auto)
let init_buf = Gpu.init (ref auto_dev) 4 (\i -> i * i)
let auto_buf = Gpu.map (ref auto_dev) (\v -> v + 1i32) init_buf
let auto_sum = auto_buf |> Gpu.to_array |> Array.sum
let _which = Gpu.last_backend ()

let cuda_state = match Gpu.request Gpu.Cuda with
    | Result.Ok _ -> "ok"
    | Result.Error Gpu.Unavailable -> "unavailable"

$"explicit={explicit} auto_sum={auto_sum} cuda={cuda_state}"
```

## データ型と公開関数一覧（全 9 関数）

### データ型

```text
union Backend = CpuReference | WebGpu | Vulkan | Cuda | Metal | Auto
union Error   = Unavailable
record Device         // 不透明・非 Copy レコード（ref Gpu.Device として渡す）
record Buffer<'a>     // 不透明・非 Copy レコード（map / map_relaxed / to_array でムーブ消費）
```

### 公開関数一覧

`init`・`map`・`init_relaxed`・`map_relaxed`・`from_array` はカーネル抽出の対象となるため、部分適用や関数値としての束縛は行えず、呼び出し箇所ですべての引数を揃えて呼び出す必要があります（違反時は `E1018`）。また、レーン数 `count` の有効範囲は `0 <= count <= 2,147,483,647` です。

| 関数 | シグネチャ | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `Gpu.request` | `Gpu.Backend -> Result<Gpu.Device, Gpu.Error>` | 未対応・機能不足は `Error Unavailable` | 指定バックエンドのデバイスハンドルを要求 |
| `Gpu.backend` | `ref Gpu.Device -> Gpu.Backend` | なし | デバイス要求時に指定された `Backend` を返す（`Auto` デバイスなら `Auto`） |
| `Gpu.last_backend` | `unit -> Gpu.Backend` | なし | 非 CPU バックエンドを含むプログラムで直前のカーネルを実行した実バックエンドを返す（初期値は `CpuReference`） |
| `Gpu.init` | `ref Gpu.Device -> i64 -> (i32 -> 'a) -> Gpu.Buffer<'a>` | `count` 範囲外・非対応カーネル実行時にトラップ | インデックス `0 ..< count`（`i32`）から厳密セマンティクスでバッファを生成 |
| `Gpu.map` | `Copy<'a> => ref Gpu.Device -> ('a -> 'b) -> Gpu.Buffer<'a> -> Gpu.Buffer<'b>` | 非対応カーネル実行・デバイス上限超過でトラップ | バッファを消費し、各要素に厳密カーネルを適用した新バッファを返す |
| `Gpu.init_relaxed` | `ref Gpu.Device -> i64 -> (i32 -> 'a) -> Gpu.Buffer<'a>` | `count` 範囲外・デバイスエラーでトラップ | GPU 上で `f32` / `f16` の緩和浮動小数点規則を許可してバッファを生成（CPU 参照では厳密評価） |
| `Gpu.map_relaxed` | `Copy<'a> => ref Gpu.Device -> ('a -> 'b) -> Gpu.Buffer<'a> -> Gpu.Buffer<'b>` | デバイスエラーでトラップ | GPU 上で緩和浮動小数点規則を許可して各要素を変換（CPU 参照では厳密評価） |
| `Gpu.from_array` | `Copy<'a> => ref Gpu.Device -> ref ['a] -> Gpu.Buffer<'a>` | なし | ホスト配列を複製して `Buffer<'a>` を作成 |
| `Gpu.to_array` | `Gpu.Buffer<'a> -> ['a]` | なし | バッファを消費してホスト配列 `['a]` を取り出す |

```tsuzuri run=relaxed_sum%3D3.5%20roundtrip%3D%5B7%2C%208%2C%209%5D
let dev = Result.get (Gpu.request Gpu.CpuReference)
let rbuf = Gpu.init_relaxed (ref dev) 4 (\i -> (i as f32) * 0.5f32 + 0.125f32)
let rsum = Array.sum (Gpu.to_array rbuf)
let copy_buf = Gpu.from_array (ref dev) [7, 8, 9]
$"relaxed_sum={rsum} roundtrip={Gpu.to_array copy_buf}"
```

## バックエンド別の対応型・カーネル制約・シェーダー出力

カーネルコールバックには環境をキャプチャしない静的な関数またはラムダのみを指定でき、内部で使用できるのはスカラー局所変数・算術/ビット/比較演算・キャスト・`if` 分岐・既知の純粋スカラー関数呼び出しに限られます（ループ・再帰・ヒープ確保・借用・`assert` は `E1018`、式ノード上限や WGSL の 127 段ネスト上限超過は `E1017`）。整数の `/`・`%` および累乗 `**` は GPU シェーダーで言語のトラップ契約を再現できないため全バックエンドで拒否されます。

| バックエンド / CLI 出力 | 厳密モード対応レーン | 緩和モード（`*_relaxed`）対応レーン | 実行時ライブラリ・ターゲット要件 |
| --- | --- | --- | --- |
| `CpuReference` | `i32`, `i32u`, `i64`, `i64u`, `f16`, `f32`, `f64` | 同左（常に厳密評価） | 追加依存なし（全プラットフォーム・WASM 対応） |
| `WebGpu` / `--emit wgsl[-relaxed]` | `i32`, `i32u` | `i32`, `i32u`, `f32`, `f16`（要 `shader-f16`） | ネイティブは `wgpu-native` v29 を動的ロード（`TSUZURI_WEBGPU_LIBRARY`）、WASM は `--wasm-feature webgpu` + JSPI ホスト |
| `Vulkan` / `--emit spirv[-relaxed]` | `i32`, `i32u`, `i64`/`i64u`（要 `shaderInt64`）, `f32`（要 float controls + 27 レーン適合プローブ通過、`f32` の `/` は不可） | `i32`, `i32u`, `f32`（`/` 可、`f32`→整数キャスト不可） | ネイティブ専用。Vulkan ローダーを安全パスまたは `TSUZURI_VULKAN_LIBRARY` から動的ロード |
| `Auto` | カーネル単位で `CpuReference` または統合 GPU の `Vulkan` を自動選択 | 同左 | コスト閾値は `TSUZURI_GPU_AUTO_MIN_WORK`、判定ログは `TSUZURI_GPU_DEBUG=1` で確認可能 |

単一のエクスポート関数 `export def kernel :: ...` のみを持つソースファイルに対して `tsuzuri build Kernel.tz --emit wgsl`（または `wgsl-relaxed` / `spirv` / `spirv-relaxed`）を実行すると、外部シェーダーコンパイラに依存せず決定論的な WGSL / SPIR-V 1.3 コンピュートシェーダーを直接出力できます。

## 現在の制限事項

- `Gpu.Cuda` と `Gpu.Metal` は未実装であり、常に `Unavailable` を返します。
- GPU デバイスメモリ上に常駐するバッファはまだなく、`init` / `map` の呼び出しごとにホスト配列との転送とフェンス完了待ちが発生します。
- 2 次元インデックスや総和ループを含むカーネル（行列積など）は記述できません。
- `Gpu.Auto` のコストモデル定数は Apple Silicon 統合 GPU（MoltenVK）での実測に基づく経験則であり、離散 GPU や WebGPU は `Auto` の自動選択対象に含まれません。

## 関連項目

- [Simd](simd.md)
- [Matrix](matrix.md)
- [Parallel](../sync/parallel.md)
- [Result](../core/result.md)
- [パッケージ管理](../../modules/packages.md)
- [コンパイラオプション](../../compiler/options.md)
- [WebAssembly](../../compiler/webassembly.md)
- [標準ライブラリの設計規約](../conventions.md)
